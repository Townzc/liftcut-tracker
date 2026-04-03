import { AiServiceError } from "@/services/ai/errors";

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

export function getDeepSeekConfigOptional(): DeepSeekConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL,
    model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export function getDeepSeekConfig(): DeepSeekConfig {
  const config = getDeepSeekConfigOptional();
  if (!config) {
    throw new AiServiceError(
      "AI_CONFIG_MISSING",
      "AI service is not configured. Please set DEEPSEEK_API_KEY on the server.",
    );
  }

  return config;
}
