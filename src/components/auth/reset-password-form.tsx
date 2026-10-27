"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AuthExperience } from "./auth-experience";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelRecovery, finishRecovery, openRecovery } from "@/lib/supabase/password-recovery";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const t = useTranslations("auth"), pending = useRef<ReturnType<typeof openRecovery> | null>(null);
  const [identity, setIdentity] = useState<{ id: string; email: string } | null>(null);
  const [state, setState] = useState("checking"), [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    pending.current ??= openRecovery(); // Strict Mode must not exchange the one-use code twice.
    void pending.current.then(user => { if (active) { setIdentity(user); setState("ready"); } })
      .catch(() => { if (active) setState("invalid"); });
    return () => { active = false; };
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!identity || busy) return;
    setError(null);
    if (password !== confirmation) { setError(t("passwordMismatch")); return; }
    setBusy(true);
    try { await finishRecovery(password, identity.id); setPassword(""); setConfirmation(""); setState("done"); }
    catch { setError(t("recoveryUpdateFailed")); }
    finally { setBusy(false); }
  }
  async function leave(path: string) {
    setBusy(true); setError(null);
    try {
      if (state === "done") {
        const { error } = await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
        if (error) throw error;
      } else await cancelRecovery();
      window.location.replace(path);
    } catch { setError(t("genericError")); setBusy(false); }
  }
  return <AuthExperience title={t("forgotTitle")} description={t("recoveryDesc")}>
    {state === "checking" && <p role="status">{t("recoveryChecking")}</p>}
    {state === "invalid" && <p role="alert">{t("recoveryInvalid")}</p>}
    {state === "ready" && <form onSubmit={submit} className="space-y-5">
      <p className="text-sm break-all">{identity?.email}</p>
      <div className="space-y-2"><Label htmlFor="new-password">{t("recoveryNewPassword")}</Label>
        <Input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="confirm-password">{t("confirmPassword")}</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>
      <Button type="submit" className="min-h-11 w-full" disabled={busy}>{t("recoverySave")}</Button>
    </form>}
    {state === "done" && <p role="status">{t("recoveryDone")}</p>}
    {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
    {state !== "checking" && <Button variant="outline" className="mt-5 min-h-11 w-full" disabled={busy}
      onClick={() => void leave(state === "done" ? "/login" : "/forgot-password")}>{t(state === "done" ? "recoveryLogin" : "recoveryRestart")}</Button>}
  </AuthExperience>;
}
