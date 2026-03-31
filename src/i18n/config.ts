import type { AppLocale } from "@/types";

export const defaultLocale: AppLocale = "zh-CN";
export const supportedLocales: AppLocale[] = ["zh-CN", "en"];

export function isSupportedLocale(value: string): value is AppLocale {
  return supportedLocales.includes(value as AppLocale);
}