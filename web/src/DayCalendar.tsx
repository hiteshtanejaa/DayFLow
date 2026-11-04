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

// A block only has a sane position on the timeline grid if its start (and
// ideally its end) fall within [dayStartHour, dayEndHour). Two real ways a
// block can land outside that: the engine's own "couldn't place this at
// all" fallback (status === "failed"), or a task with a model-supplied
// fixed_start that build_schedule places unconditionally (fixed times are
// trusted as genuinely fixed, never clamped to the working day) — caught
// afterward by validate_schedule as an "outside working hours" violation,
// but by then the block still needs to render *somewhere*. Previously
// these were absolutely-positioned using the same top-offset math as
// in-range blocks, which for a block starting at or after dayEndHour
// produces a `top` beyond the grid's own height — it visually overflowed
// past the calendar into whatever page content sits below (the violations
// banner, the Confirm button). Rendering them in a separate section
// instead of forcing them onto the grid fixes that outright.
function isOutOfGrid(b: ScheduleBlock, dayStartHour: number, dayEndHour: number): boolean {
  if (b.status === "failed") return true;
  const start = new Date(b.start);
  const startOffsetHours = start.getHours() + start.getMinutes() / 60 - dayStartHour;
  return startOffsetHours < 0 || startOffsetHours >= dayEndHour - dayStartHour;
}

const MIN_BLOCK_PX = 20;

// A 5-10 minute task is only ~5-11px tall at true scale, so it is drawn at a
// 20px minimum; that box then covers the next block's top edge (a protein shake
// hid behind the 4-hour deep-work block). Boxes that overlap *visually* are put
// side by side in lanes, like Google Calendar, instead of on top of each other.
function assignLanes(blocks: ScheduleBlock[], dayStartHour: number): Map<ScheduleBlock, { col: number; cols: number }> {
  const boxes = blocks
    .map((b) => {
      const s = new Date(b.start);
      const top = (s.getHours() + s.getMinutes() / 60 - dayStartHour) * PIXELS_PER_HOUR;
      const h = ((new Date(b.end).getTime() - s.getTime()) / 3600000) * PIXELS_PER_HOUR - 3;
      return { b, top, bottom: top + Math.max(h, MIN_BLOCK_PX), col: 0 };
    })
    .sort((x, y) => x.top - y.top);

  const out = new Map<ScheduleBlock, { col: number; cols: number }>();
  let cluster: typeof boxes = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const flush = () => {
    cluster.forEach((c) => out.set(c.b, { col: c.col, cols: laneEnds.length }));
    cluster = [];
    laneEnds = [];
  };
  for (const box of boxes) {
    if (box.top >= clusterEnd) flush();
    let col = laneEnds.findIndex((end) => end <= box.top);
    if (col === -1) {
      col = laneEnds.length;
      laneEnds.push(box.bottom);
    } else laneEnds[col] = box.bottom;
    box.col = col;
    cluster.push(box);
    clusterEnd = box.top >= clusterEnd ? box.bottom : Math.max(clusterEnd, box.bottom);
  }
  flush();
  return out;
}

export default function DayCalendar({ blocks, dayStartHour = 8, dayEndHour = 20 }: Props) {
  const totalHours = dayEndHour - dayStartHour;
  const containerHeight = totalHours * PIXELS_PER_HOUR;
  const hourMarks = Array.from({ length: totalHours + 1 }, (_, i) => dayStartHour + i);

  const inGrid = blocks.filter((b) => !isOutOfGrid(b, dayStartHour, dayEndHour));
  const lanes = assignLanes(inGrid, dayStartHour);
  const lane = (b: ScheduleBlock) => lanes.get(b) ?? { col: 0, cols: 1 };
  const outOfGrid = blocks.filter((b) => isOutOfGrid(b, dayStartHour, dayEndHour));

  return (
    <div>
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
            {inGrid.map((b) => {
              const start = new Date(b.start);
              const end = new Date(b.end);
              const startOffsetHours = start.getHours() + start.getMinutes() / 60 - dayStartHour;
              const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

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
                    top: startOffsetHours * PIXELS_PER_HOUR,
                    height: Math.max(durationHours * PIXELS_PER_HOUR - 3, MIN_BLOCK_PX),
                    left: `calc(6px + ${lane(b).col} * (100% - 12px) / ${lane(b).cols})`,
                    width: `calc((100% - 12px) / ${lane(b).cols} - 3px)`,
                    background: ENERGY_COLOR[b.energy_required] ?? "#4f8fc0",
                    border: "1px solid rgba(0,0,0,0.15)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    overflow: "hidden",
                    color: "#fff",
                    fontSize: "0.78rem",
                    lineHeight: 1.25,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    cursor: "default",
                  }}
                  title={`${b.title}: ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`}
                >
                  <strong>{b.title}</strong>
                  <div style={{ fontSize: "0.68rem", opacity: 0.9 }}>
                    {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
                    {end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {outOfGrid.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <p style={{ margin: "0 0 0.35rem", fontSize: "0.78rem", fontWeight: "bold", color: "#7b241c" }}>
            Outside today's working hours:
          </p>
          <AnimatePresence>
            {outOfGrid.map((b) => {
              const start = new Date(b.start);
              const end = new Date(b.end);
              return (
                <motion.div
                  key={taskKey(b.title)}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  style={{
                    background: "#c0392b",
                    border: "2px dashed #7b241c",
                    borderRadius: 6,
                    padding: "3px 8px",
                    color: "#fff",
                    fontSize: "0.78rem",
                    lineHeight: 1.25,
                    marginBottom: 4,
                  }}
                  title={`${b.title}: ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()} (outside working hours)`}
                >
                  <strong>{b.title}</strong>
                  <div style={{ fontSize: "0.68rem", opacity: 0.9 }}>
                    {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
                    {end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ⚠
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
