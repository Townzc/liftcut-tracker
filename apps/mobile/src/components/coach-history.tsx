import type { CoachHistoryClient, HistoryState } from "@liftcut/core/coach-history-client";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button, Card } from "./ui";
import { useI18n } from "@/lib/i18n";
import { useColors } from "@/lib/theme";

export function CoachHistory({ history, state, busy, closeDrafts }: { history: CoachHistoryClient; state: HistoryState; busy: boolean; closeDrafts: () => void }) {
  const { t } = useI18n(), c = useColors(), [open, setOpen] = useState(false), [removing, setRemoving] = useState<string | null>(null);
  const disabled = busy || state.loading || !state.ready;
  return <View style={{ padding: 12, gap: 8 }}>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button variant="outline" label={t("coachHistory")} disabled={busy} onPress={() => { setOpen(!open); if (!open) void history.refreshList(); }} />
      <Button variant="outline" label={t("coachNew")} disabled={disabled} onPress={() => { closeDrafts(); history.newConversation(); setOpen(false); }} />
    </View>
    <Text testID="coach-history-status" style={{ color: c.muted }}>{t(!state.ready ? "loading" : state.error === "LOCAL_STORAGE" ? "coachStorageError" : state.sync === "error" || state.sync === "offline" || state.error ? "coachHistoryError" : state.sync === "saved" ? "coachHistorySaved" : "coachHistoryLocal")}</Text>
    {(state.error || state.sync === "offline") && <Button label={t("retry")} disabled={disabled} onPress={() => { void history.flush(); void history.refreshList(); }} />}
    {open && <ScrollView style={{ maxHeight: 260 }} testID="coach-history-list">
      {state.threads.map(chat => <Card key={chat.id}>
        <Button variant="outline" label={chat.title} disabled={disabled} onPress={() => { closeDrafts(); void history.select(chat.id).then(() => setOpen(false)); }} />
        <Button variant="outline" label={t("coachDelete")} disabled={disabled} onPress={() => setRemoving(chat.id)} />
      </Card>)}
      {state.next && <Button label={t("coachMore")} disabled={disabled} onPress={() => void history.refreshList(true)} />}
    </ScrollView>}
    {removing && <Card><Text style={{ color: c.text }}>{t("coachDeleteHint")}</Text>
      <Button label={t("coachDeleteConfirm")} disabled={disabled} onPress={() => { closeDrafts(); void history.remove(removing).then(() => setRemoving(null)); }} />
      <Button variant="outline" label={t("coachCancel")} onPress={() => setRemoving(null)} />
    </Card>}
  </View>;
}
