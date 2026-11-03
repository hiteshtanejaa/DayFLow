from datetime import datetime
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
        inferred = infer_conventional_preferences(tasks)

    question = generate_clarifying_question(tasks, req.answered + inferred)
    return ClarifyNextResponse(tasks=tasks, question=question, done=question is None, inferred=inferred)


@app.post("/clarify/answer", response_model=TaskPreference)
def clarify_answer(req: ClarifyAnswerRequest):
    return parse_clarification_answer(req.question, req.answer_text)


@app.post("/intake")
def intake(req: IntakeRequest):
    mode = req.orchestration_mode.value if req.orchestration_mode else None
    schedule, logs = run_pipeline(
        req.transcript,
        req.day_start,
        req.day_end,
        req.busy_slots,
        mode=mode,
        preferences=req.preferences,
    )
    return {"schedule": schedule, "agent_actions": logs}
