"""Orchestration mode implementations — Step 4.

Two genuinely different architectures now, not a cosmetic label switch:

- **ReAct** (`run_react`): a LangGraph 2-node graph (`agent` <-> `tools`)
  implementing the actual ReAct paradigm (Yao et al. 2023) — one agent
  interleaves reasoning with tool calls (`propose_schedule`), handling
  both intake understanding and scheduling in a single continuous trace.
  Iteration count varies per run depending on how many tool calls the
  model needs — that variability is itself real RQ1 data.
- **Hierarchical** (`run_hierarchical`): a LangGraph 3-node graph
  (`intake` -> `orchestrator` -> `monitor`), grounded in the AutoGen (Wu
  et al. 2023) conversation model and MetaGPT (Hong et al. 2024) role
  specialisation cited in the proposal — separate specialised agents, a
  fixed two-LLM-call shape per run.

Both log identically to `AgentActionLog` so the benchmark harness (Step 6)
can compare them on equal footing. The `monitor` node is a structural
placeholder — Step 8 replaces it with real deviation polling; the
conditional edge back to `orchestrator` on a disruption is already wired.

Requires OPENAI_API_KEY to actually execute; the deterministic parts
(scheduling.engine / validator) run without it.
"""
from __future__ import annotations

import functools
import json
import time
from datetime import datetime
from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph
from openai import OpenAI
from pydantic import BaseModel

from app.config import get_settings
from app.models.schemas import (
    AgentActionLog,
    BusySlot,
    ClarifyingQuestion,
    IntakeResult,
    OrchestrationMode,
    PreferenceCategory,
    PreferenceViolation,
    ProposedSchedule,
    ScheduleBlock,
    ScheduleViolation,
    Task,
    TaskPreference,
)
from app.scheduling.engine import build_schedule
from app.scheduling.validator import check_preferences, validate_schedule

MAX_REACT_ITERATIONS = 6

# Real failure: "4 hours of deep work with 15 min breaks" became a separate
# "Take a break during deep work" task that landed at 8am, before everything.
# The engine places one block per task, so a break inside a task must not be a task.
_BREAKS_RULE = (
    "A break or rest that happens inside another activity (e.g. \"4 hours of deep "
    "work with 15 min breaks\") is not a separate task: make a single task for "
    "that activity whose duration is the total time including the breaks."
)


# --------------------------------------------------------------------------
# Shared LLM client / logging helpers
# --------------------------------------------------------------------------


@functools.lru_cache(maxsize=1)
def _client() -> OpenAI:
    return OpenAI(api_key=get_settings().openai_api_key)


def _model() -> str:
    return get_settings().openai_model


def _fast_model() -> str:
    return get_settings().openai_fast_model


def _extract_text(response: Any) -> str:
    # Confirmed against the installed openai SDK source (response.py):
    # `output_text` is a real convenience property that aggregates every
    # `output_text` content block from `response.output`. No longer a
    # guess — verified by reading the property implementation directly.
    return response.output_text


def _format_time(dt: datetime) -> str:
    # Cross-platform 12-hour formatting — %-I is Linux-only (Windows
    # strftime raises on it), so strip the zero-pad manually instead.
    return dt.strftime("%I:%M %p").lstrip("0") or "12:00 AM"


def _blocks_plaintext(blocks: list[ScheduleBlock]) -> str:
    """Plain human-readable time strings for the LLM reasoning prompt.

    Deliberately NOT raw ISO datetimes. Passing `model_dump(mode="json")`
    gives the model full ISO strings with a UTC offset (e.g.
    "2026-08-10T08:00:00+00:00"), and models reliably "helpfully" convert
    those to a different timezone in their prose response — producing an
    explanation whose times don't match the actual schedule. Pre-formatted
    plain strings remove the ambiguity that invites that conversion.
    """
    lines = []
    for b in blocks:
        status = "" if b.status != "failed" else " [COULD NOT BE SCHEDULED]"
        lines.append(
            f"- {b.title}: {_format_time(b.start)} to {_format_time(b.end)}"
            f" ({b.energy_required.value} energy){status}"
        )
    return "\n".join(lines)


def _template_reasoning(blocks: list[ScheduleBlock]) -> str:
    """Zero-latency, zero-API-call fallback for the schedule explanation.

    Used whenever `use_llm_reasoning=False` — the disruption
    re-optimization path (Step 8), where the proposal's Critical Success
    Factor (P90 <= 12s) leaves no room for a second LLM round trip that
    only produces narration, not a decision.
    """
    placed = [b for b in blocks if b.status != "failed"]
    failed = [b for b in blocks if b.status == "failed"]

    if not placed and not failed:
        return "No tasks to schedule."

    parts = [f"{b.title} at {_format_time(b.start)}" for b in placed]
    summary = "Scheduled: " + "; ".join(parts) + "." if parts else ""
    if failed:
        summary += f" Could not fit: {', '.join(b.title for b in failed)}."
    return summary.strip()


def _log(
    mode: OrchestrationMode,
    agent_name: str,
    action: str,
    input_summary: str,
    output_summary: str,
    started_at: float,
    reasoning_summary: str | None = None,
    usage: Any = None,
) -> AgentActionLog:
    # `usage` is a response.usage object (confirmed fields: input_tokens /
    # output_tokens — Responses API naming, not Chat Completions' older
    # prompt_tokens/completion_tokens). Optional because tool-execution log
    # entries (deterministic, no API call) have no usage to report.
    return AgentActionLog(
        timestamp=datetime.utcnow(),
        orchestration_mode=mode,
        agent_name=agent_name,
        action=action,
        input_summary=input_summary,
        output_summary=output_summary,
        latency_ms=(time.perf_counter() - started_at) * 1000,
        reasoning_summary=reasoning_summary,
        tokens_input=getattr(usage, "input_tokens", None) if usage else None,
        tokens_output=getattr(usage, "output_tokens", None) if usage else None,
    )


# --------------------------------------------------------------------------
# Intake and Intent Agent — perception stage, shared by both modes
# --------------------------------------------------------------------------


def extract_intent(
    transcript: str, mode: OrchestrationMode, reference_date: datetime | None = None
) -> tuple[IntakeResult, AgentActionLog]:
    """`reference_date` anchors "today" for the model. Real bug this fixes:
    without it, the model has no way to know the actual date when it needs
    to construct a full `fixed_start` datetime from a phrase like "moved
    to 3pm" — observed hallucinating year 3000 in the RQ1 benchmark, which
    then triggered a false "outside working hours" violation. Caught by
    the benchmark harness, not by inspection — exactly what it's for.
    """
    t0 = time.perf_counter()
    date_context = (
        f"Today's date is {reference_date.strftime('%Y-%m-%d')}. "
        if reference_date
        else ""
    )
    response = _client().responses.parse(
        model=_fast_model(),
        input=[
            {
                "role": "user",
                "content": (
                    f"{date_context}Extract structured tasks, the user's overall "
                    "energy level, and any context flags from this morning intake "
                    f"transcript:\n\n{transcript}\n\n"
                    "If a task has a specific fixed start time mentioned (e.g. "
                    "\"moved to 3pm\"), set fixed_start using today's date above — "
                    "never invent a different year. Extract only concrete "
                    "activities the user themselves will do. Ignore instructions "
                    "addressed to the assistant (e.g. \"design a schedule for the "
                    "rest of my day\", \"plan my day\") — those are not tasks. "
                    + _BREAKS_RULE
                ),
            }
        ],
        text_format=IntakeResult,
    )
    result = response.output_parsed
    result.raw_transcript = transcript
    log = _log(
        mode,
        "IntakeAgent",
        "extract_intent",
        transcript[:200],
        f"{len(result.tasks)} tasks extracted",
        t0,
        usage=response.usage,
    )
    return result, log


# --------------------------------------------------------------------------
# Clarification loop — shared preprocessing before either orchestration
# mode runs (keeps the RQ1 comparison apples-to-apples: both modes see the
# exact same clarified task list, never a mode-specific one). Turn-by-turn:
# the caller (main.py) asks for one question at a time, shows it to the
# user, sends back the answer, and repeats until this returns None or the
# user says they're satisfied — the same two-stop-condition shape as the
# ReAct loop's own "done or give up" logic, applied to elicitation instead
# of tool-calling.
# --------------------------------------------------------------------------


class _ClarificationDecision(BaseModel):
    """Internal parse target only — never crosses the API boundary."""

    has_question: bool
    task_title: str = ""
    category: PreferenceCategory = PreferenceCategory.TIME_WINDOW
    question_text: str = ""


class _InferredPreferences(BaseModel):
    """Internal parse target only — never crosses the API boundary."""

    preferences: list[TaskPreference] = []


def infer_conventional_preferences(tasks: list[Task]) -> list[TaskPreference]:
    """The "infer, don't ask" half of the clarification design: silent,
    general-knowledge time-of-day defaults (dinner -> evening, breakfast ->
    morning, ...). Runs once per conversation, before the turn-by-turn
    ambiguity loop starts, precisely so these never show up as questions —
    generate_clarifying_question is also told to skip them, but this is
    what actually gets them onto the schedule at the right time rather
    than merely not-asked-about-and-then-placed-wherever.
    """
    if not tasks:
        return []
    task_lines = "\n".join(f"- {t.title}" for t in tasks)
    response = _client().responses.parse(
        model=_fast_model(),
        input=[
            {
                "role": "user",
                "content": (
                    "Here are today's tasks:\n"
                    f"{task_lines}\n\n"
                    "Using general knowledge of when activities conventionally "
                    "happen (dinner in the evening, breakfast in the morning, "
                    "lunch at midday, and similarly obvious cases), list a "
                    "time_window preference for every task that has a clear, "
                    "widely-shared conventional time. Skip any task without "
                    "one — leave those for the user to clarify rather than "
                    "guessing."
                ),
            }
        ],
        text_format=_InferredPreferences,
    )
    prefs = response.output_parsed.preferences
    for p in prefs:
        p.category = PreferenceCategory.TIME_WINDOW
    return prefs


def _resolve_title(label: str, tasks: list[Task]) -> Optional[str]:
    """Map a model-written label onto exactly one real task title, else None.
    Real failure this prevents: the model wrote task_title="Gym and deep work
    timing" (a topic, not a task); loose substring matching later matched it to
    the "Deep work" block, producing meaningless "Deep work before Deep work"
    warnings. Exact match first; otherwise accept only an unambiguous containment.
    """
    norm = label.strip().lower()
    for t in tasks:
        if t.title.strip().lower() == norm:
            return t.title
    hits = [t.title for t in tasks if t.title.strip().lower() in norm or norm in t.title.strip().lower()]
    return hits[0] if len(hits) == 1 else None


def generate_clarifying_question(
    tasks: list[Task], already_answered: list[TaskPreference]
) -> Optional[ClarifyingQuestion]:
    """Looks at the task list and what's already been resolved, and decides
    whether there's one more genuinely schedule-relevant ambiguity worth a
    question. Silent inference (e.g. "dinner" -> evening) never reaches
    here — the model is explicitly told to leave conventionally-timed
    tasks alone rather than ask about them.
    """
    covered = ", ".join(p.task_title for p in already_answered) or "none yet"
    task_lines = "\n".join(
        f"- {t.title} ({t.duration_minutes} min, {t.energy_required.value} energy"
        + (f", FIXED at {t.fixed_start.strftime('%H:%M')}" if t.fixed_start else "")
        + ")"
        for t in tasks
    )
    response = _client().responses.parse(
        model=_fast_model(),
        input=[
            {
                "role": "user",
                "content": (
                    "You are helping build today's schedule from this task list:\n"
                    f"{task_lines}\n\n"
                    f"Preferences already clarified for: {covered}.\n\n"
                    "task_title MUST be copied exactly from the list above (one task). "
                    "For an ordering question, put the task being positioned in "
                    "task_title and name the other task in the question text. "
                    "Never ask about a task marked FIXED: the user already gave its time. "
                    "Tasks with an obvious conventional time (dinner -> evening, "
                    "breakfast -> morning, lunch -> midday, etc.) will be handled "
                    "automatically — never ask about those. Only ask about a task "
                    "if its placement is genuinely ambiguous and would meaningfully "
                    "change the schedule: no stated time and no obvious "
                    "convention, unclear ordering relative to another named task, "
                    "or unclear energy timing. Pick the single most impactful "
                    "remaining ambiguity not already covered above and phrase one "
                    "short, natural question about it. If nothing meaningfully "
                    "ambiguous remains, set has_question to false."
                ),
            }
        ],
        text_format=_ClarificationDecision,
    )
    decision = response.output_parsed
    if not decision.has_question or not decision.task_title.strip():
        return None
    title = _resolve_title(decision.task_title, tasks)
    if title is None:  # not a real task: asking about it could only create a bogus rule
        return None
    return ClarifyingQuestion(
        task_title=title,
        category=decision.category,
        question_text=decision.question_text,
    )


def parse_clarification_answer(
    question: ClarifyingQuestion, answer_text: str, tasks: list[Task]
) -> Optional[TaskPreference]:
    """Parses one free-text reply into the typed preference vocabulary
    shared with check_preferences (validator.py) — so what gets asked and
    what later gets checked are never out of sync. Returns None when the reply
    cannot be turned into a meaningful rule (e.g. an ordering whose other task
    is not a real task, or is the task itself) instead of storing a bogus one.
    """
    titles = ", ".join(f'"{t.title}"' for t in tasks)
    response = _client().responses.parse(
        model=_fast_model(),
        input=[
            {
                "role": "user",
                "content": (
                    f'The user was asked: "{question.question_text}" (about the '
                    f'task "{question.task_title}"). They replied: "{answer_text}".\n\n'
                    "Parse this into a single structured preference for that task. "
                    "Use category=time_window if they named a time of day, "
                    "category=relative_order if they said it should come before "
                    "or after another named task (set reference_task to that "
                    f"task's exact title, copied from this list: {titles}), or category=energy_match if they "
                    "described an energy level for it. If the reply is vague or "
                    "doesn't map cleanly, make your best reasonable judgment "
                    "rather than leaving fields empty."
                ),
            }
        ],
        text_format=TaskPreference,
    )
    pref = response.output_parsed
    pref.task_title = question.task_title
    if pref.category == PreferenceCategory.RELATIVE_ORDER:
        ref = _resolve_title(pref.reference_task or "", tasks)
        if not pref.relative_order or ref is None or ref == pref.task_title:
            return None
        pref.reference_task = ref
    return pref


def _propose_and_validate(
    tasks: list[Task],
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
    mode: OrchestrationMode,
    reasoning_depth: str,
    use_llm_reasoning: bool = True,
    preferences: list[TaskPreference] | None = None,
) -> tuple[ProposedSchedule, AgentActionLog]:
    """Scheduling Orchestrator Agent (hierarchical mode only).

    The LLM only produces the user-facing rationale text; the actual block
    placement always comes from the deterministic engine, and every output
    is re-checked by the validator before being returned — per the
    hallucination-mitigation design in the proposal. `preferences` (from
    the clarification loop, if any were collected) are honored best-effort
    by the engine and then mechanically re-checked here; any mismatch is
    surfaced as a preference_violation, never silently corrected.
    """
    t0 = time.perf_counter()
    preferences = preferences or []
    blocks = build_schedule(tasks, day_start, day_end, busy, preferences)
    violations = validate_schedule(blocks, day_start, day_end, busy)
    pref_violations = check_preferences(blocks, preferences)

    if use_llm_reasoning:
        reasoning = _client().responses.create(
            model=_model(),
            input=[
                {
                    "role": "user",
                    "content": (
                        "In 2-3 plain-language sentences, explain this schedule to the "
                        "user. Use the times exactly as given below, verbatim — do not "
                        "convert timezones or alter any time value:\n\n"
                        f"{_blocks_plaintext(blocks)}"
                    ),
                }
            ],
        )
        reasoning_text = _extract_text(reasoning)
        reasoning_usage = reasoning.usage
    else:
        reasoning_text = _template_reasoning(blocks)
        reasoning_usage = None

    schedule = ProposedSchedule(
        blocks=blocks,
        reasoning_summary=reasoning_text,
        violations=violations,
        orchestration_mode=mode,
        preference_violations=pref_violations,
    )
    log = _log(
        mode,
        "SchedulingOrchestrator",
        f"propose_schedule[{reasoning_depth}]",
        f"{len(tasks)} tasks",
        f"{len(blocks)} blocks, {len(violations)} violations, {len(pref_violations)} preference mismatches",
        t0,
        reasoning_text,
        usage=reasoning_usage,
    )
    return schedule, log


# --------------------------------------------------------------------------
# Hierarchical mode — real LangGraph StateGraph: Intake -> Orchestrator ->
# Monitor, with a conditional edge back to Orchestrator on disruption.
# --------------------------------------------------------------------------


class HierState(TypedDict):
    transcript: str
    day_start: datetime
    day_end: datetime
    busy: list[BusySlot]
    use_llm_reasoning: bool
    preferences: list[TaskPreference]
    intake: Optional[IntakeResult]
    schedule: Optional[ProposedSchedule]
    disruption: Optional[dict]  # populated by Step 8's Execution Monitor
    logs: list[AgentActionLog]


def _intake_node(state: HierState) -> dict:
    intake, log = extract_intent(
        state["transcript"], OrchestrationMode.HIERARCHICAL, reference_date=state["day_start"]
    )
    return {"intake": intake, "logs": state["logs"] + [log]}


def _orchestrator_node(state: HierState) -> dict:
    intake = state["intake"]
    schedule, log = _propose_and_validate(
        intake.tasks,
        state["day_start"],
        state["day_end"],
        state["busy"],
        OrchestrationMode.HIERARCHICAL,
        reasoning_depth="medium",
        use_llm_reasoning=state["use_llm_reasoning"],
        preferences=state["preferences"],
    )
    return {"schedule": schedule, "logs": state["logs"] + [log]}


def _monitor_node(state: HierState) -> dict:
    """Placeholder — Step 8 replaces this with real deviation polling and
    FCM nudge dispatch. Its job here is purely structural: give the graph
    a genuine third node and a real conditional edge for Step 8 to plug a
    disruption event into, without inventing fake monitoring logic now.
    """
    t0 = time.perf_counter()
    log = _log(
        OrchestrationMode.HIERARCHICAL,
        "ExecutionMonitor",
        "check_disruption",
        "schedule committed" if state["schedule"] else "no schedule",
        "disruption detected" if state.get("disruption") else "no disruption (stub)",
        t0,
    )
    return {"logs": state["logs"] + [log]}


def _route_after_monitor(state: HierState) -> str:
    return "orchestrator" if state.get("disruption") else END


@functools.lru_cache(maxsize=1)
def _hier_graph():
    g = StateGraph(HierState)
    g.add_node("intake", _intake_node)
    g.add_node("orchestrator", _orchestrator_node)
    g.add_node("monitor", _monitor_node)
    g.add_edge(START, "intake")
    g.add_edge("intake", "orchestrator")
    g.add_edge("orchestrator", "monitor")
    g.add_conditional_edges("monitor", _route_after_monitor, {"orchestrator": "orchestrator", END: END})
    return g.compile()


def run_hierarchical(
    transcript: str,
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
    use_llm_reasoning: bool = True,
    preferences: list[TaskPreference] | None = None,
) -> tuple[ProposedSchedule, list[AgentActionLog]]:
    initial: HierState = {
        "transcript": transcript,
        "day_start": day_start,
        "day_end": day_end,
        "busy": busy,
        "use_llm_reasoning": use_llm_reasoning,
        "preferences": preferences or [],
        "intake": None,
        "schedule": None,
        "disruption": None,
        "logs": [],
    }
    final_state = _hier_graph().invoke(initial)
    return final_state["schedule"], final_state["logs"]


# --------------------------------------------------------------------------
# ReAct mode — real LangGraph StateGraph: agent <-> tools loop.
# One agent handles both intake understanding and scheduling by calling
# `propose_schedule`, revising its task list if the tool reports
# constraint violations, until it's satisfied or the iteration cap hits.
# --------------------------------------------------------------------------


def _react_tool_defs() -> list[dict]:
    return [
        {
            "type": "function",
            "name": "propose_schedule",
            "description": (
                "Propose a time-blocked schedule for the given tasks against the "
                "user's actual free/busy calendar for the day. Returns the placed "
                "blocks and any constraint violations (outside working hours, "
                "calendar conflicts, unplaceable tasks). If violations are "
                "returned, revise the task list (durations, priorities, energy) "
                "and call this again before giving your final answer."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "duration_minutes": {"type": "integer"},
                                "energy_required": {
                                    "type": "string",
                                    "enum": ["low", "medium", "high"],
                                },
                                "priority": {
                                    "type": "integer",
                                    "description": "1 = highest priority, 5 = lowest",
                                },
                                "fixed_start": {
                                    "type": "string",
                                    "description": (
                                        "ISO 8601 datetime (YYYY-MM-DDTHH:MM:SS), only "
                                        "for tasks with a specific committed time — e.g. "
                                        "a meeting the user said is fixed at 3pm. Use "
                                        "today's date exactly as given in the system "
                                        "prompt; never guess or invent a different date. "
                                        "Omit this field entirely for flexible tasks."
                                    ),
                                },
                            },
                            "required": ["title", "duration_minutes"],
                        },
                    },
                },
                "required": ["tasks"],
            },
            "strict": False,
        }
    ]


def _dispatch_propose_schedule(
    args: dict,
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
    preferences: list[TaskPreference],
) -> tuple[dict, list[ScheduleBlock], list[ScheduleViolation], list[PreferenceViolation]]:
    tasks = [Task(**t) for t in args.get("tasks", [])]
    blocks = build_schedule(tasks, day_start, day_end, busy, preferences)
    violations = validate_schedule(blocks, day_start, day_end, busy)
    pref_violations = check_preferences(blocks, preferences)
    result = {
        "blocks": [
            {
                **b.model_dump(mode="json"),
                # Pre-formatted, unambiguous. Same fix as _blocks_plaintext:
                # handing the model raw ISO-with-offset timestamps invites
                # it to "helpfully" re-convert timezones in its final
                # answer, producing times that don't match the real
                # schedule. Tell it to quote this field verbatim.
                "display_time": f"{_format_time(b.start)} to {_format_time(b.end)}",
            }
            for b in blocks
        ],
        "violations": [v.model_dump(mode="json") for v in violations],
    }
    return result, blocks, violations, pref_violations


class ReActState(TypedDict):
    day_start: datetime
    day_end: datetime
    busy: list[BusySlot]
    use_llm_reasoning: bool
    preferences: list[TaskPreference]
    conversation: list[dict]  # new input items to send this turn
    previous_response_id: Optional[str]
    pending_calls: list[Any]
    last_blocks: list[ScheduleBlock]
    last_violations: list[ScheduleViolation]
    last_preference_violations: list[PreferenceViolation]
    reasoning_text: Optional[str]
    iterations: int
    logs: list[AgentActionLog]


def _react_agent_node(state: ReActState) -> dict:
    t0 = time.perf_counter()
    response = _client().responses.create(
        model=_model(),
        input=state["conversation"],
        tools=_react_tool_defs(),
        previous_response_id=state["previous_response_id"],
    )
    function_calls = [item for item in response.output if getattr(item, "type", None) == "function_call"]

    update: dict = {
        "previous_response_id": response.id,
        "iterations": state["iterations"] + 1,
        "pending_calls": function_calls,
    }
    if function_calls:
        names = ", ".join(fc.name for fc in function_calls)
        log = _log(
            OrchestrationMode.REACT,
            "ReActAgent",
            f"agent_turn[{state['iterations']}]",
            "(conversation so far)",
            f"requested tool call(s): {names}",
            t0,
            usage=response.usage,
        )
    else:
        reasoning_text = (
            _extract_text(response) if state["use_llm_reasoning"] else _template_reasoning(state["last_blocks"])
        )
        update["reasoning_text"] = reasoning_text
        log = _log(
            OrchestrationMode.REACT,
            "ReActAgent",
            f"final_answer[{state['iterations']}]",
            "(conversation so far)",
            "no further tool calls — finalizing",
            t0,
            reasoning_text,
            usage=response.usage,
        )
    update["logs"] = state["logs"] + [log]
    return update


def _react_tools_node(state: ReActState) -> dict:
    t0 = time.perf_counter()
    next_items: list[dict] = []
    last_blocks, last_violations = state["last_blocks"], state["last_violations"]
    last_pref_violations = state["last_preference_violations"]
    tool_names: list[str] = []

    for fc in state["pending_calls"]:
        args = json.loads(fc.arguments)
        result, blocks, violations, pref_violations = _dispatch_propose_schedule(
            args, state["day_start"], state["day_end"], state["busy"], state["preferences"]
        )
        last_blocks, last_violations, last_pref_violations = blocks, violations, pref_violations
        tool_names.append(fc.name)
        next_items.append(
            {"type": "function_call_output", "call_id": fc.call_id, "output": json.dumps(result)}
        )

    log = _log(
        OrchestrationMode.REACT,
        "ReActAgent",
        f"tool_execution[{','.join(tool_names)}]",
        f"{len(state['pending_calls'])} call(s)",
        f"{len(last_blocks)} blocks, {len(last_violations)} violations, "
        f"{len(last_pref_violations)} preference mismatches",
        t0,
    )

    update: dict = {
        "conversation": next_items,
        "last_blocks": last_blocks,
        "last_violations": last_violations,
        "last_preference_violations": last_pref_violations,
        "pending_calls": [],
        "logs": state["logs"] + [log],
    }
    # Fast path (disruption re-optimization): a clean result is good
    # enough — skip the extra LLM round trip that would only produce
    # narration, matching the same use_llm_reasoning contract as the
    # hierarchical mode.
    if not state["use_llm_reasoning"] and last_blocks and not last_violations:
        update["reasoning_text"] = _template_reasoning(last_blocks)
    return update


def _give_up_node(state: ReActState) -> dict:
    if state["last_blocks"]:
        text = _template_reasoning(state["last_blocks"])
    else:
        text = "Could not determine a valid schedule within the iteration limit."
    return {"reasoning_text": text}


def _route_after_agent(state: ReActState) -> str:
    if state.get("reasoning_text") is not None:
        return END
    if state["iterations"] >= MAX_REACT_ITERATIONS:
        return "give_up"
    return "tools"


def _route_after_tools(state: ReActState) -> str:
    if state.get("reasoning_text") is not None:
        return END
    if state["iterations"] >= MAX_REACT_ITERATIONS:
        return "give_up"
    return "agent"


@functools.lru_cache(maxsize=1)
def _react_graph():
    g = StateGraph(ReActState)
    g.add_node("agent", _react_agent_node)
    g.add_node("tools", _react_tools_node)
    g.add_node("give_up", _give_up_node)
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", _route_after_agent, {"tools": "tools", "give_up": "give_up", END: END})
    g.add_conditional_edges("tools", _route_after_tools, {"agent": "agent", "give_up": "give_up", END: END})
    g.add_edge("give_up", END)
    return g.compile()


def _react_system_prompt(reference_date: datetime) -> str:
    return (
        f"Today's date is {reference_date.strftime('%Y-%m-%d')}. You are a single "
        "scheduling agent handling both intake understanding and schedule "
        "construction in one continuous reasoning process. Read the user's "
        "morning intake transcript, infer their tasks (title, duration in "
        "minutes, required energy level low/medium/high, priority 1-5 where 1 "
        "is highest, and fixed_start if the user names a specific committed "
        "time for that task), and call `propose_schedule` with your best task "
        "list. If "
        "the tool reports constraint violations, revise the task list and call "
        "it again. Once you have a schedule with no violations, write a short "
        "2-3 sentence explanation of the plan for the user as your final "
        "answer — do not call the tool again once it succeeds. When writing "
        "that explanation, quote each block's `display_time` field exactly as "
        "given — do not convert timezones or recompute times yourself. "
        + _BREAKS_RULE
    )


def run_react(
    transcript: str,
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
    use_llm_reasoning: bool = True,
    preferences: list[TaskPreference] | None = None,
) -> tuple[ProposedSchedule, list[AgentActionLog]]:
    initial: ReActState = {
        "day_start": day_start,
        "day_end": day_end,
        "busy": busy,
        "use_llm_reasoning": use_llm_reasoning,
        "preferences": preferences or [],
        "conversation": [
            {"role": "system", "content": _react_system_prompt(day_start)},
            {"role": "user", "content": transcript},
        ],
        "previous_response_id": None,
        "pending_calls": [],
        "last_blocks": [],
        "last_violations": [],
        "last_preference_violations": [],
        "reasoning_text": None,
        "iterations": 0,
        "logs": [],
    }
    final_state = _react_graph().invoke(initial)

    schedule = ProposedSchedule(
        blocks=final_state["last_blocks"],
        reasoning_summary=final_state["reasoning_text"] or "",
        violations=final_state["last_violations"],
        orchestration_mode=OrchestrationMode.REACT,
        preference_violations=final_state["last_preference_violations"],
    )
    return schedule, final_state["logs"]


# --------------------------------------------------------------------------
# Mode switch
# --------------------------------------------------------------------------


def run_pipeline(
    transcript: str,
    day_start: datetime,
    day_end: datetime,
    busy: list[BusySlot],
    use_llm_reasoning: bool = True,
    mode: str | None = None,
    preferences: list[TaskPreference] | None = None,
) -> tuple[ProposedSchedule, list[AgentActionLog]]:
    """`mode` overrides the ORCHESTRATION_MODE env var for this call only —
    deliberately a per-call parameter, not a mutation of the cached
    Settings singleton, so concurrent requests under different modes
    (e.g. the web UI's side-by-side compare) never race each other.
    `preferences` (from the clarification loop) are identical for both
    modes on a given request — the RQ1 comparison stays about
    orchestration, not about which mode got asked better questions."""
    resolved_mode = mode or get_settings().orchestration_mode
    if resolved_mode == "react":
        return run_react(transcript, day_start, day_end, busy, use_llm_reasoning, preferences)
    return run_hierarchical(transcript, day_start, day_end, busy, use_llm_reasoning, preferences)
