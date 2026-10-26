import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocales } from "expo-localization";
import { createContext, use, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { format, localeFor, messages, type Locale, type MessageKey } from "./messages";

const KEY = "liftcut-locale";
type Choice = Locale | "system";
const I18n = createContext<{ locale: Locale; choice: Choice; choose: (c: Choice) => void; t: (k: MessageKey, v?: Record<string, string | number>) => string } | null>(null);

export function I18nProvider({ children }: PropsWithChildren) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const systemLocale = localeFor(useLocales()[0]?.languageCode);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY).then(v => { if (active) setChoice(v === "zh-CN" || v === "en" ? v : "system"); })
      .catch(() => { if (active) setChoice("system"); });
    return () => { active = false; };
  }, []);
  const value = useMemo(() => {
    const locale = !choice || choice === "system" ? systemLocale : choice;
    return { locale, choice: choice ?? "system", t: (k: MessageKey, v?: Record<string, string | number>) => format(messages[locale][k], v),
      choose: (c: Choice) => { setChoice(c); void (c === "system" ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, c)).catch(() => {}); } };
  }, [choice, systemLocale]);
  return <I18n.Provider value={value}>{choice !== null ? children : null}</I18n.Provider>;
}
export function useI18n() {
  const value = use(I18n);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
