import en from "../../messages/en.json";
import zhCN from "../../messages/zh-CN.json";

import type { AppLocale } from "@/types";

export const appMessages: Record<AppLocale, Record<string, unknown>> = {
  "zh-CN": zhCN,
  en,
};