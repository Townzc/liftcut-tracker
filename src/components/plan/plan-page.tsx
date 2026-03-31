"use client";

import { useMemo, useState } from "react";
import { Download, FileJson, Upload } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { downloadJson, readJsonFile, validateTrainingPlan } from "@/lib/import-export";
import { createBlankTrainingPlan } from "@/lib/plan";
import { useTrackerStore } from "@/store/use-tracker-store";

export function PlanPage() {
  const trainingPlan = useTrackerStore((state) => state.trainingPlan);
  const selectedWeek = useTrackerStore((state) => state.selectedWeek);
  const selectedDay = useTrackerStore((state) => state.selectedDay);
  const setSelectedWeek = useTrackerStore((state) => state.setSelectedWeek);
  const setSelectedDay = useTrackerStore((state) => state.setSelectedDay);
  const setTrainingPlan = useTrackerStore((state) => state.setTrainingPlan);

  const [planName, setPlanName] = useState("My Training Plan");
  const [weeksInput, setWeeksInput] = useState(12);
  const [daysInput, setDaysInput] = useState(3);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentWeek = useMemo(
    () => trainingPlan.weeks.find((week) => week.weekNumber === selectedWeek) ?? trainingPlan.weeks[0],
    [selectedWeek, trainingPlan.weeks],
  );
  const currentDay = useMemo(
    () => currentWeek?.days.find((day) => day.dayNumber === selectedDay) ?? currentWeek?.days[0],
    [currentWeek, selectedDay],
  );

  const handleCreatePlan = () => {
    const nextPlan = createBlankTrainingPlan(
      planName.trim() || "My Training Plan",
      Math.min(12, Math.max(1, weeksInput)),
      Math.min(7, Math.max(1, daysInput)),
    );
    setTrainingPlan(nextPlan);
    setMessage("Blank plan created. You can import JSON to replace it.");
    setError(null);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const json = await readJsonFile(file);
      const parsedPlan = validateTrainingPlan(json);
      setTrainingPlan(parsedPlan);
      setMessage("Training plan imported.");
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
      setMessage(null);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">Plan</p>
        <h1 className="text-2xl font-semibold text-slate-900">Training Plan</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{trainingPlan.name}</CardTitle>
            <CardDescription>
              {trainingPlan.weeks.length} weeks total, browse by week/day
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-2 pb-2">
                {trainingPlan.weeks.map((week) => (
                  <Button
                    key={week.weekNumber}
                    type="button"
                    size="sm"
                    variant={week.weekNumber === currentWeek?.weekNumber ? "default" : "outline"}
                    onClick={() => {
                      setSelectedWeek(week.weekNumber);
                      setSelectedDay(week.days[0]?.dayNumber ?? 1);
                    }}
                  >
                    Week {week.weekNumber}
                  </Button>
                ))}
              </div>
            </ScrollArea>

            {currentWeek ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {currentWeek.days.map((day) => (
                    <Button
                      key={day.dayNumber}
                      type="button"
                      size="sm"
                      variant={day.dayNumber === currentDay?.dayNumber ? "default" : "outline"}
                      onClick={() => setSelectedDay(day.dayNumber)}
                    >
                      Day {day.dayNumber}
                    </Button>
                  ))}
                </div>

                {currentDay ? (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{currentDay.title}</h3>
                      <p className="text-sm text-slate-600">{currentDay.notes || "No notes"}</p>
                    </div>

                    <div className="space-y-2">
                      {currentDay.exercises.map((exercise) => (
                        <div
                          key={exercise.id}
                          className="rounded-xl border border-slate-200 bg-slate-50/80 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium text-slate-900">{exercise.name}</p>
                            <Badge variant="outline">RPE {exercise.targetRpe}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">
                            {exercise.sets} sets | {exercise.repRange} reps
                          </p>
                          <p className="mt-1 text-xs text-slate-500">Notes: {exercise.notes || "none"}</p>
                          {exercise.alternativeExercises?.length ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Alternatives: {exercise.alternativeExercises.join(" / ")}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState title="No day found" description="Create or import a plan with day data." />
                )}
              </div>
            ) : (
              <EmptyState title="No week found" description="Create or import a training plan first." />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Plan Management</CardTitle>
            <CardDescription>Create / import / export JSON</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="plan-name">Plan Name</Label>
              <Input
                id="plan-name"
                value={planName}
                onChange={(event) => setPlanName(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="weeks-input">Weeks</Label>
                <Input
                  id="weeks-input"
                  type="number"
                  value={weeksInput}
                  min={1}
                  max={12}
                  onChange={(event) => setWeeksInput(Number(event.target.value) || 1)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="days-input">Days / week</Label>
                <Input
                  id="days-input"
                  type="number"
                  value={daysInput}
                  min={1}
                  max={7}
                  onChange={(event) => setDaysInput(Number(event.target.value) || 1)}
                />
              </div>
            </div>

            <Button type="button" className="w-full" onClick={handleCreatePlan}>
              Create blank plan
            </Button>

            <div className="space-y-2">
              <Label htmlFor="plan-import" className="text-sm">
                Import training plan JSON
              </Label>
              <Input id="plan-import" type="file" accept="application/json" onChange={handleImport} />
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => downloadJson("training-plan-export.json", trainingPlan)}
            >
              <Download className="mr-2 h-4 w-4" />
              Export current plan
            </Button>

            <a
              href="/samples/sample-training-plan.json"
              download
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileJson className="mr-2 h-4 w-4" />
              Download sample JSON
            </a>

            <div className="inline-flex w-full items-center justify-center rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
              <Upload className="mr-2 h-3.5 w-3.5" />
              JSON will be validated with Zod
            </div>

            {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
            {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}