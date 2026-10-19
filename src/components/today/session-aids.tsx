"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export const REST_PRESETS = [60, 90, 120, 180] as const;
const REST_KEY = "liftcut-rest-seconds";

/** Keeps the screen on during an active workout. Unsupported, denied or hidden-page requests degrade silently. */
export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.wakeLock) return;
    let lock: WakeLockSentinel | null = null, pending = false, stopped = false;
    const acquire = async () => {
      if (stopped || lock || pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (stopped) void next.release().catch(() => {});
        else { lock = next; next.addEventListener("release", () => { if (lock === next) lock = null; }); }
      } catch { /* The workout continues without it. */ } finally { pending = false; }
    };
    // The browser drops the lock when the page is hidden; take it again on return.
    const onVisibility = () => void acquire();
    void acquire(); document.addEventListener("visibilitychange", onVisibility);
    return () => { stopped = true; document.removeEventListener("visibilitychange", onVisibility); void lock?.release().catch(() => {}); lock = null; };
  }, [active]);
}

function storedRestSeconds() {
  try { const value = Number(localStorage.getItem(REST_KEY)); return REST_PRESETS.some(p => p === value) ? value : 90; } catch { return 90; }
}
export type RestTimer = ReturnType<typeof useRestTimer>;
/** Wall-clock based, so background throttling of intervals cannot stretch the rest. */
export function useRestTimer() {
  const [seconds, setSeconds] = useState(storedRestSeconds);
  const [run, setRun] = useState<{ endsAt: number; total: number } | null>(null);
  const choose = useCallback((value: number) => {
    setSeconds(value);
    try { localStorage.setItem(REST_KEY, String(value)); } catch { /* Per-device convenience only. */ }
  }, []);
  return { seconds, choose, run, start: useCallback(() => setRun({ endsAt: Date.now() + seconds * 1000, total: seconds }), [seconds]),
    extend: useCallback(() => setRun(r => r && { endsAt: r.endsAt + 30000, total: r.total + 30 }), []), stop: useCallback(() => setRun(null), []) };
}

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
export function RestTimerBar({ timer }: { timer: RestTimer }) {
  const t = useTranslations("today.rest"), { run } = timer;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!run) return; const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, [run]);
  const remaining = run ? Math.min(run.total, Math.max(0, Math.ceil((run.endsAt - now) / 1000))) : 0;
  const finished = !!run && remaining === 0;
  useEffect(() => { if (finished) try { navigator.vibrate?.([200, 100, 200]); } catch { /* Optional feedback. */ } }, [finished]);
  if (!run) return null;
  return <div role="timer" aria-label={t("title")} data-testid="rest-timer" className="sticky top-2 z-20 flex items-center justify-between gap-3 rounded-xl border bg-background p-3 shadow-sm">
    {finished ? <p role="status" className="text-sm font-medium">{t("done")}</p>
      : <p className="text-sm">{t("title")}<span className="ml-3 font-mono text-2xl tabular-nums">{clock(remaining)}</span></p>}
    <div className="flex gap-2">
      {!finished && <Button size="sm" variant="outline" onClick={timer.extend}>{t("add")}</Button>}
      <Button size="sm" variant="outline" onClick={timer.stop}>{t(finished ? "dismiss" : "stop")}</Button>
    </div>
  </div>;
}

export function RestLength({ timer }: { timer: RestTimer }) {
  const t = useTranslations("today.rest");
  return <label className="flex items-center gap-2 text-xs text-muted-foreground">{t("length")}
    <select className="rounded-lg border bg-background p-2 text-sm text-foreground" value={timer.seconds} onChange={e => timer.choose(Number(e.target.value))}>
      {REST_PRESETS.map(s => <option key={s} value={s}>{t("seconds", { seconds: s })}</option>)}
    </select></label>;
}
