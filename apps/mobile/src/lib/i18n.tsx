import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { createContext, use, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { format, localeFor, messages, type Locale, type MessageKey } from "./messages";

const KEY = "liftcut-locale";
type Choice = Locale | "system";
const I18n = createContext<{ locale: Locale; choice: Choice; choose: (c: Choice) => void; t: (k: MessageKey, v?: Record<string, string | number>) => string } | null>(null);

export function I18nProvider({ children }: PropsWithChildren) {
  const [choice, setChoice] = useState<Choice>("system");
  useEffect(() => { AsyncStorage.getItem(KEY).then(v => { if (v === "zh-CN" || v === "en") setChoice(v); }).catch(() => {}); }, []);
  const value = useMemo(() => {
    const locale = choice === "system" ? localeFor(getLocales()[0]?.languageCode) : choice;
    return { locale, choice, t: (k: MessageKey, v?: Record<string, string | number>) => format(messages[locale][k], v),
      choose: (c: Choice) => { setChoice(c); void (c === "system" ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, c)).catch(() => {}); } };
  }, [choice]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}
export function useI18n() {
  const value = use(I18n);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
