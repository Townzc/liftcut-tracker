"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Dumbbell,
  ExternalLink,
  Globe2,
  HeartPulse,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  beginnerExercises,
  EXERCISE_DATASET_SOURCE,
  filterBeginnerExercises,
  type DemoLocale,
  type ExerciseFocus,
} from "@/lib/beginner-exercises";
import { cn } from "@/lib/utils";

const focusOptions: ExerciseFocus[] = ["all", "upper", "lower", "core"];

const copy = {
  zh: {
    navDemo: "新手动作 Demo",
    website: "官方网站",
    github: "GitHub",
    eyebrow: "无需注册 · 现在就能体验",
    title: "第一次健身，先把动作做明白。",
    description:
      "LiftCut 把动作说明、保守起步剂量与安全提醒放在一起，帮助新手从可控的小训练开始，再把每一次完成记录下来。",
    primaryCta: "进入完整追踪器",
    secondaryCta: "查看开源仓库",
    metricExercises: "6 个入门动作",
    metricLanguages: "中英双语",
    metricCost: "零器械可开始",
    safetyTitle: "先安全，再进步",
    safetyDescription: "这是一份通用入门演示，不替代医生、物理治疗师或持证教练的个体化建议。",
    safetyItems: [
      "从小量开始，逐步增加时长、频率和强度。",
      "正式训练前先用轻松动作热身，并在结束后逐渐降低强度。",
      "出现胸痛、胸闷、明显气短或眩晕时停止运动并寻求医疗评估。",
    ],
    explorerEyebrow: "动作浏览器",
    explorerTitle: "找到今天适合练的动作",
    explorerDescription: "按训练部位筛选，点击卡片查看逐步说明和更简单的版本。",
    searchPlaceholder: "搜索动作、部位或器械",
    focus: { all: "全部", upper: "上肢", lower: "下肢", core: "核心" },
    empty: "没有匹配的动作，试试更短的关键词。",
    target: "主要训练",
    equipment: "需要",
    dose: "建议起步",
    selectedEyebrow: "动作步骤",
    coachingCue: "动作提示",
    easier: "更简单一点",
    source: "动作数据来源",
    sourceNote: "仅使用 MIT 授权的数据与说明文本；未使用参考仓库中需单独授权的图片或视频。",
    sourcesTitle: "依据与边界",
    who: "WHO 身体活动指南",
    aha: "AHA 循序渐进与警示症状建议",
    openSourceTitle: "从 Demo 到长期追踪",
    openSourceDescription:
      "完整应用还提供游客模式、训练计划、饮食记录、体重趋势与可配置 AI 计划。项目公开源代码、测试、部署与贡献流程。",
    visitWebsite: "访问 www.liftcuttracker.com",
    footer: "为第一次开始，也为长期坚持而设计。",
  },
  en: {
    navDemo: "Beginner movement demo",
    website: "Official website",
    github: "GitHub",
    eyebrow: "No signup · Try it now",
    title: "Start by understanding the movement.",
    description:
      "LiftCut puts clear instructions, conservative starting doses, and safety reminders together so beginners can start small and track every session afterward.",
    primaryCta: "Open the full tracker",
    secondaryCta: "View the open-source repo",
    metricExercises: "6 beginner movements",
    metricLanguages: "Chinese + English",
    metricCost: "Start without gym gear",
    safetyTitle: "Safety before progress",
    safetyDescription: "This general beginner demo does not replace individualized advice from a doctor, physical therapist, or qualified coach.",
    safetyItems: [
      "Start with small amounts and gradually increase duration, frequency, and intensity.",
      "Warm up with easy movement, then reduce intensity gradually when finishing.",
      "Stop and seek medical evaluation for chest pain or pressure, unusual shortness of breath, or lightheadedness.",
    ],
    explorerEyebrow: "Movement explorer",
    explorerTitle: "Find a movement for today's session",
    explorerDescription: "Filter by focus and select a card for steps and an easier option.",
    searchPlaceholder: "Search movement, body area, or equipment",
    focus: { all: "All", upper: "Upper", lower: "Lower", core: "Core" },
    empty: "No movement matches. Try a shorter search.",
    target: "Works",
    equipment: "Needs",
    dose: "Start with",
    selectedEyebrow: "Movement steps",
    coachingCue: "Coaching cue",
    easier: "Make it easier",
    source: "Movement data source",
    sourceNote: "Uses MIT-licensed data and instruction text only; no separately licensed images or videos are reused.",
    sourcesTitle: "Evidence and boundaries",
    who: "WHO physical activity guidance",
    aha: "AHA gradual progression and warning signs",
    openSourceTitle: "From a first demo to long-term tracking",
    openSourceDescription:
      "The full app adds guest mode, training plans, nutrition logs, body trends, and configurable AI planning. Its source, tests, deployment, and contribution workflow are public.",
    visitWebsite: "Visit www.liftcuttracker.com",
    footer: "Designed for the first session and the long habit after it.",
  },
} as const;

export function BeginnerDemo() {
  const [locale, setLocale] = useState<DemoLocale>("zh");
  const [focus, setFocus] = useState<ExerciseFocus>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(beginnerExercises[0].id);
  const t = copy[locale];

  const filteredExercises = useMemo(
    () => filterBeginnerExercises(beginnerExercises, query, focus),
    [focus, query],
  );
  const selectedExercise =
    filteredExercises.find((exercise) => exercise.id === selectedId) ?? filteredExercises[0] ?? null;

  return (
    <div className="w-full overflow-hidden rounded-[2rem] border border-white/80 bg-[#f4f7f1] text-slate-950 shadow-[0_30px_90px_rgba(15,23,42,0.12)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-950/10 bg-white/70 px-5 py-4 backdrop-blur sm:px-8">
        <Link href="/demo" className="flex items-center gap-3">
          <span className="rounded-2xl bg-[#172820] p-2.5 text-lime-200">
            <Activity className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold">LiftCut Tracker</span>
            <span className="block text-xs text-slate-500">{t.navDemo}</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-2 text-sm">
          <a
            href="https://www.liftcuttracker.com/"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-medium text-emerald-800 hover:bg-emerald-50"
          >
            <Globe2 className="h-4 w-4" />
            <span className="hidden sm:inline">www.liftcuttracker.com</span>
            <span className="sm:hidden">{t.website}</span>
          </a>
          <a
            href="https://github.com/Townzc/liftcut-tracker"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            <Code2 className="h-4 w-4" />
            {t.github}
          </a>
          <div className="flex rounded-full border border-slate-200 bg-white p-1" aria-label="Language">
            {(["zh", "en"] as const).map((language) => (
              <button
                key={language}
                type="button"
                onClick={() => setLocale(language)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold transition",
                  locale === language ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-900",
                )}
                aria-pressed={locale === language}
              >
                {language === "zh" ? "中" : "EN"}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#172820] px-5 py-14 text-white sm:px-8 lg:px-12 lg:py-20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(190,242,100,0.22),transparent_24%),radial-gradient(circle_at_65%_85%,rgba(45,212,191,0.18),transparent_27%)]" />
          <div className="relative grid gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
            <div>
              <Badge className="mb-5 border border-white/15 bg-white/10 text-lime-100 hover:bg-white/10">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {t.eyebrow}
              </Badge>
              <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                {t.title}
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">{t.description}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "bg-lime-300 text-slate-950 hover:bg-lime-200")}>
                  {t.primaryCta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <a
                  href="https://github.com/Townzc/liftcut-tracker"
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white")}
                >
                  <Code2 className="mr-2 h-4 w-4" />
                  {t.secondaryCta}
                </a>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {[t.metricExercises, t.metricLanguages, t.metricCost].map((metric, index) => (
                <div key={metric} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lime-200">
                    {index === 0 ? <Dumbbell className="h-4 w-4" /> : index === 1 ? <Globe2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  </span>
                  <span className="text-sm font-medium text-white/85">{metric}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 py-8 sm:px-8 lg:px-12">
          <Card className="border-amber-200/80 bg-amber-50/80 shadow-none">
            <CardContent className="grid gap-6 p-5 lg:grid-cols-[0.75fr_1.25fr] lg:p-6">
              <div>
                <div className="mb-3 inline-flex rounded-2xl bg-amber-100 p-2.5 text-amber-800">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-semibold text-amber-950">{t.safetyTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-amber-900/75">{t.safetyDescription}</p>
              </div>
              <ul className="grid gap-3">
                {t.safetyItems.map((item) => (
                  <li key={item} className="flex gap-3 rounded-xl bg-white/70 p-3 text-sm leading-6 text-amber-950">
                    <HeartPulse className="mt-1 h-4 w-4 shrink-0 text-amber-700" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="px-5 pb-12 sm:px-8 lg:px-12">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">{t.explorerEyebrow}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t.explorerTitle}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t.explorerDescription}</p>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.searchPlaceholder}
                className="h-11 bg-white pl-9"
              />
            </div>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {focusOptions.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={focus === option ? "default" : "outline"}
                onClick={() => setFocus(option)}
                className={cn(focus === option && "bg-[#172820] text-white hover:bg-[#22372d]")}
              >
                {t.focus[option]}
              </Button>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {filteredExercises.length > 0 ? filteredExercises.map((exercise) => {
                const active = exercise.id === selectedExercise?.id;
                return (
                  <button
                    key={exercise.id}
                    type="button"
                    onClick={() => setSelectedId(exercise.id)}
                    className={cn(
                      "group flex w-full items-center justify-between gap-3 rounded-2xl border bg-white p-4 text-left transition",
                      active
                        ? "border-emerald-700 ring-2 ring-emerald-700/10"
                        : "border-slate-200 hover:border-emerald-300 hover:shadow-sm",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-emerald-700">{t.focus[exercise.focus]}</span>
                      <span className="mt-1 block text-base font-semibold text-slate-950">{exercise.name[locale]}</span>
                      <span className="mt-1 block truncate text-xs text-slate-500">{exercise.target[locale]} · {exercise.equipment[locale]}</span>
                    </span>
                    <ChevronRight className={cn("h-4 w-4 shrink-0 text-slate-400 transition", active && "text-emerald-700", !active && "group-hover:translate-x-0.5")} />
                  </button>
                );
              }) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-sm text-slate-500 sm:col-span-2 xl:col-span-1">{t.empty}</div>
              )}
            </div>

            {selectedExercise ? (
              <Card className="border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
                <CardHeader className="border-b border-slate-100">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">{t.selectedEyebrow} · #{selectedExercise.id}</p>
                      <CardTitle className="mt-2 text-2xl">{selectedExercise.name[locale]}</CardTitle>
                      <CardDescription className="mt-1">{selectedExercise.sourceName}</CardDescription>
                    </div>
                    <Badge className="bg-lime-100 text-lime-900 hover:bg-lime-100">{selectedExercise.dose[locale]}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{t.target}</p>
                      <p className="mt-1 text-sm font-semibold">{selectedExercise.target[locale]}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{t.equipment}</p>
                      <p className="mt-1 text-sm font-semibold">{selectedExercise.equipment[locale]}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 p-5 sm:p-6">
                  <ol className="space-y-3">
                    {selectedExercise.steps[locale].map((step, index) => (
                      <li key={step} className="flex gap-3 text-sm leading-6 text-slate-700">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#172820] text-xs font-semibold text-lime-200">{index + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">{t.coachingCue}</p>
                      <p className="mt-2 text-sm leading-6 text-emerald-950">{selectedExercise.cue[locale]}</p>
                    </div>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">{t.easier}</p>
                      <p className="mt-2 text-sm leading-6 text-sky-950">{selectedExercise.easier[locale]}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>

        <section className="grid gap-5 border-t border-emerald-950/10 bg-white/70 px-5 py-10 sm:px-8 lg:grid-cols-2 lg:px-12">
          <Card className="border-slate-200 bg-white shadow-none">
            <CardHeader>
              <CardTitle className="text-lg">{t.openSourceTitle}</CardTitle>
              <CardDescription className="leading-6">{t.openSourceDescription}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <a href="https://www.liftcuttracker.com/" className={cn(buttonVariants(), "bg-[#172820] text-white hover:bg-[#22372d]")}>
                {t.visitWebsite}
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
              <Link href="/login" className={buttonVariants({ variant: "outline" })}>{t.primaryCta}</Link>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-none">
            <CardHeader>
              <CardTitle className="text-lg">{t.sourcesTitle}</CardTitle>
              <CardDescription>{t.sourceNote}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <a href={EXERCISE_DATASET_SOURCE} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 font-medium text-slate-700 hover:text-emerald-800">
                {t.source}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <a href="https://www.who.int/news-room/fact-sheets/detail/physical-activity" target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 font-medium text-slate-700 hover:text-emerald-800">
                {t.who}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <a href="https://newsroom.heart.org/news/slow-steady-increase-in-exercise-intensity-is-best-for-heart-health-much-more-is-not-always-much-better" target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 font-medium text-slate-700 hover:text-emerald-800">
                {t.aha}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 bg-[#101c17] px-5 py-5 text-xs text-white/60 sm:px-8 lg:px-12">
        <span>© 2026 LiftCut Tracker</span>
        <span>{t.footer}</span>
      </footer>
    </div>
  );
}
