import { BODY_REGIONS, FIGURE_BACK, FIGURE_FRONT, muscleVolume, volumeLevel, type BodyRegion, type FigureShape } from "@liftcut/core/muscle-volume";
import { localDateAt } from "@liftcut/core/today";
import { trainingCalendar, type CalendarDay } from "@liftcut/core/training-calendar";
import type { WorkoutLog } from "@liftcut/core/types";
import { getCalendars } from "expo-localization";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { z } from "zod";
import { Button, Card } from "@/components/ui";
import { getJson } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";

// The fields the shared charts read; the rest of each row is kept as is.
const logsSchema = z.array(z.looseObject({ date: z.string(), exercises: z.array(z.looseObject({ name: z.string(), completed: z.boolean(),
  recordedSets: z.number().optional() })) }));

/** The web history charts on the phone: the same core functions over the same confirmed sets. */
export default function History() {
  const { session: auth } = useSession(), { t } = useI18n(), c = useColors();
  const [logs, setLogs] = useState<WorkoutLog[] | null>(null), [failed, setFailed] = useState(false);
  const [days, setDays] = useState<7 | 28>(7), [selected, setSelected] = useState<CalendarDay | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  useFocusEffect(useCallback(() => {
    if (!auth) return;
    let alive = true;
    getJson("/api/workout-sessions/history", auth, logsSchema).then(v => { if (alive) { setLogs(v as unknown as WorkoutLog[]); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [auth]));
  const today = localDateAt(new Date(), getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const calendar = useMemo(() => logs ? trainingCalendar(logs, today) : null, [logs, today]);
  const volume = useMemo(() => logs ? muscleVolume(logs, today, days) : null, [logs, today, days]);
  const text = { color: c.text }, muted = { color: c.muted };
  if (!calendar || !volume) return <View style={styles.content}><Text style={muted}>{t(failed ? "networkError" : "loading")}</Text></View>;
  const label = (d: CalendarDay) => t("historyDay", { date: d.date, sets: d.sets }) + (d.unknownRows ? t("historyUnknown", { rows: d.unknownRows }) : "");
  const trained = BODY_REGIONS.filter(r => volume.regions[r].sets || volume.regions[r].unknownRows);
  const figure = (parts: [BodyRegion | null, FigureShape[]][], name: string) => <View style={styles.figure}>
    {parts.flatMap(([region, shapes]) => shapes.map((s, i) => <View key={`${region}-${i}`} testID={region ? `region-${region}` : undefined}
      style={[styles.shape, { left: s.x * 1.2, top: s.y * 1.2, width: s.w * 1.2, height: s.h * 1.2, borderRadius: (s.r ?? 4) * 1.2, borderColor: c.border,
        backgroundColor: region ? c.levels[[0, 1, 2, 4][volumeLevel(volume.regions[region], days)]] : "transparent" }]} />))}
    <Text style={[muted, styles.figureLabel]}>{name}</Text>
  </View>;
  return <ScrollView contentContainerStyle={styles.content}>
    <Card>
      <Text style={[text, styles.heading]}>{t("historyCalendar")}</Text>
      <Text style={muted}>{t("historyCalendarHint")}</Text>
      <Text accessibilityRole="summary" style={text}>{!calendar.trainedDays ? t("historyEmpty")
        : t(calendar.sets ? "historySummary" : "historySummaryDays", { days: calendar.trainedDays, sets: calendar.sets })}</Text>
      <ScrollView ref={scroller} horizontal onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
        <View style={styles.weeks}>{calendar.weeks.map((week, w) => <View key={w} style={styles.week}>
          {week.map((d, i) => !d ? <View key={i} style={styles.cell} /> : d.level === 0 ? <View key={i} style={[styles.cell, { backgroundColor: c.levels[0] }]} />
            : <Pressable key={i} accessibilityRole="button" accessibilityLabel={label(d)} onPress={() => setSelected(d)}
              style={[styles.cell, { backgroundColor: c.levels[d.level], borderWidth: selected?.date === d.date ? 2 : 0, borderColor: c.muted }]} />)}
        </View>)}</View>
      </ScrollView>
      <Text testID="history-selected" style={muted}>{selected ? label(selected) : t("historyTap")}</Text>
    </Card>
    <Card>
      <Text style={[text, styles.heading]}>{t("historyVolume")}</Text>
      <Text style={muted}>{t("historyVolumeHint")}</Text>
      <View style={styles.row}>{([7, 28] as const).map(d => <Button key={d} variant={d === days ? "primary" : "outline"} label={t(d === 7 ? "historyDays7" : "historyDays28")} onPress={() => setDays(d)} />)}</View>
      <View style={styles.figures} accessibilityLabel={t("historyFigure")}>{figure(FIGURE_FRONT, t("historyFront"))}{figure(FIGURE_BACK, t("historyBack"))}</View>
      <View testID="volume-list">{trained.map(r => <Text key={r} style={text}>{t(`region_${r}` as MessageKey)} · {t("historySets", { sets: volume.regions[r].sets })}
        {volume.regions[r].unknownRows ? t("historyUnknown", { rows: volume.regions[r].unknownRows }) : ""}</Text>)}
        {volume.unclassified.length > 0 && <Text style={muted}>{t("historyUnclassified", { names: volume.unclassified.map(u => u.name).join("、") })}</Text>}
        {!trained.length && !volume.unclassified.length && <Text style={muted}>{t("historyVolumeEmpty")}</Text>}</View>
    </Card>
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  heading: { fontSize: 18, fontWeight: "600" },
  row: { flexDirection: "row", gap: 8 },
  weeks: { flexDirection: "row", gap: 3, paddingVertical: 4 },
  week: { gap: 3 },
  cell: { width: 12, height: 12, borderRadius: 3 },
  figures: { flexDirection: "row", justifyContent: "center", gap: 8 },
  figure: { width: 120, height: 240 },
  shape: { position: "absolute", borderWidth: StyleSheet.hairlineWidth },
  figureLabel: { position: "absolute", bottom: 0, width: 120, textAlign: "center", fontSize: 12 },
});
