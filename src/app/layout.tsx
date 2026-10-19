import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";

import { AuthProvider } from "@/components/auth/auth-provider";
import { AppIntlProvider } from "@/components/i18n/app-intl-provider";
import { AppShell } from "@/components/layout/app-shell";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { ServiceWorkerRegistration } from "@/components/shared/service-worker-registration";
import { ThemeProvider } from "@/components/shared/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.liftcuttracker.com"),
  title: {
    default: "LiftCut Tracker",
    template: "%s | LiftCut Tracker",
  },
  description:
    "A beginner-friendly, open-source training, nutrition, and body-progress tracker with guest mode and configurable AI planning.",
  applicationName: "LiftCut Tracker",
  appleWebApp: { capable: true, title: "LiftCut", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "LiftCut Tracker",
    description:
      "Beginner-friendly training, nutrition, and body-progress tracking in one open-source app.",
    url: "https://www.liftcuttracker.com/",
    siteName: "LiftCut Tracker",
    type: "website",
  },
};

const themeScript = `
(function() {
  try {
    var stored = JSON.parse(localStorage.getItem('liftcut-ui'));
    var theme = (stored && stored.state && stored.state.theme) || 'system';
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var shouldDark = theme === 'dark' || (theme === 'system' && prefersDark);
    if (shouldDark) document.documentElement.classList.add('dark');
  } catch(e) {}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  await connection();
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">
        <AppIntlProvider>
          <HydrationGate>
            <ThemeProvider>
              <AuthProvider>
                <AppShell todayEnabled={process.env.FEATURE_TODAY_SESSION === "true"}>{children}</AppShell>
              </AuthProvider>
            </ThemeProvider>
          </HydrationGate>
        </AppIntlProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
