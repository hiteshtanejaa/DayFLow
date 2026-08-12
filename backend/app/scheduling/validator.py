"""Deterministic post-processing validation.

Runs on every schedule before it reaches the user or the calendar API —
this is the hallucination-mitigation layer described in the proposal's
Legal/Ethical section (and one of the RQ1 automated metrics: hallucination
rate = proportion of outputs with hard-constraint violations).
"""
from __future__ import annotations

from datetime import datetime

from app.models.schemas import BusySlot, ScheduleBlock, ScheduleViolation
from app.scheduling.engine import _naive


def validate_schedule(
    blocks: list[ScheduleBlock],
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
) -> list[ScheduleViolation]:
    # blocks coming out of build_schedule are already naive (it normalizes
    # internally); day_start/day_end/busy here are the caller's originals
    # and may not be — normalize everything to the same footing before
    # any comparison. See engine._naive for why this matters.
    day_start = _naive(day_start)
    day_end = _naive(day_end)
    violations: list[ScheduleViolation] = []
    ordered = sorted(blocks, key=lambda b: _naive(b.start))

    for block in ordered:
        block_start = _naive(block.start)
        block_end = _naive(block.end)
        if block_start < day_start or block_end > day_end:
            violations.append(
                ScheduleViolation(
                    block_id=block.id,
                    reason=f"'{block.title}' scheduled outside working hours",
                )
            )
        for slot in busy:
            slot_start, slot_end = _naive(slot.start), _naive(slot.end)
            if block_start < slot_end and block_end > slot_start:
                violations.append(
                    ScheduleViolation(
                        block_id=block.id,
                        reason=f"'{block.title}' conflicts with an existing calendar event",
                    )
                )

    for i in range(len(ordered) - 1):
        if _naive(ordered[i].end) > _naive(ordered[i + 1].start):
            violations.append(
                ScheduleViolation(
                    block_id=ordered[i + 1].id,
                    reason=f"'{ordered[i + 1].title}' overlaps with '{ordered[i].title}'",
                )
            )

    return violations
