"""Deterministic, LLM-free time-blocking engine.

This module is deliberately kept free of any model calls. It serves three
roles at once:
  1. The actual scheduling math behind both orchestration modes — the LLM
     reasons about ordering and produces user-facing explanation text, but
     the wall-clock placement of blocks always comes from here.
  2. The ground-truth generator for the RQ1 synthetic benchmark (50
     disruption scenarios need a known-correct answer to score against).
  3. Baseline C in the RQ2 human study ("rule-based deterministic scheduler
     with no LLM").
"""
from __future__ import annotations

from datetime import datetime, timedelta

from app.models.schemas import BusySlot, EnergyLevel, ScheduleBlock, Task

ENERGY_ORDER = {EnergyLevel.HIGH: 0, EnergyLevel.MEDIUM: 1, EnergyLevel.LOW: 2}


def _naive(dt: datetime) -> datetime:
    """Strip timezone info so every comparison in this module is
    apples-to-apples. The engine treats a schedule as one day's wall-clock
    time, not a genuine cross-timezone span. Real trigger for this: the
    hierarchical mode's Intake Agent has `fixed_start` available on the
    full Task schema (ReAct's tool schema doesn't expose it at all) and
    can return a timezone-aware datetime inferred from phrases like
    "moved to 3pm" — that then crashes comparison against every other
    datetime in the request, which is naive. Normalizing at the engine
    boundary is more robust than trying to keep every caller (web request,
    benchmark scenario, LLM-inferred field) consistently aware or naive.
    """
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def find_free_slots(
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
    min_slot_minutes: int = 15,
) -> list[tuple[datetime, datetime]]:
    """Return free intervals within [day_start, day_end], carving out busy slots."""
    day_start = _naive(day_start)
    day_end = _naive(day_end)
    ordered = sorted(busy, key=lambda b: _naive(b.start))
    free: list[tuple[datetime, datetime]] = []
    cursor = day_start

    for slot in ordered:
        slot_start = max(_naive(slot.start), day_start)
        slot_end = min(_naive(slot.end), day_end)
        if slot_start > cursor and (slot_start - cursor) >= timedelta(minutes=min_slot_minutes):
            free.append((cursor, slot_start))
        cursor = max(cursor, slot_end)

    if cursor < day_end and (day_end - cursor) >= timedelta(minutes=min_slot_minutes):
        free.append((cursor, day_end))

    return free


def _urgency_key(task: Task) -> tuple[datetime, int]:
    deadline_key = _naive(task.deadline) if task.deadline else datetime.max
    return (deadline_key, task.priority)


def build_schedule(
    tasks: list[Task],
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
) -> list[ScheduleBlock]:
    """Greedy time-blocker: fixed-time tasks are placed first (they define
    additional busy slots), then flexible tasks are placed into remaining
    free slots, high-energy tasks first (a simple proxy for morning
    cognitive peak — worth revisiting against real usage data in Phase 2).
    """
    day_start = _naive(day_start)
    day_end = _naive(day_end)
    fixed = [t for t in tasks if t.fixed_start is not None]
    flexible = [t for t in tasks if t.fixed_start is None]

    blocks: list[ScheduleBlock] = []
    occupied = list(busy)

    for task in fixed:
        start = _naive(task.fixed_start)
        end = start + timedelta(minutes=task.duration_minutes)
        blocks.append(
            ScheduleBlock(
                task_id=task.id or task.title,
                title=task.title,
                start=start,
                end=end,
                energy_required=task.energy_required,
            )
        )
        occupied.append(BusySlot(start=start, end=end, source="fixed"))

    flexible_ordered = sorted(
        flexible, key=lambda t: (ENERGY_ORDER[t.energy_required], _urgency_key(t))
    )

    for task in flexible_ordered:
        free_slots = find_free_slots(
            day_start, day_end, occupied, min_slot_minutes=task.duration_minutes
        )
        placed = False
        for slot_start, slot_end in free_slots:
            if (slot_end - slot_start) >= timedelta(minutes=task.duration_minutes):
                start = slot_start
                end = start + timedelta(minutes=task.duration_minutes)
                blocks.append(
                    ScheduleBlock(
                        task_id=task.id or task.title,
                        title=task.title,
                        start=start,
                        end=end,
                        energy_required=task.energy_required,
                    )
                )
                occupied.append(BusySlot(start=start, end=end, source="scheduled"))
                placed = True
                break

        if not placed:
            # Unplaceable within working hours — flagged by the validator
            # as a violation rather than silently dropped from the plan.
            blocks.append(
                ScheduleBlock(
                    task_id=task.id or task.title,
                    title=task.title,
                    start=day_end,
                    end=day_end + timedelta(minutes=task.duration_minutes),
                    energy_required=task.energy_required,
                    status="failed",
                )
            )

    return sorted(blocks, key=lambda b: b.start)
