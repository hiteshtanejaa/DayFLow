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


def test_resolve_title_rejects_labels_that_are_not_one_task():
    from app.agents.pipeline import _resolve_title
    tasks = [Task(title="Gym", duration_minutes=60), Task(title="Deep work", duration_minutes=240)]
    assert _resolve_title("deep work", tasks) == "Deep work"
    assert _resolve_title("Gym and deep work timing", tasks) is None  # a topic naming two tasks, not a task
    assert _resolve_title("Yoga", tasks) is None


def test_task_ordered_against_itself_is_ignored():
    # real bug: loose title matching mapped made-up labels onto the same block
    blocks = build_schedule([Task(title="Deep work", duration_minutes=60)], *DAY, [])
    prefs = [TaskPreference(task_title="Gym and deep work timing", category=C.RELATIVE_ORDER,
                            relative_order=RelativeOrder.BEFORE, reference_task="Deep work")]
    assert check_preferences(blocks, prefs) == []


def test_fixed_time_tasks_are_not_given_inferred_conventions(monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    from app.models.schemas import AgentActionLog, EnergyLevel, IntakeResult, OrchestrationMode
    seen = {}
    tasks = [Task(title="Lunch", duration_minutes=30, fixed_start=datetime(2026, 8, 12, 17)),
             Task(title="Dinner", duration_minutes=60)]
    log = AgentActionLog(timestamp=datetime.utcnow(), orchestration_mode=OrchestrationMode.HIERARCHICAL,
                         agent_name="x", action="x", input_summary="", output_summary="", latency_ms=1.0)
    monkeypatch.setattr(main, "extract_intent", lambda *a, **k: (IntakeResult(tasks=tasks, user_energy_level=EnergyLevel.MEDIUM), log))
    monkeypatch.setattr(main, "infer_conventional_preferences", lambda ts: seen.setdefault("titles", [t.title for t in ts]) and [])
    monkeypatch.setattr(main, "generate_clarifying_question", lambda *a, **k: None)
    TestClient(main.app).post("/clarify/next", json={"transcript": "x", "day_start": "2026-08-12T08:00:00"})
    assert seen["titles"] == ["Dinner"]
