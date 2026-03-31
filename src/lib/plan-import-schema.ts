import { z } from "zod";

export const parsedExerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.number().int().min(1),
  repRange: z.string().min(1),
  targetRpe: z.number().min(1).max(10),
  notes: z.string().default(""),
  alternativeExercises: z.array(z.string()).optional(),
});

export const parsedDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  title: z.string().min(1),
  notes: z.string().default(""),
  exercises: z.array(parsedExerciseSchema).min(1),
});

export const parsedWeekSchema = z.object({
  weekNumber: z.number().int().min(1),
  days: z.array(parsedDaySchema).min(1),
});

export const parsedPlanSchema = z.object({
  name: z.string().min(1),
  weeks: z.array(parsedWeekSchema).min(1),
});

export type ParsedPlan = z.infer<typeof parsedPlanSchema>;