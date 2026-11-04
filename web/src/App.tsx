import { useEffect, useState } from "react";
import {
  submitIntake, decideSchedule, connectGoogle, googleConnected, ProposedSchedule, AgentActionLog, OrchestrationMode, ScheduleBlock,
  ScheduleStatus, TaskPreference,
} from "./api";
import ScheduleView from "./ScheduleView";
import ClarificationChat from "./ClarificationChat";

type ModeChoice = OrchestrationMode | "compare";

interface Result {
  scheduleId: string;
  status: ScheduleStatus;
  schedule: ProposedSchedule;
  actions: AgentActionLog[];
  note?: string; // calendar read warning, or the result of writing to the calendar
}

const toResult = (r: {
  schedule_id: string;
  schedule: ProposedSchedule;
  agent_actions: AgentActionLog[];
  calendar_error: string | null;
}): Result => ({
  scheduleId: r.schedule_id,
  status: "pending",
  schedule: r.schedule,
  actions: r.agent_actions,
  note: r.calendar_error ?? undefined,
});

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
  const [gcal, setGcal] = useState<boolean | null>(null); // null = unknown
  useEffect(() => {
    googleConnected().then(setGcal).catch(() => setGcal(null));
    // The server redirects back with ?calendar=connected|error after Google sign-in.
    const outcome = new URLSearchParams(window.location.search).get("calendar");
    if (outcome === "error") setError("Google Calendar connection failed. Please try again.");
    if (outcome) window.history.replaceState({}, "", window.location.pathname);
  }, []);
  const [clarifying, setClarifying] = useState(false);
  const [preferences, setPreferences] = useState<TaskPreference[]>([]);

  const dayBounds = () => {
    // Local wall-clock ISO with NO "Z"/offset. The backend treats every
    // datetime as naive wall-clock (engine._naive strips tzinfo without
    // converting), so sending toISOString() (UTC) shifted the working day by
    // the browser's UTC offset: 8am-8pm became 7am-7pm for a UTC+1 user.
    // Europe/London only, for now (decision: UK users only). "en-CA" formats
    // as YYYY-MM-DD. ponytail: single hardcoded zone, add a user setting if
    // non-UK users ever matter.
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    const at = (hour: number) => `${date}T${String(hour).padStart(2, "0")}:00:00`;
    return { dayStart: at(8), dayEnd: at(20) };
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
        setResults([toResult(reactResult), toResult(hierResult)]);
      } else {
        const result = await submitIntake(effectiveTranscript, dayStart, dayEnd, modeChoice, prefs);
        setResults([toResult(result)]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Confirm/reject one panel's schedule. Server is the authority (it refuses
  // to commit a schedule with violations); the UI only mirrors its answer.
  const handleDecision = async (index: number, decision: "confirm" | "reject") => {
    if (!results) return;
    setError(null);
    try {
      const { status, calendar } = await decideSchedule(results[index].scheduleId, decision);
      const note = calendar
        ? calendar.failed
          ? `${calendar.failed} event(s) could not be added to Google Calendar; the plan is still confirmed.`
          : `Added ${calendar.synced} event(s) to Google Calendar.`
        : undefined;
      setResults((rs) => rs && rs.map((r, i) => (i === index ? { ...r, status, note } : r)));
    } catch (e) {
      setError((e as Error).message);
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
          submitIntake(
            buildDisruptionTranscript(results[0].schedule.blocks),
            dayStart,
            dayEnd,
            "react",
            preferences,
            results[0].scheduleId,
          ),
          submitIntake(
            buildDisruptionTranscript(results[1].schedule.blocks),
            dayStart,
            dayEnd,
            "hierarchical",
            preferences,
            results[1].scheduleId,
          ),
        ]);
        setResults([toResult(reactResult), toResult(hierResult)]);
      } else {
        const combined = buildDisruptionTranscript(results[0].schedule.blocks);
        const result = await submitIntake(combined, dayStart, dayEnd, modeChoice, preferences, results[0].scheduleId);
        setResults([toResult(result)]);
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
      <p style={{ fontSize: "0.85rem", color: "#555", margin: "0 0 0.5rem" }}>
        Google Calendar: {gcal ? "connected" : "not connected"}{" "}
        {!gcal && (
          <button onClick={() => connectGoogle().catch((e) => setError((e as Error).message))}>Connect</button>
        )}
      </p>
      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="Tell me about your day: what you need to do, any fixed times, and how you're feeling. e.g. Interview prep, gym, and dinner with friends, but I'm tired today."
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
                status={r.status}
                note={r.note}
                onDecide={(d) => handleDecision(i, d)}
                label={results.length === 2 ? (i === 0 ? "ReAct" : "Hierarchical") : undefined}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
