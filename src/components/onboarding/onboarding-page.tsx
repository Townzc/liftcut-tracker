"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";

import { NumericInput } from "@/components/shared/numeric-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeActionError } from "@/lib/error-utils";
import { isBasicProfileComplete } from "@/lib/profile-completion";
import { userSettingsSchema } from "@/lib/schemas";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { UserSettings } from "@/types";

export function OnboardingPage() {
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const settings = useTrackerStore((state) => state.settings);
  const trackerLoading = useTrackerStore((state) => state.loading);
  const ensureUserId = useTrackerStore((state) => state.ensureUserId);
  const updateSettings = useTrackerStore((state) => state.updateSettings);

  const [draft, setDraft] = useState<UserSettings>(settings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const genderOptions = useMemo<Array<{ value: UserSettings["gender"]; label: string }>>(
    () => [
      { value: "male", label: t("genderMale") },
      { value: "female", label: t("genderFemale") },
      { value: "other", label: t("genderOther") },
      { value: "unknown", label: t("genderUnknown") },
    ],
    [t],
  );

  const updateField = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const parsed = userSettingsSchema.parse(draft);
      if (!isBasicProfileComplete(parsed)) {
        throw new Error(t("requiredHint"));
      }

      const resolvedUserId = await ensureUserId();
      await updateSettings({
        ...parsed,
        userId: resolvedUserId,
        updatedAt: new Date().toISOString(),
      });

      router.replace("/");
      router.refresh();
    } catch (submitError) {
      console.error(submitError);
      setError(
        normalizeActionError(submitError, {
          fallback: t("saveFailed"),
          authMessage: tCommon("authRequired"),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const isBusy = loading || trackerLoading;

  return (
    <div className="mx-auto w-full max-w-2xl py-2">
      <Card className="border-slate-200/80 bg-white/95">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">{t("requiredHint")}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("gender")}</Label>
              <Select
                value={draft.gender}
                onValueChange={(value) => updateField("gender", value as UserSettings["gender"])}
                disabled={isBusy}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {genderOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("age")}</Label>
              <NumericInput
                value={draft.age}
                allowDecimal={false}
                onValueChange={(value) => updateField("age", value)}
                min={0}
                max={120}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("height")}</Label>
              <NumericInput value={draft.height} onValueChange={(value) => updateField("height", value)} min={0} max={260} />
            </div>
            <div className="space-y-1">
              <Label>{t("currentWeight")}</Label>
              <NumericInput value={draft.currentWeight} onValueChange={(value) => updateField("currentWeight", value)} min={0} max={300} />
            </div>
            <div className="space-y-1">
              <Label>{t("targetWeight")}</Label>
              <NumericInput value={draft.targetWeight} onValueChange={(value) => updateField("targetWeight", value)} min={0} max={300} />
            </div>
            <div className="space-y-1">
              <Label>{t("weeklyTrainingDays")}</Label>
              <NumericInput
                value={draft.weeklyTrainingDays}
                allowDecimal={false}
                onValueChange={(value) => updateField("weeklyTrainingDays", value)}
                min={0}
                max={7}
              />
            </div>
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={isBusy}>
            {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loading ? t("saving") : t("saveAndEnter")}
          </Button>

          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
