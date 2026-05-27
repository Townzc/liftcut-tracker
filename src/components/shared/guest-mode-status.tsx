"use client";

import Link from "next/link";
import { HardDrive, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/components/auth/auth-provider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function GuestModeStatus() {
  const t = useTranslations("guest");
  const { authMode } = useAuth();

  if (authMode !== "guest") {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-100">
      <div className="flex min-w-0 items-center gap-3">
        <div className="rounded-xl bg-amber-100 p-2 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          <HardDrive className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("statusTitle")}</p>
          <p className="text-xs leading-5 text-amber-800 dark:text-amber-300">{t("statusDesc")}</p>
        </div>
      </div>
      <Link
        href="/register"
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "border-amber-300 bg-white/70 text-amber-950 hover:bg-white dark:border-amber-700 dark:bg-slate-800/50 dark:text-amber-100 dark:hover:bg-slate-800",
        )}
      >
        <LogIn className="mr-2 h-3.5 w-3.5" />
        {t("upgradeNow")}
      </Link>
    </div>
  );
}
