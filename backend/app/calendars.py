"""Calendar providers: Google Calendar for real, mock Outlook / EventKit for
the extensibility demo the proposal asks for (Objective 4).

All times in and out are naive Europe/London wall-clock, like the rest of the
backend; conversion to Google's offset-aware format happens only here.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime
from typing import Callable, Protocol, TypeVar
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.models.schemas import BusySlot

LONDON = ZoneInfo("Europe/London")
SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"]
T = TypeVar("T")


class CalendarProvider(Protocol):
    def free_busy(self, start: datetime, end: datetime) -> list[BusySlot]: ...
    def create_event(self, title: str, start: datetime, end: datetime, key: str) -> str:
        """Idempotent on `key`: creating the same key twice returns the same event id."""
    def delete_event(self, event_id: str) -> None: ...


def _retry(fn: Callable[[], T], tries: int = 4) -> T:
    """Exponential backoff (1s, 2s, 4s) for rate limits and 5xx, per the proposal."""
    from googleapiclient.errors import HttpError

    for attempt in range(tries):
        try:
            return fn()
        except HttpError as e:
            if e.resp.status not in (429, 500, 502, 503, 504) or attempt == tries - 1:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def _to_london_naive(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(LONDON).replace(tzinfo=None)


class GoogleCalendar:
    def __init__(self, refresh_token: str, service=None):
        if service is None:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build

            s = get_settings()
            creds = Credentials(
                None, refresh_token=refresh_token, token_uri="https://oauth2.googleapis.com/token",
                client_id=s.google_client_id, client_secret=s.google_client_secret, scopes=SCOPES,
            )
            service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        self.svc = service

    def free_busy(self, start: datetime, end: datetime) -> list[BusySlot]:
        """The participant's *own* commitments in the window. Uses events.list, not
        freebusy, so events this app created are excluded: otherwise re-planning
        would treat the previous plan as busy time and could never move it."""
        kw = dict(
            calendarId="primary", singleEvents=True, orderBy="startTime", maxResults=250,
            timeMin=start.replace(tzinfo=LONDON).isoformat(), timeMax=end.replace(tzinfo=LONDON).isoformat(),
        )
        items = _retry(lambda: self.svc.events().list(**kw).execute()).get("items", [])
        busy = []
        for e in items:
            if (
                e.get("status") == "cancelled"
                or e.get("transparency") == "transparent"  # marked "free"
                or e.get("extendedProperties", {}).get("private", {}).get("dayflow") == "1"
                or "dateTime" not in e.get("start", {})  # all-day events don't block time
            ):
                continue
            busy.append(BusySlot(
                start=_to_london_naive(e["start"]["dateTime"]), end=_to_london_naive(e["end"]["dateTime"]),
                source="google"))
        return busy

    def create_event(self, title: str, start: datetime, end: datetime, key: str) -> str:
        from googleapiclient.errors import HttpError

        # Event ids must be base32hex (a-v, 0-9): a dash-free uuid qualifies, and a
        # fixed id makes a retry idempotent (a 409 means it already exists).
        event_id = key.replace("-", "").lower()
        body = {
            "id": event_id,
            "summary": title,
            "extendedProperties": {"private": {"dayflow": "1"}},  # lets free_busy skip our own events
            "start": {"dateTime": start.isoformat(), "timeZone": "Europe/London"},
            "end": {"dateTime": end.isoformat(), "timeZone": "Europe/London"},
        }
        try:
            _retry(lambda: self.svc.events().insert(calendarId="primary", body=body).execute())
        except HttpError as e:
            if e.resp.status != 409:
                raise
        return event_id

    def delete_event(self, event_id: str) -> None:
        from googleapiclient.errors import HttpError

        try:
            _retry(lambda: self.svc.events().delete(calendarId="primary", eventId=event_id).execute())
        except HttpError as e:
            if e.resp.status not in (404, 410):  # already gone is fine
                raise


class MockCalendar:
    """In-memory calendar. Stands in for Outlook (Graph) and Apple EventKit:
    same interface, no integration risk, as the proposal specifies."""

    name = "mock"

    def __init__(self, busy: list[BusySlot] | None = None):
        self.busy = busy or []
        self.events: dict[str, tuple[str, datetime, datetime]] = {}

    def free_busy(self, start: datetime, end: datetime) -> list[BusySlot]:
        return [b for b in self.busy if b.end > start and b.start < end]

    def create_event(self, title: str, start: datetime, end: datetime, key: str) -> str:
        self.events.setdefault(key, (title, start, end))
        return key

    def delete_event(self, event_id: str) -> None:
        self.events.pop(event_id, None)


class MockOutlook(MockCalendar):
    name = "outlook-mock"


class MockEventKit(MockCalendar):
    name = "eventkit-mock"


# state -> (participant_id, flow). The Flow carries the PKCE code verifier, so the
# callback must reuse it. ponytail: in-memory, lost on restart and per-process;
# move to the database if the backend ever runs more than one worker.
_PENDING: dict[str, tuple[str, object]] = {}


def begin_google_auth(participant_id: str) -> str:
    flow = _flow()
    state = uuid.uuid4().hex
    url, _ = flow.authorization_url(access_type="offline", prompt="consent", state=state)
    _PENDING[state] = (participant_id, flow)
    return url


def finish_google_auth(state: str, code: str) -> tuple[str, str]:
    """Returns (participant_id, refresh_token). Unknown state (CSRF/expired) raises KeyError."""
    participant_id, flow = _PENDING.pop(state)
    flow.fetch_token(code=code)
    return participant_id, flow.credentials.refresh_token


def _flow():
    from google_auth_oauthlib.flow import Flow

    s = get_settings()
    cfg = {"web": {
        "client_id": s.google_client_id, "client_secret": s.google_client_secret,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [s.google_redirect_uri],
    }}
    return Flow.from_client_config(cfg, scopes=SCOPES, redirect_uri=s.google_redirect_uri)
