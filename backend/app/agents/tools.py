"""LLM-facing tool implementations shared by both orchestration modes.

Keeping identical tools for the ReAct and hierarchical variants is required
for a fair RQ1 comparison — only the orchestration pattern should differ,
never the available actions or the underlying scheduling math.
"""
from __future__ import annotations

from datetime import datetime

from app.models.schemas import BusySlot, ScheduleBlock, ScheduleViolation, Task
from app.scheduling.engine import build_schedule, find_free_slots
from app.scheduling.validator import validate_schedule


def tool_find_free_slots(
    day_start: datetime, day_end: datetime, busy: list[BusySlot]
) -> list[dict]:
    slots = find_free_slots(day_start, day_end, busy)
    return [{"start": s.isoformat(), "end": e.isoformat()} for s, e in slots]


def tool_propose_schedule(
    tasks: list[Task], day_start: datetime, day_end: datetime, busy: list[BusySlot]
) -> list[ScheduleBlock]:
    return build_schedule(tasks, day_start, day_end, busy)


def tool_detect_conflicts(
    blocks: list[ScheduleBlock],
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
) -> list[ScheduleViolation]:
    return validate_schedule(blocks, day_start, day_end, busy)
