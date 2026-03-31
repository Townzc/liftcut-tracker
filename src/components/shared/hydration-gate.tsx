"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import { useTrackerStore } from "@/store/use-tracker-store";

export function HydrationGate({ children }: { children: ReactNode }) {
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
        Loading local data...
      </div>
    );
  }

  return <>{children}</>;
}