from datetime import datetime
from typing import Optional

import logging

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app import calendars, store
from app.agents.pipeline import (
    extract_intent,
    generate_clarifying_question,
    infer_conventional_preferences,
    parse_clarification_answer,
    run_pipeline,
)
from app.config import get_settings
from app.models.schemas import BusySlot, ClarifyingQuestion, OrchestrationMode, Task, TaskPreference

app = FastAPI(title="Agentic Schedule Assistant API")
store.configure(get_settings().db_url)
log = logging.getLogger("dayflow")


def calendar_for(participant_id: Optional[str]) -> Optional[calendars.CalendarProvider]:
    """The participant's connected calendar, or None. Tests swap this for a mock."""
    token = store.get_google_token(participant_id) if participant_id else None
    return calendars.GoogleCalendar(token) if token else None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # web companion dev server
    allow_methods=["*"],
    allow_headers=["*"],
)


class IntakeRequest(BaseModel):
    transcript: str
    day_start: datetime
    day_end: datetime
    busy_slots: list[BusySlot] = []
    # Per-request override for the RQ1 side-by-side comparison — falls
    # back to ORCHESTRATION_MODE if omitted. A real enum field so FastAPI
    # rejects anything other than "react"/"hierarchical" with a 422
    # instead of silently falling through to the server default.
    orchestration_mode: Optional[OrchestrationMode] = None
    # Collected by the clarification loop below (empty if the user skipped
    # it) — identical for both orchestration modes on a given request, so
    # the RQ1 comparison never varies by which mode got asked better
    # questions.
    preferences: list[TaskPreference] = []
    # Set on a disruption re-plan: the schedule this one replaces (marked
    # "superseded", so only one live plan per day is ever pending/committed).
    replaces: Optional[str] = None


class ClarifyNextRequest(BaseModel):
    transcript: str
    day_start: datetime
    # Sent back by the client after the first turn so this stays a single
    # extract_intent call per conversation, not one per question — see
    # ClarifyNextResponse.tasks.
    tasks: Optional[list[Task]] = None
    answered: list[TaskPreference] = []


class ClarifyNextResponse(BaseModel):
    tasks: list[Task]
    question: Optional[ClarifyingQuestion] = None
    done: bool
    # Silently-inferred preferences (dinner -> evening, etc.) discovered on
    # this call — empty on every turn except the first. The client folds
    # these into its answered list without ever showing them as a
    # question.
    inferred: list[TaskPreference] = []


class ClarifyAnswerRequest(BaseModel):
    question: ClarifyingQuestion
    answer_text: str
    tasks: list[Task]  # the extracted task list: lets the server reject rules about non-tasks


@app.get("/health")
def health():
    settings = get_settings()
    return {"status": "ok", "orchestration_mode": settings.orchestration_mode}


@app.post("/clarify/next", response_model=ClarifyNextResponse)
def clarify_next(req: ClarifyNextRequest):
    """One turn of the shared clarification loop (see design notes): the
    client calls this repeatedly, showing `question` and sending the reply
    to /clarify/answer, until `done` is true or the user says they're
    satisfied and stops calling it themselves."""
    inferred: list[TaskPreference] = []
    if req.tasks is not None:
        tasks = req.tasks
    else:
        intake, _log = extract_intent(
            req.transcript, OrchestrationMode.HIERARCHICAL, reference_date=req.day_start
        )
        tasks = intake.tasks
        # An explicit time from the user ("lunch at 5pm") beats a general-knowledge
        # default ("lunch is in the afternoon"), so fixed tasks are never inferred.
        inferred = infer_conventional_preferences([t for t in tasks if t.fixed_start is None])

    question = generate_clarifying_question(tasks, req.answered + inferred)
    return ClarifyNextResponse(tasks=tasks, question=question, done=question is None, inferred=inferred)


@app.post("/clarify/answer", response_model=Optional[TaskPreference])
def clarify_answer(req: ClarifyAnswerRequest):
    """null when the reply can't be turned into a meaningful rule."""
    return parse_clarification_answer(req.question, req.answer_text, req.tasks)


@app.post("/participants", status_code=201)
def create_participant():
    """Anonymous pseudonymous participant: a random UUID, no personal data.
    ponytail: the id is the credential (unguessable UUID). Real auth
    (Supabase Auth) when accounts are needed."""
    return {"participant_id": store.create_participant()}


@app.delete("/participants/{participant_id}", status_code=204)
def delete_participant(participant_id: str):
    """GDPR erasure: deletes the participant and everything they own."""
    if not store.delete_participant(participant_id):
        raise HTTPException(404, "unknown participant")
    return Response(status_code=204)


@app.post("/intake")
def intake(req: IntakeRequest, x_participant_id: Optional[str] = Header(default=None)):
    if x_participant_id and not store.participant_exists(x_participant_id):
        raise HTTPException(404, "unknown participant")
    mode = req.orchestration_mode.value if req.orchestration_mode else None
    busy, calendar_error = list(req.busy_slots), None
    cal = calendar_for(x_participant_id)
    if cal and not busy:  # a connected calendar supplies the busy time
        try:
            busy = cal.free_busy(req.day_start, req.day_end)
        except Exception as e:  # plan anyway, but tell the client the calendar was not used
            log.warning("calendar read failed: %s", e)
            calendar_error = "Could not read your calendar; this plan ignores existing events."
    schedule, logs = run_pipeline(
        req.transcript,
        req.day_start,
        req.day_end,
        busy,
        mode=mode,
        preferences=req.preferences,
    )
    schedule_id = store.save_schedule(schedule, logs, req.preferences, x_participant_id, req.replaces)
    return {
        "schedule_id": schedule_id, "schedule": schedule, "agent_actions": logs,
        "calendar_busy": len(busy), "calendar_error": calendar_error,
    }


def _sync(schedule_id: str, participant_id: Optional[str]) -> Optional[dict]:
    """Write a committed schedule to the participant's calendar and remove events of
    plans that were rejected or replaced. Failures never undo the commit: they are
    recorded per block and can be retried with POST /schedules/{id}/sync."""
    cal = calendar_for(participant_id)
    if cal is None:
        return None
    for block_id, event_id in store.stale_events(participant_id):
        try:
            cal.delete_event(event_id)
            store.clear_event(block_id)
        except Exception as e:
            log.warning("could not delete stale event %s: %s", event_id, e)
    synced = failed = 0
    for b in store.blocks_to_sync(schedule_id):
        try:
            store.mark_synced(b["id"], cal.create_event(b["title"], b["start"], b["end"], key=b["id"]))
            synced += 1
        except Exception as e:
            store.mark_sync_failed(b["id"], str(e))
            failed += 1
    return {"synced": synced, "failed": failed}


def _decide(schedule_id: str, participant_id: Optional[str], decision: str):
    try:
        status = store.decide(schedule_id, participant_id, decision)
    except store.Conflict as e:
        raise HTTPException(409, str(e))
    if status is None:
        raise HTTPException(404, "unknown schedule")
    calendar = _sync(schedule_id, participant_id) if status == "committed" else None
    return {"schedule_id": schedule_id, "status": status, "calendar": calendar}


@app.post("/schedules/{schedule_id}/confirm")
def confirm_schedule(schedule_id: str, x_participant_id: Optional[str] = Header(default=None)):
    return _decide(schedule_id, x_participant_id, "committed")


@app.post("/schedules/{schedule_id}/sync")
def retry_sync(schedule_id: str, x_participant_id: Optional[str] = Header(default=None)):
    """Retry writing a committed schedule's blocks to the calendar."""
    if store.schedule_status(schedule_id, x_participant_id) != "committed":
        raise HTTPException(409, "only a committed schedule can be synced")
    return {"schedule_id": schedule_id, "calendar": _sync(schedule_id, x_participant_id)}


@app.get("/calendar/status")
def calendar_status(x_participant_id: Optional[str] = Header(default=None)):
    return {"google_connected": bool(x_participant_id and store.get_google_token(x_participant_id))}


@app.get("/calendar/google/connect")
def google_connect(x_participant_id: Optional[str] = Header(default=None)):
    if not x_participant_id or not store.participant_exists(x_participant_id):
        raise HTTPException(404, "unknown participant")
    s = get_settings()
    if not (s.google_client_id and s.google_client_secret):
        raise HTTPException(503, "Google credentials are not configured on the server")
    return {"url": calendars.begin_google_auth(x_participant_id)}


@app.get("/calendar/google/callback")
def google_callback(state: str = "", code: str = "", error: str = ""):
    back = get_settings().frontend_url
    try:
        if error or not code:
            raise ValueError(error or "no code")
        participant_id, token = calendars.finish_google_auth(state, code)
        if not token:  # Google only returns a refresh token on first consent
            raise ValueError("no refresh token returned")
        store.set_google_token(participant_id, token)
    except Exception as e:
        log.warning("google oauth failed: %s", e)
        return RedirectResponse(f"{back}?calendar=error")
    return RedirectResponse(f"{back}?calendar=connected")


@app.delete("/calendar/google", status_code=204)
def google_disconnect(x_participant_id: Optional[str] = Header(default=None)):
    if not x_participant_id or not store.participant_exists(x_participant_id):
        raise HTTPException(404, "unknown participant")
    store.set_google_token(x_participant_id, None)
    return Response(status_code=204)


@app.post("/schedules/{schedule_id}/reject")
def reject_schedule(schedule_id: str, x_participant_id: Optional[str] = Header(default=None)):
    return _decide(schedule_id, x_participant_id, "rejected")
