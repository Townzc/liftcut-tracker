"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Activity,
  Apple,
  CalendarCheck,
  Dumbbell,
  Home,
  Settings,
  Sparkles,
  Weight,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { GuestUpgradeBanner } from "@/components/shared/guest-upgrade-banner";
import { GuestModeStatus } from "@/components/shared/guest-mode-status";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ className?: string }>;
  showInMobile?: boolean;
}

const shellFreeRoutes = ["/login", "/register", "/forgot-password", "/onboarding"];

function NavLink({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const pathname = usePathname();
  const active = pathname === item.href;
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[#18251f] text-lime-100 shadow-sm"
          : "text-slate-600 hover:bg-white hover:text-slate-950",
        compact && "flex-1 min-w-0 flex-col justify-center gap-1 px-1 py-1.5",
      )}
    >
      <Icon className={cn("h-4 w-4", compact && "h-4 w-4")} />
      {compact ? (
        <span className="w-full truncate text-center text-[10px] leading-tight">{item.shortLabel}</span>
      ) : (
        <span>{item.label}</span>
      )}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tGuest = useTranslations("guest");
  const pathname = usePathname();
  const { loading, profile, user, authMode } = useAuth();

  const email = profile?.email || user?.email || "";
  const displayName =
    authMode === "guest"
      ? tGuest("badge")
      : profile?.displayName || email.split("@")[0] || "User";
  const secondaryLabel = authMode === "guest" ? tGuest("localOnlyHint") : email || "-";

  const navItems: NavItem[] = [
    { href: "/", label: tNav("dashboard"), shortLabel: tNav("dashboardShort"), icon: Home },
    { href: "/plan", label: tNav("plan"), shortLabel: tNav("planShort"), icon: CalendarCheck },
    { href: "/plan/ai", label: tNav("aiPlanner"), shortLabel: tNav("aiPlannerShort"), icon: Sparkles, showInMobile: false },
    { href: "/workout", label: tNav("workout"), shortLabel: tNav("workoutShort"), icon: Dumbbell },
    { href: "/nutrition", label: tNav("nutrition"), shortLabel: tNav("nutritionShort"), icon: Apple },
    { href: "/body", label: tNav("body"), shortLabel: tNav("bodyShort"), icon: Weight },
    { href: "/settings", label: tNav("settings"), shortLabel: tNav("settingsShort"), icon: Settings },
  ];

  if (shellFreeRoutes.some((route) => pathname.startsWith(route))) {
    return (
      <div className="relative min-h-screen bg-[#eef4ed]">
        <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 md:px-8">
          {children}
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {tCommon("loading")}
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#f4f7f2]">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-slate-200/70 bg-[#eef4ed]/95 p-4 backdrop-blur md:block">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="rounded-xl bg-[#18251f] p-2 text-lime-200">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">LiftCut Tracker</p>
            <p className="text-xs text-slate-500">{tNav("subtitle")}</p>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm">
          <UserAvatar displayName={displayName} email={email} avatarUrl={profile?.avatarUrl} className="h-9 w-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{displayName}</p>
            <p className="truncate text-xs text-slate-500">{secondaryLabel}</p>
          </div>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>
      </aside>

      <div className="pb-20 md:ml-64 md:pb-0">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-4 md:hidden">
          <div className="flex items-center gap-2">
            <UserAvatar displayName={displayName} email={email} avatarUrl={profile?.avatarUrl} className="h-8 w-8" textClassName="text-xs" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{displayName}</p>
              <p className="truncate text-xs text-slate-500">{secondaryLabel}</p>
            </div>
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-8">
          <GuestModeStatus />
          <GuestUpgradeBanner />
          {children}
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-20 flex items-center gap-1 border-t border-slate-200 bg-white/95 p-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        {navItems.filter((item) => item.showInMobile !== false).map((item) => (
          <NavLink key={item.href} item={item} compact />
        ))}
      </nav>
    </div>
  );
}
