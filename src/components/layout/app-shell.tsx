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
  Weight,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const authRoutes = ["/login", "/register", "/forgot-password"];

function NavLink({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const pathname = usePathname();
  const active = pathname === item.href;
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        compact && "flex-1 justify-center px-2",
      )}
    >
      <Icon className={cn("h-4 w-4", compact && "h-5 w-5")} />
      {!compact && <span>{item.label}</span>}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const { loading, profile, user } = useAuth();

  const email = profile?.email || user?.email || "";
  const displayName = profile?.displayName || email.split("@")[0] || "User";

  const navItems: NavItem[] = [
    { href: "/", label: tNav("dashboard"), icon: Home },
    { href: "/plan", label: tNav("plan"), icon: CalendarCheck },
    { href: "/workout", label: tNav("workout"), icon: Dumbbell },
    { href: "/nutrition", label: tNav("nutrition"), icon: Apple },
    { href: "/body", label: tNav("body"), icon: Weight },
    { href: "/settings", label: tNav("settings"), icon: Settings },
  ];

  if (authRoutes.some((route) => pathname.startsWith(route))) {
    return (
      <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,116,144,0.08),transparent_55%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
        <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 md:px-8">
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
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,116,144,0.08),transparent_55%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-slate-200/70 bg-white/90 p-4 backdrop-blur md:block">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="rounded-lg bg-emerald-600 p-2 text-white">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">LiftCut Tracker</p>
            <p className="text-xs text-slate-500">{tNav("subtitle")}</p>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3">
          <UserAvatar displayName={displayName} email={email} avatarUrl={profile?.avatarUrl} className="h-9 w-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{displayName}</p>
            <p className="truncate text-xs text-slate-500">{email || "-"}</p>
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
              <p className="truncate text-xs text-slate-500">{email || "-"}</p>
            </div>
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl p-4 md:p-8">{children}</main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-20 flex items-center gap-1 border-t border-slate-200 bg-white/95 p-2 backdrop-blur md:hidden">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} compact />
        ))}
      </nav>
    </div>
  );
}
