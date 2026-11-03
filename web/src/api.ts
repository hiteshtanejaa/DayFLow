const API_BASE = "http://localhost:8000";

export type EnergyLevel = "low" | "medium" | "high";

export interface Task {
  title: string;
  duration_minutes: number;
  energy_required: EnergyLevel;
  priority?: number;
  fixed_start?: string | null;
}

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

export type PreferenceCategory = "time_window" | "relative_order" | "energy_match";

export interface TaskPreference {
  task_title: string;
  category: PreferenceCategory;
  time_window?: "morning" | "afternoon" | "evening" | "night" | null;
  relative_order?: "before" | "after" | null;
  reference_task?: string | null;
  energy_slot?: EnergyLevel | null;
}

export interface ClarifyingQuestion {
  task_title: string;
  category: PreferenceCategory;
  question_text: string;
}

export interface PreferenceViolation {
  task_title: string;
  category: PreferenceCategory;
  message: string;
}

export interface ProposedSchedule {
  blocks: ScheduleBlock[];
  reasoning_summary: string;
  violations: ScheduleViolation[];
  preference_violations: PreferenceViolation[];
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
  preferences: TaskPreference[] = [],
): Promise<{ schedule: ProposedSchedule; agent_actions: AgentActionLog[] }> {
  const res = await fetch(`${API_BASE}/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      day_start: dayStart,
      day_end: dayEnd,
      busy_slots: [],
      preferences,
      ...(orchestrationMode ? { orchestration_mode: orchestrationMode } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Intake failed: ${res.status}`);
  return res.json();
}

// Clarification loop — one call per turn. `tasks` is null on the first
// call (the server extracts it from the transcript once and hands it
// back); pass it straight through on later turns so extract_intent only
// runs once per conversation, not once per question.
export async function clarifyNext(
  transcript: string,
  dayStart: string,
  tasks: Task[] | null,
  answered: TaskPreference[],
): Promise<{ tasks: Task[]; question: ClarifyingQuestion | null; done: boolean }> {
  const res = await fetch(`${API_BASE}/clarify/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, day_start: dayStart, tasks, answered }),
  });
  if (!res.ok) throw new Error(`Clarification failed: ${res.status}`);
  return res.json();
}

export async function clarifyAnswer(
  question: ClarifyingQuestion,
  answerText: string,
): Promise<TaskPreference> {
  const res = await fetch(`${API_BASE}/clarify/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, answer_text: answerText }),
  });
  if (!res.ok) throw new Error(`Clarification failed: ${res.status}`);
  return res.json();
}
