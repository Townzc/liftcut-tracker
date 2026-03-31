import type { ParsedLineError } from "@/types";

import type { ParsedPlan } from "@/lib/plan-import-schema";

export interface ParsedPlanResult {
  draft: ParsedPlan | null;
  errors: ParsedLineError[];
  warnings: string[];
}

export const PLAN_TEXT_TEMPLATE = `Week 1
Day 1
Bench Press 4 x 5 RPE 7
Incline DB Press 3 x 8-10 RPE 8
Seated Row 3 x 8-10 RPE 8

Day 2
Squat 3 x 6 RPE 6
Romanian Deadlift 3 x 8 RPE 6.5
Overhead Press 3 x 10 RPE 7.5`;

const weekPattern = /^(?:week\s*(\d+)|\u7b2c\s*(\d+)\s*\u5468)$/i;
const dayPattern = /^(?:day\s*(\d+)|day(\d+)|\u7b2c\s*(\d+)\s*\u5929)(?:\s*[:\-]\s*(.+))?$/i;
const exercisePattern = /^(.+?)\s+(\d+)\s*[xX*\u00d7]\s*([0-9]+(?:\s*-\s*[0-9]+)?(?:s|sec|seconds)?)\s*(?:rpe\s*([0-9]+(?:\.[0-9]+)?))?(?:\s*(?:#|\/\/|note[:\uff1a]|\u5907\u6ce8[:\uff1a])\s*(.*))?$/i;

type ParsedExerciseRow = {
  name: string;
  sets: number;
  repRange: string;
  targetRpe: number;
  notes: string;
};

type ParsedDayNode = {
  dayNumber: number;
  title: string;
  notes: string;
  exercises: ParsedExerciseRow[];
};

type ParsedWeekNode = {
  weekNumber: number;
  days: Map<number, ParsedDayNode>;
};

function ensureWeek(weeksMap: Map<number, ParsedWeekNode>, weekNumber: number): ParsedWeekNode {
  if (!weeksMap.has(weekNumber)) {
    weeksMap.set(weekNumber, {
      weekNumber,
      days: new Map(),
    });
  }

  return weeksMap.get(weekNumber)!;
}

function ensureDay(weekNode: ParsedWeekNode, dayNumber: number, title?: string): ParsedDayNode {
  if (!weekNode.days.has(dayNumber)) {
    weekNode.days.set(dayNumber, {
      dayNumber,
      title: title?.trim() || `Day ${dayNumber}`,
      notes: "",
      exercises: [],
    });
  }

  return weekNode.days.get(dayNumber)!;
}

function toPositiveInteger(value: string | undefined, fallback: number): number {
  const next = Number(value);
  if (Number.isInteger(next) && next > 0) {
    return next;
  }

  return fallback;
}

export function parsePlanText(input: string, defaultPlanName = "Imported Text Plan"): ParsedPlanResult {
  const lines = input.split(/\r?\n/);
  const errors: ParsedLineError[] = [];
  const warnings: string[] = [];
  const weeksMap = new Map<number, ParsedWeekNode>();

  let currentWeek = 1;
  let currentDay = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const weekMatch = line.match(weekPattern);
    if (weekMatch) {
      currentWeek = toPositiveInteger(weekMatch[1] || weekMatch[2], currentWeek);
      ensureWeek(weeksMap, currentWeek);
      continue;
    }

    const dayMatch = line.match(dayPattern);
    if (dayMatch) {
      currentDay = toPositiveInteger(dayMatch[1] || dayMatch[2] || dayMatch[3], currentDay);
      const title = dayMatch[4]?.trim();
      const weekNode = ensureWeek(weeksMap, currentWeek);
      ensureDay(weekNode, currentDay, title);
      continue;
    }

    const exerciseMatch = line.match(exercisePattern);
    if (exerciseMatch) {
      const weekNode = ensureWeek(weeksMap, currentWeek);
      const dayNode = ensureDay(weekNode, currentDay);

      const name = exerciseMatch[1].trim();
      const sets = Number(exerciseMatch[2]);
      const repRange = exerciseMatch[3].replace(/\s+/g, "");
      const parsedRpe = exerciseMatch[4] ? Number(exerciseMatch[4]) : null;
      const notes = exerciseMatch[5]?.trim() || "";

      if (parsedRpe === null) {
        warnings.push(`missing_rpe|${index + 1}`);
      }

      dayNode.exercises.push({
        name,
        sets,
        repRange,
        targetRpe: parsedRpe ?? 7,
        notes,
      });

      continue;
    }

    errors.push({
      lineNumber: index + 1,
      content: rawLine,
      reason: "unrecognized_line_format",
    });
  }

  const weeks = [...weeksMap.values()]
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((weekNode) => ({
      weekNumber: weekNode.weekNumber,
      days: [...weekNode.days.values()]
        .sort((a, b) => a.dayNumber - b.dayNumber)
        .filter((dayNode) => dayNode.exercises.length > 0)
        .map((dayNode) => ({
          dayNumber: dayNode.dayNumber,
          title: dayNode.title,
          notes: dayNode.notes,
          exercises: dayNode.exercises,
        })),
    }))
    .filter((week) => week.days.length > 0);

  if (weeks.length === 0) {
    errors.push({
      lineNumber: 0,
      content: "",
      reason: "no_valid_structure",
    });

    return {
      draft: null,
      errors,
      warnings,
    };
  }

  return {
    draft: {
      name: defaultPlanName,
      weeks,
    },
    errors,
    warnings,
  };
}
