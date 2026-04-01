"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, LoaderCircle, Save } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { NumericInput } from "@/components/shared/numeric-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayString } from "@/lib/date";
import { normalizeActionError } from "@/lib/error-utils";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { ExerciseLog, PlanDay, WorkoutLog } from "@/types";

function buildExerciseRows(currentDay: PlanDay, existingLog?: WorkoutLog): ExerciseLog[] {
  return currentDay.exercises.map((exercise) => {
    const existingExercise = existingLog?.exercises.find(
      (logExercise) => logExercise.exercisePlanId === exercise.id,
    );

    return {
      id: existingExercise?.id ?? "",
      workoutLogId: existingExercise?.workoutLogId ?? "",
      exercisePlanId: exercise.id,
      name: exercise.name,
      actualWeight: existingExercise?.actualWeight ?? 0,
      actualReps: existingExercise?.actualReps ?? 0,
      actualRpe: existingExercise?.actualRpe ?? exercise.targetRpe,
      completed: existingExercise?.completed ?? false,
    };
  });
}

function WorkoutDraftForm({
  currentWeekNumber,
  currentDay,
  workoutDate,
  existingLog,
  onSave,
  trainingPlanId,
  trackerLoading,
}: {
  currentWeekNumber: number;
  currentDay: PlanDay;
  workoutDate: string;
  existingLog?: WorkoutLog;
  trainingPlanId: string;
  trackerLoading: boolean;
  onSave: (
    payload: Omit<WorkoutLog, "id" | "userId" | "createdAt"> & { id?: string },
  ) => Promise<void>;
}) {
  const t = useTranslations("workout");
  const tCommon = useTranslations("common");

  const [durationMinutes, setDurationMinutes] = useState(existingLog?.durationMinutes ?? 60);
  const [notes, setNotes] = useState(existingLog?.notes ?? "");
  const [completed, setCompleted] = useState(existingLog?.completed ?? true);
  const [exerciseRows, setExerciseRows] = useState<ExerciseLog[]>(
    buildExerciseRows(currentDay, existingLog),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedSummary, setLastSavedSummary] = useState<{
    date: string;
    weekNumber: number;
    dayNumber: number;
    durationMinutes: number;
    completed: boolean;
    exerciseCount: number;
  } | null>(null);

  const updateRow = (index: number, patch: Partial<ExerciseLog>) => {
    setExerciseRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const handleSaveWorkout = async () => {
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      await onSave({
        id: existingLog?.id,
        date: workoutDate,
        trainingPlanId,
        weekNumber: currentWeekNumber,
        dayNumber: currentDay.dayNumber,
        durationMinutes,
        completed,
        notes,
        exercises: exerciseRows,
      });
      setMessage(t("saved"));
      setLastSavedSummary({
        date: workoutDate,
        weekNumber: currentWeekNumber,
        dayNumber: currentDay.dayNumber,
        durationMinutes,
        completed,
        exerciseCount: exerciseRows.length,
      });
    } catch (saveError) {
      console.error(saveError);
      setError(
        normalizeActionError(saveError, {
          fallback: t("saveFailed"),
          authMessage: tCommon("authRequired"),
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-lg">{currentDay.title}</CardTitle>
          <CardDescription>{currentDay.notes || "-"}</CardDescription>
        </CardHeader>
      </Card>

      {exerciseRows.map((exercise, index) => (
        <Card key={exercise.exercisePlanId} className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{exercise.name}</CardTitle>
            <CardDescription>{t("exerciseLabel", { index: index + 1 })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>{t("actualWeight")}</Label>
              <NumericInput
                value={exercise.actualWeight}
                min={0}
                onValueChange={(value) => updateRow(index, { actualWeight: value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("actualReps")}</Label>
              <NumericInput
                value={exercise.actualReps}
                allowDecimal={false}
                min={0}
                onValueChange={(value) => updateRow(index, { actualReps: value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("actualRpe")}</Label>
              <NumericInput
                value={exercise.actualRpe}
                step="0.1"
                min={0}
                max={10}
                onValueChange={(value) => updateRow(index, { actualRpe: value })}
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Checkbox
                id={`completed-${exercise.exercisePlanId}`}
                checked={exercise.completed}
                onCheckedChange={(checked) => updateRow(index, { completed: checked === true })}
              />
              <Label htmlFor={`completed-${exercise.exercisePlanId}`}>{t("completed")}</Label>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("notesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("duration")}</Label>
              <NumericInput
                value={durationMinutes}
                min={0}
                onValueChange={(value) => setDurationMinutes(value)}
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Checkbox
                id="workout-completed"
                checked={completed}
                onCheckedChange={(checked) => setCompleted(checked === true)}
              />
              <Label htmlFor="workout-completed">{t("sessionCompleted")}</Label>
            </div>
          </div>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("notesPlaceholder")}
          />
        </CardContent>
      </Card>

      <Button
        className="fixed bottom-24 left-4 right-4 z-20 h-12 md:static md:h-10"
        onClick={handleSaveWorkout}
        disabled={isSaving || trackerLoading}
      >
        {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        {isSaving ? t("savingWorkout") : t("saveWorkout")}
      </Button>

      {message ? (
        <p className="inline-flex items-center text-sm text-emerald-700">
          <CheckCircle2 className="mr-1 h-4 w-4" />
          {message}
        </p>
      ) : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {lastSavedSummary ? (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardHeader>
            <CardTitle className="text-sm text-emerald-900">{t("savedSummaryTitle")}</CardTitle>
            <CardDescription>{t("savedSummaryDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-emerald-900">
            <p>
              {t("savedSummaryDate", { date: lastSavedSummary.date })}
            </p>
            <p>
              {t("savedSummaryWeekDay", {
                week: lastSavedSummary.weekNumber,
                day: lastSavedSummary.dayNumber,
              })}
            </p>
            <p>
              {t("savedSummaryDuration", { minutes: lastSavedSummary.durationMinutes })}
            </p>
            <p>
              {t("savedSummaryCompleted", {
                value: lastSavedSummary.completed ? tCommon("yes") : tCommon("no"),
              })}
            </p>
            <p>
              {t("savedSummaryExercises", { count: lastSavedSummary.exerciseCount })}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function WorkoutPage() {
  const t = useTranslations("workout");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");

  const trainingPlan = useTrackerStore((state) => state.trainingPlan);
  const workoutLogs = useTrackerStore((state) => state.workoutLogs);
  const trackerLoading = useTrackerStore((state) => state.loading);
  const selectedWeek = useTrackerStore((state) => state.selectedWeek);
  const selectedDay = useTrackerStore((state) => state.selectedDay);
  const setSelectedWeek = useTrackerStore((state) => state.setSelectedWeek);
  const setSelectedDay = useTrackerStore((state) => state.setSelectedDay);
  const addWorkoutLog = useTrackerStore((state) => state.addWorkoutLog);

  const [workoutDate, setWorkoutDate] = useState(todayString());

  const currentWeek = useMemo(
    () => trainingPlan.weeks.find((week) => week.weekNumber === selectedWeek) ?? trainingPlan.weeks[0],
    [selectedWeek, trainingPlan.weeks],
  );
  const currentDay = useMemo(
    () => currentWeek?.days.find((day) => day.dayNumber === selectedDay) ?? currentWeek?.days[0],
    [currentWeek, selectedDay],
  );

  const existingLog = useMemo(
    () =>
      workoutLogs.find(
        (log) =>
          log.date === workoutDate &&
          log.weekNumber === (currentWeek?.weekNumber ?? 1) &&
          log.dayNumber === (currentDay?.dayNumber ?? 1),
      ),
    [currentDay?.dayNumber, currentWeek?.weekNumber, workoutDate, workoutLogs],
  );
  const recentLogs = useMemo(() => workoutLogs.slice(0, 5), [workoutLogs]);

  const draftKey = `${workoutDate}-${currentWeek?.weekNumber ?? 1}-${currentDay?.dayNumber ?? 1}-${existingLog?.id ?? "new"}`;

  return (
    <div className="space-y-4 pb-20">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("workout")}</p>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("selectorTitle")}</CardTitle>
          <CardDescription>{t("selectorDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="workout-date">{t("date")}</Label>
            <Input
              id="workout-date"
              type="date"
              value={workoutDate}
              disabled={trackerLoading}
              onChange={(event) => setWorkoutDate(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="week-select">{tCommon("week")}</Label>
            <NumericInput
              id="week-select"
              value={currentWeek?.weekNumber ?? 1}
              allowDecimal={false}
              min={1}
              max={trainingPlan.weeks.length}
              disabled={trackerLoading}
              onValueChange={(value) => {
                const matchedWeek = trainingPlan.weeks.find((week) => week.weekNumber === value);
                if (matchedWeek) {
                  setSelectedWeek(matchedWeek.weekNumber);
                  setSelectedDay(matchedWeek.days[0]?.dayNumber ?? 1);
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="day-select">{tCommon("day")}</Label>
            <NumericInput
              id="day-select"
              value={currentDay?.dayNumber ?? 1}
              allowDecimal={false}
              min={1}
              max={currentWeek?.days.length ?? 1}
              disabled={trackerLoading}
              onValueChange={(value) => {
                const matchedDay = currentWeek?.days.find((day) => day.dayNumber === value);
                if (matchedDay) {
                  setSelectedDay(matchedDay.dayNumber);
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("whereSavedTitle")}</CardTitle>
          <CardDescription>{t("whereSavedDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-slate-600">
          <p>{t("whereSavedItemDate")}</p>
          <p>{t("whereSavedItemWeekDay")}</p>
          <p>{t("whereSavedItemDuration")}</p>
          <p>{t("whereSavedItemCompleted")}</p>
          <p>{t("whereSavedItemExercises")}</p>
        </CardContent>
      </Card>

      {currentWeek && currentDay ? (
        <WorkoutDraftForm
          key={draftKey}
          currentWeekNumber={currentWeek.weekNumber}
          currentDay={currentDay}
          workoutDate={workoutDate}
          existingLog={existingLog}
          trainingPlanId={trainingPlan.id}
          trackerLoading={trackerLoading}
          onSave={addWorkoutLog}
        />
      ) : (
        <EmptyState title={t("noDayTitle")} description={t("noDayDesc")} />
      )}

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("recentLogsTitle")}</CardTitle>
          <CardDescription>{t("recentLogsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentLogs.length === 0 ? (
            <EmptyState title={t("recentLogsEmptyTitle")} description={t("recentLogsEmptyDesc")} />
          ) : (
            recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{log.date}</p>
                  <p className="text-xs text-slate-600">
                    {t("recentLogMeta", {
                      week: log.weekNumber,
                      day: log.dayNumber,
                      duration: log.durationMinutes,
                      count: log.exercises.length,
                    })}
                  </p>
                </div>
                <Badge variant={log.completed ? "default" : "outline"}>
                  {log.completed ? t("statusCompleted") : t("statusPending")}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}


