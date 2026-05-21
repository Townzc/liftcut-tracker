"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, MailCheck } from "lucide-react";

import { AuthExperience } from "@/components/auth/auth-experience";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setSuccess(t("forgotSuccess"));
      setEmail("");
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthExperience title={t("forgotTitle")} description={t("forgotDesc")}>
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

          <ActionFeedback message={success} error={error} />

          <Button className="h-11 w-full bg-slate-950 text-white hover:bg-slate-800" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <MailCheck className="mr-2 h-4 w-4" />}
            {t("forgotButton")}
          </Button>

          <Link href="/login" className="text-sm font-medium text-emerald-700 hover:text-emerald-900">
            {t("toLogin")}
          </Link>
        </form>
    </AuthExperience>
  );
}
