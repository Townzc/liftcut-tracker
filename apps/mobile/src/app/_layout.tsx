import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { I18nProvider } from "@/lib/i18n";
import { SessionProvider, useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";

export default function RootLayout() {
  return <I18nProvider><SessionProvider><RootNavigator /></SessionProvider></I18nProvider>;
}

function RootNavigator() {
  const { session, loading } = useSession(), colors = useColors();
  if (loading) return null; // Keep the splash until the stored session is read.
  return <>
    <StatusBar style="auto" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={!!session}><Stack.Screen name="(app)" /></Stack.Protected>
      <Stack.Protected guard={!session}><Stack.Screen name="sign-in" /><Stack.Screen name="register" /></Stack.Protected>
      <Stack.Screen name="auth/callback" options={{ gestureEnabled: false }} />
    </Stack>
  </>;
}
