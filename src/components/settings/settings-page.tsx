"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadJson, readJsonFile, validateTrainingPlan } from "@/lib/import-export";
import { userSettingsSchema } from "@/lib/schemas";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { UserSettings } from "@/types";

function numberOrZero(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function SettingsPage() {
  const settings = useTrackerStore((state) => state.settings);
  const setTrainingPlan = useTrackerStore((state) => state.setTrainingPlan);
  const updateSettings = useTrackerStore((state) => state.updateSettings);
  const resetAllData = useTrackerStore((state) => state.resetAllData);
  const getSnapshot = useTrackerStore((state) => state.getSnapshot);

  const [draft, setDraft] = useState<UserSettings>(settings);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const weeklyLossHint = useMemo(
    () =>
      draft.targetWeeklyLossMin <= draft.targetWeeklyLossMax
        ? "Target range is valid"
        : "Min weekly loss must be <= max weekly loss",
    [draft.targetWeeklyLossMax, draft.targetWeeklyLossMin],
  );

  const updateField = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveSettings = () => {
    try {
      const parsed = userSettingsSchema.parse(draft);
      if (parsed.targetWeeklyLossMin > parsed.targetWeeklyLossMax) {
        throw new Error("Min weekly loss cannot be greater than max weekly loss.");
      }

      updateSettings(parsed);
      setMessage("Settings saved.");
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
      setMessage(null);
    }
  };

  const handleImportPlan = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const json = await readJsonFile(file);
      const plan = validateTrainingPlan(json);
      setTrainingPlan(plan);
      setMessage("Training plan imported.");
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Plan import failed.");
      setMessage(null);
    } finally {
      event.target.value = "";
    }
  };

  const handleExportAllData = () => {
    const snapshot = getSnapshot();
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`liftcut-backup-${date}.json`, snapshot);
  };

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }

    resetAllData();
    setDraft(useTrackerStore.getState().settings);
    setConfirmClear(false);
    setMessage("Local data reset to demo defaults.");
    setError(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">Settings</p>
        <h1 className="text-2xl font-semibold text-slate-900">Settings and Data</h1>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">Profile and Targets</CardTitle>
          <CardDescription>Used by dashboard and trend analysis</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>Height (cm)</Label>
            <Input type="number" value={draft.height} onChange={(event) => updateField("height", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Current Weight (kg)</Label>
            <Input type="number" value={draft.currentWeight} onChange={(event) => updateField("currentWeight", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Target Weight (kg)</Label>
            <Input type="number" value={draft.targetWeight} onChange={(event) => updateField("targetWeight", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Weekly Training Days</Label>
            <Input type="number" value={draft.weeklyTrainingDays} onChange={(event) => updateField("weeklyTrainingDays", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Calorie Target</Label>
            <Input type="number" value={draft.calorieTarget} onChange={(event) => updateField("calorieTarget", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Protein Target</Label>
            <Input type="number" value={draft.proteinTarget} onChange={(event) => updateField("proteinTarget", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Weekly Loss Min (kg)</Label>
            <Input type="number" step="0.1" value={draft.targetWeeklyLossMin} onChange={(event) => updateField("targetWeeklyLossMin", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Weekly Loss Max (kg)</Label>
            <Input type="number" step="0.1" value={draft.targetWeeklyLossMax} onChange={(event) => updateField("targetWeeklyLossMax", numberOrZero(event.target.value))} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Plan Import and Data Export</CardTitle>
            <CardDescription>Plan JSON is validated by Zod</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="file" accept="application/json" onChange={handleImportPlan} />
            <Button variant="outline" className="w-full" onClick={handleExportAllData}>
              <Download className="mr-2 h-4 w-4" />
              Export All Data JSON
            </Button>
            <a
              href="/samples/sample-training-plan.json"
              download
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Upload className="mr-2 h-4 w-4" />
              Download Sample Plan JSON
            </a>
            <Button onClick={handleSaveSettings} className="w-full">
              Save Settings
            </Button>
          </CardContent>
        </Card>

        <Card className="border-rose-200/80 bg-rose-50/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-rose-800">
              <AlertTriangle className="h-4 w-4" />
              Dangerous Action
            </CardTitle>
            <CardDescription className="text-rose-700">
              Local data reset requires second confirmation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="destructive" className="w-full" onClick={handleClear}>
              {confirmClear ? "Click again to confirm reset" : "Reset Local Data"}
            </Button>
            {confirmClear ? (
              <Button variant="outline" className="w-full" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            ) : null}
            <p className="text-xs text-rose-700">Status: {weeklyLossHint}</p>
          </CardContent>
        </Card>
      </div>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}