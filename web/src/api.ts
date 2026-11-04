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
  id?: string | null; // database id; needed to report start/done
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

// Anonymous pseudonymous participant id (random UUID, no personal data),
// created once and kept in localStorage so every schedule is stored under it.
const PID_KEY = "dayflow_participant";

async function participantId(fresh = false): Promise<string> {
  if (!fresh) {
    const saved = localStorage.getItem(PID_KEY);
    if (saved) return saved;
  }
  const res = await fetch(`${API_BASE}/participants`, { method: "POST" });
  if (!res.ok) throw new Error(`Could not register participant: ${res.status}`);
  const { participant_id } = await res.json();
  localStorage.setItem(PID_KEY, participant_id);
  return participant_id;
}

export async function submitIntake(
  transcript: string,
  dayStart: string,
  dayEnd: string,
  orchestrationMode?: OrchestrationMode,
  preferences: TaskPreference[] = [],
  replaces?: string,
  skip?: string[],
): Promise<{
  schedule_id: string;
  schedule: ProposedSchedule;
  agent_actions: AgentActionLog[];
  calendar_error: string | null;
}> {
  const post = async (pid: string) =>
    fetch(`${API_BASE}/intake`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Participant-Id": pid },
      body: JSON.stringify({
        transcript,
        day_start: dayStart,
        day_end: dayEnd,
        busy_slots: [],
        preferences,
        ...(orchestrationMode ? { orchestration_mode: orchestrationMode } : {}),
        ...(replaces ? { replaces } : {}),
        ...(skip?.length ? { skip } : {}),
      }),
    });
  let res = await post(await participantId());
  // Stored id no longer exists server-side (e.g. erased): register again once.
  if (res.status === 404) res = await post(await participantId(true));
  if (!res.ok) throw new Error(`Intake failed: ${res.status}`);
  return res.json();
}

export type ScheduleStatus = "pending" | "committed" | "rejected";

export interface CalendarSync {
  synced: number;
  failed: number;
}

export async function decideSchedule(
  scheduleId: string,
  decision: "confirm" | "reject",
): Promise<{ status: ScheduleStatus; calendar: CalendarSync | null }> {
  const res = await fetch(`${API_BASE}/schedules/${scheduleId}/${decision}`, {
    method: "POST",
    headers: { "X-Participant-Id": await participantId() },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? `${decision} failed: ${res.status}`);
  }
  return res.json();
}

export async function googleConnected(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/calendar/status`, { headers: { "X-Participant-Id": await participantId() } });
  return res.ok && (await res.json()).google_connected;
}

// Sends the browser to Google's consent screen; the server redirects back here.
export async function connectGoogle(): Promise<void> {
  const res = await fetch(`${API_BASE}/calendar/google/connect`, {
    headers: { "X-Participant-Id": await participantId() },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Could not start Google sign-in: ${res.status}`);
  }
  window.location.href = (await res.json()).url;
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
): Promise<{ tasks: Task[]; question: ClarifyingQuestion | null; done: boolean; inferred: TaskPreference[] }> {
  const res = await fetch(`${API_BASE}/clarify/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, day_start: dayStart, tasks, answered }),
  });
  if (!res.ok) throw new Error(`Clarification failed: ${res.status}`);
  return res.json();
}

// null = the reply could not be turned into a meaningful rule (nothing is stored).
export async function clarifyAnswer(
  question: ClarifyingQuestion,
  answerText: string,
  tasks: Task[],
): Promise<TaskPreference | null> {
  const res = await fetch(`${API_BASE}/clarify/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, answer_text: answerText, tasks }),
  });
  if (!res.ok) throw new Error(`Clarification failed: ${res.status}`);
  return res.json();
}

// ---- Execution Monitor ----

export interface OverdueBlock {
  block_id: string;
  schedule_id: string;
  title: string;
  kind: "late_start" | "overrun";
  minutes_late: number;
}

export interface MonitorState {
  blocks: { id: string; started: boolean; done: boolean }[];
  overdue: OverdueBlock[];
  done_titles: string[];
}

export async function monitorCheck(): Promise<MonitorState> {
  const res = await fetch(`${API_BASE}/monitor/check`, { headers: { "X-Participant-Id": await participantId() } });
  if (!res.ok) throw new Error(`Monitor check failed: ${res.status}`);
  return res.json();
}

export async function markBlock(blockId: string, event: "start" | "done"): Promise<void> {
  const res = await fetch(`${API_BASE}/blocks/${blockId}/${event}`, {
    method: "POST",
    headers: { "X-Participant-Id": await participantId() },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Could not mark block ${event}: ${res.status}`);
  }
}
