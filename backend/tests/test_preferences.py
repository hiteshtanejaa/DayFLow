from datetime import datetime

from app.models.schemas import (
    PreferenceCategory as C,
    RelativeOrder,
    Task,
    TaskPreference,
    TimeWindow,
)
from app.scheduling.engine import build_schedule
from app.scheduling.validator import check_preferences

DAY = (datetime(2026, 8, 12, 8), datetime(2026, 8, 12, 20))


def _tasks():
    return [
        Task(title="Gym", duration_minutes=60),
        Task(title="Dinner with friends", duration_minutes=90),
        Task(title="Protein shake", duration_minutes=10),
    ]


def test_time_window_honoured_even_with_reworded_title():
    # preference title differs from task title (real bug: separate LLM extractions)
    prefs = [TaskPreference(task_title="Have dinner with friends", category=C.TIME_WINDOW, time_window=TimeWindow.EVENING)]
    blocks = build_schedule(_tasks(), *DAY, [], prefs)
    dinner = next(b for b in blocks if b.title == "Dinner with friends")
    assert dinner.start.hour >= 17
    assert check_preferences(blocks, prefs) == []


def test_relative_order_after():
    prefs = [TaskPreference(task_title="Protein shake", category=C.RELATIVE_ORDER, relative_order=RelativeOrder.AFTER, reference_task="Gym")]
    blocks = {b.title: b for b in build_schedule(_tasks(), *DAY, [], prefs)}
    assert blocks["Protein shake"].start >= blocks["Gym"].end
    assert check_preferences(list(blocks.values()), prefs) == []


def test_violation_is_flagged_not_fixed():
    # no preferences passed to the engine, so gym lands in the morning
    blocks = build_schedule(_tasks(), *DAY, [])
    prefs = [TaskPreference(task_title="Gym", category=C.TIME_WINDOW, time_window=TimeWindow.EVENING)]
    assert len(check_preferences(blocks, prefs)) == 1
