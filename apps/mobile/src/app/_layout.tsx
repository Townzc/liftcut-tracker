import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { I18nProvider } from "@/lib/i18n";
import { SessionProvider, useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";
import { DeletionProvider, useDeletion } from "@/lib/deletion-context";
import { ownerRuntime } from "@/lib/owner-runtime";

export default function RootLayout() {
  return <I18nProvider><SessionProvider><DeletionProvider><RootNavigator /></DeletionProvider></SessionProvider></I18nProvider>;
}

function RootNavigator() {
  const { session, loading } = useSession(), colors = useColors();
  const deletion = useDeletion(), router = useRouter(), blocked = ownerRuntime.isBlocked(session?.user.id);
  useEffect(() => {
    if (!loading && (!deletion.ready || blocked || (!session && deletion.records.size))) router.replace("/delete-account");
  }, [loading, deletion, deletion.ready, deletion.records.size, blocked, session, router]);
  if (loading) return null; // Keep the splash until the stored session is read.
  return <>
    <StatusBar style="auto" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={deletion.ready && !!session && !blocked}><Stack.Screen name="(app)" /></Stack.Protected>
      <Stack.Protected guard={deletion.ready && !session && deletion.records.size === 0}>
        <Stack.Screen name="sign-in" /><Stack.Screen name="register" />
      </Stack.Protected>
      <Stack.Protected guard={deletion.ready && !blocked && (!!session || deletion.records.size === 0)}>
        <Stack.Screen name="auth/callback" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Screen name="delete-account" />
    </Stack>
  </>;
}
