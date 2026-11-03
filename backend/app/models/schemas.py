"""Shared Pydantic models for the agentic scheduling assistant.

These types are the contract between the deterministic scheduling engine,
the LLM agents, the FastAPI routes, and (via .model_dump()) the Supabase
tables in db/schema.sql. Keep this file the single source of truth.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class EnergyLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class OrchestrationMode(str, Enum):
    REACT = "react"
    HIERARCHICAL = "hierarchical"


class Task(BaseModel):
    id: Optional[str] = None
    title: str
    duration_minutes: int = Field(gt=0)
    energy_required: EnergyLevel = EnergyLevel.MEDIUM
    priority: int = Field(default=3, ge=1, le=5, description="1 = highest priority")
    deadline: Optional[datetime] = None
    fixed_start: Optional[datetime] = None  # e.g. an existing calendar commitment


class IntakeResult(BaseModel):
    tasks: list[Task]
    user_energy_level: EnergyLevel
    context_flags: list[str] = Field(default_factory=list)
    raw_transcript: str = ""


class BusySlot(BaseModel):
    start: datetime
    end: datetime
    source: str = "calendar"


class ScheduleBlock(BaseModel):
    id: Optional[str] = None
    task_id: str
    title: str
    start: datetime
    end: datetime
    energy_required: EnergyLevel = EnergyLevel.MEDIUM
    status: str = "pending"  # pending | committed | failed


class ScheduleViolation(BaseModel):
    block_id: Optional[str] = None
    reason: str


class PreferenceCategory(str, Enum):
    TIME_WINDOW = "time_window"
    RELATIVE_ORDER = "relative_order"
    ENERGY_MATCH = "energy_match"


class TimeWindow(str, Enum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"
    NIGHT = "night"


class RelativeOrder(str, Enum):
    BEFORE = "before"
    AFTER = "after"


# Hour ranges (24h, local wall-clock) backing each TimeWindow. Deliberately
# coarse and shared by both the clarification agent's silent inference (e.g.
# "dinner" -> EVENING) and the deterministic intent-check -- a single source
# of truth so what gets asked/inferred and what gets checked never drift.
TIME_WINDOW_HOURS: dict[TimeWindow, tuple[int, int]] = {
    TimeWindow.MORNING: (6, 12),
    TimeWindow.AFTERNOON: (12, 17),
    TimeWindow.EVENING: (17, 21),
    TimeWindow.NIGHT: (21, 24),
}


class TaskPreference(BaseModel):
    """One clarified, typed constraint on where a task should land. Soft by
    design -- the engine tries to honor it, but if it can't, the schedule
    still gets built and the mismatch is flagged rather than silently
    dropped or forced (see check_preferences in scheduling/validator.py)."""

    task_title: str
    category: PreferenceCategory
    time_window: Optional[TimeWindow] = None
    relative_order: Optional[RelativeOrder] = None
    reference_task: Optional[str] = None  # for RELATIVE_ORDER: the other task's title
    energy_slot: Optional[EnergyLevel] = None  # for ENERGY_MATCH


class ClarifyingQuestion(BaseModel):
    task_title: str
    category: PreferenceCategory
    question_text: str


class PreferenceViolation(BaseModel):
    task_title: str
    category: PreferenceCategory
    message: str


class ProposedSchedule(BaseModel):
    id: Optional[str] = None
    blocks: list[ScheduleBlock]
    reasoning_summary: str
    violations: list[ScheduleViolation] = Field(default_factory=list)
    orchestration_mode: OrchestrationMode
    preference_violations: list[PreferenceViolation] = Field(default_factory=list)


class DisruptionEvent(BaseModel):
    id: Optional[str] = None
    description: str
    detected_at: datetime
    disruption_type: str  # meeting_moved | task_overrun | urgent_injected | energy_change


class AgentActionLog(BaseModel):
    id: Optional[str] = None
    timestamp: datetime
    orchestration_mode: OrchestrationMode
    agent_name: str
    action: str
    input_summary: str
    output_summary: str
    latency_ms: float
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    reasoning_summary: Optional[str] = None
