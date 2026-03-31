"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayString } from "@/lib/date";
import { getNutritionByDate } from "@/lib/metrics";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { FoodLog, MealType, QuickFoodItem } from "@/types";

function parseNumber(value: string): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

export function NutritionPage() {
  const t = useTranslations("nutrition");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");

  const foodLogs = useTrackerStore((state) => state.foodLogs);
  const quickFoods = useTrackerStore((state) => state.quickFoods);
  const addFoodLog = useTrackerStore((state) => state.addFoodLog);
  const updateFoodLog = useTrackerStore((state) => state.updateFoodLog);
  const deleteFoodLog = useTrackerStore((state) => state.deleteFoodLog);

  const [selectedDate, setSelectedDate] = useState(todayString());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [foodName, setFoodName] = useState("");
  const [calories, setCalories] = useState(0);
  const [protein, setProtein] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [quickLoadingId, setQuickLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mealTypeOptions: Array<{ value: MealType; label: string }> = [
    { value: "breakfast", label: t("meal_breakfast") },
    { value: "lunch", label: t("meal_lunch") },
    { value: "dinner", label: t("meal_dinner") },
    { value: "snack", label: t("meal_snack") },
  ];

  const dayLogs = useMemo(
    () =>
      foodLogs
        .filter((log) => log.date === selectedDate)
        .sort((a, b) => a.mealType.localeCompare(b.mealType)),
    [foodLogs, selectedDate],
  );
  const nutritionSummary = useMemo(
    () => getNutritionByDate(foodLogs, selectedDate),
    [foodLogs, selectedDate],
  );

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setMealType("breakfast");
    setFoodName("");
    setCalories(0);
    setProtein(0);
  };

  const validateForm = (): string | null => {
    if (!mealType) {
      return t("errorMealRequired");
    }

    if (!foodName.trim()) {
      return t("errorFoodRequired");
    }

    if (calories <= 0) {
      return t("errorCaloriesRequired");
    }

    if (protein < 0) {
      return t("errorProteinRequired");
    }

    return null;
  };

  const applyQuickFood = async (quickFood: QuickFoodItem) => {
    setQuickLoadingId(quickFood.id);
    clearFeedback();

    try {
      await addFoodLog({
        date: selectedDate,
        mealType: quickFood.mealType,
        foodName: quickFood.name,
        calories: quickFood.calories,
        protein: quickFood.protein,
      });
      setMessage(t("quickAddSuccess", { name: quickFood.name }));
    } catch (quickError) {
      console.error(quickError);
      setError(quickError instanceof Error ? quickError.message : t("saveFailed"));
    } finally {
      setQuickLoadingId(null);
    }
  };

  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      setMessage(null);
      return;
    }

    setSubmitting(true);
    clearFeedback();

    try {
      const payload = {
        date: selectedDate,
        mealType,
        foodName: foodName.trim(),
        calories,
        protein,
      };

      if (editingId) {
        await updateFoodLog({ ...payload, id: editingId });
        setMessage(t("editSuccess"));
      } else {
        await addFoodLog(payload);
        setMessage(t("addSuccess"));
      }

      resetForm();
    } catch (submitError) {
      console.error(submitError);
      setError(submitError instanceof Error ? submitError.message : t("saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = (log: FoodLog) => {
    clearFeedback();
    setEditingId(log.id);
    setSelectedDate(log.date);
    setMealType(log.mealType);
    setFoodName(log.foodName);
    setCalories(log.calories);
    setProtein(log.protein);
    setMessage(t("editingState"));
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    clearFeedback();

    try {
      await deleteFoodLog(id);
      setMessage(t("deleteSuccess"));
    } catch (deleteError) {
      console.error(deleteError);
      setError(deleteError instanceof Error ? deleteError.message : t("deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  const mealTypeLabel = (value: MealType): string =>
    mealTypeOptions.find((item) => item.value === value)?.label ?? value;

  const isBusy = submitting || quickLoadingId !== null || deletingId !== null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("nutrition")}</p>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("summaryTitle")}</CardTitle>
            <CardDescription>{t("summaryDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-orange-50 p-3">
              <p className="text-xs text-orange-700">{t("date")}</p>
              <Input
                className="mt-2 border-orange-200 bg-white"
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </div>
            <div className="rounded-xl bg-orange-50 p-3">
              <p className="text-xs text-orange-700">{t("calories")}</p>
              <p className="mt-2 text-2xl font-semibold text-orange-900">{nutritionSummary.calories} kcal</p>
            </div>
            <div className="rounded-xl bg-orange-50 p-3">
              <p className="text-xs text-orange-700">{t("protein")}</p>
              <p className="mt-2 text-2xl font-semibold text-orange-900">{nutritionSummary.protein} g</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{t("quickTitle")}</CardTitle>
            <CardDescription>{t("quickDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {quickFoods.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                className="justify-between"
                onClick={() => applyQuickFood(item)}
                disabled={isBusy}
              >
                <span className="truncate">{item.name}</span>
                <span className="inline-flex items-center text-xs text-slate-500">
                  {quickLoadingId === item.id ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  {item.calories} kcal / {item.protein}g
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("addEditTitle")}</CardTitle>
          <CardDescription>{t("addEditDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-2 lg:col-span-2">
            <Label>{t("foodName")}</Label>
            <Input value={foodName} onChange={(event) => setFoodName(event.target.value)} placeholder="Chicken Breast" />
          </div>
          <div className="space-y-2">
            <Label>{t("mealType")}</Label>
            <Select value={mealType} onValueChange={(value) => setMealType(value as MealType)}>
              <SelectTrigger>
                <SelectValue placeholder={t("mealType")} />
              </SelectTrigger>
              <SelectContent>
                {mealTypeOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("calories")}</Label>
            <Input
              type="number"
              value={calories}
              onChange={(event) => setCalories(parseNumber(event.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("protein")}</Label>
            <Input
              type="number"
              value={protein}
              onChange={(event) => setProtein(parseNumber(event.target.value))}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleSubmit} className="w-full" disabled={isBusy}>
              {submitting ? <LoaderCircle className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              {editingId ? t("saveEdit") : t("add")}
            </Button>
            {editingId ? (
              <Button type="button" variant="outline" onClick={resetForm} disabled={isBusy}>
                {tCommon("cancel")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("dailyEntries")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dayLogs.length === 0 ? (
            <EmptyState title={t("noneTitle")} description={t("noneDesc")} />
          ) : (
            dayLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{log.foodName}</p>
                  <p className="text-xs text-slate-500">
                    {t("entryMeta", {
                      mealType: mealTypeLabel(log.mealType),
                      calories: log.calories,
                      protein: log.protein,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{mealTypeLabel(log.mealType)}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => startEditing(log)} disabled={isBusy}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(log.id)} disabled={isBusy}>
                    {deletingId === log.id ? (
                      <LoaderCircle className="h-4 w-4 animate-spin text-rose-600" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-rose-600" />
                    )}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
