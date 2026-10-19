import { Link, Stack } from "expo-router";
import { useI18n } from "@/lib/i18n";
import { useColors } from "@/lib/theme";

export default function AppLayout() {
  const { t } = useI18n(), c = useColors();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: c.background }, headerTintColor: c.text, headerShadowVisible: false, contentStyle: { backgroundColor: c.background } }}>
    <Stack.Screen name="index" options={{ title: t("today"), headerRight: () => <Link href="/settings" style={{ color: c.text, fontSize: 16, padding: 8 }}>{t("settings")}</Link> }} />
    <Stack.Screen name="settings" options={{ title: t("settings") }} />
  </Stack>;
}
