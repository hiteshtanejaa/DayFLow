import { useState } from "react";
import { submitIntake, ProposedSchedule, AgentActionLog, OrchestrationMode, ScheduleBlock, TaskPreference } from "./api";
import ScheduleView from "./ScheduleView";
import ClarificationChat from "./ClarificationChat";

type ModeChoice = OrchestrationMode | "compare";

interface Result {
  schedule: ProposedSchedule;
  actions: AgentActionLog[];
}

// Real bug this fixes: naively appending "Update: <disruption text>" to the
// original transcript gives the model no signal that a task named in the
// disruption ("gym session") is the SAME task named earlier ("gym") — on
// re-extraction it duplicated the task at two times instead of moving it.
// Spelling out the current schedule explicitly, plus an explicit
// don't-duplicate instruction, is what fixes that.
//
// Second bug, found via live testing, fixed here too: stating the
// schedule as "My current schedule for today is: X (8:00-9:30)..." reads
// to the model as a set of commitments, not a tentative starting point —
// it pinned every task to its previous time via fixed_start and never
// applied the actual requested change. "tentative plan... none of these
// times are fixed unless stated otherwise below" is what stops that.
function describeCurrentSchedule(blocks: ScheduleBlock[]): string {
  if (blocks.length === 0) return "";
  const items = blocks
    .map((b) => {
      const start = new Date(b.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const end = new Date(b.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `${b.title} (${start}-${end})`;
    })
    .join(", ");
  return `For reference, here was today's tentative plan before this update — none of these times are fixed unless stated otherwise below: ${items}. `;
}

export default function App() {
  const [transcript, setTranscript] = useState("");
  const [disruption, setDisruption] = useState("");
  const [modeChoice, setModeChoice] = useState<ModeChoice>("hierarchical");
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Turn-by-turn preference elicitation, run once before the first build
  // (see design notes) — shared identically by both orchestration modes so
  // the RQ1 compare view never varies by which mode got asked better
  // questions. clarifying === true shows the chat in place of the build
  // button; preferences carries forward into disruption re-plans too.
  const [clarifying, setClarifying] = useState(false);
  const [preferences, setPreferences] = useState<TaskPreference[]>([]);

  const dayBounds = () => {
    const today = new Date();
    const dayStart = new Date(today.setHours(8, 0, 0, 0)).toISOString();
    const dayEnd = new Date(today.setHours(20, 0, 0, 0)).toISOString();
    return { dayStart, dayEnd };
  };

  // Shared by both the initial intake and disruption updates — the only
  // difference is which transcript goes in. Reusing this (rather than
  // duplicating the fetch logic) is what keeps setResults() updating the
  // *same* ScheduleView/DayCalendar components in place instead of
  // remounting them, which is what lets framer-motion animate the
  // before/after diff instead of just popping in a whole new calendar.
  const runPipeline = async (effectiveTranscript: string, prefs: TaskPreference[]) => {
    setLoading(true);
    setError(null);
    try {
      const { dayStart, dayEnd } = dayBounds();

      if (modeChoice === "compare") {
        const [reactResult, hierResult] = await Promise.all([
          submitIntake(effectiveTranscript, dayStart, dayEnd, "react", prefs),
          submitIntake(effectiveTranscript, dayStart, dayEnd, "hierarchical", prefs),
        ]);
        setResults([
          { schedule: reactResult.schedule, actions: reactResult.agent_actions },
          { schedule: hierResult.schedule, actions: hierResult.agent_actions },
        ]);
      } else {
        const result = await submitIntake(effectiveTranscript, dayStart, dayEnd, modeChoice, prefs);
        setResults([{ schedule: result.schedule, actions: result.agent_actions }]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (!transcript.trim()) return;
    setResults(null);
    setPreferences([]);
    setClarifying(true);
  };

  const handleClarificationDone = (prefs: TaskPreference[]) => {
    setClarifying(false);
    setPreferences(prefs);
    runPipeline(transcript, prefs);
  };

  const buildDisruptionTranscript = (currentBlocks: ScheduleBlock[]) => {
    const scheduleContext = describeCurrentSchedule(currentBlocks);
    return (
      `${transcript} ${scheduleContext}Update: ${disruption}. Give a fresh, ` +
      "fully re-planned schedule. Only set a fixed start time on a task if " +
      "this update explicitly states a specific committed time for it (e.g. " +
      '"pushed to 2pm") — every other task, including ones from the ' +
      "tentative plan above, stays flexible and can move. If a task is " +
      "simply being moved, renamed, or resized, treat it as the same task " +
      "with a new time, not a duplicate."
    );
  };

  const handleDisruption = async () => {
    if (!disruption.trim() || !results) return;
    // Full live disruption detection (polling, push notifications) is
    // Step 8, not this — this re-plans on demand via the same /intake
    // endpoint. Bug fixed here: in "Compare both" mode, results[0] is
    // always the ReAct panel — reusing it as the context for BOTH modes
    // meant hierarchical's re-plan was being fed ReAct's schedule as if it
    // were its own after the two had already diverged. Each mode now gets
    // its own actual current blocks as context, not a single shared one.
    setLoading(true);
    setError(null);
    try {
      const { dayStart, dayEnd } = dayBounds();

      if (modeChoice === "compare") {
        const [reactResult, hierResult] = await Promise.all([
          submitIntake(buildDisruptionTranscript(results[0].schedule.blocks), dayStart, dayEnd, "react", preferences),
          submitIntake(
            buildDisruptionTranscript(results[1].schedule.blocks),
            dayStart,
            dayEnd,
            "hierarchical",
            preferences,
          ),
        ]);
        setResults([
          { schedule: reactResult.schedule, actions: reactResult.agent_actions },
          { schedule: hierResult.schedule, actions: hierResult.agent_actions },
        ]);
      } else {
        const combined = buildDisruptionTranscript(results[0].schedule.blocks);
        const result = await submitIntake(combined, dayStart, dayEnd, modeChoice, preferences);
        setResults([{ schedule: result.schedule, actions: result.agent_actions }]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    setDisruption("");
  };

  return (
    <main style={{ maxWidth: 1000, margin: "2rem auto", fontFamily: "sans-serif", padding: "0 1rem" }}>
      <h1>Morning Intake</h1>
      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="I have interview prep, gym, and coursework today, but I am feeling pretty tired."
        rows={4}
        style={{ width: "100%" }}
        disabled={clarifying}
      />

      <div style={{ margin: "0.75rem 0" }}>
        <label style={{ marginRight: "1.5rem" }}>
          <input
            type="radio"
            name="mode"
            checked={modeChoice === "hierarchical"}
            onChange={() => setModeChoice("hierarchical")}
          />{" "}
          Hierarchical
        </label>
        <label style={{ marginRight: "1.5rem" }}>
          <input
            type="radio"
            name="mode"
            checked={modeChoice === "react"}
            onChange={() => setModeChoice("react")}
          />{" "}
          ReAct
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={modeChoice === "compare"}
            onChange={() => setModeChoice("compare")}
          />{" "}
          Compare both (RQ1 view)
        </label>
      </div>

      {!clarifying && (
        <button onClick={handleSubmit} disabled={loading || !transcript}>
          {loading ? "Thinking..." : "Build my schedule"}
        </button>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {clarifying && (
        <ClarificationChat transcript={transcript} dayStart={dayBounds().dayStart} onDone={handleClarificationDone} />
      )}

      {results && (
        <>
          <div style={{ margin: "1.5rem 0 0.5rem", padding: "0.75rem", background: "#f7f7f7", borderRadius: 6 }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.35rem" }}>
              Something come up?
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={disruption}
                onChange={(e) => setDisruption(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDisruption()}
                placeholder="My gym session got moved to 3pm"
                style={{ flex: 1 }}
              />
              <button onClick={handleDisruption} disabled={loading || !disruption.trim()}>
                {loading ? "Rebuilding..." : "Update schedule"}
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: "0.75rem",
              display: "grid",
              gridTemplateColumns: results.length === 2 ? "1fr 1fr" : "1fr",
              gap: "1rem",
            }}
          >
            {results.map((r, i) => (
              <ScheduleView
                key={i}
                schedule={r.schedule}
                actions={r.actions}
                label={results.length === 2 ? (i === 0 ? "ReAct" : "Hierarchical") : undefined}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
