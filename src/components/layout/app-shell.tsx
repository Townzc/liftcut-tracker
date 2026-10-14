"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Home, MessageCircle, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { GuestUpgradeBanner } from "@/components/shared/guest-upgrade-banner";
import { UserAvatar } from "@/components/shared/user-avatar";
import { PersonalRecordsProvider } from "@/components/agent/personal-records-provider";
import { cn } from "@/lib/utils";

const shellFreeRoutes = ["/login", "/register", "/forgot-password", "/onboarding", "/demo"];
const primaryRoutes = ["/", "/agent", "/coach", "/settings"];

export function AppShell({ children }: { children: ReactNode; todayEnabled?: boolean }) {
  const pathname = usePathname(), locale = useLocale(), t = useTranslations("common");
  const { loading, profile, user, authMode } = useAuth();
  const en = locale === "en";
  const email = profile?.email || user?.email || "";
  const displayName = authMode === "guest" ? (en ? "Guest" : "访客") : profile?.displayName || email.split("@")[0] || "LiftCut";
  const nav = [
    { href: "/", label: en ? "Home" : "首页", icon: Home, active: pathname === "/" },
    { href: "/agent", label: "Agent", icon: MessageCircle, active: !["/", "/settings"].includes(pathname) },
    { href: "/settings", label: en ? "Settings" : "设置", icon: Settings, active: pathname === "/settings" },
  ];
  if (shellFreeRoutes.some(route => pathname.startsWith(route))) return <main className="mx-auto flex min-h-dvh w-full max-w-6xl items-center px-5 py-8">{children}</main>;
  if (loading) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">{t("loading")}</div>;
  return <PersonalRecordsProvider key={user?.id ?? authMode} owner={user?.id ?? null}>
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-20 max-w-5xl items-center justify-between px-6 sm:px-10">
        <Link href="/" className="text-lg font-semibold tracking-[-0.06em]" aria-label="LiftCut">liftcut<span className="text-muted-foreground">.</span></Link>
        <Link href="/settings" className="flex min-h-11 items-center gap-2.5 rounded-full text-sm text-muted-foreground transition-colors hover:text-foreground" aria-label={en ? "Account settings" : "账号设置"}>
          <span className="max-w-32 truncate">{displayName}</span>
          <UserAvatar displayName={displayName} email={email} avatarUrl={profile?.avatarUrl} className="size-8 bg-muted text-foreground" textClassName="text-xs" />
        </Link>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-4xl px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-10">
        <GuestUpgradeBanner />
        {authMode === "guest" && <p className="mb-5 text-center text-xs text-muted-foreground">{en ? "Guest · data stays on this device" : "访客模式 · 数据保存在本机"}<Link href="/login" className="ml-3 underline underline-offset-4">{en ? "Sign in" : "登录同步"}</Link></p>}
        {!primaryRoutes.includes(pathname) && <Link href="/agent" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{en ? "Back to Agent" : "返回 Agent"}</Link>}
        {children}
      </main>
      <nav aria-label={en ? "Main navigation" : "主导航"} className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto grid h-[72px] max-w-md grid-cols-3 items-center px-5">
          {nav.map(({icon: Icon, ...item}) => <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}
            className={cn("mx-auto flex min-h-12 w-24 flex-col items-center justify-center gap-1.5 rounded-2xl text-[11px] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2", item.active ? "font-semibold text-foreground" : "text-muted-foreground")}>
            <Icon className="size-5" strokeWidth={item.active ? 2 : 1.5} aria-hidden="true" /><span>{item.label}</span>
          </Link>)}
        </div>
      </nav>
    </div>
  </PersonalRecordsProvider>;
}
