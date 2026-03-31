"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useTrackerStore } from "@/store/use-tracker-store";

export function HydrationGate({ children }: { children: ReactNode }) {
  const tCommon = useTranslations("common");
  const hydrated = useTrackerStore((state) => state.hydrated);
  const markHydrated = useTrackerStore((state) => state.markHydrated);

  useEffect(() => {
    if (!hydrated) {
      markHydrated();
    }
  }, [hydrated, markHydrated]);

  if (!hydrated) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        {tCommon("loading")}
      </div>
    );
  }

  return <>{children}</>;
}