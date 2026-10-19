import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { apiBase } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme";

export default function Settings() {
  const { t, choice, choose } = useI18n(), { session } = useSession(), c = useColors();
  return <ScrollView contentContainerStyle={styles.content}>
    <Card>
      <Text style={[styles.heading, { color: c.text }]}>{t("language")}</Text>
      <View style={styles.row}>
        {(["system", "zh-CN", "en"] as const).map(option => <View key={option} style={styles.choice}>
          <Button variant={choice === option ? "primary" : "outline"} label={option === "system" ? t("followSystem") : option === "zh-CN" ? "中文" : "English"} onPress={() => choose(option)} />
        </View>)}
      </View>
    </Card>
    <Card>
      <Text style={[styles.heading, { color: c.text }]}>{t("account")}</Text>
      <Text style={{ color: c.text }}>{session?.user.email ?? "—"}</Text>
      <Text style={{ color: c.muted }}>{t("server")} · {apiBase}</Text>
    </Card>
    <Button variant="outline" label={t("signOut")} onPress={() => void supabase?.auth.signOut()} />
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  heading: { fontSize: 18, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { flexGrow: 1 },
});
