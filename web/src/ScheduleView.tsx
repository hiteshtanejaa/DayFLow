import { useState } from "react";
import { ProposedSchedule, AgentActionLog, ScheduleStatus } from "./api";
import DayCalendar from "./DayCalendar";

interface Props {
  schedule: ProposedSchedule;
  actions: AgentActionLog[];
  status: ScheduleStatus;
  onDecide: (decision: "confirm" | "reject") => void;
  note?: string;
  label?: string;
}

export default function ScheduleView({ schedule, actions, status, onDecide, note, label }: Props) {
  const [showAudit, setShowAudit] = useState(false);
  const totalLatency = actions.reduce((sum, a) => sum + a.latency_ms, 0);

  return (
    <section style={{ border: "1px solid #ccc", borderRadius: 6, padding: "1rem" }}>
      <h2 style={{ marginTop: 0 }}>
        {label ?? "Proposed schedule"} ({schedule.orchestration_mode})
      </h2>
      <p style={{ fontSize: "0.85rem", color: "#666" }}>
        {actions.length} agent step(s) — {totalLatency.toFixed(0)}ms total
      </p>
      <p>{schedule.reasoning_summary}</p>

      <DayCalendar blocks={schedule.blocks} />

      {schedule.violations.length > 0 && (
        <p style={{ color: "darkorange", marginTop: "0.75rem" }}>
          {schedule.violations.length} constraint violation(s) — do not confirm
          until resolved.
        </p>
      )}

      {note && <p style={{ fontSize: "0.85rem", color: "#555", margin: "0.5rem 0 0" }}>{note}</p>}

      {schedule.preference_violations.length > 0 && (
        <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fff8e6", borderRadius: 4 }}>
          <p style={{ margin: "0 0 0.35rem", fontSize: "0.85rem", fontWeight: "bold" }}>
            Didn't quite match what you asked for:
          </p>
          {schedule.preference_violations.map((v, i) => (
            <p key={i} style={{ margin: "0.15rem 0", fontSize: "0.85rem" }}>
              {v.message}
            </p>
          ))}
        </div>
      )}
      <div style={{ marginTop: "0.75rem" }}>
        {status === "pending" ? (
          <>
            <button disabled={schedule.violations.length > 0} onClick={() => onDecide("confirm")}>
              Confirm
            </button>{" "}
            <button onClick={() => onDecide("reject")}>Reject</button>{" "}
          </>
        ) : (
          <>
            <strong style={{ color: status === "committed" ? "seagreen" : "#a33" }}>
              {status === "committed" ? "Confirmed" : "Rejected"}
            </strong>
            {status === "rejected" && (
              <span style={{ fontSize: "0.85rem", color: "#666" }}>
                {" "}
                — describe what to change under "Something come up?" to get a new plan.
              </span>
            )}{" "}
          </>
        )}
        <button onClick={() => setShowAudit((v) => !v)}>
          {showAudit ? "Hide" : "Show"} audit trail
        </button>
      </div>

      {showAudit && (
        <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#444" }}>
          <h3>Audit trail</h3>
          {actions.map((a, i) => (
            <div key={i} style={{ borderTop: "1px solid #ddd", padding: "0.5rem 0" }}>
              <strong>{a.agent_name}</strong> — {a.action} ({a.latency_ms.toFixed(0)}ms)
              {a.reasoning_summary && <p>{a.reasoning_summary}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
