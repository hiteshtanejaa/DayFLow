"""Synthetic disruption scenario generator — RQ1 benchmark (Step 6).

Produces 50 scenarios spanning the four disruption types named in the
proposal (meeting moved, task overrun, urgent task injected, energy-level
change), each with:

  - a natural-language transcript (fed to the Intake Agent, same as a real
    morning intake — this benchmarks the same capability Step 8's live
    re-optimization will invoke, without needing Step 8's mid-session
    polling infrastructure to exist first)
  - a structured ground-truth task list (for intent-extraction F1)
  - pre-existing busy slots on some scenarios (to test conflict resolution)

Ground truth is deterministic and reproducible: fixed random seed, and the
"optimal" schedule for each scenario is computed by our own engine
(build_schedule) — the same deterministic function that both orchestration
modes call internally, and the one the proposal names as Baseline C. This
is a defensible ground truth for scoring the LLM layer specifically
(intent extraction + prose reasoning) since the placement math is provably
identical either way; it is NOT a substitute for independent human review
of a sample before you call this "human-annotated ground truth" in a
methods section — flag that gap explicitly rather than overclaiming it.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel

from app.models.schemas import BusySlot, EnergyLevel, ScheduleBlock, Task
from app.scheduling.engine import build_schedule

SEED = 42
SCENARIO_DAY = datetime(2026, 8, 10)
DAY_START = SCENARIO_DAY.replace(hour=8, minute=0)
DAY_END = SCENARIO_DAY.replace(hour=20, minute=0)

DisruptionType = Literal[
    "meeting_moved", "task_overrun", "urgent_task_injected", "energy_level_change"
]

TASK_POOL = [
    ("Interview prep", EnergyLevel.HIGH),
    ("Gym", EnergyLevel.LOW),
    ("Coursework", EnergyLevel.HIGH),
    ("Team meeting", EnergyLevel.MEDIUM),
    ("Grocery shopping", EnergyLevel.LOW),
    ("Essay draft", EnergyLevel.HIGH),
    ("Code review", EnergyLevel.MEDIUM),
    ("Laundry", EnergyLevel.LOW),
    ("Doctor's appointment", EnergyLevel.MEDIUM),
    ("Project presentation prep", EnergyLevel.HIGH),
    ("Study session", EnergyLevel.HIGH),
    ("Job application", EnergyLevel.MEDIUM),
    ("Meal prep", EnergyLevel.LOW),
    ("Call with advisor", EnergyLevel.MEDIUM),
    ("Read research paper", EnergyLevel.HIGH),
    ("Write cover letter", EnergyLevel.MEDIUM),
    ("Clean apartment", EnergyLevel.LOW),
]

DURATIONS = [30, 45, 60, 90, 120]


class DisruptionScenario(BaseModel):
    id: str
    disruption_type: DisruptionType
    transcript: str
    ground_truth_tasks: list[Task]
    busy_slots: list[BusySlot]
    day_start: datetime
    day_end: datetime

    @property
    def has_conflict_risk(self) -> bool:
        return len(self.busy_slots) > 0

    def ground_truth_blocks(self) -> list[ScheduleBlock]:
        return build_schedule(self.ground_truth_tasks, self.day_start, self.day_end, self.busy_slots)


def _pick_tasks(rng: random.Random, n: int) -> list[tuple[str, EnergyLevel]]:
    return rng.sample(TASK_POOL, n)


def _build_task(rng: random.Random, title: str, energy: EnergyLevel, priority: int) -> Task:
    return Task(
        title=title,
        duration_minutes=rng.choice(DURATIONS),
        energy_required=energy,
        priority=priority,
    )


_ENERGY_PHRASE = {
    EnergyLevel.HIGH: "high-energy",
    EnergyLevel.MEDIUM: "medium-energy",
    EnergyLevel.LOW: "low-energy",
}


def _task_clause(task: Task) -> str:
    # Duration and energy are stated explicitly, not left for the model to
    # guess. Root fix for a real benchmark bug: ground truth previously
    # assigned random durations/energy the transcript never mentioned, so
    # "scheduling accuracy" was scoring the model against information it
    # was never given — 0-2% accuracy despite 95%+ intent-extraction F1.
    # The proposal's own illustrative example states durations explicitly
    # ("90 minutes of prep") — this matches that, extended to energy so
    # the ground truth ordering (which sorts by energy) is reconstructable
    # too, not just each task's duration.
    return f"a {task.duration_minutes}-minute {_ENERGY_PHRASE[task.energy_required]} {task.title.lower()} block"


def _render_transcript(tasks: list[Task], mood_clause: str) -> str:
    clauses = [_task_clause(t) for t in tasks]
    if len(clauses) == 1:
        task_clause = clauses[0]
    else:
        task_clause = ", ".join(clauses[:-1]) + f", and {clauses[-1]}"
    return f"Today I have {task_clause}. {mood_clause}"


def _meeting_moved(rng: random.Random, idx: int) -> DisruptionScenario:
    picks = _pick_tasks(rng, 3)
    tasks = [_build_task(rng, t, e, i + 1) for i, (t, e) in enumerate(picks)]
    # The "moved meeting" becomes a fixed_start commitment later in the day.
    moved_hour = rng.choice([14, 15, 16, 17])
    tasks[0].fixed_start = SCENARIO_DAY.replace(hour=moved_hour, minute=0)
    transcript = _render_transcript(
        tasks,
        f"My {tasks[0].title.lower()} got moved to {moved_hour % 12 or 12}pm — "
        "please rebuild the rest of my day around that.",
    )
    return DisruptionScenario(
        id=f"meeting_moved_{idx:02d}",
        disruption_type="meeting_moved",
        transcript=transcript,
        ground_truth_tasks=tasks,
        busy_slots=[],
        day_start=DAY_START,
        day_end=DAY_END,
    )


def _task_overrun(rng: random.Random, idx: int) -> DisruptionScenario:
    picks = _pick_tasks(rng, 3)
    tasks = [_build_task(rng, t, e, i + 1) for i, (t, e) in enumerate(picks)]
    # Simulate lost time: an existing busy slot eating into the morning.
    overrun_end_hour = rng.choice([10, 11, 12])
    busy = [BusySlot(start=DAY_START, end=SCENARIO_DAY.replace(hour=overrun_end_hour), source="fixed")]
    transcript = _render_transcript(
        tasks,
        f"My earlier task ran over and I'm only free from {overrun_end_hour % 12 or 12}pm onward — "
        "please fit everything into the remaining time.",
    )
    return DisruptionScenario(
        id=f"task_overrun_{idx:02d}",
        disruption_type="task_overrun",
        transcript=transcript,
        ground_truth_tasks=tasks,
        busy_slots=busy,
        day_start=DAY_START,
        day_end=DAY_END,
    )


def _urgent_task_injected(rng: random.Random, idx: int) -> DisruptionScenario:
    picks = _pick_tasks(rng, 2)
    tasks = [_build_task(rng, t, e, i + 2) for i, (t, e) in enumerate(picks)]
    urgent_title, urgent_energy = rng.choice(TASK_POOL)
    urgent = _build_task(rng, urgent_title, urgent_energy, 1)  # priority 1 = most urgent
    tasks.insert(0, urgent)
    transcript = _render_transcript(
        tasks,
        f"The {urgent.title.lower()} just came up urgently and needs to happen first — "
        "please slot everything else in around it.",
    )
    return DisruptionScenario(
        id=f"urgent_task_injected_{idx:02d}",
        disruption_type="urgent_task_injected",
        transcript=transcript,
        ground_truth_tasks=tasks,
        busy_slots=[],
        day_start=DAY_START,
        day_end=DAY_END,
    )


def _energy_level_change(rng: random.Random, idx: int) -> DisruptionScenario:
    picks = _pick_tasks(rng, 3)
    # Force every task to LOW energy to simulate a sudden energy crash —
    # ground truth should reflect a gentler ordering than the base pool's
    # natural energy split.
    tasks = [_build_task(rng, t, EnergyLevel.LOW, i + 1) for i, (t, _) in enumerate(picks)]
    transcript = _render_transcript(
        tasks,
        "I'm suddenly exhausted and only have energy for low-effort tasks today — "
        "please keep everything light.",
    )
    return DisruptionScenario(
        id=f"energy_level_change_{idx:02d}",
        disruption_type="energy_level_change",
        transcript=transcript,
        ground_truth_tasks=tasks,
        busy_slots=[],
        day_start=DAY_START,
        day_end=DAY_END,
    )


_GENERATORS = {
    "meeting_moved": _meeting_moved,
    "task_overrun": _task_overrun,
    "urgent_task_injected": _urgent_task_injected,
    "energy_level_change": _energy_level_change,
}


def generate_scenarios(n_total: int = 50, seed: int = SEED) -> list[DisruptionScenario]:
    """Deterministic given `seed` — re-running produces byte-identical
    scenarios, which matters for a reproducible dissertation benchmark."""
    rng = random.Random(seed)
    types = list(_GENERATORS.keys())
    per_type = n_total // len(types)
    remainder = n_total - per_type * len(types)

    scenarios: list[DisruptionScenario] = []
    for i, dtype in enumerate(types):
        count = per_type + (1 if i < remainder else 0)
        for j in range(count):
            scenarios.append(_GENERATORS[dtype](rng, j))
    return scenarios
