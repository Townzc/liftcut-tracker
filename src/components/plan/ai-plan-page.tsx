"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Save, Sparkles } from "lucide-react";

import { NumericInput } from "@/components/shared/numeric-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  aiNutritionPlanSchema,
  aiTrainingPlanSchema,
} from "@/lib/ai/schemas";
import { normalizeActionError } from "@/lib/error-utils";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { DietPreference, FitnessGoal, TrainingLocation } from "@/types";

interface HistoryItem {
  id: string;
  model_name: string;
  prompt_version: string;
  status: string;
  parsed_plan_json: unknown;
  created_at: string;
}

interface HistoryResponse {
  ok: boolean;
  aiConfigured: boolean;
  training: HistoryItem[];
  nutrition: HistoryItem[];
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
    throw new Error(String(data.message || "Request failed."));
  }
  return data;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function AiPlanPage() {
  const t = useTranslations("ai");
  const tNav = useTranslations("nav");
  const settings = useTrackerStore((state) => state.settings);
  const refreshUserData = useTrackerStore((state) => state.refreshUserData);

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
  const [trainingJson, setTrainingJson] = useState("");
  const [nutritionJson, setNutritionJson] = useState("");
  const [loading, setLoading] = useState<null | "history" | "training" | "nutrition" | "save-training" | "save-nutrition">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const goalOptions = useMemo(
    () => [
      { value: "fat_loss", label: t("goalFatLoss") },
      { value: "muscle_gain", label: t("goalMuscleGain") },
      { value: "maintenance", label: t("goalMaintenance") },
      { value: "recomposition", label: t("goalRecomposition") },
    ] satisfies Array<{ value: FitnessGoal; label: string }>,
    [t],
  );

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

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const generateTraining = async () => {
    setLoading("training");
    clearFeedback();
    try {
      const data = await requestJson("/api/ai/generate-training-plan", {
        method: "POST",
        body: JSON.stringify({
          constraints: {
            goal_type: goalType,
            weekly_training_days: weeklyTrainingDays,
            session_duration_minutes: sessionDurationMinutes,
            training_location: trainingLocation,
            available_equipment: availableEquipment.split(",").map((item) => item.trim()).filter(Boolean),
            injury_notes: injuryNotes,
            notes: extraNotes,
          },
        }),
      });
      setTrainingJson(pretty(data.plan));
      setTrainingGenerationId(typeof data.generationId === "string" ? data.generationId : null);
      setMessage(t("trainingGenerateSuccess"));
      await loadHistory();
    } catch (requestError) {
      setError(normalizeActionError(requestError, { fallback: t("trainingGenerateFailed") }));
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
          constraints: {
            goal_type: goalType,
            diet_preference: dietPreference,
            food_restrictions: foodRestrictions,
            notes: extraNotes,
          },
        }),
      });
      setNutritionJson(pretty(data.plan));
      setNutritionGenerationId(typeof data.generationId === "string" ? data.generationId : null);
      setMessage(t("nutritionGenerateSuccess"));
      await loadHistory();
    } catch (requestError) {
      setError(normalizeActionError(requestError, { fallback: t("nutritionGenerateFailed") }));
    } finally {
      setLoading(null);
    }
  };

  const saveTraining = async () => {
    setLoading("save-training");
    clearFeedback();
    try {
      const parsed = aiTrainingPlanSchema.parse(JSON.parse(trainingJson));
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
      const parsed = aiNutritionPlanSchema.parse(JSON.parse(nutritionJson));
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
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("plan")}</p>
          <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        </div>
        <Link href="/plan" className="text-sm text-emerald-700 hover:underline">{t("backToPlan")}</Link>
      </div>

      {!aiConfigured ? <Card className="border-amber-200 bg-amber-50/70"><CardContent className="py-3 text-sm text-amber-800">{t("configMissing")}</CardContent></Card> : null}

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader><CardTitle className="text-base">{t("constraintsTitle")}</CardTitle><CardDescription>{t("constraintsDesc")}</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1"><Label>{t("goalType")}</Label><Select value={goalType} onValueChange={(value) => setGoalType(value as FitnessGoal)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{goalOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>{t("weeklyTrainingDays")}</Label><NumericInput value={weeklyTrainingDays} allowDecimal={false} min={1} max={7} onValueChange={setWeeklyTrainingDays} /></div>
          <div className="space-y-1"><Label>{t("sessionDurationMinutes")}</Label><NumericInput value={sessionDurationMinutes} allowDecimal={false} min={15} max={180} onValueChange={setSessionDurationMinutes} /></div>
          <div className="space-y-1"><Label>{t("trainingLocation")}</Label><Select value={trainingLocation} onValueChange={(value) => setTrainingLocation(value as TrainingLocation)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gym">{t("locationGym")}</SelectItem><SelectItem value="home">{t("locationHome")}</SelectItem><SelectItem value="mixed">{t("locationMixed")}</SelectItem></SelectContent></Select></div>
          <div className="space-y-1 sm:col-span-2"><Label>{t("availableEquipment")}</Label><Input value={availableEquipment} onChange={(event) => setAvailableEquipment(event.target.value)} placeholder={t("availableEquipmentPlaceholder")} /></div>
          <div className="space-y-1"><Label>{t("dietPreference")}</Label><Select value={dietPreference} onValueChange={(value) => setDietPreference(value as DietPreference)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("dietNone")}</SelectItem><SelectItem value="high_protein">{t("dietHighProtein")}</SelectItem><SelectItem value="vegetarian">{t("dietVegetarian")}</SelectItem><SelectItem value="low_carb">{t("dietLowCarb")}</SelectItem><SelectItem value="balanced">{t("dietBalanced")}</SelectItem></SelectContent></Select></div>
          <div className="space-y-1 sm:col-span-2"><Label>{t("foodRestrictions")}</Label><Input value={foodRestrictions} onChange={(event) => setFoodRestrictions(event.target.value)} placeholder={t("foodRestrictionsPlaceholder")} /></div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label>{t("injuryNotes")}</Label><Textarea rows={2} value={injuryNotes} onChange={(event) => setInjuryNotes(event.target.value)} placeholder={t("injuryNotesPlaceholder")} /></div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label>{t("extraNotes")}</Label><Textarea rows={2} value={extraNotes} onChange={(event) => setExtraNotes(event.target.value)} placeholder={t("extraNotesPlaceholder")} /></div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
            <Button onClick={generateTraining} disabled={Boolean(loading)}>{loading === "training" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{loading === "training" ? t("generatingTraining") : t("generateTraining")}</Button>
            <Button variant="outline" onClick={generateNutrition} disabled={Boolean(loading)}>{loading === "nutrition" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{loading === "nutrition" ? t("generatingNutrition") : t("generateNutrition")}</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader><CardTitle className="text-base">{t("trainingPreviewTitle")}</CardTitle><CardDescription>{t("trainingPreviewDesc")}</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={16} value={trainingJson} onChange={(event) => setTrainingJson(event.target.value)} placeholder={t("trainingPreviewPlaceholder")} />
          <Button onClick={saveTraining} disabled={!trainingJson || Boolean(loading)}>{loading === "save-training" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{loading === "save-training" ? t("savingTrainingPlan") : t("saveTrainingPlan")}</Button>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader><CardTitle className="text-base">{t("nutritionPreviewTitle")}</CardTitle><CardDescription>{t("nutritionPreviewDesc")}</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={16} value={nutritionJson} onChange={(event) => setNutritionJson(event.target.value)} placeholder={t("nutritionPreviewPlaceholder")} />
          <Button onClick={saveNutrition} disabled={!nutritionJson || Boolean(loading)}>{loading === "save-nutrition" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{loading === "save-nutrition" ? t("savingNutritionPlan") : t("saveNutritionPlan")}</Button>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader><CardTitle className="text-base">{t("historyTitle")}</CardTitle><CardDescription>{t("historyDesc")}</CardDescription></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2"><p className="text-sm font-medium text-slate-900">{t("historyTraining")}</p>{historyTraining.slice(0, 8).map((item) => <button key={item.id} type="button" className="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-left text-xs hover:bg-slate-100" onClick={() => { setTrainingJson(pretty(item.parsed_plan_json)); setTrainingGenerationId(item.id); }}><p>{item.created_at}</p><p className="text-slate-500">{item.model_name} · {item.prompt_version}</p><Badge variant="outline" className="mt-1">{item.status}</Badge></button>)}</div>
          <div className="space-y-2"><p className="text-sm font-medium text-slate-900">{t("historyNutrition")}</p>{historyNutrition.slice(0, 8).map((item) => <button key={item.id} type="button" className="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-left text-xs hover:bg-slate-100" onClick={() => { setNutritionJson(pretty(item.parsed_plan_json)); setNutritionGenerationId(item.id); }}><p>{item.created_at}</p><p className="text-slate-500">{item.model_name} · {item.prompt_version}</p><Badge variant="outline" className="mt-1">{item.status}</Badge></button>)}</div>
        </CardContent>
      </Card>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
