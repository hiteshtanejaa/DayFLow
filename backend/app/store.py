"""Persistence: schedules, blocks and the agent audit trail.

SQLAlchemy over whatever DATABASE_URL points at: SQLite file locally, the
Supabase (EU) Postgres instance in deployment ("postgresql+psycopg://...").
Tables are created on startup, so there is no separate SQL migration.

Data minimisation (proposal, Section 3): a participant is just a random UUID
with no name or email, and the raw transcript is never stored. Deleting a
participant cascades to everything they own. Block times are naive London
wall-clock, same convention as the engine.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from app.models.schemas import AgentActionLog, ProposedSchedule, TaskPreference


def _id() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class Participant(Base):
    __tablename__ = "participants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    schedules: Mapped[list["Schedule"]] = relationship(cascade="all, delete-orphan")


class Schedule(Base):
    __tablename__ = "schedules"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    participant_id: Mapped[str | None] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"))
    orchestration_mode: Mapped[str] = mapped_column(String(20))
    reasoning_summary: Mapped[str] = mapped_column(Text, default="")
    violations: Mapped[list] = mapped_column(JSON, default=list)
    preference_violations: Mapped[list] = mapped_column(JSON, default=list)
    preferences: Mapped[list] = mapped_column(JSON, default=list)
    # pending -> committed | rejected | superseded (replaced by a re-plan).
    # Committed/rejected counts are the proposal's "reschedule acceptance rate".
    status: Mapped[str] = mapped_column(String(20), default="pending")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    blocks: Mapped[list["Block"]] = relationship(cascade="all, delete-orphan")
    actions: Mapped[list["AgentAction"]] = relationship(cascade="all, delete-orphan")


class Block(Base):
    __tablename__ = "schedule_blocks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    schedule_id: Mapped[str] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"))
    task_id: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(200))
    start: Mapped[datetime] = mapped_column(DateTime)
    end: Mapped[datetime] = mapped_column(DateTime)
    energy_required: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | committed | failed


class AgentAction(Base):
    """One row per agent step: powers the audit trail and the RQ1 latency/token metrics."""

    __tablename__ = "agent_actions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    schedule_id: Mapped[str] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"))
    orchestration_mode: Mapped[str] = mapped_column(String(20))
    agent_name: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(200))
    input_summary: Mapped[str] = mapped_column(Text, default="")
    output_summary: Mapped[str] = mapped_column(Text, default="")
    reasoning_summary: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[float] = mapped_column(Float)
    tokens_input: Mapped[int | None] = mapped_column(Integer)
    tokens_output: Mapped[int | None] = mapped_column(Integer)
    timestamp: Mapped[datetime] = mapped_column(DateTime)


_Session: sessionmaker | None = None


def configure(url: str) -> None:
    """Point the store at a database and create tables. Called once at startup."""
    global _Session
    args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=args, pool_pre_ping=True)
    Base.metadata.create_all(engine)
    _Session = sessionmaker(engine, expire_on_commit=False)


def create_participant() -> str:
    with _Session.begin() as s:
        p = Participant()
        s.add(p)
        s.flush()
        return p.id


def delete_participant(participant_id: str) -> bool:
    """GDPR erasure: cascades to schedules, blocks and agent actions."""
    with _Session.begin() as s:
        p = s.get(Participant, participant_id)
        if p is None:
            return False
        s.delete(p)
        return True


def participant_exists(participant_id: str) -> bool:
    with _Session() as s:
        return s.get(Participant, participant_id) is not None


class Conflict(Exception):
    """Decision not allowed in the schedule's current state."""


def decide(schedule_id: str, participant_id: str | None, decision: str) -> str | None:
    """Confirm ("committed") or reject a pending schedule. Returns the new
    status, or None if the schedule is unknown or not this participant's.
    Never commits a schedule with hard violations or unplaceable blocks (the
    proposal's "no calendar change without a clean, confirmed plan" rule).
    Repeating the same decision is a no-op.
    """
    with _Session.begin() as s:
        row = s.get(Schedule, schedule_id)
        if row is None or (row.participant_id and row.participant_id != participant_id):
            return None
        if row.status == decision:
            return row.status
        if row.status != "pending":
            raise Conflict(f"schedule is already {row.status}")
        if decision == "committed":
            if row.violations or any(b.status == "failed" for b in row.blocks):
                raise Conflict("schedule has unresolved constraint violations")
            for b in row.blocks:
                b.status = "committed"
        row.status = decision
        row.decided_at = datetime.utcnow()
        return row.status


def save_schedule(
    schedule: ProposedSchedule,
    logs: list[AgentActionLog],
    preferences: list[TaskPreference],
    participant_id: str | None = None,
    replaces: str | None = None,
) -> str:
    with _Session.begin() as s:
        if replaces:
            old = s.get(Schedule, replaces)
            if old and old.participant_id == participant_id and old.status in ("pending", "committed"):
                old.status = "superseded"
        row = Schedule(
            participant_id=participant_id,
            orchestration_mode=schedule.orchestration_mode.value,
            reasoning_summary=schedule.reasoning_summary,
            violations=[v.model_dump(mode="json") for v in schedule.violations],
            preference_violations=[v.model_dump(mode="json") for v in schedule.preference_violations],
            preferences=[p.model_dump(mode="json") for p in preferences],
            blocks=[
                Block(
                    task_id=b.task_id, title=b.title, start=b.start, end=b.end,
                    energy_required=b.energy_required.value, status=b.status,
                )
                for b in schedule.blocks
            ],
            actions=[
                AgentAction(
                    orchestration_mode=a.orchestration_mode.value, agent_name=a.agent_name,
                    action=a.action, input_summary=a.input_summary, output_summary=a.output_summary,
                    reasoning_summary=a.reasoning_summary, latency_ms=a.latency_ms,
                    tokens_input=a.tokens_input, tokens_output=a.tokens_output, timestamp=a.timestamp,
                )
                for a in logs
            ],
        )
        s.add(row)
        s.flush()
        return row.id
