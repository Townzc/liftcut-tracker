import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { AppIntlProvider } from "@/components/i18n/app-intl-provider";
import { AppShell } from "@/components/layout/app-shell";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { ThemeProvider } from "@/components/shared/theme-provider";
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
  metadataBase: new URL("https://www.liftcuttracker.com"),
  title: {
    default: "LiftCut Tracker",
    template: "%s | LiftCut Tracker",
  },
  description:
    "A beginner-friendly, open-source training, nutrition, and body-progress tracker with guest mode and configurable AI planning.",
  applicationName: "LiftCut Tracker",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetBrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">
        <AppIntlProvider>
          <HydrationGate>
            <ThemeProvider>
              <AuthProvider>
                <AppShell>{children}</AppShell>
              </AuthProvider>
            </ThemeProvider>
          </HydrationGate>
        </AppIntlProvider>
      </body>
    </html>
  );
}
