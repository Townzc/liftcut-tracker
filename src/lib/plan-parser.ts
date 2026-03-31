import type { ParsedLineError } from "@/types";

import type { ParsedPlan } from "@/lib/plan-import-schema";

export interface ParsedPlanResult {
  draft: ParsedPlan | null;
  errors: ParsedLineError[];
  warnings: string[];
}

export const ENGLISH_PLAN_TEXT_TEMPLATE = `Week 1
Day 1
Bench Press 4 x 5 RPE 7
Incline DB Press 3 x 8-10 RPE 8
Seated Row 3 x 8-10 RPE 8

Day 2
Squat 3 x 6 RPE 6
Romanian Deadlift 3 x 8 RPE 6.5
Overhead Press 3 x 10 RPE 7.5

Day 3
Lat Pulldown 3 x 10-12 RPE 8
Leg Press 3 x 10 RPE 7`;

export const CHINESE_PLAN_TEXT_TEMPLATE = `第1周
Day1
卧推 4 × 5 RPE 7
上斜哑铃卧推 3 × 8-10 RPE 8
坐姿划船 3 × 8-10 RPE 8

Day2
深蹲 3 × 6 RPE 6
罗马尼亚硬拉 3 × 8 RPE 6.5
哑铃推肩 3 × 10 RPE 7.5

Day3
高位下拉 3 × 10-12 RPE 8
腿举 3 × 10 RPE 7`;

export const PLAN_TEXT_TEMPLATE = ENGLISH_PLAN_TEXT_TEMPLATE;

const weekPattern = /^(?:week\s*(\d+)|第\s*(\d+)\s*周)$/i;
const dayPattern = /^(?:day\s*(\d+)|day(\d+)|第\s*(\d+)\s*天)(?:\s*[:\-：]\s*(.+))?$/i;
const exercisePattern = /^(.+?)\s+(\d+)\s*[xX*×]\s*([0-9]+(?:\s*-\s*[0-9]+)?(?:s|sec|seconds|秒)?)\s*(?:rpe\s*([0-9]+(?:\.[0-9]+)?))?(?:\s*(?:#|\/\/|note[:：]|备注[:：])\s*(.*))?$/i;

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

function detectExerciseReason(line: string): string {
  const normalizedLine = line.trim();
  const normalizedRpe = /rpe/i;

  if (!/[xX*×]/.test(normalizedLine) && /\d/.test(normalizedLine)) {
    return "missing_sets";
  }

  if (/[xX*×]/.test(normalizedLine) && !/\d+\s*[xX*×]/.test(normalizedLine)) {
    return "missing_sets";
  }

  if (/\d+\s*[xX*×]\s*(?:rpe|#|\/\/|note|备注|$)/i.test(normalizedLine)) {
    return "missing_rep_range";
  }

  if (normalizedRpe.test(normalizedLine) && !/rpe\s*[0-9]+(?:\.[0-9]+)?/i.test(normalizedLine)) {
    return "invalid_rpe";
  }

  if (/rpe\s*([0-9]+(?:\.[0-9]+)?)/i.test(normalizedLine)) {
    const matched = normalizedLine.match(/rpe\s*([0-9]+(?:\.[0-9]+)?)/i);
    const value = Number(matched?.[1] ?? "0");
    if (value <= 0 || value > 10) {
      return "invalid_rpe";
    }
  }

  return "unrecognized_line_format";
}

export function parsePlanText(input: string, defaultPlanName = "Imported Text Plan"): ParsedPlanResult {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return {
      draft: null,
      errors: [
        {
          lineNumber: 0,
          content: "",
          reason: "empty_input",
        },
      ],
      warnings: [],
    };
  }

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
      reason: detectExerciseReason(line),
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
