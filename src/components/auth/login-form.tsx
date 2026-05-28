"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, LogIn, MessageCircle, UserRound } from "lucide-react";

import { AuthExperience } from "@/components/auth/auth-experience";
import { useAuth } from "@/components/auth/auth-provider";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const wechatEnabled = process.env.NEXT_PUBLIC_WECHAT_LOGIN_ENABLED === "true";

const oauthErrorMap: Record<string, string> = {
  oauth_cancelled: "oauthCancelled",
  missing_oauth_code: "oauthMissingCode",
  oauth_exchange_failed: "oauthExchangeFailed",
};

export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startGuestMode } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [wechatLoading, setWechatLoading] = useState(false);

  useEffect(() => {
    const oauthError = searchParams.get("error");
    if (oauthError && oauthErrorMap[oauthError]) {
      setError(t(oauthErrorMap[oauthError] as never));
    }
  }, [searchParams, t]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      router.replace("/onboarding");
      router.refresh();
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  };

  const handleGuestMode = async () => {
    setGuestLoading(true);
    setError(null);
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

  const handleWechatLogin = async () => {
    setWechatLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "custom:wechat",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        setWechatLoading(false);
      }
    } catch {
      setError(t("genericError"));
      setWechatLoading(false);
    }
  };

  const isBusy = loading || guestLoading || wechatLoading;

  return (
    <AuthExperience title={t("loginTitle")} description={t("loginDesc")}>
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

          <ActionFeedback error={error} />

          <Button className="h-11 w-full bg-slate-950 text-white hover:bg-slate-800" type="submit" disabled={isBusy}>
            {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
            {t("loginButton")}
          </Button>

          {wechatEnabled ? (
            <Button className="h-11 w-full border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100" type="button" variant="outline" onClick={handleWechatLogin} disabled={isBusy}>
              {wechatLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
              {t("loginWithWechat")}
            </Button>
          ) : null}

          <Button className="h-11 w-full border-slate-200 bg-white text-slate-900 hover:bg-slate-50" type="button" variant="outline" onClick={handleGuestMode} disabled={isBusy}>
            {guestLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <UserRound className="mr-2 h-4 w-4" />}
            {t("continueAsGuest")}
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link href="/register" className="font-medium text-emerald-700 hover:text-emerald-900">
              {t("toRegister")}
            </Link>
            <Link href="/forgot-password" className="font-medium text-slate-500 hover:text-slate-900">
              {t("toForgot")}
            </Link>
          </div>
        </form>
    </AuthExperience>
  );
}
