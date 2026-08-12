from datetime import datetime
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.agents.pipeline import run_pipeline
from app.config import get_settings
from app.models.schemas import BusySlot, OrchestrationMode

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


@app.get("/health")
def health():
    settings = get_settings()
    return {"status": "ok", "orchestration_mode": settings.orchestration_mode}


@app.post("/intake")
def intake(req: IntakeRequest):
    mode = req.orchestration_mode.value if req.orchestration_mode else None
    schedule, logs = run_pipeline(
        req.transcript, req.day_start, req.day_end, req.busy_slots, mode=mode
    )
    return {"schedule": schedule, "agent_actions": logs}
