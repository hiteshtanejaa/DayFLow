import { useEffect, useRef, useState } from "react";
import { clarifyAnswer, clarifyNext, ClarifyingQuestion, Task, TaskPreference } from "./api";

interface Props {
  transcript: string;
  dayStart: string;
  onDone: (preferences: TaskPreference[]) => void;
}

interface ChatMessage {
  role: "assistant" | "user";
  text: string;
}

// Pure safety net against a runaway loop (the model never running out of
// ambiguities) — not a target turn count. The real stop conditions are the
// model returning done=true or the user clicking "build now".
const MAX_TURNS = 10;

export default function ClarificationChat({ transcript, dayStart, onDone }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Let me ask a couple of things before I build this." },
  ]);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [answered, setAnswered] = useState<TaskPreference[]>([]);
  const [question, setQuestion] = useState<ClarifyingQuestion | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [turns, setTurns] = useState(0);
  const started = useRef(false);

  const askNext = async (nextTasks: Task[] | null, nextAnswered: TaskPreference[]) => {
    setLoading(true);
    const res = await clarifyNext(transcript, dayStart, nextTasks, nextAnswered);
    setTasks(res.tasks);

    // Silently-inferred defaults (dinner -> evening, etc.) never become a
    // question — folded straight into the answered list, with a short
    // note so it's not invisible what happened.
    const newlyInferred = res.inferred ?? [];
    const merged = newlyInferred.length ? [...nextAnswered, ...newlyInferred] : nextAnswered;
    if (newlyInferred.length) {
      setAnswered(merged);
      const note = newlyInferred.map((p) => `${p.task_title} -> ${p.time_window}`).join(", ");
      setMessages((m) => [...m, { role: "assistant", text: `(Assuming conventional timing: ${note}.)` }]);
    }

    if (res.done || turns >= MAX_TURNS) {
      onDone(merged);
      return;
    }
    setQuestion(res.question);
    setMessages((m) => [...m, { role: "assistant", text: res.question!.question_text }]);
    setLoading(false);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    askNext(null, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReply = async () => {
    if (!reply.trim() || !question) return;
    const answerText = reply.trim();
    setMessages((m) => [...m, { role: "user", text: answerText }]);
    setReply("");
    setLoading(true);
    setTurns((t) => t + 1);

    const pref = await clarifyAnswer(question, answerText);
    const nextAnswered = [...answered, pref];
    setAnswered(nextAnswered);
    setQuestion(null);
    await askNext(tasks, nextAnswered);
  };

  const handleBuildNow = () => {
    onDone(answered);
  };

  return (
    <div style={{ border: "1px solid #ccc", borderRadius: 6, padding: "1rem", margin: "1rem 0" }}>
      <div>
        {messages.map((m, i) => (
          <p
            key={i}
            style={{
              margin: "0.35rem 0",
              textAlign: m.role === "user" ? "right" : "left",
              color: m.role === "user" ? "#111" : "#444",
            }}
          >
            <strong>{m.role === "user" ? "You: " : ""}</strong>
            {m.text}
          </p>
        ))}
        {loading && <p style={{ color: "#888", fontSize: "0.85rem" }}>Thinking...</p>}
      </div>

      {!loading && question && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input
            type="text"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleReply()}
            placeholder="Type your answer..."
            style={{ flex: 1 }}
            autoFocus
          />
          <button onClick={handleReply} disabled={!reply.trim()}>
            Reply
          </button>
          <button onClick={handleBuildNow}>That's fine, build it</button>
        </div>
      )}
    </div>
  );
}
