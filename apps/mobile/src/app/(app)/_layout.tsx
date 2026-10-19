import { Link, Stack } from "expo-router";
import { View } from "react-native";
import { useI18n } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { WorkoutProvider } from "@/lib/workout";

export default function AppLayout() {
  const { t } = useI18n(), c = useColors(), link = { color: c.text, fontSize: 16, padding: 8 };
  return <WorkoutProvider><Stack screenOptions={{ headerStyle: { backgroundColor: c.background }, headerTintColor: c.text, headerShadowVisible: false, contentStyle: { backgroundColor: c.background } }}>
    <Stack.Screen name="index" options={{ title: t("today"), headerRight: () => <View style={{ flexDirection: "row" }}>
      <Link href="/coach" style={link}>{t("coach")}</Link><Link href="/history" style={link}>{t("history")}</Link><Link href="/settings" style={link}>{t("settings")}</Link></View> }} />
    <Stack.Screen name="coach" options={{ title: t("coach") }} />
    <Stack.Screen name="history" options={{ title: t("history") }} />
    <Stack.Screen name="settings" options={{ title: t("settings") }} />
  </Stack></WorkoutProvider>;
}
