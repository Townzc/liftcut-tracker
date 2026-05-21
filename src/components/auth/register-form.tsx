"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, UserRound, UserRoundPlus } from "lucide-react";

import { AuthExperience } from "@/components/auth/auth-experience";
import { useAuth } from "@/components/auth/auth-provider";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function RegisterForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { startGuestMode } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      setSuccess(t("registerSuccess"));
      setEmail("");
      setPassword("");
      setConfirmPassword("");

      if (signUpData.session) {
        router.replace("/onboarding");
        router.refresh();
      }
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  };

  const handleGuestMode = async () => {
    setGuestLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await startGuestMode();
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("genericError"));
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <AuthExperience title={t("registerTitle")} description={t("registerDesc")}>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              className="h-11 bg-slate-50"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              className="h-11 bg-slate-50"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">{t("confirmPassword")}</Label>
            <Input
              id="confirm-password"
              className="h-11 bg-slate-50"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>

          <ActionFeedback message={success} error={error} />

          <Button className="h-11 w-full bg-slate-950 text-white hover:bg-slate-800" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <UserRoundPlus className="mr-2 h-4 w-4" />}
            {t("registerButton")}
          </Button>

          <Button className="h-11 w-full border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100" type="button" variant="outline" onClick={handleGuestMode} disabled={guestLoading || loading}>
            {guestLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <UserRound className="mr-2 h-4 w-4" />}
            {t("continueAsGuest")}
          </Button>

          <Link href="/login" className="text-sm font-medium text-emerald-700 hover:text-emerald-900">
            {t("toLogin")}
          </Link>
        </form>
    </AuthExperience>
  );
}
