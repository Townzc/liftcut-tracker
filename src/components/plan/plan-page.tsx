"use client";

import { useMemo, useState } from "react";
import { Download, FileJson, Upload } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { downloadJson, readJsonFile, validateTrainingPlan } from "@/lib/import-export";
import { createBlankTrainingPlan } from "@/lib/plan";
import { PLAN_TEXT_TEMPLATE } from "@/lib/plan-parser";
import { planImportService } from "@/services/plan-import";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { TrainingPlan } from "@/types";

function parseNumber(value: string): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function getLocalizedParseReason(
  reason: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (reason === "unrecognized_line_format") {
    return t("reasonUnrecognizedLine");
  }

  if (reason === "no_valid_structure") {
    return t("reasonNoValidStructure");
  }

  return reason;
}

function getLocalizedParseWarning(
  warning: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (warning.startsWith("missing_rpe|")) {
    const line = Number(warning.split("|")[1] ?? 0);
    return t("warningMissingRpe", { line });
  }

  return warning;
}

export function PlanPage() {
  const t = useTranslations("plan");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");

  const trainingPlan = useTrackerStore((state) => state.trainingPlan);
  const trainingPlanList = useTrackerStore((state) => state.trainingPlanList);
  const selectedWeek = useTrackerStore((state) => state.selectedWeek);
  const selectedDay = useTrackerStore((state) => state.selectedDay);
  const userId = useTrackerStore((state) => state.userId);
  const setSelectedWeek = useTrackerStore((state) => state.setSelectedWeek);
  const setSelectedDay = useTrackerStore((state) => state.setSelectedDay);
  const setTrainingPlan = useTrackerStore((state) => state.setTrainingPlan);
  const setActivePlan = useTrackerStore((state) => state.setActivePlan);

  const [planName, setPlanName] = useState("My Training Plan");
  const [weeksInput, setWeeksInput] = useState(12);
  const [daysInput, setDaysInput] = useState(3);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [textPlanInput, setTextPlanInput] = useState("");
  const [parsedPlanDraft, setParsedPlanDraft] = useState<TrainingPlan | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parseErrors, setParseErrors] = useState<Array<{ lineNumber: number; content: string; reason: string }>>([]);

  const currentWeek = useMemo(
    () => trainingPlan.weeks.find((week) => week.weekNumber === selectedWeek) ?? trainingPlan.weeks[0],
    [selectedWeek, trainingPlan.weeks],
  );
  const currentDay = useMemo(
    () => currentWeek?.days.find((day) => day.dayNumber === selectedDay) ?? currentWeek?.days[0],
    [currentWeek, selectedDay],
  );

  const handleCreatePlan = async () => {
    if (!userId) {
      return;
    }

    const nextPlan = createBlankTrainingPlan(
      userId,
      planName.trim() || "My Training Plan",
      Math.min(12, Math.max(1, weeksInput)),
      Math.min(7, Math.max(1, daysInput)),
    );

    await setTrainingPlan(nextPlan);
    setMessage(t("blankCreated"));
    setError(null);
  };

  const handleImportJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !userId) {
      return;
    }

    try {
      const json = await readJsonFile(file);
      const parsedPlan = validateTrainingPlan(json, { userId });
      await setTrainingPlan(parsedPlan);
      setMessage(t("importSuccess"));
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t("importFailed"));
      setMessage(null);
    } finally {
      event.target.value = "";
    }
  };

  const handleParseText = () => {
    if (!userId) {
      return;
    }

    const result = planImportService.parseFromText(textPlanInput, {
      userId,
      planName: planName.trim() || "Imported Text Plan",
    });

    setParseWarnings(result.warnings);
    setParseErrors(result.errors);

    if (!result.plan) {
      setParsedPlanDraft(null);
      setError(t("parseFailed"));
      setMessage(null);
      return;
    }

    setParsedPlanDraft(result.plan);
    setMessage(t("parseSuccess"));
    setError(null);
  };

  const updateDraftExercise = (
    weekIndex: number,
    dayIndex: number,
    exerciseIndex: number,
    patch: Partial<TrainingPlan["weeks"][number]["days"][number]["exercises"][number]>,
  ) => {
    setParsedPlanDraft((prev) => {
      if (!prev) {
        return prev;
      }

      const weeks = [...prev.weeks];
      const week = { ...weeks[weekIndex] };
      const days = [...week.days];
      const day = { ...days[dayIndex] };
      const exercises = [...day.exercises];
      exercises[exerciseIndex] = { ...exercises[exerciseIndex], ...patch };
      day.exercises = exercises;
      days[dayIndex] = day;
      week.days = days;
      weeks[weekIndex] = week;

      return { ...prev, weeks };
    });
  };

  const handleSaveParsedPlan = async () => {
    if (!parsedPlanDraft) {
      return;
    }

    await setTrainingPlan(parsedPlanDraft);
    setMessage(t("importSuccess"));
    setError(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("plan")}</p>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{trainingPlan.name}</CardTitle>
            <CardDescription>
              {t("weeksTotal", { count: trainingPlan.weeks.length })}
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
                    {tCommon("week")} {week.weekNumber}
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
                      {tCommon("day")} {day.dayNumber}
                    </Button>
                  ))}
                </div>

                {currentDay ? (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{currentDay.title}</h3>
                      <p className="text-sm text-slate-600">{currentDay.notes || "-"}</p>
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
                            {t("setsReps", { sets: exercise.sets, repRange: exercise.repRange })}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {t("notes", { value: exercise.notes || "-" })}
                          </p>
                          {exercise.alternativeExercises?.length ? (
                            <p className="mt-1 text-xs text-slate-500">
                              {t("alternatives", { value: exercise.alternativeExercises.join(" / ") })}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState title={t("dayMissingTitle")} description={t("dayMissingDesc")} />
                )}
              </div>
            ) : (
              <EmptyState title={t("weekMissingTitle")} description={t("weekMissingDesc")} />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{t("manageTitle")}</CardTitle>
            <CardDescription>{t("manageDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="plan-name">{t("planName")}</Label>
              <Input id="plan-name" value={planName} onChange={(event) => setPlanName(event.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="weeks-input">{t("weeks")}</Label>
                <Input
                  id="weeks-input"
                  type="number"
                  value={weeksInput}
                  min={1}
                  max={12}
                  onChange={(event) => setWeeksInput(parseNumber(event.target.value) || 1)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="days-input">{t("daysPerWeek")}</Label>
                <Input
                  id="days-input"
                  type="number"
                  value={daysInput}
                  min={1}
                  max={7}
                  onChange={(event) => setDaysInput(parseNumber(event.target.value) || 1)}
                />
              </div>
            </div>

            <Button type="button" className="w-full" onClick={handleCreatePlan}>
              {t("createBlank")}
            </Button>

            <div className="space-y-2">
              <Label htmlFor="plan-import" className="text-sm">
                {t("importJson")}
              </Label>
              <Input id="plan-import" type="file" accept="application/json" onChange={handleImportJson} />
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => downloadJson("training-plan-export.json", trainingPlan)}
            >
              <Download className="mr-2 h-4 w-4" />
              {t("exportCurrent")}
            </Button>

            <a
              href="/samples/sample-training-plan.json"
              download
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileJson className="mr-2 h-4 w-4" />
              {t("downloadSample")}
            </a>

            <div className="inline-flex w-full items-center justify-center rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
              <Upload className="mr-2 h-3.5 w-3.5" />
              {t("validationHint")}
            </div>

            {trainingPlanList.length > 0 ? (
              <div className="space-y-2">
                {trainingPlanList.map((planItem) => (
                  <Button
                    key={planItem.id}
                    type="button"
                    variant={planItem.isActive ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => setActivePlan(planItem.id)}
                  >
                    {planItem.name}
                  </Button>
                ))}
              </div>
            ) : null}

            {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
            {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("textImportTitle")}</CardTitle>
          <CardDescription>{t("textImportDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setTextPlanInput(PLAN_TEXT_TEMPLATE)}>
              {t("loadTemplate")}
            </Button>
            <Button type="button" onClick={handleParseText}>
              {t("parseButton")}
            </Button>
          </div>

          <div className="space-y-2">
            <Label>{t("textInputLabel")}</Label>
            <Textarea
              value={textPlanInput}
              onChange={(event) => setTextPlanInput(event.target.value)}
              rows={12}
              placeholder={PLAN_TEXT_TEMPLATE}
            />
          </div>

          {parseWarnings.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {parseWarnings.map((warning) => (
                <p key={warning}>{getLocalizedParseWarning(warning, t)}</p>
              ))}
            </div>
          ) : null}

          {parseErrors.length > 0 ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <p className="mb-1 font-medium">{t("parseErrors")}</p>
              {parseErrors.map((parseIssue) => (
                <p key={`${parseIssue.lineNumber}-${parseIssue.content}`}>
                  {t("lineError", {
                    line: parseIssue.lineNumber,
                    reason: getLocalizedParseReason(parseIssue.reason, t),
                  })}
                </p>
              ))}
            </div>
          ) : null}

          {parsedPlanDraft ? (
            <div className="space-y-3">
              <h3 className="text-base font-semibold">{t("previewTitle")}</h3>
              {parsedPlanDraft.weeks.map((week, weekIndex) => (
                <Card key={week.id} className="border-slate-200/80 bg-slate-50/60">
                  <CardHeader>
                    <CardTitle className="text-sm">{tCommon("week")} {week.weekNumber}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {week.days.map((day, dayIndex) => (
                      <div key={day.id} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-sm font-medium">
                          {tCommon("day")} {day.dayNumber}: {day.title}
                        </p>
                        {day.exercises.map((exercise, exerciseIndex) => (
                          <div key={exercise.id} className="grid gap-2 sm:grid-cols-7">
                            <Input
                              className="sm:col-span-2"
                              value={exercise.name}
                              onChange={(event) =>
                                updateDraftExercise(weekIndex, dayIndex, exerciseIndex, {
                                  name: event.target.value,
                                })
                              }
                            />
                            <Input
                              type="number"
                              value={exercise.sets}
                              onChange={(event) =>
                                updateDraftExercise(weekIndex, dayIndex, exerciseIndex, {
                                  sets: parseNumber(event.target.value),
                                })
                              }
                            />
                            <Input
                              value={exercise.repRange}
                              onChange={(event) =>
                                updateDraftExercise(weekIndex, dayIndex, exerciseIndex, {
                                  repRange: event.target.value,
                                })
                              }
                            />
                            <Input
                              type="number"
                              step="0.1"
                              value={exercise.targetRpe}
                              onChange={(event) =>
                                updateDraftExercise(weekIndex, dayIndex, exerciseIndex, {
                                  targetRpe: parseNumber(event.target.value),
                                })
                              }
                            />
                            <Input
                              value={exercise.notes}
                              onChange={(event) =>
                                updateDraftExercise(weekIndex, dayIndex, exerciseIndex, {
                                  notes: event.target.value,
                                })
                              }
                            />
                            <Input
                              value={(exercise.alternativeExercises ?? []).join(", ")}
                              onChange={(event) =>
                                updateDraftExercise(weekIndex, dayIndex, exerciseIndex, {
                                  alternativeExercises: event.target.value
                                    .split(",")
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}

              <Button type="button" onClick={handleSaveParsedPlan}>
                {t("saveParsed")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

