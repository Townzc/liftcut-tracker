import type { WorkoutLog } from "./types";

/**
 * A year of training days for the history heatmap (M3-1). Only confirmed completed
 * rows count. A session row is one set; an older log row with no set count is a
 * completed exercise whose number of sets is unknown, so it marks the day as trained
 * without adding sets. Days without any record are "no record", not zero sets.
 */
export type CalendarDay = { date: string; sets: number; unknownRows: number; level: 0 | 1 | 2 | 3 | 4 };
export type TrainingCalendar = { weeks: (CalendarDay | null)[][]; trainedDays: number; sets: number; unknownDays: number };

const DAY = 86400000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Fixed thresholds so a level means the same thing every year: 1–5, 6–11, 12–19, 20+ sets. */
export const levelOf = (sets: number, unknownRows: number): CalendarDay["level"] =>
  sets >= 20 ? 4 : sets >= 12 ? 3 : sets >= 6 ? 2 : sets > 0 || unknownRows > 0 ? 1 : 0;

/** `today` is the viewer's local date (YYYY-MM-DD); weeks run Monday to Sunday and end with today's week. */
export function trainingCalendar(logs: readonly Pick<WorkoutLog, "date" | "exercises">[], today: string, weekCount = 53): TrainingCalendar {
  const byDate = new Map<string, { sets: number; unknownRows: number }>();
  for (const log of logs) for (const row of log.exercises) {
    if (!row.completed) continue;
    const day = byDate.get(log.date) ?? { sets: 0, unknownRows: 0 };
    if (row.recordedSets != null && row.recordedSets > 0) day.sets += row.recordedSets; else day.unknownRows++;
    byDate.set(log.date, day);
  }
  const end = parse(today), monday = end - ((new Date(end).getUTCDay() + 6) % 7) * DAY, start = monday - (weekCount - 1) * 7 * DAY;
  const weeks: (CalendarDay | null)[][] = [];
  let trainedDays = 0, sets = 0, unknownDays = 0;
  for (let w = 0; w < weekCount; w++) weeks.push(Array.from({ length: 7 }, (_, d) => {
    const ms = start + (w * 7 + d) * DAY;
    if (ms > end) return null; // Days after today are not part of the record.
    const date = format(ms), day = byDate.get(date) ?? { sets: 0, unknownRows: 0 };
    if (day.sets || day.unknownRows) { trainedDays++; sets += day.sets; if (day.unknownRows) unknownDays++; }
    return { date, ...day, level: levelOf(day.sets, day.unknownRows) };
  }));
  return { weeks, trainedDays, sets, unknownDays };
}
