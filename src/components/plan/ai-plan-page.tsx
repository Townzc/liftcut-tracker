"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Copy, LoaderCircle, Plus, Save, Sparkles, Trash2 } from "lucide-react";

import { NumericInput } from "@/components/shared/numeric-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  aiNutritionPlanSchema,
  aiTrainingPlanSchema,
  type AiNutritionPlan,
  type AiTrainingPlan,
} from "@/lib/ai/schemas";
import { normalizeActionError } from "@/lib/error-utils";
import { useTrackerStore } from "@/store/use-tracker-store";
import { useUIStore } from "@/store/use-ui-store";
import type { DietPreference, FitnessGoal, TrainingLocation } from "@/types";

type LoadingState =
  | null
  | "history"
  | "training"
  | "nutrition"
  | "save-training"
  | "save-nutrition"
  | "apply-training-json"
  | "apply-nutrition-json";

interface HistoryItem {
  id: string;
  model_name: string;
  prompt_version: string;
  status: string;
  parsed_plan_json: unknown;
  error_message?: string | null;
  created_at: string;
}

interface HistoryResponse {
  ok: boolean;
  aiConfigured: boolean;
  training: HistoryItem[];
  nutrition: HistoryItem[];
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeList(input: string): string[] {
  return input
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCommaList(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || data.ok === false) {
    const requestError = new Error(String(data.message || "Request failed.")) as Error & {
      code?: string;
      detail?: string;
    };
    requestError.code = typeof data.error === "string" ? data.error : undefined;
    requestError.detail = typeof data.detail === "string" ? data.detail : undefined;
    throw requestError;
  }

  return data;
}

export function AiPlanPage() {
  const t = useTranslations("ai");
  const tNav = useTranslations("nav");
  const tNutrition = useTranslations("nutrition");
  const locale = useLocale();
  const settings = useTrackerStore((state) => state.settings);
  const refreshUserData = useTrackerStore((state) => state.refreshUserData);
  const language = useUIStore((state) => state.language);
  const requestLocale = locale === "zh-CN" || locale === "en" ? locale : language;

  const [goalType, setGoalType] = useState<FitnessGoal>(settings.fitnessGoal);
  const [weeklyTrainingDays, setWeeklyTrainingDays] = useState(settings.weeklyTrainingDays || 3);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(settings.sessionDurationMinutes || 60);
  const [trainingLocation, setTrainingLocation] = useState<TrainingLocation>(settings.trainingLocation);
  const [availableEquipment, setAvailableEquipment] = useState(settings.availableEquipment.join(", "));
  const [injuryNotes, setInjuryNotes] = useState(settings.injuryNotes || "");
  const [dietPreference, setDietPreference] = useState<DietPreference>(settings.dietPreference);
  const [foodRestrictions, setFoodRestrictions] = useState(settings.foodRestrictions || "");
  const [extraNotes, setExtraNotes] = useState("");

  const [aiConfigured, setAiConfigured] = useState(true);
  const [historyTraining, setHistoryTraining] = useState<HistoryItem[]>([]);
  const [historyNutrition, setHistoryNutrition] = useState<HistoryItem[]>([]);
  const [trainingGenerationId, setTrainingGenerationId] = useState<string | null>(null);
  const [nutritionGenerationId, setNutritionGenerationId] = useState<string | null>(null);
  const [trainingPlanDraft, setTrainingPlanDraft] = useState<AiTrainingPlan | null>(null);
  const [nutritionPlanDraft, setNutritionPlanDraft] = useState<AiNutritionPlan | null>(null);
  const [trainingJson, setTrainingJson] = useState("");
  const [nutritionJson, setNutritionJson] = useState("");
  const [loading, setLoading] = useState<LoadingState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDev = process.env.NODE_ENV !== "production";

  const goalOptions = useMemo(
    () => [
      { value: "fat_loss", label: t("goalFatLoss") },
      { value: "muscle_gain", label: t("goalMuscleGain") },
      { value: "maintenance", label: t("goalMaintenance") },
      { value: "recomposition", label: t("goalRecomposition") },
    ] satisfies Array<{ value: FitnessGoal; label: string }>,
    [t],
  );

  const localeLabel = requestLocale === "zh-CN" ? t("localeZh") : t("localeEn");

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const commitTrainingDraft = (plan: AiTrainingPlan, generationId?: string | null) => {
    setTrainingPlanDraft(plan);
    setTrainingJson(pretty(plan));
    if (typeof generationId !== "undefined") {
      setTrainingGenerationId(generationId);
    }
  };

  const commitNutritionDraft = (plan: AiNutritionPlan, generationId?: string | null) => {
    setNutritionPlanDraft(plan);
    setNutritionJson(pretty(plan));
    if (typeof generationId !== "undefined") {
      setNutritionGenerationId(generationId);
    }
  };

  const updateTrainingDraft = (updater: (draft: AiTrainingPlan) => void) => {
    if (!trainingPlanDraft) {
      return;
    }

    const next = deepClone(trainingPlanDraft);
    updater(next);
    setTrainingPlanDraft(next);
    setTrainingJson(pretty(next));
  };

  const updateNutritionDraft = (updater: (draft: AiNutritionPlan) => void) => {
    if (!nutritionPlanDraft) {
      return;
    }

    const next = deepClone(nutritionPlanDraft);
    updater(next);
    setNutritionPlanDraft(next);
    setNutritionJson(pretty(next));
  };

  const loadHistory = useCallback(async () => {
    setLoading("history");
    try {
      const data = (await requestJson("/api/ai/history")) as unknown as HistoryResponse;
      setAiConfigured(Boolean(data.aiConfigured));
      setHistoryTraining(data.training ?? []);
      setHistoryNutrition(data.nutrition ?? []);
    } catch (historyError) {
      setError(normalizeActionError(historyError, { fallback: t("historyLoadFailed") }));
    } finally {
      setLoading(null);
    }
  }, [t]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const applyTrainingJson = async () => {
    setLoading("apply-training-json");
    clearFeedback();
    try {
      const parsed = aiTrainingPlanSchema.parse(JSON.parse(trainingJson));
      setTrainingPlanDraft(parsed);
      setTrainingJson(pretty(parsed));
      setMessage(t("jsonApplySuccess"));
    } catch (applyError) {
      setError(normalizeActionError(applyError, { fallback: t("invalidTrainingPlan") }));
    } finally {
      setLoading(null);
    }
  };

  const applyNutritionJson = async () => {
    setLoading("apply-nutrition-json");
    clearFeedback();
    try {
      const parsed = aiNutritionPlanSchema.parse(JSON.parse(nutritionJson));
      setNutritionPlanDraft(parsed);
      setNutritionJson(pretty(parsed));
      setMessage(t("jsonApplySuccess"));
    } catch (applyError) {
      setError(normalizeActionError(applyError, { fallback: t("invalidNutritionPlan") }));
    } finally {
      setLoading(null);
    }
  };

  const copyJson = async (value: string) => {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setMessage(t("jsonCopySuccess"));
    } catch {
      setError(t("jsonCopyFailed"));
    }
  };

  const generateTraining = async () => {
    setLoading("training");
    clearFeedback();
    try {
      const data = await requestJson("/api/ai/generate-training-plan", {
        method: "POST",
        body: JSON.stringify({
          locale: requestLocale,
          constraints: {
            goal_type: goalType,
            weekly_training_days: weeklyTrainingDays,
            session_duration_minutes: sessionDurationMinutes,
            training_location: trainingLocation,
            available_equipment: normalizeCommaList(availableEquipment),
            injury_notes: injuryNotes,
            notes: extraNotes,
          },
        }),
      });
      const parsed = aiTrainingPlanSchema.parse(data.plan);
      commitTrainingDraft(parsed, typeof data.generationId === "string" ? data.generationId : null);
      setMessage(t("trainingGenerateSuccess"));
      await loadHistory();
    } catch (requestError) {
      const typedError = requestError as Error & { code?: string; detail?: string };
      if (typedError.code === "AI_LANGUAGE_MISMATCH") {
        setError(t("languageMismatch"));
      } else if (typedError.code === "AI_SCHEMA_VALIDATION_FAILED" || typedError.code === "AI_INVALID_JSON") {
        setError(
          isDev && typedError.detail
            ? `${t("resultFormatRetry")} (${typedError.detail})`
            : t("resultFormatRetry"),
        );
      } else {
        setError(normalizeActionError(requestError, { fallback: t("trainingGenerateFailed") }));
      }
    } finally {
      setLoading(null);
    }
  };

  const generateNutrition = async () => {
    setLoading("nutrition");
    clearFeedback();
    try {
      const data = await requestJson("/api/ai/generate-nutrition-plan", {
        method: "POST",
        body: JSON.stringify({
          locale: requestLocale,
          constraints: {
            goal_type: goalType,
            diet_preference: dietPreference,
            food_restrictions: foodRestrictions,
            notes: extraNotes,
          },
        }),
      });
      const parsed = aiNutritionPlanSchema.parse(data.plan);
      commitNutritionDraft(parsed, typeof data.generationId === "string" ? data.generationId : null);
      setMessage(t("nutritionGenerateSuccess"));
      await loadHistory();
    } catch (requestError) {
      const typedError = requestError as Error & { code?: string; detail?: string };
      if (typedError.code === "AI_LANGUAGE_MISMATCH") {
        setError(t("languageMismatch"));
      } else if (typedError.code === "AI_SCHEMA_VALIDATION_FAILED" || typedError.code === "AI_INVALID_JSON") {
        setError(
          isDev && typedError.detail
            ? `${t("resultFormatRetry")} (${typedError.detail})`
            : t("resultFormatRetry"),
        );
      } else {
        setError(normalizeActionError(requestError, { fallback: t("nutritionGenerateFailed") }));
      }
    } finally {
      setLoading(null);
    }
  };

  const saveTraining = async () => {
    setLoading("save-training");
    clearFeedback();
    try {
      const parsed = aiTrainingPlanSchema.parse(trainingPlanDraft ?? JSON.parse(trainingJson));
      await requestJson("/api/ai/save-training-plan", {
        method: "POST",
        body: JSON.stringify({ generation_id: trainingGenerationId, plan: parsed }),
      });
      await refreshUserData();
      setMessage(t("trainingSaveSuccess"));
    } catch (saveError) {
      setError(normalizeActionError(saveError, { fallback: t("trainingSaveFailed") }));
    } finally {
      setLoading(null);
    }
  };

  const saveNutrition = async () => {
    setLoading("save-nutrition");
    clearFeedback();
    try {
      const parsed = aiNutritionPlanSchema.parse(nutritionPlanDraft ?? JSON.parse(nutritionJson));
      await requestJson("/api/ai/save-nutrition-plan", {
        method: "POST",
        body: JSON.stringify({ generation_id: nutritionGenerationId, plan: parsed, activate: true }),
      });
      setMessage(t("nutritionSaveSuccess"));
    } catch (saveError) {
      setError(normalizeActionError(saveError, { fallback: t("nutritionSaveFailed") }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("aiPlanner")}</p>
          <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("localeModeHint", { locale: localeLabel })}</p>
        </div>
        <Link href="/plan" className="text-sm text-emerald-700 hover:underline">
          {t("backToPlan")}
        </Link>
      </div>

      {!aiConfigured ? (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="py-3 text-sm text-amber-800">{t("configMissing")}</CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("constraintsTitle")}</CardTitle>
          <CardDescription>{t("constraintsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label>{t("goalType")}</Label>
            <Select value={goalType} onValueChange={(value) => setGoalType(value as FitnessGoal)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {goalOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("weeklyTrainingDays")}</Label>
            <NumericInput value={weeklyTrainingDays} allowDecimal={false} min={1} max={7} onValueChange={setWeeklyTrainingDays} />
          </div>
          <div className="space-y-1">
            <Label>{t("sessionDurationMinutes")}</Label>
            <NumericInput value={sessionDurationMinutes} allowDecimal={false} min={15} max={180} onValueChange={setSessionDurationMinutes} />
          </div>
          <div className="space-y-1">
            <Label>{t("trainingLocation")}</Label>
            <Select value={trainingLocation} onValueChange={(value) => setTrainingLocation(value as TrainingLocation)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gym">{t("locationGym")}</SelectItem>
                <SelectItem value="home">{t("locationHome")}</SelectItem>
                <SelectItem value="mixed">{t("locationMixed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("availableEquipment")}</Label>
            <Input
              value={availableEquipment}
              onChange={(event) => setAvailableEquipment(event.target.value)}
              placeholder={t("availableEquipmentPlaceholder")}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("dietPreference")}</Label>
            <Select value={dietPreference} onValueChange={(value) => setDietPreference(value as DietPreference)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("dietNone")}</SelectItem>
                <SelectItem value="high_protein">{t("dietHighProtein")}</SelectItem>
                <SelectItem value="vegetarian">{t("dietVegetarian")}</SelectItem>
                <SelectItem value="low_carb">{t("dietLowCarb")}</SelectItem>
                <SelectItem value="balanced">{t("dietBalanced")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("foodRestrictions")}</Label>
            <Input
              value={foodRestrictions}
              onChange={(event) => setFoodRestrictions(event.target.value)}
              placeholder={t("foodRestrictionsPlaceholder")}
            />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
            <Label>{t("injuryNotes")}</Label>
            <Textarea rows={2} value={injuryNotes} onChange={(event) => setInjuryNotes(event.target.value)} placeholder={t("injuryNotesPlaceholder")} />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
            <Label>{t("extraNotes")}</Label>
            <Textarea rows={2} value={extraNotes} onChange={(event) => setExtraNotes(event.target.value)} placeholder={t("extraNotesPlaceholder")} />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
            <Button onClick={generateTraining} disabled={Boolean(loading)}>
              {loading === "training" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {loading === "training" ? t("generatingTraining") : t("generateTraining")}
            </Button>
            <Button variant="outline" onClick={generateNutrition} disabled={Boolean(loading)}>
              {loading === "nutrition" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {loading === "nutrition" ? t("generatingNutrition") : t("generateNutrition")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("trainingStructuredTitle")}</CardTitle>
          <CardDescription>{t("trainingStructuredDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="structured" className="space-y-3">
            <TabsList variant="line">
              <TabsTrigger value="structured">{t("structuredTab")}</TabsTrigger>
              <TabsTrigger value="json">{t("jsonTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="structured" className="space-y-3">
              {!trainingPlanDraft ? (
                <p className="text-sm text-slate-500">{t("trainingStructuredEmpty")}</p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>{t("fieldPlanName")}</Label>
                      <Input value={trainingPlanDraft.plan_name} onChange={(event) => updateTrainingDraft((draft) => { draft.plan_name = event.target.value; })} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("goalType")}</Label>
                      <Select
                        value={trainingPlanDraft.goal_type}
                        onValueChange={(value) => updateTrainingDraft((draft) => { draft.goal_type = value as AiTrainingPlan["goal_type"]; })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {goalOptions.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>{t("fieldSummary")}</Label>
                      <Textarea rows={3} value={trainingPlanDraft.summary} onChange={(event) => updateTrainingDraft((draft) => { draft.summary = event.target.value; })} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>{t("fieldReasoningSummary")}</Label>
                      <Textarea rows={3} value={trainingPlanDraft.reasoning_summary} onChange={(event) => updateTrainingDraft((draft) => { draft.reasoning_summary = event.target.value; })} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>{t("fieldWarnings")}</Label>
                      <Textarea
                        rows={3}
                        value={trainingPlanDraft.warnings.join("\n")}
                        onChange={(event) => updateTrainingDraft((draft) => { draft.warnings = normalizeList(event.target.value); })}
                        placeholder={t("warningsPlaceholder")}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    {trainingPlanDraft.weeks.map((week, weekIndex) => (
                      <details key={`${week.week_number}-${weekIndex}`} open className="rounded-md border border-slate-200 bg-slate-50/50">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-900">{t("weekHeading", { week: week.week_number })}</summary>
                        <div className="space-y-3 border-t border-slate-200 p-3">
                          <div className="space-y-1">
                            <Label>{t("weekFocus")}</Label>
                            <Input value={week.focus} onChange={(event) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].focus = event.target.value; })} />
                          </div>

                          {week.days.map((day, dayIndex) => (
                            <Card key={`${day.day_number}-${dayIndex}`} className="border-slate-200">
                              <CardHeader className="space-y-1 pb-3">
                                <CardTitle className="text-sm">{t("dayHeading", { day: day.day_number })}</CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="space-y-1">
                                    <Label>{t("dayTitle")}</Label>
                                    <Input value={day.title} onChange={(event) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].title = event.target.value; })} />
                                  </div>
                                  <div className="space-y-1">
                                    <Label>{t("estimatedDurationMinutes")}</Label>
                                    <NumericInput
                                      value={day.estimated_duration_minutes}
                                      allowDecimal={false}
                                      min={15}
                                      max={180}
                                      onValueChange={(value) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].estimated_duration_minutes = value; })}
                                    />
                                  </div>
                                  <div className="space-y-1 md:col-span-2">
                                    <Label>{t("fieldNotes")}</Label>
                                    <Textarea rows={2} value={day.notes} onChange={(event) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].notes = event.target.value; })} />
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-medium text-slate-900">{t("exerciseListTitle")}</p>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => updateTrainingDraft((draft) => {
                                        draft.weeks[weekIndex].days[dayIndex].exercises.push({
                                          name: t("newExerciseName"),
                                          sets: 3,
                                          rep_range: "8-10",
                                          target_rpe: 7,
                                          rest_seconds: 90,
                                          notes: "",
                                          alternative_exercises: [],
                                        });
                                      })}
                                    >
                                      <Plus className="mr-1 h-4 w-4" />
                                      {t("addExercise")}
                                    </Button>
                                  </div>

                                  {day.exercises.map((exercise, exerciseIndex) => (
                                    <div key={`${exercise.name}-${exerciseIndex}`} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-medium text-slate-900">{t("exerciseItem", { index: exerciseIndex + 1 })}</p>
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          className="h-7 w-7 text-rose-600 hover:text-rose-700"
                                          onClick={() => {
                                            const confirmed = window.confirm(t("deleteExerciseConfirm"));
                                            if (!confirmed) {
                                              return;
                                            }
                                            updateTrainingDraft((draft) => {
                                              draft.weeks[weekIndex].days[dayIndex].exercises.splice(exerciseIndex, 1);
                                            });
                                          }}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                      <div className="grid gap-2 md:grid-cols-3">
                                        <div className="space-y-1 md:col-span-3">
                                          <Label>{t("exerciseName")}</Label>
                                          <Input value={exercise.name} onChange={(event) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].exercises[exerciseIndex].name = event.target.value; })} />
                                        </div>
                                        <div className="space-y-1">
                                          <Label>{t("exerciseSets")}</Label>
                                          <NumericInput value={exercise.sets} allowDecimal={false} min={1} max={12} onValueChange={(value) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].exercises[exerciseIndex].sets = value; })} />
                                        </div>
                                        <div className="space-y-1">
                                          <Label>{t("exerciseRepRange")}</Label>
                                          <Input value={exercise.rep_range} onChange={(event) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].exercises[exerciseIndex].rep_range = event.target.value; })} />
                                        </div>
                                        <div className="space-y-1">
                                          <Label>{t("exerciseRpe")}</Label>
                                          <NumericInput value={exercise.target_rpe} min={4} max={10} onValueChange={(value) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].exercises[exerciseIndex].target_rpe = value; })} />
                                        </div>
                                        <div className="space-y-1">
                                          <Label>{t("exerciseRestSeconds")}</Label>
                                          <NumericInput value={exercise.rest_seconds} allowDecimal={false} min={20} max={600} onValueChange={(value) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].exercises[exerciseIndex].rest_seconds = value; })} />
                                        </div>
                                        <div className="space-y-1 md:col-span-2">
                                          <Label>{t("exerciseAlternatives")}</Label>
                                          <Input
                                            value={exercise.alternative_exercises.join(", ")}
                                            onChange={(event) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].exercises[exerciseIndex].alternative_exercises = normalizeCommaList(event.target.value); })}
                                            placeholder={t("alternativesPlaceholder")}
                                          />
                                        </div>
                                        <div className="space-y-1 md:col-span-3">
                                          <Label>{t("exerciseNotes")}</Label>
                                          <Textarea rows={2} value={exercise.notes} onChange={(event) => updateTrainingDraft((draft) => { draft.weeks[weekIndex].days[dayIndex].exercises[exerciseIndex].notes = event.target.value; })} />
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>

                  <Button onClick={saveTraining} disabled={!trainingPlanDraft || Boolean(loading)}>
                    {loading === "save-training" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {loading === "save-training" ? t("savingTrainingPlan") : t("saveTrainingPlan")}
                  </Button>
                </>
              )}
            </TabsContent>

            <TabsContent value="json" className="space-y-2">
              <p className="text-xs text-slate-500">{t("advancedModeDesc")}</p>
              <Textarea rows={18} value={trainingJson} onChange={(event) => setTrainingJson(event.target.value)} placeholder={t("trainingPreviewPlaceholder")} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={applyTrainingJson} disabled={!trainingJson || Boolean(loading)}>
                  {loading === "apply-training-json" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {loading === "apply-training-json" ? t("jsonApplying") : t("jsonApply")}
                </Button>
                <Button variant="ghost" onClick={() => void copyJson(trainingJson)} disabled={!trainingJson}>
                  <Copy className="mr-2 h-4 w-4" />
                  {t("jsonCopy")}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("nutritionStructuredTitle")}</CardTitle>
          <CardDescription>{t("nutritionStructuredDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="structured" className="space-y-3">
            <TabsList variant="line">
              <TabsTrigger value="structured">{t("structuredTab")}</TabsTrigger>
              <TabsTrigger value="json">{t("jsonTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="structured" className="space-y-3">
              {!nutritionPlanDraft ? (
                <p className="text-sm text-slate-500">{t("nutritionStructuredEmpty")}</p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>{t("fieldPlanName")}</Label>
                      <Input value={nutritionPlanDraft.plan_name} onChange={(event) => updateNutritionDraft((draft) => { draft.plan_name = event.target.value; })} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("goalType")}</Label>
                      <Select value={nutritionPlanDraft.goal_type} onValueChange={(value) => updateNutritionDraft((draft) => { draft.goal_type = value as AiNutritionPlan["goal_type"]; })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {goalOptions.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>{t("fieldSummary")}</Label>
                      <Textarea rows={3} value={nutritionPlanDraft.summary} onChange={(event) => updateNutritionDraft((draft) => { draft.summary = event.target.value; })} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>{t("fieldWarnings")}</Label>
                      <Textarea
                        rows={3}
                        value={nutritionPlanDraft.warnings.join("\n")}
                        onChange={(event) => updateNutritionDraft((draft) => { draft.warnings = normalizeList(event.target.value); })}
                        placeholder={t("warningsPlaceholder")}
                      />
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-5">
                    <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                      <Label>{t("dailyCalories")}</Label>
                      <NumericInput value={nutritionPlanDraft.daily_targets.calories} allowDecimal={false} min={1200} max={5000} onValueChange={(value) => updateNutritionDraft((draft) => { draft.daily_targets.calories = value; })} />
                    </div>
                    <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                      <Label>{t("dailyProtein")}</Label>
                      <NumericInput value={nutritionPlanDraft.daily_targets.protein_g} min={40} max={400} onValueChange={(value) => updateNutritionDraft((draft) => { draft.daily_targets.protein_g = value; })} />
                    </div>
                    <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                      <Label>{t("dailyCarbs")}</Label>
                      <NumericInput value={nutritionPlanDraft.daily_targets.carbs_g} min={30} max={700} onValueChange={(value) => updateNutritionDraft((draft) => { draft.daily_targets.carbs_g = value; })} />
                    </div>
                    <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                      <Label>{t("dailyFat")}</Label>
                      <NumericInput value={nutritionPlanDraft.daily_targets.fat_g} min={20} max={200} onValueChange={(value) => updateNutritionDraft((draft) => { draft.daily_targets.fat_g = value; })} />
                    </div>
                    <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                      <Label>{t("dailyWater")}</Label>
                      <NumericInput value={nutritionPlanDraft.daily_targets.water_ml} allowDecimal={false} min={1000} max={6000} onValueChange={(value) => updateNutritionDraft((draft) => { draft.daily_targets.water_ml = value; })} />
                    </div>
                  </div>

                  <div className="space-y-3">
                    {nutritionPlanDraft.days.map((day, dayIndex) => (
                      <details key={`${day.day_number}-${dayIndex}`} open className="rounded-md border border-slate-200 bg-slate-50/50">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-900">{t("dayHeading", { day: day.day_number })}</summary>
                        <div className="space-y-3 border-t border-slate-200 p-3">
                          <div className="space-y-1">
                            <Label>{t("fieldNotes")}</Label>
                            <Textarea rows={2} value={day.notes} onChange={(event) => updateNutritionDraft((draft) => { draft.days[dayIndex].notes = event.target.value; })} />
                          </div>

                          {day.meals.map((meal, mealIndex) => (
                            <Card key={`${meal.meal_type}-${mealIndex}`} className="border-slate-200">
                              <CardHeader className="space-y-1 pb-3">
                                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                                  <span>{tNutrition(`meal_${meal.meal_type}`)}</span>
                                  <Badge variant="outline">{meal.meal_type}</Badge>
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-3">
                                <div className="space-y-1">
                                  <Label>{t("mealTitle")}</Label>
                                  <Input value={meal.title} onChange={(event) => updateNutritionDraft((draft) => { draft.days[dayIndex].meals[mealIndex].title = event.target.value; })} />
                                </div>

                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-medium text-slate-900">{t("foodListTitle")}</p>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => updateNutritionDraft((draft) => {
                                        draft.days[dayIndex].meals[mealIndex].foods.push({
                                          name: t("newFoodName"),
                                          amount: "1 serving",
                                          estimated_calories: 150,
                                          estimated_protein_g: 10,
                                          notes: "",
                                          alternatives: [],
                                        });
                                      })}
                                    >
                                      <Plus className="mr-1 h-4 w-4" />
                                      {t("addFood")}
                                    </Button>
                                  </div>

                                  {meal.foods.map((food, foodIndex) => (
                                    <div key={`${food.name}-${foodIndex}`} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-medium text-slate-900">{t("foodItem", { index: foodIndex + 1 })}</p>
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          className="h-7 w-7 text-rose-600 hover:text-rose-700"
                                          onClick={() => {
                                            const confirmed = window.confirm(t("deleteFoodConfirm"));
                                            if (!confirmed) {
                                              return;
                                            }
                                            updateNutritionDraft((draft) => {
                                              draft.days[dayIndex].meals[mealIndex].foods.splice(foodIndex, 1);
                                            });
                                          }}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                      <div className="grid gap-2 md:grid-cols-2">
                                        <div className="space-y-1">
                                          <Label>{t("foodName")}</Label>
                                          <Input value={food.name} onChange={(event) => updateNutritionDraft((draft) => { draft.days[dayIndex].meals[mealIndex].foods[foodIndex].name = event.target.value; })} />
                                        </div>
                                        <div className="space-y-1">
                                          <Label>{t("foodAmount")}</Label>
                                          <Input value={food.amount} onChange={(event) => updateNutritionDraft((draft) => { draft.days[dayIndex].meals[mealIndex].foods[foodIndex].amount = event.target.value; })} />
                                        </div>
                                        <div className="space-y-1">
                                          <Label>{t("foodCalories")}</Label>
                                          <NumericInput value={food.estimated_calories} allowDecimal={false} min={0} max={2000} onValueChange={(value) => updateNutritionDraft((draft) => { draft.days[dayIndex].meals[mealIndex].foods[foodIndex].estimated_calories = value; })} />
                                        </div>
                                        <div className="space-y-1">
                                          <Label>{t("foodProtein")}</Label>
                                          <NumericInput value={food.estimated_protein_g} min={0} max={200} onValueChange={(value) => updateNutritionDraft((draft) => { draft.days[dayIndex].meals[mealIndex].foods[foodIndex].estimated_protein_g = value; })} />
                                        </div>
                                        <div className="space-y-1 md:col-span-2">
                                          <Label>{t("fieldNotes")}</Label>
                                          <Textarea rows={2} value={food.notes} onChange={(event) => updateNutritionDraft((draft) => { draft.days[dayIndex].meals[mealIndex].foods[foodIndex].notes = event.target.value; })} />
                                        </div>
                                        <div className="space-y-1 md:col-span-2">
                                          <Label>{t("foodAlternatives")}</Label>
                                          <Input value={food.alternatives.join(", ")} onChange={(event) => updateNutritionDraft((draft) => { draft.days[dayIndex].meals[mealIndex].foods[foodIndex].alternatives = normalizeCommaList(event.target.value); })} placeholder={t("alternativesPlaceholder")} />
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>

                  <Button onClick={saveNutrition} disabled={!nutritionPlanDraft || Boolean(loading)}>
                    {loading === "save-nutrition" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {loading === "save-nutrition" ? t("savingNutritionPlan") : t("saveNutritionPlan")}
                  </Button>
                </>
              )}
            </TabsContent>

            <TabsContent value="json" className="space-y-2">
              <p className="text-xs text-slate-500">{t("advancedModeDesc")}</p>
              <Textarea rows={18} value={nutritionJson} onChange={(event) => setNutritionJson(event.target.value)} placeholder={t("nutritionPreviewPlaceholder")} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={applyNutritionJson} disabled={!nutritionJson || Boolean(loading)}>
                  {loading === "apply-nutrition-json" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {loading === "apply-nutrition-json" ? t("jsonApplying") : t("jsonApply")}
                </Button>
                <Button variant="ghost" onClick={() => void copyJson(nutritionJson)} disabled={!nutritionJson}>
                  <Copy className="mr-2 h-4 w-4" />
                  {t("jsonCopy")}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("historyTitle")}</CardTitle>
          <CardDescription>{t("historyDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-900">{t("historyTraining")}</p>
            {historyTraining.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-left text-xs hover:bg-slate-100"
                onClick={() => {
                  if (!item.parsed_plan_json) {
                    setError(item.error_message || t("historyLoadFailed"));
                    return;
                  }

                  const parsed = aiTrainingPlanSchema.safeParse(item.parsed_plan_json);
                  if (!parsed.success) {
                    setError(t("invalidTrainingPlan"));
                    return;
                  }

                  commitTrainingDraft(parsed.data, item.id);
                  setMessage(t("historyLoaded"));
                }}
              >
                <p>{item.created_at}</p>
                <p className="text-slate-500">{item.model_name} · {item.prompt_version}</p>
                <Badge variant="outline" className="mt-1">{item.status}</Badge>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-900">{t("historyNutrition")}</p>
            {historyNutrition.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-left text-xs hover:bg-slate-100"
                onClick={() => {
                  if (!item.parsed_plan_json) {
                    setError(item.error_message || t("historyLoadFailed"));
                    return;
                  }

                  const parsed = aiNutritionPlanSchema.safeParse(item.parsed_plan_json);
                  if (!parsed.success) {
                    setError(t("invalidNutritionPlan"));
                    return;
                  }

                  commitNutritionDraft(parsed.data, item.id);
                  setMessage(t("historyLoaded"));
                }}
              >
                <p>{item.created_at}</p>
                <p className="text-slate-500">{item.model_name} · {item.prompt_version}</p>
                <Badge variant="outline" className="mt-1">{item.status}</Badge>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
