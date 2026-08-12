from datetime import datetime

from app.models.schemas import BusySlot, EnergyLevel, Task
from app.scheduling.engine import build_schedule, find_free_slots
from app.scheduling.validator import validate_schedule


def _dt(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, 10, hour, minute)


def test_find_free_slots_carves_out_busy_time():
    busy = [BusySlot(start=_dt(10), end=_dt(11))]
    free = find_free_slots(_dt(9), _dt(12), busy)
    assert free == [(_dt(9), _dt(10)), (_dt(11), _dt(12))]


def test_build_schedule_avoids_conflicts_and_working_hours():
    tasks = [
        Task(id="t1", title="Gym", duration_minutes=60, energy_required=EnergyLevel.LOW, priority=3),
        Task(id="t2", title="Interview prep", duration_minutes=90, energy_required=EnergyLevel.HIGH, priority=1),
    ]
    busy = [BusySlot(start=_dt(12), end=_dt(13))]
    day_start, day_end = _dt(8), _dt(20)

    blocks = build_schedule(tasks, day_start, day_end, busy)
    violations = validate_schedule(blocks, day_start, day_end, busy)

    assert len(blocks) == 2
    assert not violations


def test_high_energy_task_scheduled_before_low_energy_task():
    tasks = [
        Task(id="low", title="Admin", duration_minutes=30, energy_required=EnergyLevel.LOW),
        Task(id="high", title="Deep work", duration_minutes=30, energy_required=EnergyLevel.HIGH),
    ]
    blocks = build_schedule(tasks, _dt(9), _dt(17), [])
    by_id = {b.task_id: b for b in blocks}
    assert by_id["high"].start < by_id["low"].start


def test_unplaceable_task_is_flagged_not_dropped():
    tasks = [Task(id="t1", title="Impossible", duration_minutes=999_999, priority=1)]
    day_start, day_end = _dt(8), _dt(20)
    blocks = build_schedule(tasks, day_start, day_end, [])
    assert blocks[0].status == "failed"


def test_fixed_start_task_creates_busy_slot_for_others():
    fixed_time = _dt(10)
    tasks = [
        Task(id="meeting", title="Meeting", duration_minutes=60, fixed_start=fixed_time),
        Task(id="flex", title="Flexible", duration_minutes=30, energy_required=EnergyLevel.HIGH),
    ]
    blocks = build_schedule(tasks, _dt(8), _dt(20), [])
    violations = validate_schedule(blocks, _dt(8), _dt(20), [])
    assert not violations
