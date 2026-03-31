"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Download, Upload } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
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
import { downloadJson, readJsonFile, validateTrainingPlan } from "@/lib/import-export";
import { userSettingsSchema } from "@/lib/schemas";
import { exportUserData } from "@/services/data-repository";
import { useTrackerStore } from "@/store/use-tracker-store";
import { useUIStore } from "@/store/use-ui-store";
import type { AppLocale, UserSettings } from "@/types";

function numberOrZero(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function SettingsPage() {
  const t = useTranslations("settings");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");

  const language = useUIStore((state) => state.language);
  const setLanguage = useUIStore((state) => state.setLanguage);

  const settings = useTrackerStore((state) => state.settings);
  const setTrainingPlan = useTrackerStore((state) => state.setTrainingPlan);
  const updateSettings = useTrackerStore((state) => state.updateSettings);
  const resetAllData = useTrackerStore((state) => state.resetAllData);

  const { user, profile, signOut, setPreferredLanguage } = useAuth();

  const [draft, setDraft] = useState<UserSettings>(settings);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const weeklyLossHint = useMemo(
    () =>
      draft.targetWeeklyLossMin <= draft.targetWeeklyLossMax
        ? t("rangeOk")
        : t("rangeInvalid"),
    [draft.targetWeeklyLossMax, draft.targetWeeklyLossMin, t],
  );

  const updateField = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveSettings = async () => {
    try {
      const parsed = userSettingsSchema.parse(draft);
      if (parsed.targetWeeklyLossMin > parsed.targetWeeklyLossMax) {
        throw new Error(t("rangeInvalid"));
      }

      await updateSettings({
        ...parsed,
        userId: settings.userId,
        updatedAt: new Date().toISOString(),
      });
      setMessage(t("saved"));
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"));
      setMessage(null);
    }
  };

  const handleImportPlan = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !settings.userId) {
      return;
    }

    try {
      const json = await readJsonFile(file);
      const plan = validateTrainingPlan(json, { userId: settings.userId });
      await setTrainingPlan(plan);
      setMessage(t("saved"));
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t("saveFailed"));
      setMessage(null);
    } finally {
      event.target.value = "";
    }
  };

  const handleExportAllData = async () => {
    if (!settings.userId) {
      return;
    }

    const snapshot = await exportUserData(settings.userId);
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`liftcut-backup-${date}.json`, snapshot);
  };

  const handleLanguageChange = async (nextLanguage: AppLocale) => {
    try {
      setLanguage(nextLanguage);
      await setPreferredLanguage(nextLanguage);
      setMessage(t("languageSaved"));
      setError(null);
    } catch (languageError) {
      setError(languageError instanceof Error ? languageError.message : t("saveFailed"));
      setMessage(null);
    }
  };

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }

    await resetAllData();
    setDraft(useTrackerStore.getState().settings);
    setConfirmClear(false);
    setMessage(t("resetDone"));
    setError(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("settings")}</p>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("profileTitle")}</CardTitle>
          <CardDescription>{t("profileDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>{t("height")}</Label>
            <Input type="number" value={draft.height} onChange={(event) => updateField("height", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>{t("currentWeight")}</Label>
            <Input type="number" value={draft.currentWeight} onChange={(event) => updateField("currentWeight", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>{t("targetWeight")}</Label>
            <Input type="number" value={draft.targetWeight} onChange={(event) => updateField("targetWeight", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>{t("weeklyTrainingDays")}</Label>
            <Input type="number" value={draft.weeklyTrainingDays} onChange={(event) => updateField("weeklyTrainingDays", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>{t("calorieTarget")}</Label>
            <Input type="number" value={draft.calorieTarget} onChange={(event) => updateField("calorieTarget", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>{t("proteinTarget")}</Label>
            <Input type="number" value={draft.proteinTarget} onChange={(event) => updateField("proteinTarget", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>{t("weeklyLossMin")}</Label>
            <Input type="number" step="0.1" value={draft.targetWeeklyLossMin} onChange={(event) => updateField("targetWeeklyLossMin", numberOrZero(event.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>{t("weeklyLossMax")}</Label>
            <Input type="number" step="0.1" value={draft.targetWeeklyLossMax} onChange={(event) => updateField("targetWeeklyLossMax", numberOrZero(event.target.value))} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{t("planAndExportTitle")}</CardTitle>
            <CardDescription>{t("planAndExportDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="file" accept="application/json" onChange={handleImportPlan} />
            <Button variant="outline" className="w-full" onClick={handleExportAllData}>
              <Download className="mr-2 h-4 w-4" />
              {t("exportAll")}
            </Button>
            <a
              href="/samples/sample-training-plan.json"
              download
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Upload className="mr-2 h-4 w-4" />
              {t("downloadSample")}
            </a>
            <Button onClick={handleSaveSettings} className="w-full">
              {t("saveSettings")}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{t("accountTitle")}</CardTitle>
            <CardDescription>{t("email")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
              {profile?.email || user?.email || "-"}
            </p>
            <div className="space-y-1">
              <Label>{t("language")}</Label>
              <Select value={language} onValueChange={(value) => handleLanguageChange(value as AppLocale)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh-CN">{t("languageZh")}</SelectItem>
                  <SelectItem value="en">{t("languageEn")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="w-full" onClick={signOut}>
              {t("logout")}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-rose-200/80 bg-rose-50/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-rose-800">
              <AlertTriangle className="h-4 w-4" />
              {t("dangerTitle")}
            </CardTitle>
            <CardDescription className="text-rose-700">
              {t("dangerDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="destructive" className="w-full" onClick={handleClear}>
              {confirmClear ? t("resetConfirm") : t("reset")}
            </Button>
            {confirmClear ? (
              <Button variant="outline" className="w-full" onClick={() => setConfirmClear(false)}>
                {tCommon("cancel")}
              </Button>
            ) : null}
            <p className="text-xs text-rose-700">{t("status", { value: weeklyLossHint })}</p>
          </CardContent>
        </Card>
      </div>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}