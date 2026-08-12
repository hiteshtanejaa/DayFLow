import { useState } from "react";
import { ProposedSchedule, AgentActionLog } from "./api";
import DayCalendar from "./DayCalendar";

interface Props {
  schedule: ProposedSchedule;
  actions: AgentActionLog[];
  label?: string;
}

export default function ScheduleView({ schedule, actions, label }: Props) {
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
      <div style={{ marginTop: "0.75rem" }}>
        <button disabled={schedule.violations.length > 0}>Confirm</button>{" "}
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
