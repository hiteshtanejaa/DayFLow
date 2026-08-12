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


class ProposedSchedule(BaseModel):
    id: Optional[str] = None
    blocks: list[ScheduleBlock]
    reasoning_summary: str
    violations: list[ScheduleViolation] = Field(default_factory=list)
    orchestration_mode: OrchestrationMode


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
