"use client";
import { useLocale, useTranslations } from "next-intl";
import { identifyExercise } from "@liftcut/core/exercise-catalog";
import { recordBroken, type Best } from "@liftcut/core/one-rep-max";
import { nextTarget, ruleForExercise } from "@liftcut/core/progression";
import type { ExerciseHistory, PrescriptionExercise, SetLog } from "@/lib/today";

/** The engine computes the number from confirmed history; nothing here is written or copied into a set. */
export function ProgressionTarget({ exercise, history }: { exercise: PrescriptionExercise; history?: ExerciseHistory }) {
  const t = useTranslations("today.progression"), en = useLocale() === "en";
  const rule = ruleForExercise(exercise, { bodyweight: identifyExercise(exercise.name)?.equipment.length === 0 });
  if (!rule || !history) return null;
  const target = nextTarget(rule, history.sessions);
  const value = target.weight !== null ? t("load", { weight: target.weight, reps: target.reps ?? 0, sets: target.sets })
    : rule.kind === "double" && rule.load === "bodyweight" ? t("bodyweight", { reps: target.reps ?? 0, sets: target.sets }) : t("none");
  return <div className="rounded-xl bg-muted/60 p-3 text-sm" data-testid={`target-${exercise.id}`}>
    <p>{t("title")} · {value}</p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{en ? target.why.en : target.why.zh}</p>
  </div>;
}

export function SetRecord({ saved, prior }: { saved: SetLog; prior?: Best }) {
  const t = useTranslations("today.record");
  const record = prior ? recordBroken({ date: "", weightKg: saved.weightKg, reps: saved.reps, status: saved.status }, prior) : null;
  return record && <p className="text-xs font-medium" data-testid={`record-${saved.id}`}>{t(record.kind, { value: record.value, previous: record.previous })}</p>;
}
