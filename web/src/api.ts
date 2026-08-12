const API_BASE = "http://localhost:8000";

export type EnergyLevel = "low" | "medium" | "high";

export interface ScheduleBlock {
  task_id: string;
  title: string;
  start: string;
  end: string;
  status: string;
  energy_required: EnergyLevel;
}

export interface ScheduleViolation {
  block_id: string | null;
  reason: string;
}

export interface ProposedSchedule {
  blocks: ScheduleBlock[];
  reasoning_summary: string;
  violations: ScheduleViolation[];
  orchestration_mode: string;
}

export interface AgentActionLog {
  agent_name: string;
  action: string;
  reasoning_summary: string | null;
  latency_ms: number;
  timestamp: string;
}

export type OrchestrationMode = "react" | "hierarchical";

export async function submitIntake(
  transcript: string,
  dayStart: string,
  dayEnd: string,
  orchestrationMode?: OrchestrationMode,
): Promise<{ schedule: ProposedSchedule; agent_actions: AgentActionLog[] }> {
  const res = await fetch(`${API_BASE}/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      day_start: dayStart,
      day_end: dayEnd,
      busy_slots: [],
      ...(orchestrationMode ? { orchestration_mode: orchestrationMode } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Intake failed: ${res.status}`);
  return res.json();
}
