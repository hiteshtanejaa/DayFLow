const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, PageBreak,
} = require("docx");
const fs = require("fs");

const NAVY = "1F3864";
const LIGHT = "E8EEF7";

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 120 } });
}
function h3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } });
}
function para(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text })],
    spacing: { after: 160 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
  });
}
function paraRuns(runs, opts = {}) {
  return new Paragraph({ children: runs, spacing: { after: 160 }, alignment: opts.align || AlignmentType.JUSTIFIED });
}
function bullet(text) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 80 } });
}
function labelValue(label, value) {
  return new Paragraph({
    children: [new TextRun({ text: label + ": ", bold: true }), new TextRun({ text: value })],
    spacing: { after: 100 },
  });
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}
function caption(text) {
  return new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })], spacing: { before: 160, after: 80 } });
}
function spacer(after = 240) {
  return new Paragraph({ text: "", spacing: { after } });
}

function cell(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.header
      ? { type: ShadingType.CLEAR, fill: NAVY }
      : (opts.shade ? { type: ShadingType.CLEAR, fill: LIGHT } : undefined),
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [new Paragraph({
      children: [new TextRun({
        text, bold: !!opts.header,
        color: opts.header ? "FFFFFF" : undefined,
        size: opts.size || 19,
      })],
    })],
  });
}

function simpleTable(widths, headerRow, rows) {
  const header = new TableRow({
    children: headerRow.map((t, i) => cell(t, { width: widths[i], header: true })),
    tableHeader: true,
  });
  const body = rows.map((r, i) => new TableRow({
    children: r.map((v, ci) => cell(v, { width: widths[ci], shade: i % 2 === 1 })),
  }));
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: [header, ...body] });
}

// ---------------------------------------------------------------------
// Real Phase 1 (RQ1) result tables — unchanged data, carried forward
// from the previous report draft.
// ---------------------------------------------------------------------

function metricsTable() {
  const widths = [3800, 2613, 2613];
  return simpleTable(widths, ["Metric", "ReAct", "Hierarchical"], [
    ["Scheduling accuracy (within 15-min tolerance)", "74.0%", "90.0%"],
    ["Conflict resolution rate (n=13 at-risk scenarios)", "100.0%", "100.0%"],
    ["Hallucination rate (hard-constraint violations)", "0.0%", "0.0%"],
    ["Mean intent-extraction F1", "0.993", "0.967"],
    ["Re-optimisation latency P50 / P90 / P99 (ms)", "5,973 / 9,654 / 14,486", "6,226 / 8,342 / 14,805"],
    ["Mean API tokens per scenario", "1,547", "905"],
  ]);
}

function statsTable() {
  const widths = [2100, 2100, 1726, 1400, 1700];
  return simpleTable(widths, ["Metric", "Test", "Statistic", "p-value", "Sig. (α=.05)"], [
    ["Scheduling accuracy", "McNemar's exact (paired binary)", "12 discordant pairs", "0.0386", "Yes"],
    ["Re-optimisation latency", "Paired t-test", "t = 0.253", "0.8014", "No"],
    ["Re-optimisation latency", "Wilcoxon signed-rank", "W = 622.0", "0.8859", "No"],
    ["Intent-extraction F1", "Paired t-test", "t = 1.661", "0.1030", "No"],
    ["Intent-extraction F1", "Wilcoxon signed-rank", "W = 0.000", "0.1025", "No"],
  ]);
}

function byTypeTable() {
  const widths = [3200, 1900, 1900, 2026];
  return simpleTable(widths, ["Scenario type", "Scenarios", "ReAct correct", "Hierarchical correct"], [
    ["Meeting moved", "13", "13", "13"],
    ["Task overrun", "13", "10", "11"],
    ["Urgent task injected", "12", "12", "11"],
    ["Energy-level change", "12", "2", "10"],
    ["All scenarios", "50", "37 (74.0%)", "45 (90.0%)"],
  ]);
}

function matchedMetricsTable() {
  const widths = [3800, 2613, 2613];
  return simpleTable(widths, ["Metric", "ReAct", "Hierarchical"], [
    ["Scheduling accuracy (within 15-min tolerance, n=24)", "75.0% (18/24)", "95.8% (23/24)"],
    ["Conflict resolution rate (n=6 at-risk scenarios)", "100.0%", "100.0%"],
    ["Hallucination rate (hard-constraint violations)", "0.0%", "0.0%"],
    ["Mean intent-extraction F1", "1.000", "1.000"],
    ["Latency P50 / P90 / P99 (ms)", "17,061 / 47,440 / 80,310", "20,409 / 64,786 / 111,926"],
    ["Mean API tokens per scenario", "2,626", "813"],
  ]);
}

function replicationByTypeTable() {
  const widths = [2500, 1100, 1300, 1300, 1413, 1413];
  return simpleTable(widths, ["Scenario type", "Scenarios", "ReAct (main run)", "Hier. (main run)", "ReAct (matched)", "Hier. (matched)"], [
    ["Meeting moved", "6", "6", "6", "6", "6"],
    ["Task overrun", "6", "5", "6", "5", "6"],
    ["Urgent task injected", "6", "6", "6", "2", "5"],
    ["Energy-level change", "6", "1", "5", "5", "6"],
    ["All scenarios", "24", "18 (75.0%)", "23 (95.8%)", "18 (75.0%)", "23 (95.8%)"],
  ]);
}

function frameworkTable() {
  const widths = [1600, 1000, 2100, 1900, 2426];
  return simpleTable(widths, ["Framework", "Year", "Architecture", "Primary Domain", "Key Innovation"], [
    ["ReAct", "2023", "Single-agent", "Reasoning / tool-use", "Interleaved reasoning and action execution (Yao et al., 2023)"],
    ["AutoGen", "2023", "Multi-agent conversation", "Coding / dialogue", "Structured agent-to-agent message passing (Wu et al., 2023)"],
    ["MetaGPT", "2024", "Role-based multi-agent", "Software engineering", "Professional role assignment, structured outputs (Hong et al., 2024)"],
    ["LangGraph", "2024", "Graph-based (cyclic)", "General purpose", "Explicit state; conditional branching (LangChain, 2024)"],
    ["CrewAI", "2023", "Role-based abstraction", "General purpose", "Natural-language role/goal templates (Moura, 2023)"],
    ["AutoGPT", "2023", "Autonomous single-agent", "General purpose", "Chained tool use with persistent memory; documented goal-drift risk (Gravitas, 2023)"],
  ]);
}

function capabilityTable() {
  const widths = [3100, 1900, 1600, 1400, 1026];
  return simpleTable(widths, ["Tool category", "Example products", "Adaptive re-scheduling?", "AI intake?", "HITL?"], [
    ["Passive calendars", "Google Calendar, Outlook, Apple Calendar", "No", "No", "No"],
    ["Rule-based automation", "Reclaim.ai, Motion, Clockwise", "Limited (fixed rules)", "No", "No"],
    ["AI writing / planning assistants", "Notion AI, Microsoft Copilot", "No", "Yes", "No"],
    ["Present system", "-", "Yes", "Yes", "Yes"],
  ]);
}

function techStackTable() {
  const widths = [1700, 2500, 4826];
  return simpleTable(widths, ["Layer", "Technology", "Justification"], [
    ["Agentic framework", "LangGraph (StateGraph API)", "Explicit state management; two genuinely distinct graph topologies (2-node ReAct loop, 3-node hierarchical pipeline) coexist in one codebase, enabling the same intake to be run through both for RQ1"],
    ["LLM", "OpenAI Responses API (structured output via text_format)", "Structured-output binding directly to Pydantic schemas; adopted in place of the proposal's primary Anthropic Claude choice after an API-credit evaluation during development (confirmed acceptable by the supervisor, Section 3.3.1). A thin adapter, selected by a configuration setting, lets the same pipeline run on Google's Gemini API, which was used for the matched-model run in Section 5.2.2"],
    ["Deterministic engine", "Pure Python, no LLM calls", "Single source of truth for all time-block placement; ground truth generator for Phase 1 and Baseline C for Phase 2"],
    ["Backend", "Python + FastAPI", "Async-native; automatic OpenAPI schema; first-class Pydantic v2 integration"],
    ["Schema / validation", "Pydantic v2", "One shared contract across the engine, both agent pipelines, and the API layer"],
    ["Client", "React 18 + TypeScript + Vite", "Type-safe; fast HMR; adopted in place of the proposal's primary Flutter mobile client (confirmed acceptable by the supervisor, Section 3.3.1)"],
    ["Animation", "Framer Motion", "FLIP-style layout animation for the day calendar's move / add / remove transitions"],
    ["Persistence", "SQLAlchemy; PostgreSQL on Supabase (EU, Ireland); SQLite for local development and tests", "Matches the proposal's data-layer choice. Row-level security is enabled on every table so the project's public API key cannot read participant data; the backend connects directly to the database (Section 4.7)"],
    ["Calendar", "Google Calendar API (OAuth 2.0); mock Outlook and Apple EventKit providers", "The proposal's primary calendar integration, behind a small provider interface so further platforms can be added without changing the planning code (Section 4.8)"],
  ]);
}

function rq1DesignTable() {
  const widths = [2200, 4300, 1526];
  return simpleTable(widths, ["Metric", "Measurement method", "Answers"], [
    ["Scheduling accuracy", "Exact scenario-level match against deterministic ground truth, 15-minute tolerance on every event boundary", "RQ1"],
    ["Conflict resolution rate", "Proportion of the 13 at-risk scenarios where a pre-existing conflict is correctly identified and resolved", "RQ1"],
    ["Hallucination rate", "Proportion of runs producing any hard-constraint violation (validator-flagged)", "RQ1"],
    ["Intent-extraction F1", "Token-level F1 on task extraction, normalised-title matching against ground truth", "RQ1"],
    ["Re-optimisation latency", "Wall-clock time from request to complete schedule (P50 / P90 / P99)", "RQ1"],
    ["API token consumption", "Mean tokens per scenario per architecture, as a cost / scalability proxy", "RQ1"],
  ]);
}

function rq2DesignTable() {
  const widths = [2200, 4300, 1526];
  return simpleTable(widths, ["Metric", "Measurement method", "Answers"], [
    ["Task completion rate", "Daily self-report diary (% of intended tasks completed)", "RQ2"],
    ["Cognitive load", "NASA-TLX, six subscales, administered at baseline / Week 1 / Week 2", "RQ2"],
    ["Usability", "System Usability Scale (SUS), 10-item, administered at study end", "Usability"],
    ["Trust", "Adapted Knijnenburg et al. (2012) 6-item scale (reliability, transparency, controllability)", "RQ2"],
    ["Decision fatigue", "Daily diary item, 5-point Likert", "RQ2"],
    ["System engagement", "Automated telemetry: notification acknowledgement and reschedule-acceptance rates", "RQ2"],
    ["Qualitative themes", "Semi-structured exit interview; thematic analysis (Braun and Clarke, 2006)", "RQ2"],
  ]);
}

function apiTable() {
  const widths = [900, 2700, 4126, 1300];
  return simpleTable(widths, ["Method", "Endpoint", "Description", "Response"], [
    ["GET", "/health", "Liveness check; reports the server's default orchestration mode", "200 status"],
    ["POST", "/participants", "Creates an anonymous participant (random identifier, no personal data)", "201 participant_id"],
    ["DELETE", "/participants/{id}", "Erases the participant and everything they own", "204; 404 if unknown"],
    ["POST", "/clarify/next", "One turn of the clarification loop: given the transcript and prior answers, returns the next question or done=true, plus any silently-inferred preferences", "200 ClarifyNextResponse"],
    ["POST", "/clarify/answer", "Parses one free-text reply into a typed TaskPreference, or null if it cannot be turned into a rule", "200 TaskPreference or null"],
    ["POST", "/intake", "Runs the selected orchestration mode end-to-end: reads the connected calendar, builds, validates, checks preferences, stores the schedule as pending, and returns schedule + audit trail. Accepts replaces (a schedule to supersede) and skip (finished tasks)", "200 {schedule_id, schedule, agent_actions, calendar_busy, calendar_error}"],
    ["POST", "/schedules/{id}/confirm", "Commits a pending schedule and writes its blocks to the connected calendar; refused if it has violations", "200 status, calendar result; 409 on violations"],
    ["POST", "/schedules/{id}/reject", "Rejects a schedule", "200 status"],
    ["POST", "/schedules/{id}/sync", "Retries writing a committed schedule's blocks to the calendar", "200 calendar result; 409 if not committed"],
    ["POST", "/blocks/{id}/start, /blocks/{id}/done", "Records that the participant started or finished a block of a committed schedule", "200; 404 if not theirs; 409 if not committed"],
    ["GET", "/monitor/check", "Execution Monitor: returns progress per block, blocks that are late to start or overrunning, and titles already done", "200 MonitorState"],
    ["GET", "/calendar/status", "Whether Google Calendar is connected for this participant", "200 google_connected"],
    ["GET", "/calendar/google/connect", "Starts Google OAuth 2.0 and returns the consent-screen URL", "200 url; 503 if not configured"],
    ["GET", "/calendar/google/callback", "OAuth redirect target; stores the refresh token and returns the browser to the client", "302 redirect"],
    ["DELETE", "/calendar/google", "Disconnects Google Calendar", "204"],
  ]);
}

// ---------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------

const titlePage = [
  spacer(600),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Interim Report", bold: true, size: 56, color: NAVY })],
    spacing: { after: 200 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Prototype and Phase 1 (RQ1) Automated Evaluation Results", size: 30 })],
    spacing: { after: 100 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: "Agentic AI for Real-Time Personal Schedule Execution Management: Designing, Implementing, and Evaluating a Proactive Multi-Agent Assistant for Daily Schedule Adaptation",
      italics: true, size: 22, color: "444444",
    })],
    spacing: { after: 800 },
  }),
  spacer(400),
  labelValue("Name", "[Name]"),
  labelValue("Student ID", "[Student ID]"),
  labelValue("Course of Study", "MSc Computer Science"),
  labelValue("Supervisor", "[Supervisor]"),
  labelValue("Submission Date", "13-08-2026"),
  labelValue("Word Count", "[To be finalised on submission]"),
  labelValue("Deliverable", "Interim Report (Prototype + Phase 1 Results), per project schedule"),
  pageBreak(),
];

const abstractAndAck = [
  h1("Abstract"),
  para(
    "Empirical evidence consistently suggests that the primary bottleneck in personal productivity is not planning insufficiency but execution failure: most daily plans deviate from their intended trajectory before midday, not because users fail to plan but because real-world disruptions occur and no tool adapts intelligently in response. Existing calendar platforms display schedules but do not adapt them; rule-based scheduling assistants automate parts of the workflow but offer no conversational disruption handling or transparent reasoning; and AI planning assistants can generate an initial plan but do not monitor or adapt its execution."
  ),
  para(
    "This project investigates how a multi-agent large language model (LLM) system can support real-time daily schedule adaptation, comparing two agent orchestration patterns and quantifying the effect of human-in-the-loop confirmation on trust and task completion. Two questions guide the work: (RQ1) how do single-agent ReAct and hierarchical multi-agent orchestration compare on scheduling accuracy, re-optimisation latency, and conflict-resolution fidelity; and (RQ2) to what extent does proactive, confirmable AI-driven execution support improve self-reported task completion and reduce cognitive load relative to passive calendar planning."
  ),
  para(
    "The system is built on a deterministic, LLM-free scheduling engine — the single source of truth for all time-block placement — beneath two genuinely distinct LangGraph orchestration architectures: a three-node hierarchical pipeline (Intake and Intent Agent, Scheduling Orchestrator Agent, Execution Monitor Agent) and a two-node ReAct agent–tool loop. A web-based companion client renders the resulting schedule on an animated day calendar, runs a turn-by-turn natural-language clarification dialogue before the first build to elicit scheduling preferences the model cannot safely infer, and requires explicit human confirmation before any schedule is committed, with every agent action logged to a client-visible audit trail. A confirmed schedule is written to the participant's Google Calendar, and a deterministic Execution Monitor then watches the day: when a block starts late or overruns, it offers to re-plan the remainder through the same pipeline. Participants are identified only by random anonymous identifiers, and their data is held in an EU-hosted PostgreSQL database."
  ),
  para(
    "Phase 1 (RQ1) is complete. A 50-scenario synthetic disruption benchmark, run through both architectures (100 live model calls), found hierarchical orchestration significantly more accurate at schedule construction than ReAct (90.0% vs 74.0%, McNemar's exact test p = 0.039), with no significant difference in re-optimisation latency or intent-extraction quality, and a secondary token-efficiency advantage for the hierarchical mode. Analysis of the failures qualifies this result: every mis-scored run, in both modes, placed the correct tasks with the correct durations in a different order, and 10 of ReAct's 13 failures fall in a single scenario type in which task priority is only implicit in the transcript. The result is therefore best read as a difference in agreement on task ordering rather than in placement ability. Because the two configurations also differed in model tier (Section 5.2.1), a second run on 24 of the scenarios gave both configurations the same model (Gemini 3.5 Flash Lite) and reproduced the gap (95.8% vs 75.0%; p = 0.0625, the smallest value possible with that many discordant pairs, so not significant), although the scenario types in which ReAct failed differed from the main run (Section 5.2.2). Phase 2 — the two-week human participant study answering RQ2 — has not yet begun; its status and the remaining work required before it can start are set out in Sections 5.3 and 5.5 and Chapter 7."
  ),
  para(
    "The project contributes empirical evidence on agent orchestration patterns in a time-sensitive, user-facing domain that current agentic-AI benchmarks do not cover, a reusable synthetic-benchmark methodology for scheduling systems, and a clarification-driven preference-elicitation design that surfaces and mechanically checks user scheduling constraints rather than silently guessing at them."
  ),
  para(
    "Keywords: Agentic AI, Large Language Models, Multi-Agent Orchestration, Real-Time Schedule Adaptation, Human-in-the-Loop AI, LangGraph, Deterministic Scheduling Engine, Human-AI Trust."
  ),
  h1("Acknowledgements"),
  para(
    "I would like to thank my supervisor, [Supervisor], for their guidance and consistent feedback throughout this project, particularly in confirming the two implementation-layer deviations from the original proposal documented in Section 3.3.1. I would also like to thank the MSc Computer Science cohort for discussion throughout the year, and the participants who will take part in the Phase 2 evaluation."
  ),
  pageBreak(),
];

// ---------------------------------------------------------------------
// 1. Introduction
// ---------------------------------------------------------------------

const chapter1 = [
  h1("1. Introduction"),
  h2("1.1 Background and Motivation"),
  para(
    "The personal productivity landscape is dominated by passive tools: calendars that display time blocks, and to-do lists that enumerate obligations, neither of which adapts when the day does not go to plan. Despite widespread adoption of these tools, the majority of daily plans deviate from their intended trajectory before midday — not because users fail to plan, but because rescheduled meetings, fluctuating cognitive energy, and cascading task dependencies occur, and no tool re-prioritises the remainder of the day in response. This gap is particularly acute for university students, young professionals, and individuals with executive dysfunction, who possess a plan but lack a dynamic mechanism to execute it through a real day's disruptions."
  ),
  para(
    "Existing tools fall into two incomplete categories. Passive calendar platforms (Google Calendar, Outlook, Apple Calendar) require the user to manage their own re-prioritisation; rule-based automation tools (Reclaim.ai, Motion, Clockwise) reschedule flexible tasks against pre-configured rules but offer no conversational interface for novel disruptions and no transparent reasoning trail; and AI planning assistants (Notion AI, Microsoft Copilot) can generate an initial schedule from natural language but do not monitor or adapt its execution in real time. Recent advances in multi-agent LLM frameworks — AutoGen, MetaGPT, and LangGraph among them — demonstrate that agentic systems can decompose complex tasks and coordinate across specialised components, but this body of work is concentrated almost entirely on coding, reasoning, and knowledge-retrieval tasks. Its application to time-sensitive, user-facing scheduling workflows, where quality is measured by latency, conflict-resolution fidelity, and sustained user trust rather than code correctness, remains empirically thin. This project is situated in that gap: it designs, implements, and evaluates a multi-agent system for real-time personal schedule adaptation, comparing two orchestration patterns and measuring the effect of human-in-the-loop confirmation on trust and outcomes."
  ),
  h2("1.2 Research Questions"),
  para(
    "RQ1: How do single-agent ReAct and hierarchical multi-agent LLM orchestration architectures compare in terms of scheduling accuracy, re-optimisation latency, and calendar conflict resolution fidelity when applied to the real-time daily schedule adaptation problem?"
  ),
  para(
    "RQ2: To what extent does proactive AI-driven execution support — comprising scheduled nudges, real-time reshuffling, and confirmatory micro-interactions — improve self-reported task completion rates, reduce decision fatigue, and sustain user trust and perceived autonomy compared to passive calendar-based planning over a two-week usage period?"
  ),
  h2("1.3 Objectives"),
  para("Six objectives structure the project, each carried forward from the proposal with its current status noted:"),
  bullet("Objective 1 (literature review) — complete."),
  bullet("Objective 2 (dual-orchestration system architecture) — complete for both configurations; the hierarchical pipeline and the ReAct loop are both fully implemented and directly comparable, not one built and one deferred."),
  bullet("Objective 3 (intake, scheduling engine, and human-in-the-loop interface) — complete in a minimal form: clarification dialogue, confirm-or-reject flow, persistence, and a deterministic Execution Monitor that detects late starts and overruns and offers a re-plan. Nudges are delivered as an in-page banner only; push notifications, a quiet mode, and a nudge-frequency control are not built (Section 6.2 and Chapter 7)."),
  bullet("Objective 4 (Google Calendar integration and mock platform interfaces) — complete in a minimal form: Google Calendar is read for busy time when a plan is built and written when a plan is confirmed, and mock Outlook and Apple EventKit providers implement the same interface (Section 4.8). Changes made in the calendar after a plan is built are not pushed back into the system."),
  bullet("Objective 5 (structured evaluation, RQ1 and RQ2) — Phase 1 (RQ1, automated) complete and reported in Chapter 5; Phase 2 (RQ2, human participant study) not started."),
  bullet("Objective 6 (documentation, limitations, future work) — addressed by this report (Chapters 6–7) and updated at each submission."),
  h2("1.4 Report Structure"),
  para(
    "Chapter 2 reviews five bodies of literature relevant to this project and identifies the research gap. Chapter 3 describes the system design and methodology, including architectural decisions, technology selection, and legal, social, and ethical considerations. Chapter 4 documents the implementation in detail. Chapter 5 presents the evaluation framework and the completed Phase 1 (RQ1) results. Chapter 6 discusses the system's strengths, limitations, and practical implications. Chapter 7 concludes with a summary of objectives achieved and directions for the remaining work."
  ),
];

// ---------------------------------------------------------------------
// 2. Literature Review (condensed from the standalone Literature Review
// submission; restructured to this report's chapter format, not copied
// verbatim from either source document).
// ---------------------------------------------------------------------

const chapter2 = [
  h1("2. Literature Review"),
  h2("2.1 Introduction"),
  para(
    "The emergence of LLM-based agentic systems extends language models beyond passive text generation into active, tool-using, goal-directed behaviour. Since 2022, frameworks such as AutoGen, MetaGPT, CrewAI, and LangGraph have shown that AI systems can decompose complex tasks, coordinate across specialised sub-agents, and interact with external APIs in pursuit of defined objectives (Wang et al., 2024; Xi et al., 2023). This body of work has concentrated on coding, reasoning, and knowledge-retrieval tasks; time-sensitive, user-facing domains such as personal scheduling remain comparatively unexplored. This chapter reviews five relevant streams of research — LLM-based agent frameworks and orchestration patterns; real-time scheduling and calendar automation; proactive agent design; human-AI interaction and trust; and cognitive load theory as an evaluative framework — and identifies the gap this project addresses."
  ),
  h2("2.2 LLM-Based Agent Frameworks and Orchestration Patterns"),
  h3("2.2.1 Foundational Paradigms and Agent Posture"),
  para(
    "Wang et al. (2024) document the maturation of architectures enabling models to perceive an environment, reason about goals, plan action sequences, and use external tools within a single framework. Xi et al. (2023) identify three properties shared by effective agent systems — perception, cognition, and action — which map directly to this project's three proposed agent roles: the Intake and Intent Agent (perception), the Scheduling Orchestrator Agent (cognition), and the Execution Monitor Agent (action and monitoring). Maes (1994), writing before the LLM era, distinguishes reactive agents (responding to stimuli as they arise) from proactive agents (anticipating future states and acting in advance). This distinction is central to the present design: the ReAct baseline is a primarily reactive posture, while the hierarchical variant's Monitor role is designed to sense and initiate adaptation proactively."
  ),
  h3("2.2.2 The ReAct Paradigm"),
  para(
    "Yao et al. (2023) introduce ReAct, which interleaves natural-language reasoning traces with tool-invocation steps, allowing an agent to course-correct on tool feedback. ReAct is an appropriate baseline for scheduling because calendar operations produce structured, observable feedback at each step — a query returns an available slot or a conflict. Its known limitation in complex, multi-concern domains is that a single agent must simultaneously manage task extraction, conflict resolution, and deviation detection within one reasoning chain, a hypothesis this project's Phase 1 evaluation tests directly."
  ),
  h3("2.2.3 Multi-Agent Frameworks: AutoGen and MetaGPT"),
  para(
    "Wu et al. (2023) introduce AutoGen, a multi-agent conversation framework in which agents communicate through a structured dialogue protocol with a central orchestrator coordinating decomposition and delegation — the model this project's hierarchical variant adopts as its inter-agent communication substrate. Hong et al. (2024) extend the paradigm with MetaGPT's role-based specialisation, assigning distinct professional roles to individual agents and enforcing structured outputs at each stage; the same role-specialisation principle underlies the Intake, Orchestrator, and Monitor role split used here. Neither paper evaluates orchestration on time-sensitive, user-facing scheduling workflows — the domain gap this project addresses."
  ),
  h3("2.2.4 Additional Frameworks and Comparison"),
  para(
    "AutoGPT (Gravitas, 2023) was among the earliest autonomous agent systems, chaining tool use with persistent memory; its documented tendency toward goal drift and high token consumption on long-horizon tasks helped motivate more structured orchestration. CrewAI (Moura, 2023) offers higher-level role and goal templates defined in natural language. LangGraph (LangChain, 2024) models agent interactions as directed graphs with conditional branching — well-suited to this project's disruption-handling flow, where re-optimisation must branch on whether a new disruption has been detected, and adopted as the orchestration substrate for both architectures compared here."
  ),
  caption("Table 1: Comparison of Key LLM Agent Frameworks"),
  frameworkTable(),
  spacer(),
  h2("2.3 Real-Time Scheduling Systems and Calendar Automation"),
  h3("2.3.1 The Planning–Execution Gap"),
  para(
    "A foundational premise of this project is that the primary bottleneck in personal productivity is execution failure, not planning insufficiency. Research on implementation intentions (Gollwitzer, 1999) shows that prospective goal planning reliably improves task initiation but does not prevent the goal-stranding that occurs when a plan meets a real-world disruption with no adaptive mechanism. Executive-dysfunction research in ADHD populations (Barkley, 1997) identifies difficulty with dynamic task switching — not planning per se — as the primary impairment, grounding the project's core hypothesis that real-time adaptive re-scheduling addresses a genuine, underserved need."
  ),
  h3("2.3.2 Existing Tools: A Capability Gap"),
  para(
    "A survey of the current landscape reveals a consistent pattern: tools optimise for planning support while providing minimal adaptive execution support. Passive calendars display events but perform no automated adaptation. Rule-based assistants such as Reclaim.ai, Motion, and Clockwise reschedule flexible tasks automatically but operate on pre-configured rules, without a conversational interface for novel disruptions and without a reasoning trail a user can inspect. AI writing and planning assistants such as Notion AI and Microsoft Copilot can generate an initial schedule from natural language but do not monitor or adapt its execution. No current product combines conversational disruption capture, transparent adaptive re-scheduling, and human-in-the-loop confirmation."
  ),
  caption("Table 2: Capability Gap Across Current Scheduling Tool Categories"),
  capabilityTable(),
  spacer(),
  h3("2.3.3 Calendar APIs and LLM Non-Determinism"),
  para(
    "The technical infrastructure for calendar automation is well established: the Google Calendar API v3 provides a comprehensive REST interface with OAuth 2.0 as the standard authentication mechanism. Prior work on calendar-aware scheduling (Kincaid and Lam, 2006; Berry et al., 2011) addresses availability inference and conflict detection, but these challenges compound when conflict resolution must also weigh task priority, energy constraints, and dependency relationships. Standard calendar API logic is deterministic, but routing conflict resolution through an LLM introduces non-determinism — the same disruption may produce a different ordering across calls. This project addresses that directly by enforcing structured, schema-validated output from every LLM call and re-checking every result against hard constraints with a deterministic validator before it reaches the user (Section 3.1)."
  ),
  h2("2.4 Proactive Agent Design and Execution Support"),
  h3("2.4.1 Proactive vs. Reactive Posture"),
  para(
    "Maes's (1994) reactive/proactive distinction is foundational to the Execution Monitor Agent's design: a reactive agent waits for the user to report a disruption; a proactive agent monitors execution and initiates re-scheduling once a block has gone unstarted past a configurable grace period. Maes also identifies the autonomy-override dilemma — the more proactively an agent acts, the greater the risk its actions diverge from actual user preference, eroding trust — addressed here through the human-in-the-loop confirmation mechanism (Amershi et al.'s, 2019, guideline 9: support efficient correction)."
  ),
  h3("2.4.2 Nudge Design and Behavioural Grounding"),
  para(
    "The proactive nudging mechanism is grounded in the implementation-intention literature: Gollwitzer and Sheeran (2006) show that specific if-then plans linking a situational cue to an intended action significantly increase follow-through. A push notification referencing a specific task and time functions as such a cue. Iqbal and Bailey (2008) show interruption at natural task breakpoints produces markedly less cognitive disruption than interruption during active engagement; Fogg's (2003) behaviour model — motivation, ability, and trigger co-occurring — further informs the design, with the confirmation interface and audit trail lowering the ability threshold and the notification layer supplying the trigger."
  ),
  h3("2.4.3 Generative Agents"),
  para(
    "Park et al. (2023) demonstrate that LLM-based agents can simulate complex behaviour by maintaining persistent memory and reflecting on past experience before planning future actions. The architectural insight of separating memory, reflection, and planning into distinct modules informs the Execution Monitor's deviation-detection logic, which periodically evaluates whether the current state diverges from the expected trajectory."
  ),
  h2("2.5 Human-AI Interaction, Trust, and Autonomy Preservation"),
  h3("2.5.1 Guidelines for Human-AI Interaction"),
  para(
    "Amershi et al. (2019) present 18 guidelines for human-AI interaction. Three are directly operationalised here: guideline 4 (make clear why the system acted) via the audit trail panel, which shows the agent's reasoning for every scheduling decision; guideline 7 (support efficient invocation) via natural-language intake and disruption reporting; and guideline 9 (support efficient correction) via a one-tap confirm-or-reject step and the newly built clarification loop's escape hatch (Section 4.4), which lets a user stop answering and build immediately at any point."
  ),
  h3("2.5.2 Automation Trust"),
  para(
    "Lee and See (2004) define trust in automation along three bases: performance (the system does what it claims), process (its operation is transparent), and purpose (its goals align with the user's). These map to this project's three trust-relevant features: scheduling accuracy and latency (performance), the audit trail (process), and human-in-the-loop confirmation (purpose alignment). The adapted Knijnenburg et al. (2012) 6-item scale, selected for Phase 2, operationalises exactly these three dimensions."
  ),
  h3("2.5.3 Human-in-the-Loop Design and Autonomy"),
  para(
    "The human-in-the-loop paradigm holds that user oversight is essential wherever AI errors carry real-world consequences (Monarch, 2021); a calendar modification that conflicts with a commitment the system could not see has direct, observable consequences for the user's day, making confirmation a safety mechanism, not only a trust-building feature. A recurring concern in this literature is that reducing a task's cognitive demands can also reduce the user's sense of autonomy (Dietvorst et al., 2015), risking what Parasuraman and Riley (1997) term automation complacency. This project addresses the concern through the confirmation step, the audit trail, and (planned for Phase 2) user-controlled nudge-frequency settings."
  ),
  h2("2.6 Cognitive Load Theory as an Evaluative Framework"),
  h3("2.6.1 Dual-Process Theory and Decision Fatigue"),
  para(
    "Kahneman's (2011) dual-process theory distinguishes fast, heuristic System 1 cognition from slow, effortful System 2 reasoning. Real-time schedule re-planning — holding the day's current state, dependencies, and constraints in working memory while re-ordering tasks — falls squarely in the System 2 domain, and this demand, repeated at every disruption, cumulatively depletes executive resources (Baumeister et al., 1998). The project's central cognitive-load hypothesis is that AI-driven adaptation reduces this System 2 demand by offloading re-prioritisation to the agent, operationalised via the NASA-TLX instrument (Hart and Staveland, 1988) in Phase 2."
  ),
  h3("2.6.2 The Extended Mind Hypothesis"),
  para(
    "Clark and Chalmers (1998) propose that cognitive processes can extend into reliably coupled external tools. Applied here, an AI scheduling agent reliably coupled to a user's calendar and task state functions as an extension of the user's executive planning system, offloading active re-planning computation rather than mere information storage — predicting performance gains comparable to established cognitive-offloading tools such as external to-do lists (Kirsh, 1995), with the added benefit of dynamic adaptation."
  ),
  h3("2.6.3 NASA-TLX and the System Usability Scale"),
  para(
    "The NASA-TLX (Hart and Staveland, 1988) is the most widely used subjective workload instrument in human-factors research; the SUS (Brooke, 1996) complements it with a validated 10-item usability measure. Together they provide orthogonal coverage of the user-experience dimensions most relevant to evaluating a novel AI scheduling assistant, and both are administered in the Phase 2 design (Section 5.1)."
  ),
  h2("2.7 Identifying the Research Gap"),
  para(
    "Three specific gaps emerge from this synthesis. First, multi-agent LLM frameworks have been evaluated almost exclusively on coding, reasoning, and knowledge-retrieval tasks; neither Wu et al. (2023) nor Hong et al. (2024) evaluate their frameworks in a time-sensitive, user-facing scheduling domain where quality is measured by latency, conflict-resolution fidelity, and trust rather than code correctness. Second, despite the theoretical predictions of dual-process theory and the extended mind hypothesis, there is limited empirical work quantifying the effect of proactive AI-driven execution support on task completion and cognitive load in a controlled longitudinal study. Third, the human-AI trust literature identifies calibrated reliance as a central design challenge (Lee and See, 2004) but has rarely examined it in personal productivity systems with explicit human-in-the-loop confirmation. RQ1 (via the Phase 1 synthetic benchmark) and RQ2 (via the planned Phase 2 longitudinal study) are positioned to address the first and the second and third gaps respectively."
  ),
  h2("2.8 Conclusion"),
  para(
    "This chapter has surveyed five bodies of literature — LLM agent frameworks, real-time scheduling, proactive agent design, human-AI interaction, and cognitive load theory — and shown their convergence on the problem this project addresses. The system design that follows in Chapter 3 is directly grounded in this synthesis: the ReAct baseline and hierarchical variant in established agentic AI frameworks (Yao et al., 2023; Wu et al., 2023; Hong et al., 2024); the proactive Monitor role in agent theory and behavioural science (Maes, 1994; Gollwitzer and Sheeran, 2006); the confirmation and audit trail design in human-AI interaction guidelines and automation trust research (Amershi et al., 2019; Lee and See, 2004); and the Phase 2 evaluation instruments in validated cognitive-load and usability measurement traditions (Hart and Staveland, 1988; Brooke, 1996)."
  ),
];

// ---------------------------------------------------------------------
// 3. System Design and Methodology
// ---------------------------------------------------------------------

const chapter3 = [
  h1("3. System Design and Methodology"),
  h2("3.1 Overall Architecture"),
  para(
    "The system separates three concerns cleanly. A deterministic, LLM-free scheduling engine performs all actual time-block placement, free-slot search, and constraint checking; it is never called by an LLM to make a placement decision itself, and both orchestration modes must go through it. Two LLM-driven orchestration architectures sit above this engine and differ only in how they reason about and call it — a design chosen specifically so that any measured difference in Phase 1 can be attributed to the orchestration pattern rather than to the underlying placement mathematics, which are provably identical either way. A React web client renders the resulting schedule on an animated day calendar, runs the pre-build clarification dialogue, and renders a client-visible audit trail of every agent action."
  ),
  para(
    "The user submits a morning-intake transcript through the client. The backend runs the selected orchestration mode synchronously and returns the completed schedule, its validator-checked violations, any preference mismatches, and the full agent action log in a single response. A disruption reported later in the day (\"something come up?\") is re-submitted through the same endpoint with the current schedule stated as tentative context, producing a fresh re-plan rather than an incremental patch."
  ),
  para(
    "A proposed schedule is only a proposal. It is stored with a pending status, and the participant either confirms it, which commits it and writes it to their calendar, or rejects it. Once a schedule is committed, a deterministic Execution Monitor, running as server code rather than as an LLM agent, compares the plan with what the participant reports actually happening. If a block has not been started, or has run past its end, by more than a grace period, the client shows a nudge; if the participant accepts it, the remainder of the day is re-planned through the same intake path, with finished tasks excluded and the day restarting from the current time. The monitor is identical for both orchestration modes, so it cannot confound the RQ1 comparison."
  ),
  h2("3.2 Agent Pipeline Design"),
  para(
    "Both orchestration configurations are built with LangGraph and are selectable per request, so the same intake transcript and the same clarified preferences can be processed by both for direct experimental comparison."
  ),
  h3("3.2.1 Hierarchical Delegation (Configuration A)"),
  para(
    "A three-node LangGraph state graph — Intake and Intent Agent, Scheduling Orchestrator Agent, Execution Monitor Agent — matches the architecture specified in the proposal. The Intake Agent extracts structured tasks, overall energy level, and context flags from the transcript via a single structured-output LLM call. The Orchestrator always calls the deterministic engine to place blocks and the validator to check them; an LLM call on top of that result only produces the plain-language explanation shown to the user, never the placement itself. The Monitor node closes a conditional edge back to the Orchestrator when a disruption is flagged in the graph state, and remains a structural stub inside the graph. Monitoring of the live, confirmed day is deliberately implemented outside the graph, as a deterministic service shared by both modes (Section 4.9), because deviation detection is a comparison of timestamps that needs neither an LLM's judgement nor its latency and cost."
  ),
  h3("3.2.2 Single-Agent ReAct (Configuration B)"),
  para(
    "A two-node LangGraph loop (agent ↔ tools) implements the ReAct paradigm directly: one agent interleaves reasoning with a real tool call, propose_schedule, backed directly by the same deterministic engine. If the tool reports constraint violations the agent revises its own task list and calls it again, until it is satisfied or an iteration cap (six) is reached, at which point a give_up node returns the best schedule found. Iteration count varies per run depending on how many tool calls the model judges necessary — itself a Phase 1 datum (Chapter 5)."
  ),
  para(
    "The key methodological difference between the two configurations is not the placement mathematics, which are identical, but how much of the reasoning happens inside a single continuous LLM trace (ReAct) versus split across specialised roles with a deterministic hand-off between them (hierarchical) — precisely the comparison RQ1 is designed to isolate."
  ),
  h2("3.3 Technology Stack Selection and Rationale"),
  para(
    "Technology selection was guided by three criteria: fitness for running two genuinely distinct orchestration topologies in one codebase, quality and reliability of structured LLM output for a domain where hallucinated dates or times have real consequences, and development velocity suitable for an MSc project timeline."
  ),
  caption("Table 3: Technology Stack and Justification"),
  techStackTable(),
  spacer(),
  h3("3.3.1 Deviations from the Proposal"),
  para(
    "Two implementation choices differ from the proposal as submitted. Neither affects the research design (RQ1/RQ2, the MVRC, or the evaluation framework); both are implementation-layer substitutions confirmed with the supervisor and treated as approved for the remainder of the project. First, LLM provider: the proposal names Anthropic Claude as primary with OpenAI as a secondary baseline; the prototype runs on OpenAI as primary, adopted after an evaluation of available API credits during development, with the supervisor confirming any provider is acceptable. A second provider, Google Gemini, is also supported through a thin adapter and was used for the matched-model benchmark run in Section 5.2.2, when OpenAI credit ran out. Second, client platform: the proposal specifies a Flutter mobile companion; the prototype implements a web companion as the primary and only client, confirmed acceptable by the supervisor in place of native mobile development."
  ),
  h2("3.4 Human-in-the-Loop and Clarification Interface Design"),
  para(
    "The confirmation and audit trail design follows the Amershi et al. (2019) guidelines directly (Section 2.5.1): the audit trail panel makes agent reasoning visible per guideline 4; natural-language intake and disruption reporting satisfy guideline 7; and a one-tap confirm-or-reject step satisfies guideline 9. No schedule reaches a committed state without passing the deterministic validator and without explicit user confirmation."
  ),
  para(
    "A second design layer, built after the Phase 1 benchmark and not present in the proposal's original interface sketch, addresses a specific failure mode Phase 1 did not measure but real usage exposed: the system has no way to know, for example, that \"gym\" should come before or after work without asking, and no general-knowledge basis for silently assuming a time window for an activity like \"dinner\" unless that inference is made explicit and checked. The clarification interface asks up to a handful of natural-language questions, one at a time, choosing at each turn the single most schedule-relevant remaining ambiguity; the user can answer in free text or stop early (\"that's fine, build it\") at any point, directly implementing guideline 9's efficient-correction principle at the elicitation stage rather than only after a schedule is built. Any preference the model can infer from general knowledge (dinner in the evening, breakfast in the morning) is applied silently rather than asked about, and every collected preference is later checked mechanically — not by a second LLM judgement — against the built schedule, with any mismatch flagged to the user rather than silently corrected a second time."
  ),
  h2("3.5 Data Model and API Design"),
  para(
    "A single Pydantic schema module is the contract shared by the deterministic engine, both agent pipelines, and the API layer. Task carries title, duration, energy requirement, priority, an optional deadline, and an optional fixed_start for genuinely committed times. ScheduleBlock is the engine's placed output; ScheduleViolation is a hard-constraint failure raised by the validator (outside working hours, calendar conflict, overlap). TaskPreference is the typed vocabulary produced by the clarification loop — a time window, a pairwise before/after ordering relative to another named task, or an energy-slot preference — deliberately a small closed vocabulary rather than freeform text, so that whether a built schedule honoured it can be checked mechanically rather than by a second, unverifiable LLM judgement. AgentActionLog records every agent step (mode, agent name, action, latency, token usage, reasoning summary) and is the data source for the audit trail and for Phase 1's token and latency metrics."
  ),
  para(
    "The REST API (Appendix A) exposes a clarification endpoint that returns one question per call together with any silently-inferred preferences, a matching answer-parsing endpoint, and a single intake endpoint that runs the full pipeline — build, validate, check preferences — and returns the schedule, its violations, and the complete audit trail in one response. Further endpoints cover the participant lifecycle, confirming and rejecting a schedule, calendar connection, and the Execution Monitor."
  ),
  h2("3.6 Legal, Social, Ethical, and Professional Considerations"),
  para(
    "Data protection and privacy: all data handling is designed to comply with UK GDPR and the Data Protection Act 2018. The prototype now persists data, and is built to minimise it. A participant is a random UUID created on first use; no name, email address, or other identifying field is collected, and the raw intake transcript is not stored. What is stored, under that identifier, is the structured output: tasks, schedules and their blocks, clarified preferences, block start and completion times, and the agent action log. The database is hosted in the EU (Ireland), row-level security is enabled on every table, and a single erasure endpoint deletes a participant and everything they own, which gives a working mechanism for withdrawal. The Phase 2 design additionally specifies deletion 12 months after dissertation submission. Two gaps remain before real participants are enrolled: a connected Google account's refresh token is currently stored unencrypted and must be encrypted, and the identifier itself is the only credential, so proper authentication is needed. A full ethics application will be submitted to the university Research Ethics Committee before any Phase 2 data collection begins."
  ),
  para(
    "AI transparency and disclosure: every schedule is presented as AI-generated, and the audit trail panel is persistently accessible, showing the agent's reasoning for every decision rather than only the final result."
  ),
  para(
    "Third-party APIs: the OpenAI and Google Calendar integrations operate under their providers' terms of service. Calendar access is granted by the participant through Google's own consent screen and can be revoked from within the application. API keys, OAuth client secrets, and the database password are stored only in environment variables and never committed to version control, consistent with the practice followed throughout development (Section 4.5)."
  ),
  para(
    "Autonomy preservation and guardrails: the system never commits a calendar modification without explicit user confirmation, and a schedule that the validator has flagged cannot be confirmed at all. The Execution Monitor only proposes: a nudge never re-plans the day or touches the calendar until the participant accepts it. The deterministic validator checks every LLM-proposed schedule against hard constraints before any result reaches the user, and the clarification loop's preference-checking step flags rather than silently auto-corrects a mismatch — a deliberate design choice made to avoid a second, unverified layer of AI judgement overriding what the user actually asked for."
  ),
  para(
    "Social considerations: the system targets users who may include individuals with ADHD and executive dysfunction — a group underserved by existing productivity tools (Section 2.3.1). The proactive nudging mechanism, now present in a minimal form, must support rather than exacerbate anxiety; a quiet-mode toggle and a user-controlled nudge-frequency setting are specified as minimum viable accommodations and are not yet built, and participatory design with ADHD communities is noted as a precondition for any future commercial development (Chapter 7)."
  ),
];

// ---------------------------------------------------------------------
// 4. Implementation
// ---------------------------------------------------------------------

const chapter4 = [
  h1("4. Implementation"),
  h2("4.1 Hierarchical Orchestration Mode"),
  para(
    "The hierarchical pipeline is implemented as a compiled LangGraph StateGraph with three nodes — intake, orchestrator, monitor — connected START → intake → orchestrator → monitor, with a conditional edge routing monitor back to orchestrator when a disruption is present in state, or to END otherwise. The intake node calls the Intake Agent with the transcript and the current reference date (added after a Phase 1 bug, Section 5.2, in which the model otherwise had no way to know what date \"today\" was). The orchestrator node always calls the deterministic engine and validator directly; an LLM reasoning call is layered on top only to produce the plain-language explanation of an already-fixed schedule, and can be skipped entirely on the latency-sensitive disruption-recovery path in favour of a template-generated explanation. The compiled graph is cached and reused across requests."
  ),
  h2("4.2 Single-Agent ReAct Mode"),
  para(
    "The ReAct loop is a second compiled LangGraph graph with nodes agent, tools, and give_up. The agent node calls the LLM with the full conversation so far and a single tool definition, propose_schedule, whose parameters mirror the Task schema (including, since a Phase 1 fix, an optional fixed_start field — Section 5.2). If the model requests the tool, the tools node dispatches it directly to the same build_schedule and validate_schedule functions the hierarchical mode uses, returns the result — including a pre-formatted display_time string so the model is never asked to reason about a raw ISO timestamp — and loops back to the agent. The agent stops calling the tool once it judges the schedule acceptable, or the graph routes to give_up after six iterations, returning the best schedule found rather than failing outright."
  ),
  h2("4.3 Deterministic Scheduling Engine, Validator, and Preference Handling"),
  para(
    "build_schedule places fixed-time tasks first, then flexible tasks in energy-then-urgency order into the day's remaining free slots, found by a general-purpose free-slot search that carves out both existing calendar busy time and already-placed blocks. A task carrying a clarified preference (Section 3.4) is placed with that preference applied best-effort: a time-window preference narrows the search to the relevant hours before falling back to a full-day search if nothing fits there; a pairwise ordering preference narrows the search to before or after its already-placed reference task. Neither constraint is ever silently enforced by moving another task — if it cannot be honoured, the task is still placed using the unconstrained search, and the mismatch is left for the validator layer to report rather than corrected a second time without the user's awareness."
  ),
  para(
    "Ordering preferences compose into chains. A user who says they will freshen up after the gym and then have dinner produces two pairwise rules that together fix a sequence of three tasks. Placement is therefore dependency-ordered: a task is not placed until every task it must follow has been placed, and when several rules constrain one task, the window allowed by all of them is the intersection. If the rules contradict each other, so that no task can be placed first, the engine falls back to the ordinary energy-then-urgency order instead of failing, and the unmet rule is reported by the preference check. This was added after real use showed a pairwise-only vocabulary placing a task before its prerequisite."
  ),
  para(
    "validate_schedule then re-checks the placed result against hard constraints — working-hours bounds, calendar conflicts, block overlaps — independently of whatever produced it, and check_preferences separately re-checks the softer, clarified preferences using the same typed vocabulary, matching a task by its title with an exact-then-fuzzy lookup rather than a brittle exact match, since a task's title can be extracted independently, and worded slightly differently, by the clarification step and by whichever orchestration mode subsequently builds the schedule."
  ),
  h2("4.4 Human-in-the-Loop Interface, Clarification Loop, and Interaction Logging"),
  para(
    "The web client presents a single intake box and a mode selector (hierarchical, ReAct, or both side by side for direct RQ1-style comparison). Submitting a transcript opens the clarification chat rather than building immediately: the client repeatedly calls the clarification endpoint, rendering each returned question as a chat message and any silently-inferred preference as a short informational note, until the server reports no further ambiguity or the user stops early. The resulting preferences are then submitted alongside the transcript to the intake endpoint, and the same preferences are re-used automatically if the user later reports a disruption, so a preference clarified once is not silently dropped on re-plan."
  ),
  para(
    "The resulting schedule renders on an animated day calendar (Framer Motion), with blocks keyed by normalised task title so that a task moved by a disruption animates as a move rather than a remove-and-add. A block that falls outside the working-day window — because a model-supplied fixed time landed past the boundary, or because the engine could not place it at all — renders in a clearly labelled section below the grid rather than overflowing the layout, a fix made after this exact failure mode was found during testing. Every agent action (mode, agent name, action taken, latency, token usage, and reasoning summary) is logged to a structured record and rendered in a client-visible audit trail panel, directly implementing Amershi et al.'s (2019) guideline 4 (Section 2.5.1)."
  ),
  h2("4.5 Backend API"),
  para(
    "The FastAPI backend exposes fifteen endpoint routes (Appendix A), in five groups: a health check; the two clarification-loop endpoints; the intake endpoint, which runs the selected orchestration mode end-to-end and returns the schedule, its violations, its preference mismatches, and the full audit trail in one response; the participant, confirm, reject, and calendar-sync endpoints; and the Execution Monitor endpoints. Configuration, including every credential, is read from environment variables. Every request and response body is a typed Pydantic model, giving the API runtime validation and automatic OpenAPI documentation for free, and a per-request orchestration-mode override lets the client run the identical intake through both architectures without any server-side state being shared or mutated between them — required for the side-by-side comparison view to be safe under concurrent requests."
  ),
  h2("4.6 Frontend"),
  para(
    "The frontend is a single-page React 18 and TypeScript application built with Vite. A day-calendar component renders the schedule as a vertical timeline; a schedule-view component wraps it with the reasoning summary, violation and preference-mismatch warnings, and the audit trail toggle; and a clarification-chat component implements the turn-by-turn dialogue described in Section 4.4. All backend communication is centralised through a single typed API module, keeping the request and response shapes in one place as the schema has evolved across the project. Beyond the calendar and the clarification chat, the client adds Confirm and Reject controls with the schedule's status, a list of today's blocks with Start and Done buttons once a schedule is confirmed, a Google Calendar connection bar, and the nudge banner described in Section 4.9. Blocks that overlap visually are laid out side by side in lanes so that none is hidden."
  ),
  h2("4.7 Persistence, Participant Identity, and the Confirmation Flow"),
  para(
    "Persistence uses SQLAlchemy against PostgreSQL on Supabase in production and an SQLite file in development and tests, selected from environment configuration. The backend connects to the database directly through Supabase's session pooler, not through Supabase's public API, and row-level security is enabled on every table so that the project's publishable API key, which is not used by the backend, is denied all access. A participant is an anonymous random identifier sent by the client in a request header; there is no account or password. Schedules, blocks (with their start, completion, and first-nudge times), preferences, and agent actions are stored against it, and deleting the participant deletes all of them."
  ),
  para(
    "A schedule moves through four statuses: pending when proposed, then committed or rejected by the participant, or superseded when a later plan replaces it, so at most one live plan exists for a day. Confirming a schedule that carries validator violations is refused with a conflict response, and the client disables the button as well, so the server does not rely on the client for this rule. One known shortcut: new columns are added to an existing database by a small additive helper rather than by migrations. This is adequate while the data is development data and must be replaced by proper migrations before Phase 2 data is collected."
  ),
  h2("4.8 Calendar Integration"),
  para(
    "Calendar access sits behind a small provider interface with two operations, reading busy time and creating or deleting an event. Google Calendar is the real implementation, authorised through OAuth 2.0 with the participant's explicit consent, and mock Outlook and Apple EventKit providers implement the same interface to demonstrate platform independence without further live integrations. When a plan is built for a connected participant, their existing events for the day are read as busy time, excluding events that the system itself created, so that a re-plan is not blocked by its own earlier output."
  ),
  para(
    "When a schedule is confirmed, each block is written as a calendar event. Insertion is idempotent, using a deterministic event identifier derived from the block, so a retry cannot duplicate an event, and calls are retried with exponential backoff. A failure never undoes the confirmation: it is recorded against the block and can be retried through a separate synchronisation endpoint. Events written for a plan that has since been rejected or replaced are deleted at the next confirmation, so a re-plan leaves one live set of events rather than two. All times follow one convention: naive Europe/London wall-clock time end to end, with the client sending London times without an offset and calendar times converted to London on read. This was a deliberate simplification to remove a class of time-zone shifting bugs found in testing, and it means the prototype is correct only for participants in the UK (Section 6.2)."
  ),
  h2("4.9 Execution Monitor"),
  para(
    "The Execution Monitor detects two kinds of deviation in a confirmed schedule: a late start, when a block has not been started a grace period after its scheduled start (ten minutes by default), and an overrun, when a started block is not marked done a grace period after its scheduled end. It is plain server code that compares stored timestamps with the current London time; it makes no LLM call, so it costs nothing per check, is predictable, and behaves identically in both orchestration modes. The client reports progress when the participant presses Start or Done on a block, and polls the monitor every thirty seconds. A detected deviation appears as a nudge banner offering to re-plan. If the participant accepts, the client submits a normal intake request whose day starts at the current time rounded up, with the titles of finished tasks excluded, so the same two orchestration modes produce the new plan. The time of the first nudge for each block is recorded, as the starting point for the engagement telemetry that Phase 2 requires."
  ),
  para(
    "This is the minimum that makes the proactive behaviour of RQ2 demonstrable. It is deliberately limited: nudges are shown only while the page is open, there is no push notification, and there is no quiet mode or nudge-frequency control. Acknowledgement and acceptance of nudges are also not yet recorded as telemetry; only the time of the first nudge is."
  ),
  h2("4.10 Testing"),
  para(
    "The backend has 37 automated tests covering the scheduling engine and validator, the preference vocabulary (time windows, ordering, chains, contradictory cycles, title resolution, and the rule that explicitly timed tasks are never given an inferred window), persistence and the confirm, reject, and supersede flow, the calendar layer (against the mock provider and a fake Google service, including failure and retry), and the Execution Monitor (against a fake clock). The API tests replace the LLM pipeline with a stub, so the tests are fast, free, and deterministic. This also means the prompts and the model-facing behaviour are not covered by the test suite; they are exercised by the Phase 1 benchmark and by manual use, and a test layer with recorded model responses remains to be added."
  ),
];

// ---------------------------------------------------------------------
// 5. Results and Evaluation
// ---------------------------------------------------------------------

const chapter5 = [
  h1("5. Results and Evaluation"),
  h2("5.1 Evaluation Framework"),
  para(
    "The evaluation is structured in two phases, as specified in the proposal. Phase 1 answers RQ1 through fully automated metrics and requires no human participants; it is complete and reported in Section 5.2. Phase 2 answers RQ2 through a two-week, n ≥ 20, three-condition human participant study; it has not started, and its planned design is summarised in Section 5.3 for completeness against the proposal."
  ),
  caption("Table 4: RQ1 Automated Metrics"),
  rq1DesignTable(),
  spacer(),
  caption("Table 5: RQ2 Planned Instruments"),
  rq2DesignTable(),
  spacer(),
  h2("5.2 RQ1: Orchestration Pattern Comparison — Results"),
  para(
    "Fifty synthetic disruption scenarios were generated, spanning the four disruption types named in the proposal (meeting moved, task overrun, urgent task injected, energy-level change), evenly distributed (13/13/12/12), with deterministic, seeded generation so the set can be reproduced identically for independent verification. Each scenario provides a natural-language intake transcript with explicitly stated task durations and energy levels, and a structured ground-truth schedule computed by the same deterministic engine both orchestration modes call internally — a defensible ground truth for scoring the LLM layer specifically, since the placement mathematics are identical either way, though not a substitute for independent human review of a results sample, which remains outstanding (Chapter 7). Each scenario was run through both orchestration modes (100 live model calls in total)."
  ),
  caption("Table 6: Phase 1 Results"),
  metricsTable(),
  spacer(),
  caption("Table 7: Statistical Comparison"),
  statsTable(),
  spacer(),
  para(
    "For scheduling accuracy, of the 50 paired scenarios: both modes were correct on 35, both were wrong on 3, ReAct was uniquely correct on 2, and hierarchical was uniquely correct on 10 — 12 discordant pairs, McNemar's exact test p = 0.0386. Hierarchical orchestration is significantly more accurate at schedule construction (90.0% vs 74.0%), with no statistically significant difference in re-optimisation latency (p = 0.80) or intent-extraction quality (p = 0.10), and a secondary token-efficiency advantage (905 vs 1,547 mean tokens per scenario) in the same direction as the accuracy result."
  ),
  caption("Table 8: Scheduling Accuracy by Scenario Type"),
  byTypeTable(),
  spacer(),
  para(
    "Breaking the accuracy result down by scenario type changes how it should be read. The two modes are level on meeting-moved scenarios and within one scenario of each other on task-overrun and urgent-task scenarios, in opposite directions. The whole of the headline gap comes from energy-level-change scenarios, where ReAct was correct on 2 of 12 and hierarchical on 10 of 12. Re-checking every failed run against its ground truth showed that in all 18 failures, across both modes, the produced schedule contained the right tasks with the right durations and no hard-constraint violation, but placed them in a different order from the ground truth. Because the accuracy metric requires every block to fall within 15 minutes of its ground-truth position, it is in effect an agreement test on task order."
  ),
  para(
    "That matters most in the energy-level-change scenarios. Every task in them is set to low energy, so the scheduling engine's energy-then-urgency ordering is decided entirely by priority, and the ground truth derives each task's priority from its position in the list, which the transcript conveys only through the order in which the tasks are mentioned. A configuration that reorders the tasks, or assigns priorities differently, is scored wrong even though nothing in the request makes its ordering incorrect. The Phase 1 accuracy result is therefore evidence that the hierarchical configuration reproduces the engine's ordering more faithfully when priority is implicit. It is not evidence that it places tasks more accurately in general, and it should not be reported more strongly than that."
  ),
  para(
    "Both hallucination rate and conflict resolution rate came out identical between modes (0.0% and 100.0% respectively) once the two implementation bugs below were fixed, which is itself informative: neither architecture is intrinsically more prone to hard-constraint violations at this scenario scale once the tool-schema and prompt gaps that had been driving the earlier apparent difference were closed."
  ),
  para(
    "Two implementation bugs were found and fixed during Phase 1 validation, both surfaced by the benchmark rather than by manual inspection, and both material enough that the discarded first run showed 0–2% scheduling accuracy and a 26% hierarchical hallucination rate against the corrected figures reported above. The Intake Agent's prompt originally never stated the current date, so a scenario referencing a fixed-time commitment (\"my meeting got moved to 3pm\") forced the model to invent a full calendar date, and in the discarded run it hallucinated a placement in the year 3000 — correctly flagged by the validator as a hard-constraint violation and the direct cause of the inflated hallucination rate; fixed by stating the reference date explicitly in both modes' prompts. Separately, ReAct's propose_schedule tool schema did not originally expose a fixed_start field at all, so its agent had no way to represent a fixed-time commitment and was silently dropping such tasks — a different failure mode from hierarchical's, and one that would have structurally biased all 13 meeting-moved scenarios against ReAct for a reason unrelated to orchestration-pattern quality, the actual subject of RQ1; resolved by adding the field back once the date-context fix made doing so safe. A third, lower-severity correction is also recorded for completeness: the original scenario transcripts stated only task titles, leaving duration and energy for the model to guess against a ground truth that had assigned them at random, which made the discarded run's headline accuracy figures uninterpretable regardless of model capability; transcripts now state duration and energy explicitly."
  ),
  h3("5.2.1 Threats to Validity"),
  para(
    "Four limitations apply to the Phase 1 result and should accompany any citation of it. First, the two configurations differ in model tier as well as in orchestration: the hierarchical pipeline's intake step runs on the cheaper, faster model tier, while the ReAct agent runs on the main tier throughout. The comparison therefore does not isolate orchestration pattern from model size, and the lower hierarchical intent-extraction F1 (0.967 against 0.993) is at least consistent with the smaller tier. A matched-model run on a different model (Section 5.2.2) reproduces the accuracy gap with one model serving both configurations, and gives an intent-extraction F1 of 1.000 for both, which removes tier mismatch as the explanation for the gap. It does not show the same on the OpenAI models, and it covers only 24 scenarios. Second, the accuracy metric measures order agreement, as set out above, and the priority information that decides order is implicit in one scenario type. Third, the benchmark was run once per scenario and configuration, so run-to-run variation in the models is not estimated. Fourth, the prompts have been revised since the benchmark was run, adding rules for ignoring instructions addressed to the assistant, for breaks, and for ordering. The main run's figures describe the prompts as they were when it ran. The matched-model run used the current prompts and shows the same gap, but the current system has not been re-benchmarked on all 50 scenarios or on the OpenAI models. The scenarios are synthetic and their ground truth comes from the same deterministic engine, as noted above, and this remains the case."
  ),
  h3("5.2.2 Matched-Model Replication"),
  para(
    "Because the main run leaves model tier and orchestration pattern confounded (Section 5.2.1), a second, smaller run was added in which both configurations used a single model, Gemini 3.5 Flash Lite, for every call, including intake, clarification, and the schedule explanation. This model was used because it was available on a free tier after the OpenAI credit was exhausted. The pipeline reaches it through a thin adapter that presents the same interface as the OpenAI client, so the prompts, tools, scheduling engine, validator, and scoring are unchanged between the two runs, and the run used the current prompts. It covers the first six scenarios of each type (24 scenarios, 48 live runs), half the size of the main run, chosen to fit the time available on the free tier. All 48 runs completed without error."
  ),
  caption("Table 9: Matched-Model Replication Results (Gemini 3.5 Flash Lite)"),
  matchedMetricsTable(),
  spacer(),
  para(
    "Hierarchical orchestration was correct on 23 of 24 scenarios and ReAct on 18 of 24. Of the 24 pairs, both were correct on 18, both were wrong on 1, ReAct was uniquely correct on none, and hierarchical on 5. Restricting the main run to the same 24 scenarios gives identical totals (18 and 23). With 5 discordant pairs the smallest p-value McNemar's exact test can produce is 0.0625, which is what was observed, so this sample cannot reach the 0.05 threshold however the pairs fall. The replication is therefore evidence that the gap has the same direction and size under a single model, not a second significance test. Hierarchical used about a third of the tokens (813 against 2,626 per scenario). Latency did not differ significantly (paired t-test p = 0.34, Wilcoxon p = 0.26) and should be read cautiously: the free tier returned intermittent service-unavailable and rate-limit responses, which the adapter retried, adding delay to individual runs that has nothing to do with either pattern. Intent-extraction F1 was 1.000 for both configurations, so there was no variation to test, and hallucination rate (0.0%) and conflict resolution (100.0%) again matched."
  ),
  caption("Table 10: Scheduling Accuracy by Scenario Type, Main Run (First 24 Scenarios) and Matched-Model Run"),
  replicationByTypeTable(),
  spacer(),
  para(
    "The headline gap replicated, but where ReAct fails did not. In the main run, ReAct's errors on these 24 scenarios were concentrated in energy-level-change (1 of 6 correct) and it was correct on all six urgent-task scenarios. On Gemini the pattern reversed: ReAct was correct on 5 of 6 energy-level scenarios but on only 2 of 6 urgent-task scenarios. Hierarchical missed at most one scenario per type in both runs. All seven failed runs in the matched run (six ReAct, one hierarchical) fit the earlier finding: the same number of blocks with the same durations, no hard-constraint violation, and a different order from the ground truth. The result is therefore consistent with an ordering effect that appears with different models, while which scenario types expose it depends on the model."
  ),
  para(
    "This settles one thing and leaves others open. A model-tier mismatch between hierarchical intake and the ReAct agent cannot explain the accuracy gap, since the gap appears with one model serving both. It does not show that the same holds within the OpenAI models, with a larger model, or at 50 scenarios; a matched-tier OpenAI run was not possible because the credit was exhausted. The Gemini adapter is exercised only by this benchmark and a smoke test, because the automated test suite replaces the LLM with a stub (Section 4.10)."
  ),
  h2("5.3 RQ2: Human-in-the-Loop Impact"),
  para(
    "Phase 2 has not begun. Per the proposal, it will recruit n ≥ 20 participants randomly assigned across three conditions — the system with AI nudging and adaptation enabled, the system with calendar display only (AI disabled), and the participant's own existing tool as an ecological control — over a 14-day period, administering the instruments in Table 5. University ethics approval, participant recruitment, and the study instrumentation itself remain to be built and submitted before this phase can start (Chapter 7)."
  ),
  h2("5.4 Verification of the Integration Layer"),
  para(
    "The persistence, confirmation, calendar, and monitoring features were verified functionally rather than evaluated quantitatively. They are covered by the automated tests described in Section 4.10, and were also exercised end to end against the live services: a plan was proposed, confirmed, and written to a real Google Calendar; a re-plan replaced it and the stale events were removed; the data was confirmed to be stored in the EU-hosted database; and, using a block deliberately made overdue, the monitor's nudge banner was shown in the browser. These checks show the features work as designed. They are not a measure of their usefulness, which is what Phase 2 exists to assess."
  ),
  h2("5.5 System Usability"),
  para(
    "The System Usability Scale is administered as part of Phase 2 and has therefore not yet been collected. No usability score is reported at this stage of the project."
  ),
];

// ---------------------------------------------------------------------
// 6. Discussion
// ---------------------------------------------------------------------

const chapter6 = [
  h1("6. Discussion"),
  h2("6.1 Strengths of the System"),
  para(
    "The dual-configuration architecture is the project's most significant methodological strength: implementing both the hierarchical and ReAct patterns within the same codebase, against the same deterministic engine, the same validator, and the same evaluation harness, removes the placement mathematics as an explanation for any difference between them. It is a partly controlled comparison, which the commercial tools reviewed in Chapter 2 cannot offer at all, since none of them implements more than one orchestration approach. The control is not complete: as Section 5.2.1 sets out, the two configurations also differ in model tier and prompt wording, so a difference between them cannot yet be attributed to the orchestration pattern alone. The matched-model run (Section 5.2.2) removes the tier difference and still shows the gap, which strengthens the attribution to orchestration pattern, but it is a smaller run on a different model."
  ),
  para(
    "Keeping the scheduling engine deterministic and LLM-free, with every LLM-proposed schedule re-checked by a validator that neither orchestration mode can bypass, has repeatedly proven its value in practice rather than only in principle: the Phase 1 benchmark caught two real implementation bugs (Section 5.2) before they could produce a misleading headline result, and the same validate-then-flag pattern, extended to the clarified-preference vocabulary described in Section 3.4, caught a further title-matching bug during the clarification feature's own testing — a fuzzy-versus-exact lookup mismatch between the engine's preference-application code and the validator's preference-checking code, found by reproducing a real failure directly rather than assuming the feature worked once it compiled."
  ),
  para(
    "The clarification loop itself is a design contribution beyond what the proposal originally specified: rather than a system that either asks a fixed battery of questions regardless of whether they are needed, or silently guesses at scheduling preferences it cannot know, it asks only about genuine ambiguity, one turn at a time, applies general-knowledge defaults (dinner in the evening) without asking, and lets the user stop at any point — directly extending Amershi et al.'s (2019) efficient-correction guideline to the elicitation stage rather than only to the confirmation stage."
  ),
  h2("6.2 Limitations and Edge Cases"),
  para(
    "The proactive layer is the most significant limitation. The Execution Monitor detects late starts and overruns and offers a re-plan, which is enough to make RQ2's proactive condition demonstrable, but it is minimal: it relies on the participant pressing Start and Done, so a participant who never reports progress is indistinguishable from one who is on time; nudges appear only while the page is open; there is no push notification; and there is no quiet mode or nudge-frequency control, which Section 3.6 identifies as the minimum accommodation for participants who may find nudging stressful. The Phase 1 latency target was measured for the benchmark's intake path, and the latency of a mid-day re-plan through the monitor has not been measured separately."
  ),
  para(
    "The calendar integration is likewise limited. The calendar is read when a plan is built and written when it is confirmed, but changes a participant makes in their calendar afterwards are not detected until the next plan. Working hours are a fixed server setting of 08:00 to 20:00, and a time that the participant explicitly fixes outside that window, such as a late dinner, is reported as a validator violation, which blocks confirmation, rather than being accepted. All times are interpreted as Europe/London wall-clock time, so the prototype is correct only for participants in the UK; a participant in another time zone would see their plan at London times rather than their own local times. These are acceptable for a UK-based Phase 2 cohort and should be stated as a constraint of the study."
  ),
  para(
    "The preference-matching mechanism introduced in Section 3.4 has a documented residual limitation: when the same task is independently extracted, and independently worded, by three separate non-deterministic LLM calls in the side-by-side comparison view — the clarification step's own extraction, and each orchestration mode's own fresh extraction — a fuzzy substring match can still fail to connect them if the wording diverges enough that neither phrasing is a substring of the other. This was reproduced directly rather than merely anticipated, and is recorded as an accepted simplification consistent with the same fuzzy-matching approach already used elsewhere in the evaluation harness's intent-extraction scoring (Section 5.2), rather than as an unaddressed defect."
  ),
  para(
    "Ground truth for the Phase 1 benchmark has not yet been independently reviewed by a human rater; because the ground truth is generated by the same deterministic engine the system itself uses, this is a defensible basis for scoring the LLM layer specifically, but it is not equivalent to an externally validated benchmark, and that review is listed as outstanding work (Chapter 7). As Section 5.2.1 sets out, the main Phase 1 result also carries a model-tier difference between the two configurations, an accuracy metric that is in effect an order-agreement test, and prompts that have changed since the benchmark ran; the matched-model run of Section 5.2.2 addresses the model-tier and prompt points, but only on 24 scenarios and one model. Finally, although the data layer is now deployed, it is not yet ready for real participant data: there is no authentication beyond the anonymous identifier, new columns are added by a stopgap helper in place of migrations, a connected Google account's refresh token is stored unencrypted, and the Phase 2 instrumentation for acknowledgement and acceptance of nudges, the diary, and the questionnaires does not exist."
  ),
  h2("6.3 Practical Implications"),
  para(
    "For practitioners building agentic scheduling systems, the Phase 1 result offers a concrete, if scenario-scale, basis for choosing between the two orchestration patterns compared here: a hierarchical pipeline that keeps deterministic placement outside the model's own reasoning loop reproduced the reference ordering more often than a single-agent ReAct loop and used fewer tokens, with no latency penalty. This is a scenario-scale result, reproduced in direction on a second model (Section 5.2.2), with the caveats of Section 5.2.1, and its practical lesson is probably narrower than the headline figure suggests: where a user's priorities are implicit, a system should ask for them or state the order it assumed, which is what the clarification loop of Section 3.4 does."
  ),
  para(
    "For researchers, the evaluation methodology itself — a seeded, reproducible synthetic benchmark with paired statistical tests appropriate to each metric's type (continuous metrics via paired t-test/Wilcoxon, the binary paired accuracy outcome via McNemar's exact test rather than a t-test) — is reusable for other time-sensitive, user-facing agentic domains where existing coding- and reasoning-focused benchmarks do not transfer."
  ),
  para(
    "For product teams, the clarification-and-check design in Section 3.4 offers a concrete alternative to the two failure modes it was built to avoid: asking a user a fixed battery of questions regardless of need, or silently guessing at preferences the model cannot verify — by separating what can be safely inferred from general knowledge from what must be asked, and mechanically checking rather than assuming the result honoured either."
  ),
];

// ---------------------------------------------------------------------
// 7. Conclusion and Future Work
// ---------------------------------------------------------------------

const chapter7 = [
  h1("7. Conclusion and Future Work"),
  h2("7.1 Summary of Objectives Achieved"),
  para(
    "Objective 1 (literature review) is complete. Objective 2 (dual-orchestration architecture) is complete: unlike a single-configuration prototype with a second mode deferred, both the hierarchical pipeline and the ReAct loop are fully implemented and were both exercised across the full Phase 1 benchmark. Objective 3 (intake, scheduling engine, human-in-the-loop interface) is complete in a minimal form: the clarification dialogue, the confirm-or-reject flow, persistence, and a deterministic Execution Monitor are built, while push notifications, a quiet mode, and a nudge-frequency control are not. Objective 4 (Google Calendar integration and mock platform interfaces) is complete in a minimal form: reading busy time and writing confirmed plans to Google Calendar work against the live service, and mock Outlook and EventKit providers share the interface. Objective 5 (structured evaluation) has been carried out for its Phase 1 (RQ1) half, reported in Chapter 5 with the limitations in Section 5.2.1, and not started for its Phase 2 (RQ2) half. Objective 6 (documentation, limitations, future work) is addressed by this report and will be updated at each subsequent submission."
  ),
  h2("7.2 Broader Contribution"),
  para(
    "This project contributes three things to the growing body of research on applied agentic AI. First, an empirical comparison of single-agent ReAct and hierarchical multi-agent orchestration in a time-sensitive, user-facing domain — real-time schedule adaptation — that existing agentic-AI benchmarks, concentrated on coding and reasoning tasks, do not cover. Second, a reusable synthetic-benchmark evaluation methodology for scheduling systems, combining a seeded, reproducible disruption-scenario generator with statistical tests matched to each metric's type, which surfaced and corrected two real implementation bugs before they could produce a misleading result. Third, a clarification-driven preference-elicitation design that distinguishes what a system can safely infer from general knowledge from what must be asked, and checks the result mechanically against a small typed vocabulary rather than trusting either an LLM's placement or a second LLM's judgement of that placement."
  ),
  h2("7.3 Future Work"),
  para(
    "The remaining work divides into what Phase 2 requires and what would make the Phase 1 evidence sound. For Phase 2: submit the ethics application and recruit participants; build the instrumentation that RQ2 depends on, namely the daily diary, the NASA-TLX, SUS, and trust questionnaires, and telemetry for acknowledgement and acceptance of nudges; add a quiet mode and a nudge-frequency control, and a delivery channel for nudges that works when the page is closed; and make the data layer safe for real participants by encrypting stored calendar tokens, replacing the stopgap column helper with migrations, and adding authentication."
  ),
  para(
    "For Phase 1: extend the matched-model run from 24 to all 50 scenarios, which would also allow a significance test, and repeat it with matched tiers on the OpenAI models; report ordering separately from placement, or state task priority explicitly in the scenario transcripts so that order is not left implicit; run each scenario more than once to estimate variation between runs; and have a human review a sample of the ground truth. Until this is done the Phase 1 figures should be treated as a preliminary result with the limitations of Section 5.2.1, not as the final evaluation for the dissertation."
  ),
  para(
    "Beyond the remaining MVRC work, two extensions follow naturally from what Phase 1 and the clarification-loop testing have already surfaced. First, the residual preference-matching limitation described in Section 6.2 could be addressed by carrying a stable task identifier through the clarification step and into whichever orchestration mode subsequently builds the schedule, rather than re-matching on title text after the fact — removing the need for fuzzy matching in this path specifically. Second, extending the same clarify-then-check pattern to the disruption-reporting flow, which currently reuses whatever preferences were collected before the first build rather than re-eliciting them, would close a gap between the two entry points into the same underlying preference system."
  ),
  para(
    "As specified in the proposal, features beyond the Minimum Viable Research Core — multi-calendar-platform deployment, email-to-task ingestion, wearable energy-sensing integration, and participatory design with ADHD communities prior to any commercial release — remain explicitly out of scope for the research contribution and are noted here only as directions a post-MSc continuation of this work could pursue."
  ),
];

// ---------------------------------------------------------------------
// References (Harvard style, consolidated from the Literature Review)
// ---------------------------------------------------------------------

const referenceList = [
  "Amershi, S., Weld, D., Vorvoreanu, M., Fourney, A., Nushi, B., Collisson, P., Suh, J., Iqbal, S., Bennett, P.N., Inkpen, K. et al., 2019. Guidelines for human-AI interaction. In: Proceedings of the 2019 CHI Conference on Human Factors in Computing Systems. Glasgow, 4–09 May 2019. New York: ACM, pp.1–13.",
  "Barkley, R.A., 1997. Behavioral inhibition, sustained attention, and executive functions: constructing a unifying theory of ADHD. Psychological Bulletin, 121(1), pp.65–94.",
  "Baumeister, R.F., Bratslavsky, E., Muraven, M. and Tice, D.M., 1998. Ego depletion: is the active self a limited resource? Journal of Personality and Social Psychology, 74(5), pp.1252–1265.",
  "Berry, N., Lobban, F., Emsley, R. and Bucci, S., 2011. Acceptability of interventions delivered online and through digital technology by people who experience severe mental health problems: a systematic review. Journal of Medical Internet Research, 18(4), e96.",
  "Braun, V. and Clarke, V., 2006. Using thematic analysis in psychology. Qualitative Research in Psychology, 3(2), pp.77–101.",
  "Brooke, J., 1996. SUS: a quick and dirty usability scale. In: P.W. Jordan, B. Thomas, B.A. Weerdmeester and I.L. McClelland, eds. Usability Evaluation in Industry. London: Taylor & Francis, pp.189–194.",
  "Clark, A. and Chalmers, D., 1998. The extended mind. Analysis, 58(1), pp.7–19.",
  "Dietvorst, B.J., Logg, J.M. and Logg, J., 2015. Algorithm aversion: people erroneously avoid algorithms after seeing them err. Journal of Experimental Psychology: General, 144(1), pp.114–126.",
  "Fogg, B.J., 2003. Persuasive technology: using computers to change what we think and do. San Francisco: Morgan Kaufmann.",
  "Gollwitzer, P.M., 1999. Implementation intentions: strong effects of simple plans. American Psychologist, 54(7), pp.493–503.",
  "Gollwitzer, P.M. and Sheeran, P., 2006. Implementation intentions and goal achievement: a meta-analysis of effects and processes. Advances in Experimental Social Psychology, 38, pp.69–119.",
  "Gravitas, T., 2023. AutoGPT: an autonomous GPT-4 experiment. [Online] Available at: https://github.com/Significant-Gravitas/AutoGPT [Accessed 1 June 2026].",
  "Hart, S.G. and Staveland, L.E., 1988. Development of NASA-TLX (Task Load Index): results of empirical and theoretical research. In: P.A. Hancock and N. Meshkati, eds. Human mental workload. Amsterdam: Elsevier, pp.139–183.",
  "Hong, S., Zhuge, M., Chen, J., Zheng, X., Cheng, Y., Zhang, C., Wang, J., Wang, Z., Yau, S.S.H., Lin, Z. et al., 2024. MetaGPT: meta programming for a multi-agent collaborative framework. In: International Conference on Learning Representations (ICLR 2024). Vienna, 7–11 May 2024.",
  "Iqbal, S.T. and Bailey, B.P., 2008. Effects of intelligent notification management on users and their tasks. In: Proceedings of the 2008 CHI Conference on Human Factors in Computing Systems. Florence, 5–10 April 2008. New York: ACM, pp.93–102.",
  "Kahneman, D., 2011. Thinking, fast and slow. New York: Farrar, Straus and Giroux.",
  "Kincaid, C.M. and Lam, H., 2006. Scheduling with personal calendars. In: Proceedings of the 2006 SIGCHI Conference on Human Factors in Computing Systems. Montreal, 22–27 April 2006. New York: ACM, pp.457–466.",
  "Kirsh, D., 1995. The intelligent use of space. Artificial Intelligence, 73(1–2), pp.31–68.",
  "Knijnenburg, B.P., Bostandjiev, S., O'Donovan, J. and Kobsa, A., 2012. Inspectability and control in social recommenders. In: Proceedings of the 6th ACM Conference on Recommender Systems (RecSys 2012). Dublin, 9–13 September 2012. New York: ACM, pp.43–50.",
  "LangChain, 2024. LangGraph: build stateful, multi-actor applications with LLMs. [Online] Available at: https://github.com/langchain-ai/langgraph [Accessed 1 June 2026].",
  "Lee, J.D. and See, K.A., 2004. Trust in automation: designing for appropriate reliance. Human Factors, 46(1), pp.50–80.",
  "Maes, P., 1994. Agents that reduce work and information overload. Communications of the ACM, 37(7), pp.30–40.",
  "Monarch, R.M., 2021. Human-in-the-loop machine learning. Shelter Island: Manning Publications.",
  "Moura, J., 2023. CrewAI: framework for orchestrating role-playing autonomous AI agents. [Online] Available at: https://github.com/joaomdmoura/crewAI [Accessed 1 June 2026].",
  "Parasuraman, R. and Riley, V., 1997. Humans and automation: use, misuse, disuse, abuse. Human Factors, 39(2), pp.230–253.",
  "Park, J.S., O'Brien, J.C., Cai, C.J., Morris, M.R., Liang, P. and Bernstein, M.S., 2023. Generative agents: interactive simulacra of human behavior. In: Proceedings of the 36th Annual ACM Symposium on User Interface Software and Technology (UIST 2023). San Francisco, 29 October–1 November 2023. New York: ACM, pp.1–22.",
  "Wang, L., Ma, C., Feng, X., Zhang, Z., Yang, H., Zhang, J., Chen, Z., Tang, J., Chen, X., Lin, Y. et al., 2024. A survey on large language model based autonomous agents. Frontiers of Computer Science, 18(6), 186345.",
  "Wu, Q., Bansal, G., Zhang, J., Wu, Y., Zhang, S., Zhu, E., Li, B., Jiang, L., Zhang, X. and Wang, C., 2023. AutoGen: enabling next-gen LLM applications via multi-agent conversation. [Online] Available at: https://arxiv.org/abs/2308.08155 [Accessed 1 June 2026].",
  "Xi, Z., Chen, W., Guo, X., He, W., Ding, Y., Hong, B., Zhang, M., Wang, J., Jin, S., Zhou, E. et al., 2023. The rise and potential of large language model based agents: a survey. [Online] Available at: https://arxiv.org/abs/2309.07864 [Accessed 1 June 2026].",
  "Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan, K. and Cao, Y., 2023. ReAct: synergizing reasoning and acting in language models. In: International Conference on Learning Representations (ICLR 2023). Kigali, 1–5 May 2023.",
];

const referencesSection = [
  h1("References"),
  ...referenceList.map((r) => para(r, { align: AlignmentType.LEFT })),
];

const appendix = [
  h1("Appendix A: API Endpoint Reference"),
  para("The following table documents the complete REST API exposed by the FastAPI backend at the time of this report."),
  apiTable(),
];

// ---------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
    },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 360, after: 160 } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 24, bold: true, color: "2E5395" }, paragraph: { spacing: { before: 260, after: 120 } } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { size: 22, bold: true, italics: true, color: "444444" }, paragraph: { spacing: { before: 200, after: 100 } } },
    ],
  },
  sections: [
    { properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: titlePage },
    {
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [
        ...abstractAndAck,
        ...chapter1, pageBreak(),
        ...chapter2, pageBreak(),
        ...chapter3, pageBreak(),
        ...chapter4, pageBreak(),
        ...chapter5, pageBreak(),
        ...chapter6, pageBreak(),
        ...chapter7, pageBreak(),
        ...referencesSection, pageBreak(),
        ...appendix,
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync("Interim_Report.docx", buffer);
  console.log("written");
});
