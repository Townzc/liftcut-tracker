"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Download, LoaderCircle, Trash2, Upload } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { NumericInput } from "@/components/shared/numeric-input";
import { UserAvatar } from "@/components/shared/user-avatar";
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
import { normalizeActionError } from "@/lib/error-utils";
import { downloadJson } from "@/lib/import-export";
import { userSettingsSchema } from "@/lib/schemas";
import { clearUserAvatar, exportUserData, uploadUserAvatar } from "@/services/data-repository";
import { useTrackerStore } from "@/store/use-tracker-store";
import { useUIStore } from "@/store/use-ui-store";
import type { AppLocale, UserSettings } from "@/types";

type SettingsAction =
  | "save-profile"
  | "upload-avatar"
  | "remove-avatar"
  | "save"
  | "export-data"
  | "language"
  | "logout"
  | "reset";

export function SettingsPage() {
  const t = useTranslations("settings");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");

  const language = useUIStore((state) => state.language);

  const settings = useTrackerStore((state) => state.settings);
  const trackerLoading = useTrackerStore((state) => state.loading);
  const ensureUserId = useTrackerStore((state) => state.ensureUserId);
  const updateSettings = useTrackerStore((state) => state.updateSettings);
  const resetAllData = useTrackerStore((state) => state.resetAllData);

  const { user, profile, signOut, setPreferredLanguage, updateProfile } = useAuth();

  const [draft, setDraft] = useState<UserSettings>(settings);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadingAction, setLoadingAction] = useState<SettingsAction | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    const email = profile?.email || user?.email || "";
    const fallback = email.split("@")[0] || "";
    setDisplayName(profile?.displayName || fallback);
  }, [profile?.displayName, profile?.email, user?.email]);

  const weeklyLossHint = useMemo(
    () =>
      draft.targetWeeklyLossMin <= draft.targetWeeklyLossMax
        ? t("rangeOk")
        : t("rangeInvalid"),
    [draft.targetWeeklyLossMax, draft.targetWeeklyLossMin, t],
  );
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

  const avatarMaxSize = 5 * 1024 * 1024;
  const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const email = profile?.email || user?.email || "-";

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const handleSaveProfile = async () => {
    setLoadingAction("save-profile");
    clearFeedback();

    try {
      const trimmedName = displayName.trim();
      if (!trimmedName) {
        throw new Error(t("displayNameRequired"));
      }
      if (trimmedName.length > 30) {
        throw new Error(t("displayNameTooLong"));
      }

      await updateProfile({ displayName: trimmedName });
      setMessage(t("profileSaved"));
    } catch (profileError) {
      console.error(profileError);
      setError(
        normalizeActionError(profileError, {
          fallback: t("profileSaveFailed"),
          authMessage: t("authRequired"),
          schemaMessage: t("profileSchemaUpgradeRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    setLoadingAction("upload-avatar");
    clearFeedback();

    try {
      const resolvedUserId = await ensureUserId();
      if (!supportedImageTypes.has(file.type)) {
        throw new Error(t("avatarInvalidType"));
      }

      if (file.size > avatarMaxSize) {
        throw new Error(t("avatarTooLarge"));
      }

      const { avatarUrl } = await uploadUserAvatar(resolvedUserId, file, profile?.avatarUrl);
      await updateProfile({ avatarUrl });
      setMessage(t("avatarUploadSuccess"));
    } catch (uploadError) {
      console.error(uploadError);
      setError(
        normalizeActionError(uploadError, {
          fallback: t("avatarUploadFailed"),
          authMessage: t("authRequired"),
          schemaMessage: t("profileSchemaUpgradeRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAvatarRemove = async () => {
    setLoadingAction("remove-avatar");
    clearFeedback();

    try {
      const resolvedUserId = await ensureUserId();
      await clearUserAvatar(resolvedUserId, profile?.avatarUrl);
      await updateProfile({ avatarUrl: null });
      setMessage(t("avatarRemoveSuccess"));
    } catch (removeError) {
      console.error(removeError);
      setError(
        normalizeActionError(removeError, {
          fallback: t("avatarRemoveFailed"),
          authMessage: t("authRequired"),
          schemaMessage: t("profileSchemaUpgradeRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSaveSettings = async () => {
    setLoadingAction("save");
    clearFeedback();

    try {
      const parsed = userSettingsSchema.parse(draft);
      if (parsed.targetWeeklyLossMin > parsed.targetWeeklyLossMax) {
        throw new Error(t("rangeInvalid"));
      }

      const resolvedUserId = await ensureUserId();

      await updateSettings({
        ...parsed,
        userId: resolvedUserId,
        updatedAt: new Date().toISOString(),
      });
      setMessage(t("saved"));
    } catch (saveError) {
      console.error(saveError);
      setError(
        normalizeActionError(saveError, {
          fallback: t("saveFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleExportAllData = async () => {
    setLoadingAction("export-data");
    clearFeedback();

    try {
      const resolvedUserId = await ensureUserId();
      const snapshot = await exportUserData(resolvedUserId);
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(`liftcut-backup-${date}.json`, snapshot);
      setMessage(t("exportDataSuccess"));
    } catch (exportError) {
      console.error(exportError);
      setError(
        normalizeActionError(exportError, {
          fallback: t("exportDataFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleLanguageChange = async (nextLanguage: AppLocale) => {
    setLoadingAction("language");
    clearFeedback();

    try {
      await setPreferredLanguage(nextLanguage);
      setMessage(t("languageSaved"));
    } catch (languageError) {
      console.error(languageError);
      setError(
        normalizeActionError(languageError, {
          fallback: t("saveFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSignOut = async () => {
    setLoadingAction("logout");
    clearFeedback();

    try {
      await signOut();
    } catch (logoutError) {
      console.error(logoutError);
      setError(
        normalizeActionError(logoutError, {
          fallback: t("logoutFailed"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }

    setLoadingAction("reset");
    clearFeedback();

    try {
      await resetAllData();
      setDraft(useTrackerStore.getState().settings);
      setConfirmClear(false);
      setMessage(t("resetDone"));
    } catch (clearError) {
      console.error(clearError);
      setError(
        normalizeActionError(clearError, {
          fallback: t("resetFailed"),
          authMessage: t("authRequired"),
        }),
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const isBusy = loadingAction !== null || trackerLoading;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("settings")}</p>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("identityTitle")}</CardTitle>
          <CardDescription>{t("identityDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <UserAvatar
              displayName={profile?.displayName || displayName}
              email={profile?.email || user?.email}
              avatarUrl={profile?.avatarUrl}
              className="h-16 w-16 text-xl"
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy || loadingAction === "upload-avatar"}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {loadingAction === "upload-avatar" ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {loadingAction === "upload-avatar" ? t("avatarUploading") : t("avatarUpload")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy || !profile?.avatarUrl}
                  onClick={handleAvatarRemove}
                >
                  {loadingAction === "remove-avatar" ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  {loadingAction === "remove-avatar" ? t("avatarRemoving") : t("avatarRemove")}
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                {t("avatarInvalidType")} {t("avatarTooLarge")}
              </p>
            </div>
          </div>

          <input
            ref={avatarInputRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleAvatarFileChange}
            disabled={isBusy}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="display-name">{t("displayName")}</Label>
              <Input
                id="display-name"
                value={displayName}
                maxLength={30}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("email")}</Label>
              <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">{email}</p>
            </div>
          </div>

          <Button type="button" onClick={handleSaveProfile} disabled={isBusy}>
            {loadingAction === "save-profile" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loadingAction === "save-profile" ? t("profileSaving") : t("profileSave")}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("profileTitle")}</CardTitle>
          <CardDescription>{t("profileDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
            <NumericInput value={draft.weeklyTrainingDays} allowDecimal={false} onValueChange={(value) => updateField("weeklyTrainingDays", value)} min={0} max={7} />
          </div>
          <div className="space-y-1">
            <Label>{t("calorieTarget")}</Label>
            <NumericInput value={draft.calorieTarget} allowDecimal={false} onValueChange={(value) => updateField("calorieTarget", value)} min={0} max={7000} />
          </div>
          <div className="space-y-1">
            <Label>{t("proteinTarget")}</Label>
            <NumericInput value={draft.proteinTarget} allowDecimal={false} onValueChange={(value) => updateField("proteinTarget", value)} min={0} max={400} />
          </div>
          <div className="space-y-1">
            <Label>{t("weeklyLossMin")}</Label>
            <NumericInput step="0.1" value={draft.targetWeeklyLossMin} onValueChange={(value) => updateField("targetWeeklyLossMin", value)} min={0} max={3} />
          </div>
          <div className="space-y-1">
            <Label>{t("weeklyLossMax")}</Label>
            <NumericInput step="0.1" value={draft.targetWeeklyLossMax} onValueChange={(value) => updateField("targetWeeklyLossMax", value)} min={0} max={3} />
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
            <Button variant="outline" className="w-full" onClick={handleExportAllData} disabled={isBusy}>
              {loadingAction === "export-data" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {loadingAction === "export-data" ? t("exportingData") : t("exportAll")}
            </Button>
            <Button onClick={handleSaveSettings} className="w-full" disabled={isBusy}>
              {loadingAction === "save" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loadingAction === "save" ? t("savingSettings") : t("saveSettings")}
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
              {email}
            </p>
            <div className="space-y-1">
              <Label>{t("language")}</Label>
              <Select value={language} onValueChange={(value) => handleLanguageChange(value as AppLocale)} disabled={isBusy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh-CN">{t("languageZh")}</SelectItem>
                  <SelectItem value="en">{t("languageEn")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="w-full" onClick={handleSignOut} disabled={isBusy}>
              {loadingAction === "logout" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loadingAction === "logout" ? t("loggingOut") : t("logout")}
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
            <Button variant="destructive" className="w-full" onClick={handleClear} disabled={isBusy && loadingAction !== "reset"}>
              {loadingAction === "reset" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loadingAction === "reset" ? t("resetting") : confirmClear ? t("resetConfirm") : t("reset")}
            </Button>
            {confirmClear ? (
              <Button variant="outline" className="w-full" onClick={() => setConfirmClear(false)} disabled={isBusy}>
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
