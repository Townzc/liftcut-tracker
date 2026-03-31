"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayString } from "@/lib/date";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { ExerciseLog, PlanDay, WorkoutLog } from "@/types";

function parseNumber(value: string): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function buildExerciseRows(currentDay: PlanDay, existingLog?: WorkoutLog): ExerciseLog[] {
  return currentDay.exercises.map((exercise) => {
    const existingExercise = existingLog?.exercises.find(
      (logExercise) => logExercise.exercisePlanId === exercise.id,
    );

    return {
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
}: {
  currentWeekNumber: number;
  currentDay: PlanDay;
  workoutDate: string;
  existingLog?: WorkoutLog;
  onSave: (payload: Omit<WorkoutLog, "id"> & { id?: string }) => void;
}) {
  const [durationMinutes, setDurationMinutes] = useState(existingLog?.durationMinutes ?? 60);
  const [notes, setNotes] = useState(existingLog?.notes ?? "");
  const [completed, setCompleted] = useState(existingLog?.completed ?? true);
  const [exerciseRows, setExerciseRows] = useState<ExerciseLog[]>(
    buildExerciseRows(currentDay, existingLog),
  );
  const [message, setMessage] = useState<string | null>(null);

  const updateRow = (index: number, patch: Partial<ExerciseLog>) => {
    setExerciseRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const handleSaveWorkout = () => {
    onSave({
      id: existingLog?.id,
      date: workoutDate,
      weekNumber: currentWeekNumber,
      dayNumber: currentDay.dayNumber,
      durationMinutes,
      completed,
      notes,
      exercises: exerciseRows,
    });
    setMessage("Workout log saved. Dashboard updated.");
  };

  return (
    <div className="space-y-3">
      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-lg">{currentDay.title}</CardTitle>
          <CardDescription>{currentDay.notes || "No notes"}</CardDescription>
        </CardHeader>
      </Card>

      {exerciseRows.map((exercise, index) => (
        <Card key={exercise.exercisePlanId} className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{exercise.name}</CardTitle>
            <CardDescription>Exercise {index + 1}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Actual Weight (kg)</Label>
              <Input
                type="number"
                value={exercise.actualWeight}
                onChange={(event) => updateRow(index, { actualWeight: parseNumber(event.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Actual Reps</Label>
              <Input
                type="number"
                value={exercise.actualReps}
                onChange={(event) => updateRow(index, { actualReps: parseNumber(event.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Actual RPE</Label>
              <Input
                type="number"
                value={exercise.actualRpe}
                step="0.1"
                min={0}
                max={10}
                onChange={(event) => updateRow(index, { actualRpe: parseNumber(event.target.value) })}
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Checkbox
                id={`completed-${exercise.exercisePlanId}`}
                checked={exercise.completed}
                onCheckedChange={(checked) => updateRow(index, { completed: checked === true })}
              />
              <Label htmlFor={`completed-${exercise.exercisePlanId}`}>Completed</Label>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">Workout Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                value={durationMinutes}
                min={0}
                onChange={(event) => setDurationMinutes(parseNumber(event.target.value))}
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Checkbox
                id="workout-completed"
                checked={completed}
                onCheckedChange={(checked) => setCompleted(checked === true)}
              />
              <Label htmlFor="workout-completed">Session completed</Label>
            </div>
          </div>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Example: reduced load on final set due fatigue."
          />
        </CardContent>
      </Card>

      <Button className="fixed bottom-24 left-4 right-4 z-20 h-12 md:static md:h-10" onClick={handleSaveWorkout}>
        <Save className="mr-2 h-4 w-4" />
        Save Workout Log
      </Button>

      {message ? (
        <p className="inline-flex items-center text-sm text-emerald-700">
          <CheckCircle2 className="mr-1 h-4 w-4" />
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function WorkoutPage() {
  const trainingPlan = useTrackerStore((state) => state.trainingPlan);
  const workoutLogs = useTrackerStore((state) => state.workoutLogs);
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

  const draftKey = `${workoutDate}-${currentWeek?.weekNumber ?? 1}-${currentDay?.dayNumber ?? 1}-${existingLog?.id ?? "new"}`;

  return (
    <div className="space-y-4 pb-20">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">Workout</p>
        <h1 className="text-2xl font-semibold text-slate-900">Workout Logging</h1>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">Session Selector</CardTitle>
          <CardDescription>Pick date, week, and day before entering logs</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="workout-date">Date</Label>
            <Input
              id="workout-date"
              type="date"
              value={workoutDate}
              onChange={(event) => setWorkoutDate(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="week-select">Week</Label>
            <Input
              id="week-select"
              type="number"
              value={currentWeek?.weekNumber ?? 1}
              min={1}
              max={trainingPlan.weeks.length}
              onChange={(event) => {
                const value = Number(event.target.value) || 1;
                const matchedWeek = trainingPlan.weeks.find((week) => week.weekNumber === value);
                if (matchedWeek) {
                  setSelectedWeek(matchedWeek.weekNumber);
                  setSelectedDay(matchedWeek.days[0]?.dayNumber ?? 1);
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="day-select">Day</Label>
            <Input
              id="day-select"
              type="number"
              value={currentDay?.dayNumber ?? 1}
              min={1}
              max={currentWeek?.days.length ?? 1}
              onChange={(event) => {
                const value = Number(event.target.value) || 1;
                const matchedDay = currentWeek?.days.find((day) => day.dayNumber === value);
                if (matchedDay) {
                  setSelectedDay(matchedDay.dayNumber);
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {currentWeek && currentDay ? (
        <WorkoutDraftForm
          key={draftKey}
          currentWeekNumber={currentWeek.weekNumber}
          currentDay={currentDay}
          workoutDate={workoutDate}
          existingLog={existingLog}
          onSave={addWorkoutLog}
        />
      ) : (
        <EmptyState title="No training day found" description="Create or import a plan first." />
      )}
    </div>
  );
}