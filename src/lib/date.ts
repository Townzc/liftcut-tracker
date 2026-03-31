import {
  addDays,
  format,
  isSameDay,
  parseISO,
  startOfWeek,
  endOfWeek,
} from "date-fns";

export const DATE_FORMAT = "yyyy-MM-dd";

export function toDateString(value: Date): string {
  return format(value, DATE_FORMAT);
}

export function todayString(): string {
  return toDateString(new Date());
}

export function parseDateString(value: string): Date {
  return parseISO(value);
}

export function formatDisplayDate(value: string): string {
  return format(parseDateString(value), "MMM d");
}

export function isToday(value: string): boolean {
  return isSameDay(parseDateString(value), new Date());
}

export function getCurrentWeekRange(reference = new Date()): {
  start: string;
  end: string;
} {
  const start = startOfWeek(reference, { weekStartsOn: 1 });
  const end = endOfWeek(reference, { weekStartsOn: 1 });
  return { start: toDateString(start), end: toDateString(end) };
}

export function getLastNDates(days: number, reference = new Date()): string[] {
  return Array.from({ length: days }, (_, idx) =>
    toDateString(addDays(reference, -(days - 1 - idx))),
  );
}

export function compareDateAsc(a: string, b: string): number {
  return parseDateString(a).getTime() - parseDateString(b).getTime();
}

