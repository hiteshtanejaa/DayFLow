from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import main, store
from app.models.schemas import AgentActionLog, OrchestrationMode, ProposedSchedule, Task
from app.scheduling.engine import build_schedule


def _fake_pipeline(*a, **kw):
    blocks = build_schedule([Task(title="Gym", duration_minutes=60)], datetime(2026, 8, 12, 8), datetime(2026, 8, 12, 20), [])
    sched = ProposedSchedule(blocks=blocks, reasoning_summary="ok", orchestration_mode=OrchestrationMode.HIERARCHICAL)
    log = AgentActionLog(timestamp=datetime.utcnow(), orchestration_mode=OrchestrationMode.HIERARCHICAL,
                         agent_name="A", action="x", input_summary="", output_summary="", latency_ms=1.0)
    return sched, [log]


def _count(model):
    with store._Session() as s:
        return s.scalar(select(func.count()).select_from(model))


def test_intake_persists_and_participant_delete_cascades(tmp_path, monkeypatch):
    store.configure(f"sqlite:///{tmp_path / 't.db'}")
    monkeypatch.setattr(main, "run_pipeline", _fake_pipeline)
    c = TestClient(main.app)
    pid = c.post("/participants").json()["participant_id"]
    body = {"transcript": "gym", "day_start": "2026-08-12T08:00:00", "day_end": "2026-08-12T20:00:00"}

    r = c.post("/intake", json=body, headers={"X-Participant-Id": pid})
    assert r.status_code == 200 and r.json()["schedule_id"]
    assert (_count(store.Schedule), _count(store.Block), _count(store.AgentAction)) == (1, 1, 1)

    assert c.post("/intake", json=body, headers={"X-Participant-Id": "nope"}).status_code == 404

    assert c.delete(f"/participants/{pid}").status_code == 204
    assert (_count(store.Schedule), _count(store.Block), _count(store.AgentAction)) == (0, 0, 0)
    assert c.delete(f"/participants/{pid}").status_code == 404


def _setup(tmp_path, monkeypatch, violations=()):
    store.configure(f"sqlite:///{tmp_path / 't.db'}")

    def pipe(*a, **kw):
        sched, logs = _fake_pipeline()
        sched.violations = list(violations)
        return sched, logs

    monkeypatch.setattr(main, "run_pipeline", pipe)
    c = TestClient(main.app)
    pid = c.post("/participants").json()["participant_id"]
    return c, {"X-Participant-Id": pid}


BODY = {"transcript": "gym", "day_start": "2026-08-12T08:00:00", "day_end": "2026-08-12T20:00:00"}


def test_confirm_commits_blocks_and_is_idempotent(tmp_path, monkeypatch):
    c, h = _setup(tmp_path, monkeypatch)
    sid = c.post("/intake", json=BODY, headers=h).json()["schedule_id"]
    assert c.post(f"/schedules/{sid}/confirm", headers=h).json()["status"] == "committed"
    assert c.post(f"/schedules/{sid}/confirm", headers=h).status_code == 200
    with store._Session() as s:
        assert {b.status for b in s.scalars(select(store.Block))} == {"committed"}
    assert c.post(f"/schedules/{sid}/reject", headers=h).status_code == 409  # cannot undo a commit


def test_confirm_refused_with_violations(tmp_path, monkeypatch):
    from app.models.schemas import ScheduleViolation
    c, h = _setup(tmp_path, monkeypatch, violations=[ScheduleViolation(reason="outside working hours")])
    sid = c.post("/intake", json=BODY, headers=h).json()["schedule_id"]
    assert c.post(f"/schedules/{sid}/confirm", headers=h).status_code == 409
    assert c.post(f"/schedules/{sid}/reject", headers=h).json()["status"] == "rejected"


def test_other_participant_cannot_decide(tmp_path, monkeypatch):
    c, h = _setup(tmp_path, monkeypatch)
    sid = c.post("/intake", json=BODY, headers=h).json()["schedule_id"]
    other = {"X-Participant-Id": c.post("/participants").json()["participant_id"]}
    assert c.post(f"/schedules/{sid}/confirm", headers=other).status_code == 404


def test_replan_supersedes_previous(tmp_path, monkeypatch):
    c, h = _setup(tmp_path, monkeypatch)
    old = c.post("/intake", json=BODY, headers=h).json()["schedule_id"]
    c.post("/intake", json={**BODY, "replaces": old}, headers=h)
    assert c.post(f"/schedules/{old}/confirm", headers=h).status_code == 409  # superseded


def test_intake_without_participant_still_works(tmp_path, monkeypatch):
    store.configure(f"sqlite:///{tmp_path / 't.db'}")
    monkeypatch.setattr(main, "run_pipeline", _fake_pipeline)
    body = {"transcript": "gym", "day_start": "2026-08-12T08:00:00", "day_end": "2026-08-12T20:00:00"}
    assert TestClient(main.app).post("/intake", json=body).status_code == 200
