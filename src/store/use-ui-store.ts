"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { defaultLocale } from "@/i18n/config";
import type { AppLocale } from "@/types";

export type ThemeMode = "light" | "dark" | "system";

interface UIState {
  language: AppLocale;
  theme: ThemeMode;
  setLanguage: (locale: AppLocale) => void;
  setTheme: (theme: ThemeMode) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      language: defaultLocale,
      theme: "system" as ThemeMode,
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "liftcut-ui",
      storage: typeof window !== "undefined" ? createJSONStorage(() => localStorage) : undefined,
      partialize: (state) => ({ language: state.language, theme: state.theme }),
    },
  ),
);