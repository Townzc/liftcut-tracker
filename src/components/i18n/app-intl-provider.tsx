"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import { appMessages } from "@/i18n/messages";
import { useUIStore } from "@/store/use-ui-store";

export function AppIntlProvider({ children }: { children: ReactNode }) {
  const language = useUIStore((state) => state.language);

  return (
    <NextIntlClientProvider locale={language} messages={appMessages[language]}>
      {children}
    </NextIntlClientProvider>
  );
}