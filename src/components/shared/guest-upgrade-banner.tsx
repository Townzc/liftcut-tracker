"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslations,useLocale } from "next-intl";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { normalizeActionError } from "@/lib/error-utils";
import {prepareGuestImport} from "@/services/guest-fact-migration";
import {useTrackerStore} from "@/store/use-tracker-store";
import {entryLines,type PersonalRecord} from "@/lib/personal-records";

export function GuestUpgradeBanner() {
  const t = useTranslations("guest");
  const { authMode, user,pendingGuestMigration, migrateGuestData, dismissGuestMigration } = useAuth();
  const en=useLocale()==="en";
  const [preview,setPreview]=useState<PersonalRecord[]|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authMode !== "authenticated" || !pendingGuestMigration) {
    return null;
  }

  const handleMigrate = async () => {
    setLoading(true);
    setError(null);
    try {
      if(!preview&&user){setPreview(prepareGuestImport({userId:user.id,guestSnapshot:useTrackerStore.getState().getGuestSnapshot()}).records);return;}
      await migrateGuestData();
    } catch (migrationError) {
      setError(
        normalizeActionError(migrationError, {
          fallback: en?"Import is unconfirmed. Local data is retained; retry with this same account.":"同步尚未确认. 本机数据仍保留，请使用当前账号重试.",
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-muted/30 px-4 py-4" data-testid="guest-import">
      <p className="text-sm font-medium">{en?"Sync your guest records":"同步访客记录"}</p>
      <p className="mt-1 text-xs leading-6 text-muted-foreground">{en?"Review confirmed entries before importing them into this account. Your active plans and settings stay as they are.":"先核对访客期间确认保存的数据，再导入当前账号. 当前计划与设置不会被覆盖."}</p>
      {preview&&<div className="mt-3 space-y-3 text-sm" data-testid="guest-import-preview"><p>{en?`${preview.length} entries → ${user?.email}`:`${preview.length} 条记录 → ${user?.email}`}</p><div className="max-h-60 space-y-3 overflow-y-auto rounded-xl border p-3">{preview.map(r=><div key={r.id}><p className="text-xs text-muted-foreground">{r.entry.date}</p>{entryLines(r.entry,en).map((line,i)=><p key={i}>{line}</p>)}</div>)}</div></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={handleMigrate} disabled={loading}>
          {loading ? <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          {loading ? t("migrating") : preview?(en?"Confirm sync":"确认同步"):(en?"Review entries":"核对待同步记录")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={dismissGuestMigration} disabled={loading}>
          {t("migrationLater")}
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{error}</p> : null}
    </div>
  );
}
