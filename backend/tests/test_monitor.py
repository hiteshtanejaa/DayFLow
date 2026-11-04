from datetime import datetime

from fastapi.testclient import TestClient

from app import main, store
from app.agents.pipeline import _without
from app.models.schemas import Task
from tests.test_store import BODY, _fake_pipeline

D = datetime(2026, 8, 12)  # the fake pipeline schedules "Gym" 08:00-09:00 on this day


def at(h, m=0):
    return D.replace(hour=h, minute=m)


def _confirmed(tmp_path, monkeypatch, clock):
    store.configure(f"sqlite:///{tmp_path / 't.db'}")
    monkeypatch.setattr(main, "run_pipeline", _fake_pipeline)
    monkeypatch.setattr(main, "calendar_for", lambda pid: None)
    monkeypatch.setattr(main, "london_now", lambda: clock["now"])
    c = TestClient(main.app)
    h = {"X-Participant-Id": c.post("/participants").json()["participant_id"]}
    r = c.post("/intake", json=BODY, headers=h).json()
    c.post(f"/schedules/{r['schedule_id']}/confirm", headers=h)
    return c, h, r["schedule"]["blocks"][0]["id"]


def _check(c, h):
    return c.get("/monitor/check", headers=h).json()


def test_response_blocks_carry_database_ids(tmp_path, monkeypatch):
    c, h, block_id = _confirmed(tmp_path, monkeypatch, {"now": at(7)})
    assert block_id


def test_late_start_then_overrun_then_done(tmp_path, monkeypatch):
    clock = {"now": at(8, 5)}  # grace is 10 minutes
    c, h, bid = _confirmed(tmp_path, monkeypatch, clock)

    assert _check(c, h)["overdue"] == []  # 5 min late: inside the grace period

    clock["now"] = at(8, 25)
    o = _check(c, h)["overdue"]
    assert [(x["title"], x["kind"], x["minutes_late"]) for x in o] == [("Gym", "late_start", 25)]

    assert c.post(f"/blocks/{bid}/start", headers=h).status_code == 200
    assert _check(c, h)["overdue"] == []  # started: no longer late

    clock["now"] = at(9, 5)
    assert _check(c, h)["overdue"] == []  # block just ended: grace again
    clock["now"] = at(9, 30)
    assert _check(c, h)["overdue"][0]["kind"] == "overrun"

    assert c.post(f"/blocks/{bid}/done", headers=h).status_code == 200
    s = _check(c, h)
    assert s["overdue"] == [] and s["done_titles"] == ["Gym"]


def test_first_nudge_time_is_recorded_once(tmp_path, monkeypatch):
    clock = {"now": at(8, 20)}
    c, h, bid = _confirmed(tmp_path, monkeypatch, clock)
    _check(c, h)
    clock["now"] = at(8, 40)
    _check(c, h)
    with store._Session() as s:
        assert s.get(store.Block, bid).nudged_at == at(8, 20)


def test_only_the_owner_can_report_progress(tmp_path, monkeypatch):
    c, h, bid = _confirmed(tmp_path, monkeypatch, {"now": at(8)})
    other = {"X-Participant-Id": c.post("/participants").json()["participant_id"]}
    assert c.post(f"/blocks/{bid}/start", headers=other).status_code == 404
    assert c.post(f"/blocks/{bid}/nonsense", headers=h).status_code == 404


def test_unconfirmed_blocks_cannot_be_started_or_monitored(tmp_path, monkeypatch):
    store.configure(f"sqlite:///{tmp_path / 't.db'}")
    monkeypatch.setattr(main, "run_pipeline", _fake_pipeline)
    monkeypatch.setattr(main, "calendar_for", lambda pid: None)
    monkeypatch.setattr(main, "london_now", lambda: at(12))
    c = TestClient(main.app)
    h = {"X-Participant-Id": c.post("/participants").json()["participant_id"]}
    r = c.post("/intake", json=BODY, headers=h).json()  # pending, never confirmed
    assert c.post(f"/blocks/{r['schedule']['blocks'][0]['id']}/start", headers=h).status_code == 409
    assert _check(c, h)["overdue"] == []


def test_skip_removes_finished_tasks_from_a_replan():
    tasks = [Task(title="Gym", duration_minutes=60), Task(title="Deep work", duration_minutes=240)]
    assert [t.title for t in _without(tasks, ["gym"])] == ["Deep work"]
    assert _without(tasks, []) == tasks


def test_intake_forwards_skip_to_the_pipeline(tmp_path, monkeypatch):
    store.configure(f"sqlite:///{tmp_path / 't.db'}")
    seen = {}

    def pipe(*a, **kw):
        seen.update(kw)
        return _fake_pipeline()

    monkeypatch.setattr(main, "run_pipeline", pipe)
    TestClient(main.app).post("/intake", json={**BODY, "skip": ["Gym"]})
    assert seen["skip"] == ["Gym"]
