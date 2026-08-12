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
        size: opts.size || 20,
      })],
    })],
  });
}

function metricsTable() {
  const widths = [3800, 2613, 2613];
  const header = new TableRow({
    children: [
      cell("Metric", { width: widths[0], header: true }),
      cell("ReAct", { width: widths[1], header: true }),
      cell("Hierarchical", { width: widths[2], header: true }),
    ],
    tableHeader: true,
  });
  const rows = [
    ["Scheduling accuracy (within 15-min tolerance)", "74.0%", "90.0%"],
    ["Conflict resolution rate (n=13 at-risk scenarios)", "100.0%", "100.0%"],
    ["Hallucination rate (hard-constraint violations)", "0.0%", "0.0%"],
    ["Mean intent-extraction F1", "0.993", "0.967"],
    ["Re-optimisation latency P50 / P90 / P99 (ms)", "5,973 / 9,654 / 14,486", "6,226 / 8,342 / 14,805"],
    ["Mean API tokens per scenario", "1,547", "905"],
  ];
  const body = rows.map((r, i) => new TableRow({
    children: [
      cell(r[0], { width: widths[0], shade: i % 2 === 1 }),
      cell(r[1], { width: widths[1], shade: i % 2 === 1 }),
      cell(r[2], { width: widths[2], shade: i % 2 === 1 }),
    ],
  }));
  return new Table({ width: { size: 9026, type: WidthType.DXA }, columnWidths: widths, rows: [header, ...body] });
}

function statsTable() {
  const widths = [2200, 2100, 1626, 1400, 1700];
  const header = new TableRow({
    children: [
      cell("Metric", { width: widths[0], header: true, size: 18 }),
      cell("Test", { width: widths[1], header: true, size: 18 }),
      cell("Statistic", { width: widths[2], header: true, size: 18 }),
      cell("p-value", { width: widths[3], header: true, size: 18 }),
      cell("Sig. (α=.05)", { width: widths[4], header: true, size: 18 }),
    ],
    tableHeader: true,
  });
  const rows = [
    ["Scheduling accuracy", "McNemar's exact (paired binary)", "12 discordant pairs", "0.0386", "Yes"],
    ["Re-optimisation latency", "Paired t-test", "t = 0.253", "0.8014", "No"],
    ["Re-optimisation latency", "Wilcoxon signed-rank", "W = 622.0", "0.8859", "No"],
    ["Intent-extraction F1", "Paired t-test", "t = 1.661", "0.1030", "No"],
    ["Intent-extraction F1", "Wilcoxon signed-rank", "W = 0.000", "0.1025", "No"],
  ];
  const body = rows.map((r, i) => new TableRow({
    children: r.map((v, ci) => cell(v, { width: widths[ci], shade: i % 2 === 1, size: 18 })),
  }));
  return new Table({ width: { size: 9026, type: WidthType.DXA }, columnWidths: widths, rows: [header, ...body] });
}

const titlePage = [
  new Paragraph({ text: "", spacing: { after: 1200 } }),
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
  new Paragraph({ text: "", spacing: { after: 600 } }),
  labelValue("Name", "[Name]"),
  labelValue("Student ID", "[Student ID]"),
  labelValue("Course of Study", "MSc Computer Science"),
  labelValue("Supervisor", "[Supervisor]"),
  labelValue("Date Submitted", "11-08-2026"),
  labelValue("Deliverable", "Interim Report (Prototype + Phase 1 Results), per project schedule"),
  new Paragraph({ text: "", spacing: { after: 400 } }),
  paraRuns([
    new TextRun({ text: "Scope of this report: ", bold: true }),
    new TextRun({
      text:
        "covers Objectives 1–3 and the automated (Phase 1) half of Objective 5 — a working prototype implementing both orchestration architectures under comparison, and a completed 50-scenario synthetic benchmark answering RQ1. Objective 5's Phase 2 (two-week human participant study, RQ2) and Objectives 4 and 6 remain outstanding; status set out in Section 4.",
    }),
  ]),
  pageBreak(),
];

const section1 = [
  h1("1. Introduction"),
  para(
    "This report documents progress against the project proposal as of the interim deliverable date. Two things are presented: (1) the current state of the prototype — the deterministic scheduling core, both orchestration architectures under comparison, and the companion web interface — and (2) the results of the Phase 1 automated evaluation, which directly answers RQ1 (comparative effectiveness of single-agent ReAct versus hierarchical multi-agent orchestration for real-time schedule adaptation)."
  ),
  para(
    "Phase 2 (the two-week human participant study answering RQ2) has not yet begun. Its instrumentation, Google Calendar integration, and the Execution Monitor component are scoped and partially designed but not implemented; their status and the plan to close the gap before Phase 2 begins are set out in Section 4."
  ),
];

const section2 = [
  h1("2. Prototype Status"),
  h2("2.1 Architecture Implemented"),
  para(
    "The prototype separates three concerns cleanly, matching the design set out in the proposal: a deterministic, LLM-free scheduling engine that performs all actual time-block placement and constraint checking; two LLM-driven orchestration architectures that sit above it and differ only in how they reason about and call it; and a client (web, not mobile — see 2.2) that renders the result and an audit trail of every agent action."
  ),
  bullet("Deterministic scheduling engine and validator: a greedy time-blocking algorithm (energy-aware task ordering, fixed-time-commitment handling, free-slot search) plus a post-processing validator that checks every LLM-proposed schedule against hard constraints (working hours, calendar conflicts, task overlaps) before it can reach the user. This module is never called by an LLM to make placement decisions — it is the single source of truth both orchestration modes must go through, and it doubles as the ground-truth generator for Phase 1 and as Baseline C for Phase 2."),
  bullet("Hierarchical multi-agent mode: a three-node LangGraph state graph — Intake and Intent Agent, Scheduling Orchestrator Agent, Execution Monitor Agent — matching the architecture specified in the proposal. The Monitor node is currently a structural stub: the graph topology and the conditional edge back to the Orchestrator on a detected disruption are implemented and tested, but the live deviation-polling logic itself is Objective 3 remaining work (Section 4)."),
  bullet("Single-agent ReAct mode: a two-node LangGraph loop (agent ↔ tools) implementing the actual ReAct paradigm — one agent interleaves reasoning with a real tool call (propose_schedule, backed directly by the deterministic engine), revising its own task list when the tool reports constraint violations, until it is satisfied or an iteration cap is reached. Iteration count varies per run depending on how many tool calls the model needs, which is itself a Phase 1 datum (Section 3)."),
  bullet("Human-in-the-loop confirmation and audit trail: every agent action (which agent, what it did, latency, token usage, reasoning summary) is logged to a structured record and rendered in a client-visible audit trail panel. No schedule reaches a committed state without passing the deterministic validator first."),
  bullet("Mode-comparison view: the client can run the same intake transcript through both orchestration modes concurrently and render the two resulting schedules and audit trails side by side — built specifically to make the RQ1 comparison inspectable, not just measurable."),
  h2("2.2 Deviations from the Proposal's Technology Choices"),
  para(
    "Two implementation choices differ from the proposal document as submitted. Neither affects the research design (RQ1/RQ2, the MVRC, or the evaluation framework); both are implementation-layer substitutions made for practical reasons during development, and both have since been confirmed with the supervisor and are treated as approved for the remainder of the project."
  ),
  bullet("LLM provider: the proposal names Anthropic Claude as primary with OpenAI GPT-4o as a secondary baseline. The prototype runs on OpenAI as the primary provider, adopted following an evaluation of available API credits during development. Confirmed with the supervisor that any LLM provider is acceptable; OpenAI is retained as primary for the remainder of the project."),
  bullet("Client platform: the proposal specifies a Flutter mobile companion (iOS and Android), with a web companion listed as optional. The prototype implements the web companion as the primary and only client. Confirmed with the supervisor that the web interface is acceptable as the project's client platform; native mobile development is not required."),
];

const section3 = [
  h1("3. Phase 1: Automated Evaluation (RQ1)"),
  h2("3.1 Methodology"),
  para(
    "Fifty synthetic disruption scenarios were generated, spanning the four disruption types named in the proposal (meeting moved, task overrun, urgent task injected, energy-level change), evenly distributed (13/13/12/12). Generation is deterministic and reproducible (fixed random seed), so the scenario set can be regenerated identically for independent verification."
  ),
  para(
    "Each scenario provides a natural-language morning-intake transcript together with a structured ground-truth task list (title, duration, energy requirement, priority, and any fixed-time commitment). Transcripts state each task's duration and energy requirement explicitly — a deliberate design choice, made after an initial run exposed a flaw: an earlier scenario design left duration and energy unstated in the transcript while the ground truth assigned them at random, making exact schedule matching an unfair target regardless of model capability. This is recorded in Section 3.5 as a substantive methodological correction, not hidden as a false first result."
  ),
  para(
    "Ground truth for each scenario's optimal schedule is computed by the same deterministic engine both orchestration modes call internally (Section 2.1) — a defensible ground truth for scoring the LLM layer specifically (intent extraction and orchestration correctness), since the placement mathematics are provably identical either way. This is not a substitute for independent human review of a sample before the figures are reported as validated in the dissertation's evaluation chapter; that review is listed as outstanding work in Section 4."
  ),
  para(
    "Each of the 50 scenarios was run through both orchestration modes (100 total live model calls), producing the produced schedule, any constraint violations, extracted task titles, total latency, and total token usage per run. Five automated metrics were computed per the proposal's evaluation framework: scheduling accuracy (exact scenario-level match within a 15-minute tolerance on every event boundary), conflict resolution rate (on the 13 scenarios with a pre-existing calendar conflict), hallucination rate (proportion of runs producing any hard-constraint violation), intent-extraction F1 (task-level, normalised-title matching — a documented simplification versus full NLP span alignment), and latency distribution (P50/P90/P99). Statistical comparison used a paired t-test and Wilcoxon signed-rank test with Cohen's d for the two continuous metrics (latency, F1), and McNemar's exact test for scheduling accuracy, which is a paired binary outcome and not appropriately tested with a t-test — this is addressed directly in Section 3.5."
  ),
  h2("3.2 Results"),
  metricsTable(),
  new Paragraph({ text: "", spacing: { after: 240 } }),
  h2("3.3 Statistical Comparison"),
  statsTable(),
  new Paragraph({ text: "", spacing: { after: 240 } }),
  para(
    "For scheduling accuracy, of the 50 paired scenarios: both modes were correct on 35, both were wrong on 3, ReAct was uniquely correct on 2, and hierarchical was uniquely correct on 10 — 12 discordant pairs, McNemar's exact test p = 0.0386."
  ),
  h2("3.4 Discussion"),
  para(
    "The central finding: hierarchical orchestration is significantly more accurate at schedule construction (90.0% vs 74.0%, McNemar's p = 0.039), with no statistically significant difference in re-optimisation latency (p = 0.80) or intent-extraction quality (p = 0.10). Hierarchical also used substantially fewer tokens per scenario (905 vs 1,547, a proxy the proposal specifically names for cost and scalability), a second practical advantage in the same direction as the accuracy result."
  ),
  para(
    "A plausible mechanism for the accuracy gap: the Hierarchical Scheduling Orchestrator receives the deterministic engine's placement directly, with no further model-driven interpretation between task extraction and the committed schedule. ReAct's tool-calling loop gives the model more opportunity to interpret and revise across turns, which is also where its scoring errors concentrate. The 12 discordant-pair scenarios are retained in the results file (Section 3.5) as a starting point for qualitative analysis in the dissertation — which specific disruption types and task configurations the two architectures disagree on is a richer question than the aggregate percentage alone answers."
  ),
  para(
    "Both hallucination rate and conflict resolution rate came out identical between modes (0.0% and 100.0% respectively) after the fixes described in 3.5, which is itself informative: it indicates that, once the tool-schema and prompt gaps below were closed, neither architecture is intrinsically more prone to hard-constraint violations at this scenario scale — the earlier apparent gap (26% vs 0%) was an artefact of an implementation bug, not an architectural property, and this is exactly the kind of false signal automated evaluation is designed to catch before it reaches a dissertation."
  ),
  h2("3.5 Benchmark Validation: Issues Found and Corrected"),
  para(
    "Two implementation bugs were identified and fixed during Phase 1 validation, both caught by the benchmark itself rather than by manual inspection — recorded here because they materially changed the results (the first Phase 1 run, discarded, showed 0–2% scheduling accuracy and a 26% hierarchical hallucination rate; the corrected run, reported above, shows 74–90% accuracy and 0% hallucination for both modes) and because the process of finding them is itself methodologically relevant."
  ),
  bullet("Date-hallucination bug: the Intake Agent's prompt never stated the current date. When a scenario transcript referenced a fixed-time commitment (\"my meeting got moved to 3pm\"), the model had to invent a full calendar date to populate the fixed_start field and, in the discarded run, hallucinated a placement in the year 3000 — which the deterministic validator correctly flagged as a hard-constraint violation, driving the inflated hallucination-rate figure. Fixed by stating the reference date explicitly in both orchestration modes' prompts; verified against the exact scenario that had failed."),
  bullet("Tool-schema capability gap: ReAct's propose_schedule tool did not expose a fixed_start field at all (a deliberate choice to prevent the model from being asked to produce a datetime, closing the hallucination surface above for that mode). This meant ReAct's agent had no way to represent a fixed-time commitment through its tool interface and was silently dropping such tasks from the schedule entirely — a different failure mode from hierarchical's, and one that would have structurally biased all 13 meeting-moved scenarios against ReAct for a reason unrelated to orchestration-pattern quality, the actual subject of RQ1. Resolved by adding fixed_start back to the tool schema now that the date-context fix above makes it safe to expose."),
  para(
    "A separate, lower-severity design correction is also recorded: the original synthetic-scenario transcripts stated only task titles, leaving duration and energy level for the model to guess against a ground truth that had assigned them at random — an unfair target regardless of model capability, and the reason the discarded run's scheduling-accuracy figures (0–2%) were uninterpretable despite high intent-extraction F1 (0.95+) in the same run. Scenario transcripts now state duration and energy explicitly, consistent with the proposal's own illustrative example (which states durations such as \"90 minutes of prep\" directly in the user's spoken intake)."
  ),
  para(
    "All fixes were verified against the specific failing case before the full 100-call benchmark was re-run, and the existing unit test suite for the deterministic engine (5 tests covering free-slot search, energy-based ordering, fixed-commitment handling, and unplaceable-task flagging) was re-run clean after each change."
  ),
];

const section4 = [
  h1("4. Remaining Work"),
  para("Mapped against the proposal's objectives and the current project task list:"),
  bullet("Objective 4 — Google Calendar integration: OAuth 2.0 consent flow, bidirectional event synchronisation, and mock Outlook/EventKit adapters are designed but not implemented. The prototype currently accepts busy-slot data directly rather than through a live calendar connection."),
  bullet("Objective 3 (remaining) — Execution Monitor: the LangGraph node and conditional-edge topology exist; live deviation polling and Firebase push-notification dispatch do not. This is the component behind the proposal's own illustrative example (disruption reported → schedule rebuilt within the P90 target) and is prioritised as the next build step."),
  bullet("Web client completion: the confirmation modal, quiet-mode and nudge-frequency settings, and full audit-trail styling remain partially built; core intake → schedule → confirm → audit-trail flow is functional."),
  bullet("Data layer: the Supabase schema is written but not deployed against a live project; authentication, pseudonymised participant ID mapping, and cascading-delete are not yet implemented."),
  bullet("Ground-truth validation: a sample of the 50 synthetic scenarios' ground truth should be independently reviewed before the Phase 1 figures in this report are treated as final for the dissertation's evaluation chapter (Section 3.1)."),
  bullet("Phase 2: the two-week human participant study (RQ2) has not started. University ethics approval, participant recruitment, and the three-condition study instrumentation (NASA-TLX, SUS, adapted Knijnenburg Trust Scale, daily diary) remain to be built and submitted, per the project's critical-path risk on ethics approval timing."),
];

const section5 = [
  h1("5. Updated Risk Assessment"),
  para(
    "Real data now exists for one risk the proposal identified in advance: LLM API latency exceeding the P90 target. Observed per-call latency across the benchmark ranged from approximately 5 to 23 seconds on individual calls, with P90 re-optimisation latency for a full scenario at 9,654ms (ReAct) and 8,342ms (hierarchical) — within the proposal's 12-second target on average, but with a P99 tail (14,486–14,805ms) that exceeds it. Two of the proposal's own named mitigations are already implemented and measured: routing the Intake Agent to a lower-cost, faster model tier for structured extraction, and a deterministic-template fallback that removes the second LLM call from the critical path entirely on the disruption re-optimisation route once the Execution Monitor is built. Both were validated to cut real per-call latency substantially during development (a single intake call fell from approximately 16 seconds to approximately 6.7 seconds after the model-tier change)."
  ),
  para(
    "No new risks are added at this stage beyond what the proposal already names. The tool-schema capability gap described in Section 3.5 is noted as a category of risk worth generalising: any future change to what an agent's tools allow it to represent should be re-validated against the synthetic benchmark before being treated as safe, since the two bugs found here were both invisible to manual inspection and surfaced only through the automated evaluation."
  ),
];

const section6 = [
  h1("6. Conclusion"),
  para(
    "The prototype implements both orchestration architectures specified in the proposal as genuinely distinct systems — not a configuration flag over shared code, but different LangGraph topologies with measurably different capabilities and failure modes — sitting on a common deterministic scheduling core that neither is permitted to bypass. Phase 1 answers RQ1 with a statistically significant result: hierarchical multi-agent orchestration produces more accurate schedules than single-agent ReAct at this scenario scale (90.0% vs 74.0%, p = 0.039), with no significant difference in latency or intent-extraction quality, and a secondary token-efficiency advantage in the same direction. The evaluation process itself surfaced and corrected two implementation bugs before they could produce a misleading headline result, which is recorded here as part of the methodology rather than omitted."
  ),
  para(
    "The remaining work required before Phase 2 — principally Calendar integration, the Execution Monitor, and study instrumentation — is scoped in Section 4 against the project's original schedule."
  ),
];

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
    },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 360, after: 160 } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 24, bold: true, color: "2E5395" }, paragraph: { spacing: { before: 260, after: 120 } } },
    ],
  },
  sections: [
    { properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: titlePage },
    { properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: [...section1, ...section2, pageBreak(), ...section3, pageBreak(), ...section4, ...section5, ...section6] },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync("Interim_Report.docx", buffer);
  console.log("written");
});
