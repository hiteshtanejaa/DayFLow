import { motion, AnimatePresence } from "framer-motion";
import { ScheduleBlock } from "./api";

interface Props {
  blocks: ScheduleBlock[];
  dayStartHour?: number;
  dayEndHour?: number;
}

const PIXELS_PER_HOUR = 64;

const ENERGY_COLOR: Record<string, string> = {
  high: "#d9663b",
  medium: "#d6a337",
  low: "#4f8fc0",
};

// Keyed by normalized title, not task_id — task_id is often just the title
// anyway (backend falls back to it when no explicit id is set), and this
// is what lets framer-motion recognize "same task, new time" as a MOVE
// rather than a remove+add when a disruption reshuffles the day. If the
// model phrases the same task slightly differently across two calls
// (rare, but possible), it degrades to a remove+add instead of a move —
// acceptable for a visual nicety, not scoring-critical like the backend's
// fuzzy title matching has to be.
function taskKey(title: string): string {
  return title.trim().toLowerCase();
}

function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "am" : "pm"}`;
}

export default function DayCalendar({ blocks, dayStartHour = 8, dayEndHour = 20 }: Props) {
  const totalHours = dayEndHour - dayStartHour;
  const containerHeight = totalHours * PIXELS_PER_HOUR;
  const hourMarks = Array.from({ length: totalHours + 1 }, (_, i) => dayStartHour + i);

  return (
    <div style={{ display: "flex", marginTop: "0.75rem" }}>
      <div style={{ width: 48, position: "relative", height: containerHeight, flexShrink: 0 }}>
        {hourMarks.map((h) => (
          <div
            key={h}
            style={{
              position: "absolute",
              top: (h - dayStartHour) * PIXELS_PER_HOUR - 7,
              right: 6,
              fontSize: "0.7rem",
              color: "#888",
            }}
          >
            {hourLabel(h)}
          </div>
        ))}
      </div>

      <div
        style={{
          position: "relative",
          flex: 1,
          height: containerHeight,
          borderLeft: "1px solid #ddd",
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PIXELS_PER_HOUR - 1}px, #eee ${PIXELS_PER_HOUR - 1}px, #eee ${PIXELS_PER_HOUR}px)`,
        }}
      >
        <AnimatePresence>
          {blocks.map((b) => {
            const start = new Date(b.start);
            const end = new Date(b.end);
            const startOffsetHours = start.getHours() + start.getMinutes() / 60 - dayStartHour;
            const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
            const failed = b.status === "failed";

            return (
              <motion.div
                key={taskKey(b.title)}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                style={{
                  position: "absolute",
                  top: Math.max(startOffsetHours, 0) * PIXELS_PER_HOUR,
                  height: Math.max(durationHours * PIXELS_PER_HOUR - 3, 20),
                  left: 6,
                  right: 6,
                  background: failed ? "#c0392b" : ENERGY_COLOR[b.energy_required] ?? "#4f8fc0",
                  border: failed ? "2px dashed #7b241c" : "1px solid rgba(0,0,0,0.15)",
                  borderRadius: 6,
                  padding: "3px 8px",
                  overflow: "hidden",
                  color: "#fff",
                  fontSize: "0.78rem",
                  lineHeight: 1.25,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  cursor: "default",
                }}
                title={`${b.title}: ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}${failed ? " (could not be scheduled)" : ""}`}
              >
                <strong>{b.title}</strong>
                <div style={{ fontSize: "0.68rem", opacity: 0.9 }}>
                  {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
                  {end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {failed && " ⚠"}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
