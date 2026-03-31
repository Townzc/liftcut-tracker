"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

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
  const bodyMetricLogs = useTrackerStore((state) => state.bodyMetricLogs);
  const addBodyMetricLog = useTrackerStore((state) => state.addBodyMetricLog);
  const deleteBodyMetricLog = useTrackerStore((state) => state.deleteBodyMetricLog);

  const [date, setDate] = useState(todayString());
  const [weight, setWeight] = useState(0);
  const [waist, setWaist] = useState(0);
  const [notes, setNotes] = useState("");

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

  const handleSubmit = () => {
    addBodyMetricLog({
      date,
      weight,
      waist,
      notes,
    });

    setNotes("");
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">Body</p>
        <h1 className="text-2xl font-semibold text-slate-900">Body Metrics</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardDescription>7-day average weight</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {recent7DayAverage !== null ? `${recent7DayAverage.toFixed(1)} kg` : "Not enough data"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardDescription>Weekly trend</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {weeklyWeightDelta !== null ? `${weeklyWeightDelta > 0 ? "-" : "+"}${Math.abs(weeklyWeightDelta).toFixed(2)} kg` : "Not enough data"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardDescription>7-day average waist</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {recentWaistAvg !== null ? `${recentWaistAvg.toFixed(1)} cm` : "Not enough data"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Add Entry</CardTitle>
            <CardDescription>Saving same date overwrites that date data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Weight (kg)</Label>
              <Input type="number" value={weight} onChange={(event) => setWeight(parseNumber(event.target.value))} />
            </div>
            <div className="space-y-1">
              <Label>Waist (cm)</Label>
              <Input type="number" value={waist} onChange={(event) => setWaist(parseNumber(event.target.value))} />
            </div>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note" />
            <Button className="w-full" onClick={handleSubmit}>
              Save
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Weight Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <SimpleLineChart data={trendData} lines={[{ key: "weight", color: "#0f766e", name: "Weight" }]} />
            ) : (
              <EmptyState title="No weight data" description="Add your first body entry." />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Waist Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <SimpleLineChart data={trendData} lines={[{ key: "waist", color: "#ea580c", name: "Waist" }]} />
            ) : (
              <EmptyState title="No waist data" description="Add your first body entry." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/80 bg-white/90">
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>Browse by date and delete if needed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {sortedLogs.length === 0 ? (
            <EmptyState title="No history yet" description="Log your first weight and waist entry." />
          ) : (
            sortedLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{log.date}</p>
                  <p className="text-xs text-slate-600">
                    Weight {log.weight}kg | Waist {log.waist}cm {log.notes ? `| ${log.notes}` : ""}
                  </p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => deleteBodyMetricLog(log.id)}>
                  <Trash2 className="h-4 w-4 text-rose-600" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}