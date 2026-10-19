import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL, anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
/** Null when the build has no public Supabase settings; the sign-in screen says so instead of crashing. */
export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
}) : null;

// Refresh tokens only while the app is in the foreground, as Supabase recommends for React Native.
if (supabase && Platform.OS !== "web") AppState.addEventListener("change", state => {
  if (state === "active") void supabase.auth.startAutoRefresh(); else void supabase.auth.stopAutoRefresh();
});
