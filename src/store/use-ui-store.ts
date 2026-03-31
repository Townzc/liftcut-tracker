"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { defaultLocale } from "@/i18n/config";
import type { AppLocale } from "@/types";

interface UIState {
  language: AppLocale;
  setLanguage: (locale: AppLocale) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      language: defaultLocale,
      setLanguage: (language) => set({ language }),
    }),
    {
      name: "liftcut-ui",
      storage: typeof window !== "undefined" ? createJSONStorage(() => localStorage) : undefined,
      partialize: (state) => ({ language: state.language }),
    },
  ),
);