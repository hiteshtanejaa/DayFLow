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

from app.models.schemas import (
    TIME_WINDOW_HOURS,
    BusySlot,
    EnergyLevel,
    PreferenceCategory,
    RelativeOrder,
    ScheduleBlock,
    Task,
    TaskPreference,
)

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


def _norm(title: str) -> str:
    return title.strip().lower()


def _prefs_for_task(title: str, preferences: list[TaskPreference]) -> list[TaskPreference]:
    """Fuzzy, not an exact dict lookup — and deliberately so. A
    preference's task_title comes from the clarification loop's own
    extract_intent call, while `title` here comes from whichever
    orchestration mode is building the schedule running its *own*,
    independent (and non-deterministic) extraction. The two routinely
    word the same task slightly differently ("Have dinner with friends"
    vs "Dinner with friends") — this uses the same substring-containment
    fallback as validator._find_block and evaluation/metrics._titles_match
    so a preference actually reaches the engine that's meant to honor it,
    not just the check that reports it was missed.
    """
    target = _norm(title)
    exact = [p for p in preferences if _norm(p.task_title) == target]
    if exact:
        return exact
    return [
        p
        for p in preferences
        if target in _norm(p.task_title) or _norm(p.task_title) in target
    ]


def _find_placed(blocks: list[ScheduleBlock], title: str) -> ScheduleBlock | None:
    target = _norm(title)
    for b in blocks:
        if _norm(b.title) == target:
            return b
    return None


def _make_block(task: Task, start: datetime, failed: bool = False) -> ScheduleBlock:
    end = start + timedelta(minutes=task.duration_minutes)
    return ScheduleBlock(
        task_id=task.id or task.title,
        title=task.title,
        start=start,
        end=end,
        energy_required=task.energy_required,
        status="failed" if failed else "pending",
    )


def _preferred_window(
    task: Task, preferences: list[TaskPreference], day_start: datetime, day_end: datetime
) -> tuple[datetime, datetime]:
    """Soft, best-effort — see check_preferences (validator.py) for what
    happens when a placement can't honor this."""
    tw = next(
        (
            p
            for p in _prefs_for_task(task.title, preferences)
            if p.category == PreferenceCategory.TIME_WINDOW and p.time_window
        ),
        None,
    )
    if not tw:
        return day_start, day_end
    lo_h, hi_h = TIME_WINDOW_HOURS[tw.time_window]
    midnight = day_start.replace(hour=0, minute=0, second=0, microsecond=0)
    lo = max(day_start, midnight + timedelta(hours=lo_h))
    hi = min(day_end, midnight + timedelta(hours=hi_h))
    return lo, hi


def _preferred_order_bounds(
    task: Task,
    preferences: list[TaskPreference],
    placed_so_far: list[ScheduleBlock],
    day_start: datetime,
    day_end: datetime,
) -> tuple[datetime, datetime]:
    """Single pairwise only (no dependency chains) — the reference task
    must already be in placed_so_far or this is a no-op constraint."""
    ro = next(
        (
            p
            for p in _prefs_for_task(task.title, preferences)
            if p.category == PreferenceCategory.RELATIVE_ORDER and p.relative_order and p.reference_task
        ),
        None,
    )
    if not ro:
        return day_start, day_end
    ref = _find_placed(placed_so_far, ro.reference_task)
    if ref is None:
        return day_start, day_end
    if ro.relative_order == RelativeOrder.AFTER:
        return max(day_start, ref.end), day_end
    return day_start, min(day_end, ref.start)


def build_schedule(
    tasks: list[Task],
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
    preferences: list[TaskPreference] | None = None,
) -> list[ScheduleBlock]:
    """Greedy time-blocker: fixed-time tasks are placed first (they define
    additional busy slots), then flexible tasks are placed into remaining
    free slots, high-energy tasks first (a simple proxy for morning
    cognitive peak — worth revisiting against real usage data in Phase 2).

    `preferences` (from the clarification loop) are soft constraints: a
    time-window preference narrows the search window before falling back
    to the full day, and a relative-order preference narrows it to before
    or after an already-placed reference task. Both are best-effort — if
    honoring one leaves no free slot at all, the task still gets placed
    using the normal full-day search rather than dropped, and the mismatch
    is left for check_preferences (validator.py) to flag rather than
    silently forced or silently ignored.
    """
    day_start = _naive(day_start)
    day_end = _naive(day_end)
    preferences = preferences or []
    fixed = [t for t in tasks if t.fixed_start is not None]
    flexible = [t for t in tasks if t.fixed_start is None]

    blocks: list[ScheduleBlock] = []
    occupied = list(busy)

    for task in fixed:
        block = _make_block(task, _naive(task.fixed_start))
        blocks.append(block)
        occupied.append(BusySlot(start=block.start, end=block.end, source="fixed"))

    flexible_ordered = sorted(
        flexible, key=lambda t: (ENERGY_ORDER[t.energy_required], _urgency_key(t))
    )
    # Tasks with a relative-order preference are placed after everything
    # else, so their reference task (usually unconstrained) already has a
    # real placement to anchor against — a single extra pass is enough
    # since only pairwise (not chained) ordering is supported.
    dependent = [
        t
        for t in flexible_ordered
        if any(
            p.category == PreferenceCategory.RELATIVE_ORDER
            for p in _prefs_for_task(t.title, preferences)
        )
    ]
    independent = [t for t in flexible_ordered if t not in dependent]

    for task in independent + dependent:
        window_start, window_end = _preferred_window(task, preferences, day_start, day_end)
        order_start, order_end = _preferred_order_bounds(task, preferences, blocks, day_start, day_end)
        search_start = max(window_start, order_start)
        search_end = min(window_end, order_end)

        block = None
        if search_start < search_end:
            for slot_start, slot_end in find_free_slots(
                search_start, search_end, occupied, min_slot_minutes=task.duration_minutes
            ):
                if (slot_end - slot_start) >= timedelta(minutes=task.duration_minutes):
                    block = _make_block(task, slot_start)
                    break

        if block is None:
            # Preference couldn't be honored (or none was given) — fall
            # back to the unconstrained full-day search.
            for slot_start, slot_end in find_free_slots(
                day_start, day_end, occupied, min_slot_minutes=task.duration_minutes
            ):
                if (slot_end - slot_start) >= timedelta(minutes=task.duration_minutes):
                    block = _make_block(task, slot_start)
                    break

        if block is not None:
            blocks.append(block)
            occupied.append(BusySlot(start=block.start, end=block.end, source="scheduled"))
        else:
            # Unplaceable within working hours at all — flagged by the
            # validator as a violation rather than silently dropped.
            blocks.append(_make_block(task, day_end, failed=True))

    return sorted(blocks, key=lambda b: b.start)
