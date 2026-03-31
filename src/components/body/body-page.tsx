"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Trash2 } from "lucide-react";

import { SimpleLineChart } from "@/components/charts/simple-line-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { compareDateAsc, todayString } from "@/lib/date";
import {
  getAverageWeightByDays,
  getBodyTrendData,
  getWeeklyWeightChange,
} from "@/lib/metrics";
import { useTrackerStore } from "@/store/use-tracker-store";

function parseNumber(value: string): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function BodyPage() {
  const t = useTranslations("body");
  const tNav = useTranslations("nav");

  const bodyMetricLogs = useTrackerStore((state) => state.bodyMetricLogs);
  const addBodyMetricLog = useTrackerStore((state) => state.addBodyMetricLog);
  const deleteBodyMetricLog = useTrackerStore((state) => state.deleteBodyMetricLog);

  const [date, setDate] = useState(todayString());
  const [weight, setWeight] = useState(0);
  const [waist, setWaist] = useState(0);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedLogs = useMemo(
    () => [...bodyMetricLogs].sort((a, b) => compareDateAsc(b.date, a.date)),
    [bodyMetricLogs],
  );
  const trendData = useMemo(() => getBodyTrendData(bodyMetricLogs), [bodyMetricLogs]);

  const recent7DayAverage = useMemo(() => getAverageWeightByDays(bodyMetricLogs, 7), [bodyMetricLogs]);
  const weeklyWeightDelta = useMemo(() => getWeeklyWeightChange(bodyMetricLogs), [bodyMetricLogs]);
  const recentWaistAvg = useMemo(() => {
    const values = [...bodyMetricLogs]
      .sort((a, b) => compareDateAsc(b.date, a.date))
      .slice(0, 7)
      .map((item) => item.waist);
    return average(values);
  }, [bodyMetricLogs]);

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async () => {
    clearFeedback();

    if (weight <= 0) {
      setError(t("errorWeightRequired"));
      return;
    }

    if (waist <= 0) {
      setError(t("errorWaistRequired"));
      return;
    }

    setIsSaving(true);

    try {
      await addBodyMetricLog({
        date,
        weight,
        waist,
        notes,
      });

      setNotes("");
      setMessage(t("saveSuccess"));
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    clearFeedback();
    setDeletingId(id);

    try {
      await deleteBodyMetricLog(id);
      setMessage(t("deleteSuccess"));
    } catch (deleteError) {
      console.error(deleteError);
      setError(deleteError instanceof Error ? deleteError.message : t("deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">{tNav("body")}</p>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardDescription>{t("avg7")}</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {recent7DayAverage !== null ? `${recent7DayAverage.toFixed(1)} kg` : "-"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardDescription>{t("weeklyTrend")}</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {weeklyWeightDelta !== null ? `${weeklyWeightDelta > 0 ? "-" : "+"}${Math.abs(weeklyWeightDelta).toFixed(2)} kg` : "-"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardDescription>{t("waistAvg7")}</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {recentWaistAvg !== null ? `${recentWaistAvg.toFixed(1)} cm` : "-"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{t("addEntryTitle")}</CardTitle>
            <CardDescription>{t("addEntryDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1">
              <Label>{t("date")}</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("weight")}</Label>
              <Input type="number" value={weight} onChange={(event) => setWeight(parseNumber(event.target.value))} />
            </div>
            <div className="space-y-1">
              <Label>{t("waist")}</Label>
              <Input type="number" value={waist} onChange={(event) => setWaist(parseNumber(event.target.value))} />
            </div>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("optionalNote")} />
            <Button className="w-full" onClick={handleSubmit} disabled={isSaving || deletingId !== null}>
              {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("save")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{t("weightTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <SimpleLineChart data={trendData} lines={[{ key: "weight", color: "#0f766e", name: "Weight" }]} />
            ) : (
              <EmptyState title={t("noWeightTitle")} description={t("noWeightDesc")} />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">{t("waistTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <SimpleLineChart data={trendData} lines={[{ key: "waist", color: "#ea580c", name: "Waist" }]} />
            ) : (
              <EmptyState title={t("noWaistTitle")} description={t("noWaistDesc")} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">{t("historyTitle")}</CardTitle>
          <CardDescription>{t("historyDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {sortedLogs.length === 0 ? (
            <EmptyState title={t("noHistoryTitle")} description={t("noHistoryDesc")} />
          ) : (
            sortedLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{log.date}</p>
                  <p className="text-xs text-slate-600">
                    {t("historyLine", {
                      weight: log.weight,
                      waist: log.waist,
                      note: log.notes ? `| ${log.notes}` : "",
                    })}
                  </p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => handleDelete(log.id)} disabled={isSaving || deletingId !== null}>
                  {deletingId === log.id ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-rose-600" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  )}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
