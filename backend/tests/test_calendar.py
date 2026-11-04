from datetime import datetime

import httplib2
import pytest
from fastapi.testclient import TestClient
from googleapiclient.errors import HttpError

from app import calendars, main, store
from app.models.schemas import BusySlot
from tests.test_store import BODY, _fake_pipeline


def _client(tmp_path, monkeypatch, cal, pipeline=_fake_pipeline):
    store.configure(f"sqlite:///{tmp_path / 't.db'}")
    monkeypatch.setattr(main, "run_pipeline", pipeline)
    monkeypatch.setattr(main, "calendar_for", lambda pid: cal if pid else None)
    c = TestClient(main.app)
    return c, {"X-Participant-Id": c.post("/participants").json()["participant_id"]}


def test_confirm_writes_events_and_replan_removes_old_ones(tmp_path, monkeypatch):
    cal = calendars.MockOutlook()
    c, h = _client(tmp_path, monkeypatch, cal)
    a = c.post("/intake", json=BODY, headers=h).json()["schedule_id"]
    r = c.post(f"/schedules/{a}/confirm", headers=h).json()
    assert r["calendar"] == {"synced": 1, "failed": 0}
    first = set(cal.events)
    assert len(first) == 1

    b = c.post("/intake", json={**BODY, "replaces": a}, headers=h).json()["schedule_id"]
    assert set(cal.events) == first  # old plan stays until the new one is confirmed
    c.post(f"/schedules/{b}/confirm", headers=h)
    assert len(cal.events) == 1 and not (set(cal.events) & first)  # old removed, new added


def test_intake_reads_busy_time_from_calendar(tmp_path, monkeypatch):
    seen = {}

    def pipe(transcript, day_start, day_end, busy, **kw):
        seen["busy"] = busy
        return _fake_pipeline()

    busy = BusySlot(start=datetime(2026, 8, 12, 9), end=datetime(2026, 8, 12, 10))
    c, h = _client(tmp_path, monkeypatch, calendars.MockEventKit(busy=[busy]), pipe)
    r = c.post("/intake", json=BODY, headers=h).json()
    assert seen["busy"] == [busy] and r["calendar_busy"] == 1 and r["calendar_error"] is None


def test_calendar_read_failure_still_plans_and_says_so(tmp_path, monkeypatch):
    class Broken(calendars.MockCalendar):
        def free_busy(self, *a):
            raise RuntimeError("down")

    c, h = _client(tmp_path, monkeypatch, Broken())
    r = c.post("/intake", json=BODY, headers=h).json()
    assert r["schedule"]["blocks"] and "Could not read" in r["calendar_error"]


def test_sync_failure_keeps_commit_and_can_be_retried(tmp_path, monkeypatch):
    class Flaky(calendars.MockCalendar):
        fail = True

        def create_event(self, *a, **kw):
            if self.fail:
                raise RuntimeError("quota")
            return super().create_event(*a, **kw)

    cal = Flaky()
    c, h = _client(tmp_path, monkeypatch, cal)
    sid = c.post("/intake", json=BODY, headers=h).json()["schedule_id"]
    r = c.post(f"/schedules/{sid}/confirm", headers=h).json()
    assert r["status"] == "committed" and r["calendar"] == {"synced": 0, "failed": 1}
    cal.fail = False
    assert c.post(f"/schedules/{sid}/sync", headers=h).json()["calendar"] == {"synced": 1, "failed": 0}
    assert c.post(f"/schedules/{sid}/sync", headers=h).json()["calendar"] == {"synced": 0, "failed": 0}  # idempotent


def test_no_calendar_means_plain_confirm(tmp_path, monkeypatch):
    c, h = _client(tmp_path, monkeypatch, None)
    sid = c.post("/intake", json=BODY, headers=h).json()["schedule_id"]
    assert c.post(f"/schedules/{sid}/confirm", headers=h).json()["calendar"] is None


# ---- GoogleCalendar against a fake service (no network) ----

class _Call:
    def __init__(self, fn): self.fn = fn
    def execute(self): return self.fn()


class _Events:
    def __init__(self, items, insert_status=None):
        self.items, self.insert_status, self.inserted = items, insert_status, []

    def list(self, **kw): return _Call(lambda: {"items": self.items})

    def insert(self, calendarId, body):
        def go():
            if self.insert_status:
                raise HttpError(httplib2.Response({"status": self.insert_status}), b"")
            self.inserted.append(body)
        return _Call(go)


class _Svc:
    def __init__(self, ev): self.ev = ev
    def events(self): return self.ev


def test_google_free_busy_ignores_own_free_allday_and_cancelled_events():
    mk = lambda **e: {"start": {"dateTime": "2026-08-12T09:00:00+01:00"}, "end": {"dateTime": "2026-08-12T10:00:00+01:00"}, **e}
    items = [
        mk(summary="real meeting"),
        mk(extendedProperties={"private": {"dayflow": "1"}}),
        mk(transparency="transparent"),
        mk(status="cancelled"),
        {"start": {"date": "2026-08-12"}, "end": {"date": "2026-08-13"}},
    ]
    busy = calendars.GoogleCalendar("tok", service=_Svc(_Events(items))).free_busy(datetime(2026, 8, 12, 8), datetime(2026, 8, 12, 20))
    assert busy == [BusySlot(start=datetime(2026, 8, 12, 9), end=datetime(2026, 8, 12, 10), source="google")]


def test_google_create_event_is_idempotent_on_conflict():
    ev = _Events([], insert_status=409)  # event already exists
    eid = calendars.GoogleCalendar("tok", service=_Svc(ev)).create_event(
        "Gym", datetime(2026, 8, 12, 9), datetime(2026, 8, 12, 10), key="ABCD-1234")
    assert eid == "abcd1234"


def test_google_create_event_propagates_real_errors():
    with pytest.raises(HttpError):
        calendars.GoogleCalendar("tok", service=_Svc(_Events([], insert_status=403))).create_event(
            "Gym", datetime(2026, 8, 12, 9), datetime(2026, 8, 12, 10), key="k")


def test_oauth_callback_with_unknown_state_redirects_to_error(tmp_path, monkeypatch):
    store.configure(f"sqlite:///{tmp_path / 't.db'}")
    r = TestClient(main.app).get("/calendar/google/callback?state=bogus&code=x", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"].endswith("?calendar=error")
