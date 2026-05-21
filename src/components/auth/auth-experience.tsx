"use client";

import { Activity, BarChart3, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function AuthExperience({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const t = useTranslations("auth");

  return (
    <section className="grid min-h-[720px] w-full overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.14)] lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#16251f] p-10 text-white lg:flex">
        <div className="absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(circle_at_35%_30%,rgba(250,204,21,0.22),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(20,184,166,0.24),transparent_30%),linear-gradient(140deg,rgba(255,255,255,0.08),transparent_42%)]" />
        <div className="relative z-10">
          <div className="mb-14 flex items-center gap-3">
            <div className="rounded-2xl bg-lime-300 p-2.5 text-slate-950">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">LiftCut Tracker</p>
              <p className="text-xs text-white/60">{t("productKicker")}</p>
            </div>
          </div>

          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-lime-100">
            <Sparkles className="h-3.5 w-3.5" />
            {t("heroEyebrow")}
          </p>
          <h1 className="max-w-xl text-5xl font-semibold leading-[1.02] tracking-normal">
            {t("heroTitle")}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/70">
            {t("heroDesc")}
          </p>
        </div>

        <div className="relative z-10 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/12 bg-white/10 p-4 backdrop-blur">
            <BarChart3 className="mb-4 h-5 w-5 text-lime-200" />
            <p className="text-2xl font-semibold">7d</p>
            <p className="mt-1 text-xs leading-5 text-white/60">{t("heroMetricTrend")}</p>
          </div>
          <div className="rounded-2xl border border-white/12 bg-white/10 p-4 backdrop-blur">
            <ShieldCheck className="mb-4 h-5 w-5 text-teal-200" />
            <p className="text-2xl font-semibold">{t("heroMetricLocal")}</p>
            <p className="mt-1 text-xs leading-5 text-white/60">{t("heroMetricGuest")}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-[linear-gradient(135deg,#fbfdf8_0%,#eef7f2_46%,#f8fafc_100%)] p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-7 lg:hidden">
            <div className="mb-4 inline-flex rounded-2xl bg-slate-900 p-2.5 text-lime-200">
              <Activity className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-500">LiftCut Tracker</p>
          </div>
          <div className="rounded-3xl border border-slate-200/80 bg-white/[0.92] p-6 shadow-[0_20px_55px_rgba(15,23,42,0.08)] sm:p-8">
            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                LiftCut Tracker
              </p>
              <h2 className="text-3xl font-semibold tracking-normal text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
            </div>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
