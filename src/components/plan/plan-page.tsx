"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, FileJson, LoaderCircle, Pencil, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { NumericInput } from "@/components/shared/numeric-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { downloadJson } from "@/lib/import-export";
import {
  CHINESE_PLAN_TEXT_TEMPLATE,
  ENGLISH_PLAN_TEXT_TEMPLATE,
} from "@/lib/plan-parser";
import { createBlankTrainingPlan } from "@/lib/plan";
import { normalizeActionError } from "@/lib/error-utils";
import { exportTrainingPlanPdf } from "@/services/plan-export";
import { planImportService } from "@/services/plan-import";
import { useTrackerStore } from "@/store/use-tracker-store";
import { useUIStore } from "@/store/use-ui-store";
import type { TrainingPlan } from "@/types";

type PlanAction =
  | "create"
  | "delete-plan"
  | "export-pdf"
  | "export-json"
  | "parse"
  | "save-parsed"
  | "save-edited"
  | "set-active";

function getLocalizedParseReason(
  reason: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (reason === "empty_input") {
    return t("reasonEmptyInput");
  }

  if (reason === "missing_sets") {
    return t("reasonMissingSets");
  }

  if (reason === "missing_rep_range") {
    return t("reasonMissingRepRange");
  }

  if (reason === "invalid_rpe") {
    return t("reasonInvalidRpe");
  }

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

  const language = useUIStore((state) => state.language);

  const trainingPlan = useTrackerStore((state) => state.trainingPlan);
  const trainingPlanList = useTrackerStore((state) => state.trainingPlanList);
  const selectedWeek = useTrackerStore((state) => state.selectedWeek);
  const selectedDay = useTrackerStore((state) => state.selectedDay);
  const trackerLoading = useTrackerStore((state) => state.loading);
  const ensureUserId = useTrackerStore((state) => state.ensureUserId);
  const setSelectedWeek = useTrackerStore((state) => state.setSelectedWeek);
  const setSelectedDay = useTrackerStore((state) => state.setSelectedDay);
  const setTrainingPlan = useTrackerStore((state) => state.setTrainingPlan);
  const setActivePlan = useTrackerStore((state) => state.setActivePlan);
  const deleteTrainingPlan = useTrackerStore((state) => state.deleteTrainingPlan);

  const [planName, setPlanName] = useState("");
  const [weeksInput, setWeeksInput] = useState(12);
  const [daysInput, setDaysInput] = useState(3);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [textPlanInput, setTextPlanInput] = useState("");
  const [parsedPlanDraft, setParsedPlanDraft] = useState<TrainingPlan | null>(null);
  const [editablePlanDraft, setEditablePlanDraft] = useState<TrainingPlan | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parseErrors, setParseErrors] = useState<Array<{ lineNumber: number; content: string; reason: string }>>([]);

  const [loadingAction, setLoadingAction] = useState<PlanAction | null>(null);
  const [activePlanLoadingId, setActivePlanLoadingId] = useState<string | null>(null);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  const activePlanForView = isEditMode && editablePlanDraft ? editablePlanDraft : trainingPlan;
  const currentWeek = useMemo(
    () => activePlanForView.weeks.find((week) => week.weekNumber === selectedWeek) ?? activePlanForView.weeks[0],
    [activePlanForView.weeks, selectedWeek],
  );
  const currentDay = useMemo(
    () => currentWeek?.days.find((day) => day.dayNumber === selectedDay) ?? currentWeek?.days[0],
    [currentWeek, selectedDay],
  );

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const handleCreatePlan = async () => {
    setLoadingAction("create");
    clearFeedback();

    try {
      const resolvedUserId = await ensureUserId();

      const normalizedWeeks = Math.min(12, Math.max(1, weeksInput || 1));
      const normalizedDays = Math.min(7, Math.max(1, daysInput || 1));
      const defaultPlanName = language === "zh-CN" ? "新训练计划" : "Untitled Plan";

      const nextPlan = createBlankTrainingPlan(
        resolvedUserId,
        planName.trim() || defaultPlanName,
        normalizedWeeks,
        normalizedDays,
      );

      await setTrainingPlan(nextPlan);
      setSelectedWeek(1);
      setSelectedDay(1);
      setMessage(t("blankCreated"));
      setParsedPlanDraft(null);
      setParseWarnings([]);
      setParseErrors([]);
    } catch (createError) {
      console.error(createError);
      setError(
        normalizeActionError(createError, {
          fallback: t("createFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleExportPdf = async () => {
    setLoadingAction("export-pdf");
    clearFeedback();

    try {
      if (trainingPlan.weeks.length === 0) {
        throw new Error(t("exportPdfNoPlan"));
      }
      await exportTrainingPlanPdf(trainingPlan, language);
      setMessage(t("exportPdfSuccess"));
    } catch (exportError) {
      console.error(exportError);
      setError(exportError instanceof Error ? exportError.message : t("exportPdfFailed"));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleExportJson = async () => {
    setLoadingAction("export-json");
    clearFeedback();

    try {
      downloadJson("training-plan-export.json", trainingPlan);
      setMessage(t("exportJsonSuccess"));
    } catch (exportError) {
      console.error(exportError);
      setError(exportError instanceof Error ? exportError.message : t("exportJsonFailed"));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleParseText = async () => {
    setLoadingAction("parse");
    clearFeedback();

    try {
      if (!textPlanInput.trim()) {
        throw new Error(t("reasonEmptyInput"));
      }

      const resolvedUserId = await ensureUserId();
      const result = planImportService.parseFromText(textPlanInput, {
        userId: resolvedUserId,
        planName: planName.trim() || (language === "zh-CN" ? "文本导入计划" : "Imported Text Plan"),
      });

      setParseWarnings(result.warnings);
      setParseErrors(result.errors);

      if (!result.plan) {
        setParsedPlanDraft(null);
        setError(t("parseFailed"));
        return;
      }

      setParsedPlanDraft(result.plan);
      setMessage(t("parseSuccess"));
    } catch (parseError) {
      console.error(parseError);
      setParsedPlanDraft(null);
      setError(
        normalizeActionError(parseError, {
          fallback: t("parseFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
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
    setLoadingAction("save-parsed");
    clearFeedback();

    try {
      if (!parsedPlanDraft) {
        throw new Error(t("previewMissing"));
      }

      await setTrainingPlan(parsedPlanDraft);
      setSelectedWeek(1);
      setSelectedDay(1);
      setMessage(t("saveParsedSuccess"));
    } catch (saveError) {
      console.error(saveError);
      setError(
        normalizeActionError(saveError, {
          fallback: t("saveParsedFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSetActivePlan = async (planId: string) => {
    setActivePlanLoadingId(planId);
    clearFeedback();

    try {
      await setActivePlan(planId);
      setMessage(t("setActiveSuccess"));
    } catch (setActiveError) {
      console.error(setActiveError);
      setError(
        normalizeActionError(setActiveError, {
          fallback: t("setActiveFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setActivePlanLoadingId(null);
    }
  };

  const handleDeletePlan = async (planId: string) => {
    clearFeedback();

    const confirmed = window.confirm(t("deleteConfirm"));
    if (!confirmed) {
      return;
    }

    setLoadingAction("delete-plan");
    setDeletingPlanId(planId);

    try {
      await deleteTrainingPlan(planId);
      setMessage(t("deleteSuccess"));
    } catch (deleteError) {
      console.error(deleteError);
      setError(
        normalizeActionError(deleteError, {
          fallback: t("deleteFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setDeletingPlanId(null);
      setLoadingAction(null);
    }
  };

  const clonePlan = (plan: TrainingPlan): TrainingPlan => {
    if (typeof structuredClone === "function") {
      return structuredClone(plan);
    }

    return JSON.parse(JSON.stringify(plan)) as TrainingPlan;
  };

  const enterEditMode = () => {
    if (trainingPlan.weeks.length === 0) {
      setError(t("editNoPlan"));
      return;
    }

    clearFeedback();
    setEditablePlanDraft(clonePlan(trainingPlan));
    setIsEditMode(true);
  };

  const cancelEditMode = () => {
    setEditablePlanDraft(null);
    setIsEditMode(false);
    setMessage(t("editCancelled"));
  };

  const updateEditablePlan = (updater: (draft: TrainingPlan) => TrainingPlan) => {
    setEditablePlanDraft((prev) => {
      if (!prev) {
        return prev;
      }

      return updater(prev);
    });
  };

  const updateEditableExercise = (
    weekNumber: number,
    dayNumber: number,
    exerciseId: string,
    patch: Partial<TrainingPlan["weeks"][number]["days"][number]["exercises"][number]>,
  ) => {
    updateEditablePlan((draft) => ({
      ...draft,
      weeks: draft.weeks.map((week) =>
        week.weekNumber !== weekNumber
          ? week
          : {
              ...week,
              days: week.days.map((day) =>
                day.dayNumber !== dayNumber
                  ? day
                  : {
                      ...day,
                      exercises: day.exercises.map((exercise) =>
                        exercise.id === exerciseId ? { ...exercise, ...patch } : exercise,
                      ),
                    },
              ),
            },
      ),
    }));
  };

  const addEditableExercise = (weekNumber: number, dayNumber: number) => {
    updateEditablePlan((draft) => {
      const nextId = `ex-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;

      return {
        ...draft,
        weeks: draft.weeks.map((week) =>
          week.weekNumber !== weekNumber
            ? week
            : {
                ...week,
                days: week.days.map((day) =>
                  day.dayNumber !== dayNumber
                    ? day
                    : {
                        ...day,
                        exercises: [
                          ...day.exercises,
                          {
                            id: nextId,
                            dayId: day.id,
                            name: "",
                            sets: 3,
                            repRange: "8-10",
                            targetRpe: 7,
                            notes: "",
                            alternativeExercises: [],
                          },
                        ],
                      },
                ),
              },
        ),
      };
    });
  };

  const removeEditableExercise = (weekNumber: number, dayNumber: number, exerciseId: string) => {
    const confirmed = window.confirm(t("deleteExerciseConfirm"));
    if (!confirmed) {
      return;
    }

    updateEditablePlan((draft) => ({
      ...draft,
      weeks: draft.weeks.map((week) =>
        week.weekNumber !== weekNumber
          ? week
          : {
              ...week,
              days: week.days.map((day) =>
                day.dayNumber !== dayNumber
                  ? day
                  : {
                      ...day,
                      exercises: day.exercises.filter((exercise) => exercise.id !== exerciseId),
                    },
              ),
            },
      ),
    }));
  };

  const saveEditablePlan = async () => {
    setLoadingAction("save-edited");
    clearFeedback();

    try {
      if (!editablePlanDraft) {
        throw new Error(t("editMissingDraft"));
      }

      const normalizedName = editablePlanDraft.name.trim();
      if (!normalizedName) {
        throw new Error(t("editNameRequired"));
      }

      const normalizedPlan: TrainingPlan = {
        ...editablePlanDraft,
        name: normalizedName,
        notes: editablePlanDraft.notes || "",
        updatedAt: new Date().toISOString(),
      };

      await setTrainingPlan(normalizedPlan);
      setEditablePlanDraft(null);
      setIsEditMode(false);
      setMessage(t("editSaved"));
    } catch (saveError) {
      console.error(saveError);
      setError(
        normalizeActionError(saveError, {
          fallback: t("editSaveFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const renderLoadingIcon = (condition: boolean) =>
    condition ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null;
  const isBusy = loadingAction !== null || trackerLoading;
  const hasPlan = trainingPlan.weeks.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("plan")}</p>
          <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        </div>
        <div className="flex max-w-xs flex-col items-stretch gap-2 sm:items-end">
          <p className="text-xs text-slate-500 sm:text-right">{t("aiEntryDesc")}</p>
          <Link href="/plan/ai" className={buttonVariants()}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("aiEntry")}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{hasPlan ? activePlanForView.name : t("noActivePlanName")}</CardTitle>
            <CardDescription>
              {t("weeksTotal", { count: activePlanForView.weeks.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {isEditMode ? (
                <>
                  <Button
                    type="button"
                    onClick={saveEditablePlan}
                    disabled={isBusy || !editablePlanDraft}
                  >
                    {renderLoadingIcon(loadingAction === "save-edited")}
                    <Save className="mr-2 h-4 w-4" />
                    {loadingAction === "save-edited" ? t("editSaving") : t("editSave")}
                  </Button>
                  <Button type="button" variant="outline" onClick={cancelEditMode} disabled={isBusy}>
                    <X className="mr-2 h-4 w-4" />
                    {t("editCancel")}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="outline" onClick={enterEditMode} disabled={isBusy || !hasPlan}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("editMode")}
                </Button>
              )}
            </div>

            {isEditMode && editablePlanDraft ? (
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="edit-plan-name">{t("planName")}</Label>
                  <Input
                    id="edit-plan-name"
                    value={editablePlanDraft.name}
                    onChange={(event) =>
                      updateEditablePlan((draft) => ({ ...draft, name: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="edit-plan-notes">{t("planNotes")}</Label>
                  <Textarea
                    id="edit-plan-notes"
                    rows={2}
                    value={editablePlanDraft.notes || ""}
                    onChange={(event) =>
                      updateEditablePlan((draft) => ({ ...draft, notes: event.target.value }))
                    }
                  />
                </div>
              </div>
            ) : null}

            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-2 pb-2">
                {activePlanForView.weeks.map((week) => (
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
                      {isEditMode && editablePlanDraft ? (
                        <div className="space-y-2">
                          <Label htmlFor="edit-day-title">{t("dayTitle")}</Label>
                          <Input
                            id="edit-day-title"
                            value={currentDay.title}
                            onChange={(event) =>
                              updateEditablePlan((draft) => ({
                                ...draft,
                                weeks: draft.weeks.map((week) =>
                                  week.weekNumber !== currentWeek.weekNumber
                                    ? week
                                    : {
                                        ...week,
                                        days: week.days.map((day) =>
                                          day.dayNumber !== currentDay.dayNumber
                                            ? day
                                            : {
                                                ...day,
                                                title: event.target.value,
                                              },
                                        ),
                                      },
                                ),
                              }))
                            }
                          />
                          <Label htmlFor="edit-day-notes">{t("dayNotes")}</Label>
                          <Textarea
                            id="edit-day-notes"
                            rows={2}
                            value={currentDay.notes || ""}
                            onChange={(event) =>
                              updateEditablePlan((draft) => ({
                                ...draft,
                                weeks: draft.weeks.map((week) =>
                                  week.weekNumber !== currentWeek.weekNumber
                                    ? week
                                    : {
                                        ...week,
                                        days: week.days.map((day) =>
                                          day.dayNumber !== currentDay.dayNumber
                                            ? day
                                            : {
                                                ...day,
                                                notes: event.target.value,
                                              },
                                        ),
                                      },
                                ),
                              }))
                            }
                          />
                        </div>
                      ) : (
                        <>
                          <h3 className="text-lg font-semibold text-slate-900">{currentDay.title}</h3>
                          <p className="text-sm text-slate-600">{currentDay.notes || "-"}</p>
                        </>
                      )}
                    </div>

                    <div className="space-y-2">
                      {currentDay.exercises.length === 0 ? (
                        <EmptyState title={t("emptyExercisesTitle")} description={t("emptyExercisesDesc")} />
                      ) : (
                        currentDay.exercises.map((exercise) => (
                          <div
                            key={exercise.id}
                            className="rounded-xl border border-slate-200 bg-slate-50/80 p-3"
                          >
                            {isEditMode && editablePlanDraft ? (
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div className="space-y-1 sm:col-span-2">
                                  <Label>{t("exerciseName")}</Label>
                                  <Input
                                    value={exercise.name}
                                    onChange={(event) =>
                                      updateEditableExercise(currentWeek.weekNumber, currentDay.dayNumber, exercise.id, {
                                        name: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>{t("exerciseSets")}</Label>
                                  <NumericInput
                                    value={exercise.sets}
                                    allowDecimal={false}
                                    min={1}
                                    max={20}
                                    onValueChange={(value) =>
                                      updateEditableExercise(currentWeek.weekNumber, currentDay.dayNumber, exercise.id, {
                                        sets: value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>{t("exerciseRepRange")}</Label>
                                  <Input
                                    value={exercise.repRange}
                                    onChange={(event) =>
                                      updateEditableExercise(currentWeek.weekNumber, currentDay.dayNumber, exercise.id, {
                                        repRange: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>{t("exerciseRpe")}</Label>
                                  <NumericInput
                                    value={exercise.targetRpe}
                                    step="0.1"
                                    min={1}
                                    max={10}
                                    onValueChange={(value) =>
                                      updateEditableExercise(currentWeek.weekNumber, currentDay.dayNumber, exercise.id, {
                                        targetRpe: value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1 sm:col-span-2">
                                  <Label>{t("exerciseNotes")}</Label>
                                  <Input
                                    value={exercise.notes || ""}
                                    onChange={(event) =>
                                      updateEditableExercise(currentWeek.weekNumber, currentDay.dayNumber, exercise.id, {
                                        notes: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1 sm:col-span-2">
                                  <Label>{t("exerciseAlternatives")}</Label>
                                  <Input
                                    value={(exercise.alternativeExercises ?? []).join(", ")}
                                    onChange={(event) =>
                                      updateEditableExercise(currentWeek.weekNumber, currentDay.dayNumber, exercise.id, {
                                        alternativeExercises: event.target.value
                                          .split(",")
                                          .map((item) => item.trim())
                                          .filter(Boolean),
                                      })
                                    }
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="text-rose-700"
                                    onClick={() =>
                                      removeEditableExercise(currentWeek.weekNumber, currentDay.dayNumber, exercise.id)
                                    }
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    {t("deleteExercise")}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
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
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {isEditMode ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => addEditableExercise(currentWeek.weekNumber, currentDay.dayNumber)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {t("addExercise")}
                      </Button>
                    ) : null}
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
            <Link
              href="/plan/ai"
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              {t("aiEntry")}
            </Link>

            <div className="space-y-2">
              <Label htmlFor="plan-name">{t("planName")}</Label>
              <Input id="plan-name" value={planName} onChange={(event) => setPlanName(event.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="weeks-input">{t("weeks")}</Label>
                <NumericInput
                  id="weeks-input"
                  value={weeksInput}
                  allowDecimal={false}
                  min={1}
                  max={12}
                  onValueChange={(value) => setWeeksInput(value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="days-input">{t("daysPerWeek")}</Label>
                <NumericInput
                  id="days-input"
                  value={daysInput}
                  allowDecimal={false}
                  min={1}
                  max={7}
                  onValueChange={(value) => setDaysInput(value)}
                />
              </div>
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={handleCreatePlan}
              disabled={isBusy}
            >
              {renderLoadingIcon(loadingAction === "create")}
              {loadingAction === "create" ? t("creating") : t("createBlank")}
            </Button>

            <Button
              type="button"
              className="w-full"
              onClick={handleExportPdf}
              disabled={isBusy || !hasPlan}
            >
              {renderLoadingIcon(loadingAction === "export-pdf")}
              <Download className="mr-2 h-4 w-4" />
              {loadingAction === "export-pdf" ? t("exportingPdf") : t("exportPdf")}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleExportJson}
              disabled={isBusy}
            >
              {renderLoadingIcon(loadingAction === "export-json")}
              <FileJson className="mr-2 h-4 w-4" />
              {loadingAction === "export-json" ? t("exportingJson") : t("exportCurrent")}
            </Button>

            {!hasPlan ? <p className="text-xs text-slate-500">{t("exportPdfNoPlan")}</p> : null}

            {trainingPlanList.length > 0 ? (
              <div className="space-y-2">
                {trainingPlanList.map((planItem) => (
                  <div
                    key={planItem.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/70 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant={planItem.isActive ? "default" : "outline"}
                        className="flex-1 justify-start"
                        onClick={() => handleSetActivePlan(planItem.id)}
                        disabled={isBusy || activePlanLoadingId !== null}
                      >
                        {renderLoadingIcon(activePlanLoadingId === planItem.id)}
                        {planItem.name}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeletePlan(planItem.id)}
                        disabled={isBusy || deletingPlanId !== null}
                        aria-label={tCommon("delete")}
                      >
                        {deletingPlanId === planItem.id ? (
                          <LoaderCircle className="h-4 w-4 animate-spin text-rose-600" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        )}
                      </Button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {planItem.isActive ? t("activePlanTag") : t("inactivePlanTag")}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">{t("plansEmpty")}</p>
            )}

            <ActionFeedback message={message} error={error} />
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setTextPlanInput(CHINESE_PLAN_TEXT_TEMPLATE)}
              disabled={isBusy}
            >
              {t("loadTemplateZh")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTextPlanInput(ENGLISH_PLAN_TEXT_TEMPLATE)}
              disabled={isBusy}
            >
              {t("loadTemplateEn")}
            </Button>
            <Button type="button" onClick={handleParseText} disabled={isBusy}>
              {renderLoadingIcon(loadingAction === "parse")}
              {loadingAction === "parse" ? t("parsing") : t("parseButton")}
            </Button>
          </div>

          <div className="space-y-2">
            <Label>{t("textInputLabel")}</Label>
            <Textarea
              value={textPlanInput}
              onChange={(event) => setTextPlanInput(event.target.value)}
              rows={12}
              placeholder={language === "zh-CN" ? CHINESE_PLAN_TEXT_TEMPLATE : ENGLISH_PLAN_TEXT_TEMPLATE}
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
                            <NumericInput
                              value={exercise.sets}
                              allowDecimal={false}
                              min={1}
                              onValueChange={(value) =>
                                updateDraftExercise(weekIndex, dayIndex, exerciseIndex, {
                                  sets: value,
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
                            <NumericInput
                              step="0.1"
                              value={exercise.targetRpe}
                              min={1}
                              max={10}
                              onValueChange={(value) =>
                                updateDraftExercise(weekIndex, dayIndex, exerciseIndex, {
                                  targetRpe: value,
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

              <Button type="button" onClick={handleSaveParsedPlan} disabled={isBusy}>
                {renderLoadingIcon(loadingAction === "save-parsed")}
                {loadingAction === "save-parsed" ? t("savingParsed") : t("saveParsed")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
