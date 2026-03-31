import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { AppIntlProvider } from "@/components/i18n/app-intl-provider";
import { AppShell } from "@/components/layout/app-shell";
import { HydrationGate } from "@/components/shared/hydration-gate";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LiftCut Tracker",
  description: "Minimal training plan and fat-loss tracker MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetBrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <AppIntlProvider>
          <HydrationGate>
            <AuthProvider>
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </HydrationGate>
        </AppIntlProvider>
      </body>
    </html>
  );
}