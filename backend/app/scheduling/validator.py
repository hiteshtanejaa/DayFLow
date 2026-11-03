"""Deterministic post-processing validation.

Runs on every schedule before it reaches the user or the calendar API —
this is the hallucination-mitigation layer described in the proposal's
Legal/Ethical section (and one of the RQ1 automated metrics: hallucination
rate = proportion of outputs with hard-constraint violations).
"""
from __future__ import annotations

from datetime import datetime

from app.models.schemas import (
    TIME_WINDOW_HOURS,
    BusySlot,
    PreferenceCategory,
    PreferenceViolation,
    RelativeOrder,
    ScheduleBlock,
    ScheduleViolation,
    TaskPreference,
)
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


def _norm(title: str) -> str:
    return title.strip().lower()


def _format_clock(dt: datetime) -> str:
    dt = _naive(dt)
    return dt.strftime("%I:%M %p").lstrip("0") or "12:00 AM"


def _find_block(blocks: list[ScheduleBlock], title: str) -> ScheduleBlock | None:
    target = _norm(title)
    for b in blocks:
        if _norm(b.title) == target:
            return b
    # Fallback: substring match, same documented simplification as
    # evaluation/metrics._titles_match — clarification questions and the
    # original intake sometimes phrase the same task slightly differently
    # (e.g. "gym" vs "gym session").
    for b in blocks:
        norm_b = _norm(b.title)
        if target in norm_b or norm_b in target:
            return b
    return None


def check_preferences(
    blocks: list[ScheduleBlock],
    preferences: list[TaskPreference],
) -> list[PreferenceViolation]:
    """Mechanical check of the built schedule against clarified soft
    preferences (see TaskPreference). Deliberately not an LLM judgment
    call — a typed preference is checked the same fixed way every time, so
    a flagged mismatch means the same thing regardless of which
    orchestration mode produced the schedule. Never auto-corrects; the
    caller (main.py) surfaces these to the user instead of silently
    rearranging anything a second time.
    """
    violations: list[PreferenceViolation] = []

    for pref in preferences:
        block = _find_block(blocks, pref.task_title)
        if block is None or block.status == "failed":
            continue  # unplaceable tasks are already flagged by validate_schedule

        if pref.category == PreferenceCategory.TIME_WINDOW and pref.time_window:
            lo, hi = TIME_WINDOW_HOURS[pref.time_window]
            start = _naive(block.start)
            start_hour = start.hour + start.minute / 60
            if not (lo <= start_hour < hi):
                violations.append(
                    PreferenceViolation(
                        task_title=block.title,
                        category=pref.category,
                        message=(
                            f"You wanted '{block.title}' in the {pref.time_window.value}, "
                            f"but it landed at {_format_clock(block.start)}."
                        ),
                    )
                )

        elif (
            pref.category == PreferenceCategory.RELATIVE_ORDER
            and pref.relative_order
            and pref.reference_task
        ):
            ref_block = _find_block(blocks, pref.reference_task)
            if ref_block is None or ref_block.status == "failed":
                continue
            if pref.relative_order == RelativeOrder.AFTER:
                ok = _naive(block.start) >= _naive(ref_block.end)
                relation = "after"
            else:
                ok = _naive(block.end) <= _naive(ref_block.start)
                relation = "before"
            if not ok:
                violations.append(
                    PreferenceViolation(
                        task_title=block.title,
                        category=pref.category,
                        message=(
                            f"You wanted '{block.title}' {relation} '{ref_block.title}', "
                            f"but '{block.title}' is at {_format_clock(block.start)} and "
                            f"'{ref_block.title}' is at {_format_clock(ref_block.start)}."
                        ),
                    )
                )

        elif pref.category == PreferenceCategory.ENERGY_MATCH and pref.energy_slot:
            if block.energy_required != pref.energy_slot:
                violations.append(
                    PreferenceViolation(
                        task_title=block.title,
                        category=pref.category,
                        message=(
                            f"You wanted '{block.title}' treated as {pref.energy_slot.value} "
                            f"energy, but it was scheduled as {block.energy_required.value}."
                        ),
                    )
                )

    return violations
