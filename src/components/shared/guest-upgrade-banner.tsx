"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { normalizeActionError } from "@/lib/error-utils";

export function GuestUpgradeBanner() {
  const t = useTranslations("guest");
  const { authMode, pendingGuestMigration, migrateGuestData, dismissGuestMigration } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authMode !== "authenticated" || !pendingGuestMigration) {
    return null;
  }

  const handleMigrate = async () => {
    setLoading(true);
    setError(null);
    try {
      await migrateGuestData();
    } catch (migrationError) {
      console.error(migrationError);
      setError(
        normalizeActionError(migrationError, {
          fallback: t("migrationFailed"),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <p className="text-sm font-medium text-emerald-900">{t("migrationPromptTitle")}</p>
      <p className="mt-1 text-xs text-emerald-800">{t("migrationPromptDesc")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={handleMigrate} disabled={loading}>
          {loading ? <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          {loading ? t("migrating") : t("migrationConfirm")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={dismissGuestMigration} disabled={loading}>
          {t("migrationLater")}
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
