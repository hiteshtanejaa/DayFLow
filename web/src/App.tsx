import { useEffect, useState } from "react";
import {
  submitIntake, decideSchedule, connectGoogle, googleConnected, ProposedSchedule, AgentActionLog, OrchestrationMode, ScheduleBlock,
  ScheduleStatus, TaskPreference, markBlock, monitorCheck, MonitorState, OverdueBlock,
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

// Now in London, rounded up to the next 5 minutes and never before the 08:00 day start.
function londonNowRounded(): { iso: string; label: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  let mins = Math.max(Number(parts.hour) * 60 + Number(parts.minute), 8 * 60);
  mins = Math.ceil(mins / 5) * 5;
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return { iso: `${parts.year}-${parts.month}-${parts.day}T${hh}:${mm}:00`, label: `${hh}:${mm}` };
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

  const buildDisruptionTranscript = (currentBlocks: ScheduleBlock[], update: string) => {
    const scheduleContext = describeCurrentSchedule(currentBlocks);
    return (
      `${transcript} ${scheduleContext}Update: ${update}. Give a fresh, ` +
      "fully re-planned schedule. Only set a fixed start time on a task if " +
      "this update explicitly states a specific committed time for it (e.g. " +
      '"pushed to 2pm") — every other task, including ones from the ' +
      "tentative plan above, stays flexible and can move. If a task is " +
      "simply being moved, renamed, or resized, treat it as the same task " +
      "with a new time, not a duplicate."
    );
  };

  // Re-plan on demand (typed disruption) or because the Execution Monitor saw
  // the day slip. In "Compare both" mode each panel uses its own current
  // blocks as context: reusing results[0] for both fed hierarchical ReAct's
  // schedule after the two had diverged. `skip` = tasks already done, which the
  // server never schedules again; `dayStart` lets a mid-day re-plan start now.
  const replan = async (update: string, opts: { dayStart?: string; skip?: string[] } = {}) => {
    if (!results) return;
    setLoading(true);
    setError(null);
    try {
      const bounds = dayBounds();
      const dayStart = opts.dayStart ?? bounds.dayStart;
      const run = (r: Result, mode: OrchestrationMode) =>
        submitIntake(
          buildDisruptionTranscript(r.schedule.blocks, update),
          dayStart,
          bounds.dayEnd,
          mode,
          preferences,
          r.scheduleId,
          opts.skip,
        );

      if (modeChoice === "compare") {
        const [reactResult, hierResult] = await Promise.all([run(results[0], "react"), run(results[1], "hierarchical")]);
        setResults([toResult(reactResult), toResult(hierResult)]);
      } else {
        setResults([toResult(await run(results[0], modeChoice))]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisruption = async () => {
    if (!disruption.trim() || !results) return;
    await replan(disruption);
    setDisruption("");
  };

  // ---- Execution Monitor (client side): poll, nudge, start/done, re-plan ----
  const [monitor, setMonitor] = useState<MonitorState | null>(null);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const live = !!results?.some((r) => r.status === "committed");

  const refreshMonitor = () => monitorCheck().then(setMonitor).catch(() => {});
  useEffect(() => {
    if (!live) {
      setMonitor(null);
      return;
    }
    refreshMonitor();
    const timer = setInterval(refreshMonitor, 30000);
    return () => clearInterval(timer);
  }, [live, results]);

  const handleProgress = async (blockId: string, event: "start" | "done") => {
    try {
      await markBlock(blockId, event);
      await refreshMonitor();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const nudge = monitor?.overdue.find((o) => (snoozed[o.block_id] ?? 0) < Date.now());
  const handleNudgeReplan = (o: OverdueBlock) => {
    const now = londonNowRounded();
    const what =
      o.kind === "late_start" ? `"${o.title}" has not been started` : `"${o.title}" is still running past its planned end`;
    replan(`it is now ${now.label} and ${what}. Re-plan only what is left of today, starting now`, {
      dayStart: now.iso,
      skip: monitor?.done_titles ?? [],
    });
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
          {nudge && (
            <div style={{ margin: "1rem 0 0", padding: "0.75rem", background: "#fff4e0", borderLeft: "4px solid #e49a1c", borderRadius: 4 }}>
              <strong>
                {nudge.kind === "late_start"
                  ? `"${nudge.title}" was due ${nudge.minutes_late} min ago.`
                  : `"${nudge.title}" is ${nudge.minutes_late} min past its planned end.`}
              </strong>{" "}
              <button onClick={() => handleProgress(nudge.block_id, "start").then(() => {})} disabled={nudge.kind !== "late_start"}>
                Start now
              </button>{" "}
              <button onClick={() => handleNudgeReplan(nudge)} disabled={loading}>
                Re-plan the rest of my day
              </button>{" "}
              <button onClick={() => setSnoozed((z) => ({ ...z, [nudge.block_id]: Date.now() + 10 * 60 * 1000 }))}>
                Remind me in 10 min
              </button>
            </div>
          )}
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
                progress={Object.fromEntries((monitor?.blocks ?? []).map((b) => [b.id, b]))}
                onProgress={handleProgress}
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
