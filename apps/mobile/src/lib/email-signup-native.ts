import AsyncStorage from "@react-native-async-storage/async-storage";
import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytesAsync, randomUUID } from "expo-crypto";
import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { EmailSignupController } from "./email-signup";
import { signupAuthFactory } from "./email-signup-client";
import { supabase } from "./supabase";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const mainAuth = supabase?.auth;
export const emailSignup = url && key && mainAuth ? new EmailSignupController({
  storage: AsyncStorage, auth: signupAuthFactory(url, key, Platform.OS === "web" ? undefined : {
    randomBytes: () => getRandomBytesAsync(32),
    digest: value => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
  }, Platform.OS === "web" ? undefined : expoFetch), uuid: randomUUID,
  owner: async () => {
    const result = await mainAuth.getSession();
    if (result.error) throw result.error;
    return result.data.session?.user.id ?? null;
  },
}) : null;

// Preparation builds only, until SMTP, native crypto and signed-device delivery pass.
export const mobileEmailSignupEnabled = process.env.EXPO_PUBLIC_MOBILE_EMAIL_SIGNUP === "true" && !!emailSignup;
export async function cancelEmailSignup() { await emailSignup?.cancel(); }
