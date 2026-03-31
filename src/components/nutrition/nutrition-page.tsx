"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

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
import { getNutritionByDate } from "@/lib/metrics";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { FoodLog, MealType, QuickFoodItem } from "@/types";
import { todayString } from "@/lib/date";

const mealTypeOptions: Array<{ value: MealType; label: string }> = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

function parseNumber(value: string): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function mealTypeLabel(value: MealType): string {
  return mealTypeOptions.find((item) => item.value === value)?.label ?? value;
}

export function NutritionPage() {
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

  const resetForm = () => {
    setEditingId(null);
    setMealType("breakfast");
    setFoodName("");
    setCalories(0);
    setProtein(0);
  };

  const applyQuickFood = (quickFood: QuickFoodItem) => {
    addFoodLog({
      date: selectedDate,
      mealType: quickFood.mealType,
      foodName: quickFood.name,
      calories: quickFood.calories,
      protein: quickFood.protein,
    });
  };

  const handleSubmit = () => {
    if (!foodName.trim()) {
      return;
    }

    const payload: Omit<FoodLog, "id"> = {
      date: selectedDate,
      mealType,
      foodName: foodName.trim(),
      calories,
      protein,
    };

    if (editingId) {
      updateFoodLog({ ...payload, id: editingId });
    } else {
      addFoodLog(payload);
    }

    resetForm();
  };

  const startEditing = (log: FoodLog) => {
    setEditingId(log.id);
    setSelectedDate(log.date);
    setMealType(log.mealType);
    setFoodName(log.foodName);
    setCalories(log.calories);
    setProtein(log.protein);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">Nutrition</p>
        <h1 className="text-2xl font-semibold text-slate-900">Nutrition Logging</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Daily Summary</CardTitle>
            <CardDescription>Track totals first, then add entries</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-orange-50 p-3">
              <p className="text-xs text-orange-700">Date</p>
              <Input
                className="mt-2 border-orange-200 bg-white"
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </div>
            <div className="rounded-xl bg-orange-50 p-3">
              <p className="text-xs text-orange-700">Calories</p>
              <p className="mt-2 text-2xl font-semibold text-orange-900">{nutritionSummary.calories} kcal</p>
            </div>
            <div className="rounded-xl bg-orange-50 p-3">
              <p className="text-xs text-orange-700">Protein</p>
              <p className="mt-2 text-2xl font-semibold text-orange-900">{nutritionSummary.protein} g</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Quick Foods</CardTitle>
            <CardDescription>One click add to selected day</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {quickFoods.map((item) => (
              <Button key={item.id} variant="outline" className="justify-between" onClick={() => applyQuickFood(item)}>
                <span>{item.name}</span>
                <span className="text-xs text-slate-500">
                  {item.calories} kcal / {item.protein}g
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">Add / Edit Food Log</CardTitle>
          <CardDescription>Support multiple entries per day with edit and delete</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-2 lg:col-span-2">
            <Label>Food Name</Label>
            <Input value={foodName} onChange={(event) => setFoodName(event.target.value)} placeholder="Chicken Breast" />
          </div>
          <div className="space-y-2">
            <Label>Meal Type</Label>
            <Select value={mealType} onValueChange={(value) => setMealType(value as MealType)}>
              <SelectTrigger>
                <SelectValue placeholder="Select meal" />
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
            <Label>Calories</Label>
            <Input
              type="number"
              value={calories}
              onChange={(event) => setCalories(parseNumber(event.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>Protein</Label>
            <Input
              type="number"
              value={protein}
              onChange={(event) => setProtein(parseNumber(event.target.value))}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleSubmit} className="w-full">
              <Plus className="mr-1 h-4 w-4" />
              {editingId ? "Save" : "Add"}
            </Button>
            {editingId ? (
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">Daily Entries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dayLogs.length === 0 ? (
            <EmptyState title="No food logged" description="Use quick foods or add an entry above." />
          ) : (
            dayLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{log.foodName}</p>
                  <p className="text-xs text-slate-500">
                    {mealTypeLabel(log.mealType)} | {log.calories} kcal | {log.protein} g protein
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{mealTypeLabel(log.mealType)}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => startEditing(log)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteFoodLog(log.id)}>
                    <Trash2 className="h-4 w-4 text-rose-600" />
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