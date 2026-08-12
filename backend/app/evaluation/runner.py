"""Executes the benchmark: every scenario x both orchestration modes.

Resumable by design — writes results incrementally to a JSON file and
skips (scenario, mode) pairs already present on re-run. 100 live API
calls have a real chance of a transient failure partway through; losing
90 completed calls to one timeout would be a bad way to spend real
credits twice.

`dry_run=True` skips the API entirely and uses the scenario's own ground
truth as the "produced" output — validates the whole scoring/stats
pipeline for $0 before spending anything real.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from app.agents.pipeline import run_hierarchical, run_react
from app.evaluation.scenarios import DisruptionScenario, generate_scenarios
from app.models.schemas import ScheduleBlock, ScheduleViolation


class ScenarioResult(BaseModel):
    scenario_id: str
    disruption_type: str
    mode: str
    had_conflict_risk: bool
    produced_blocks: list[ScheduleBlock]
    ground_truth_blocks: list[ScheduleBlock]
    violations: list[ScheduleViolation]
    extracted_titles: list[str]
    ground_truth_titles: list[str]
    total_latency_ms: float
    total_tokens_input: int
    total_tokens_output: int
    error: Optional[str] = None


def _run_dry(scenario: DisruptionScenario, mode: str) -> ScenarioResult:
    gt_blocks = scenario.ground_truth_blocks()
    return ScenarioResult(
        scenario_id=scenario.id,
        disruption_type=scenario.disruption_type,
        mode=mode,
        had_conflict_risk=scenario.has_conflict_risk,
        produced_blocks=gt_blocks,
        ground_truth_blocks=gt_blocks,
        violations=[],
        extracted_titles=[t.title for t in scenario.ground_truth_tasks],
        ground_truth_titles=[t.title for t in scenario.ground_truth_tasks],
        total_latency_ms=0.0,
        total_tokens_input=0,
        total_tokens_output=0,
    )


def _run_live(scenario: DisruptionScenario, mode: str) -> ScenarioResult:
    runner = run_react if mode == "react" else run_hierarchical
    try:
        schedule, logs = runner(scenario.transcript, scenario.day_start, scenario.day_end, scenario.busy_slots)
        return ScenarioResult(
            scenario_id=scenario.id,
            disruption_type=scenario.disruption_type,
            mode=mode,
            had_conflict_risk=scenario.has_conflict_risk,
            produced_blocks=schedule.blocks,
            ground_truth_blocks=scenario.ground_truth_blocks(),
            violations=schedule.violations,
            extracted_titles=[b.title for b in schedule.blocks],
            ground_truth_titles=[t.title for t in scenario.ground_truth_tasks],
            total_latency_ms=sum(l.latency_ms for l in logs),
            total_tokens_input=sum(l.tokens_input or 0 for l in logs),
            total_tokens_output=sum(l.tokens_output or 0 for l in logs),
        )
    except Exception as e:  # noqa: BLE001 — deliberately broad: one bad
        # scenario must not kill a 100-call run; record and keep going.
        return ScenarioResult(
            scenario_id=scenario.id,
            disruption_type=scenario.disruption_type,
            mode=mode,
            had_conflict_risk=scenario.has_conflict_risk,
            produced_blocks=[],
            ground_truth_blocks=scenario.ground_truth_blocks(),
            violations=[],
            extracted_titles=[],
            ground_truth_titles=[t.title for t in scenario.ground_truth_tasks],
            total_latency_ms=0.0,
            total_tokens_input=0,
            total_tokens_output=0,
            error=str(e),
        )


def _load_existing(path: Path) -> dict[tuple[str, str], ScenarioResult]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {(r["scenario_id"], r["mode"]): ScenarioResult(**r) for r in data}


def _save(path: Path, results: dict[tuple[str, str], ScenarioResult]) -> None:
    path.write_text(json.dumps([r.model_dump(mode="json") for r in results.values()], indent=2))


def run_benchmark(
    output_path: str,
    n_scenarios: int = 50,
    dry_run: bool = False,
    scenario_limit_per_type: Optional[int] = None,
    modes: tuple[str, ...] = ("react", "hierarchical"),
) -> list[ScenarioResult]:
    path = Path(output_path)
    existing = _load_existing(path)

    scenarios = generate_scenarios(n_scenarios)
    if scenario_limit_per_type is not None:
        seen_per_type: dict[str, int] = {}
        limited = []
        for s in scenarios:
            count = seen_per_type.get(s.disruption_type, 0)
            if count < scenario_limit_per_type:
                limited.append(s)
                seen_per_type[s.disruption_type] = count + 1
        scenarios = limited

    total = len(scenarios) * len(modes)
    done = 0
    for scenario in scenarios:
        for mode in modes:
            key = (scenario.id, mode)
            done += 1
            if key in existing:
                print(f"[{done}/{total}] {scenario.id} / {mode} — skipped (already in {output_path})")
                continue
            print(f"[{done}/{total}] {scenario.id} / {mode} — running...", end=" ", flush=True)
            result = _run_dry(scenario, mode) if dry_run else _run_live(scenario, mode)
            existing[key] = result
            _save(path, existing)  # incremental save — survives a crash mid-run
            status = "ERROR: " + result.error if result.error else f"{result.total_latency_ms:.0f}ms"
            print(status)

    return list(existing.values())
