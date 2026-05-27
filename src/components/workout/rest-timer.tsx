"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play, RotateCcw, Timer } from "lucide-react";

import { NumericInput } from "@/components/shared/numeric-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PRESETS = [60, 90, 120, 180] as const;

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function RestTimer() {
  const t = useTranslations("workout");

  const [selectedPreset, setSelectedPreset] = useState<number>(90);
  const [customSeconds, setCustomSeconds] = useState<number>(120);
  const [totalSeconds, setTotalSeconds] = useState<number>(90);
  const [remaining, setRemaining] = useState<number>(90);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isDone, setIsDone] = useState<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimerInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isRunning) {
      clearTimerInterval();
      return;
    }

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearTimerInterval();
          setIsRunning(false);
          setIsDone(true);

          // Vibrate on finish
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }

          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return clearTimerInterval;
  }, [isRunning, clearTimerInterval]);

  const handlePresetSelect = (seconds: number) => {
    if (isRunning) return;
    setSelectedPreset(seconds);
    setTotalSeconds(seconds);
    setRemaining(seconds);
    setIsDone(false);
  };

  const handleCustomChange = (value: number) => {
    if (isRunning) return;
    setCustomSeconds(value);
    setSelectedPreset(0);
    setTotalSeconds(value);
    setRemaining(value);
    setIsDone(false);
  };

  const handleStart = () => {
    if (remaining <= 0) return;
    setIsDone(false);
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleReset = () => {
    setIsRunning(false);
    setRemaining(totalSeconds);
    setIsDone(false);
  };

  const elapsed = totalSeconds - remaining;
  const progressPercent = totalSeconds > 0 ? (elapsed / totalSeconds) * 100 : 0;

  return (
    <Card
      className={`border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90 ${
        isDone
          ? "border-emerald-400 ring-2 ring-emerald-400/50 dark:border-emerald-500 dark:ring-emerald-500/30"
          : ""
      }`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          {t("restTimer")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Countdown display */}
        <div className="flex flex-col items-center gap-1">
          <p
            className={`font-mono text-5xl font-bold tabular-nums tracking-tight ${
              isDone
                ? "text-emerald-600 dark:text-emerald-400 animate-pulse"
                : "text-slate-900 dark:text-slate-100"
            }`}
          >
            {formatTime(remaining)}
          </p>
          {isDone ? (
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              {t("restTimerDone")}
            </p>
          ) : null}
        </div>

        {/* Progress bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-1000 ease-linear dark:bg-emerald-400"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Presets */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t("restTimerPresets")}
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((seconds) => (
              <Button
                key={seconds}
                type="button"
                variant={selectedPreset === seconds ? "default" : "outline"}
                size="sm"
                disabled={isRunning}
                onClick={() => handlePresetSelect(seconds)}
                className={
                  selectedPreset === seconds
                    ? "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                    : ""
                }
              >
                {seconds}s
              </Button>
            ))}
          </div>
        </div>

        {/* Custom duration */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t("restTimerCustom")}
          </p>
          <div className="flex items-center gap-2">
            <NumericInput
              value={customSeconds}
              min={5}
              max={600}
              allowDecimal={false}
              disabled={isRunning}
              onValueChange={handleCustomChange}
              className="w-24"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">s</span>
          </div>
        </div>

        {/* Control buttons */}
        <div className="flex gap-2">
          {isRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePause}
              className="flex-1"
            >
              <Pause className="mr-1.5 h-3.5 w-3.5" />
              {t("restTimerPause")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleStart}
              disabled={remaining <= 0}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {t("restTimerStart")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="flex-1"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("restTimerReset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
