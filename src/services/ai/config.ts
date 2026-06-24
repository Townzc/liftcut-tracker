import "server-only";

import { AiServiceError } from "@/services/ai/errors";
import type {
  AiProviderConfig,
  AiProviderName,
} from "@/services/ai/types";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_LOCAL_API_KEY = "EMPTY";
const DEFAULT_LOCAL_MODEL = "liftcut-coach";

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function getSelectedAiProvider(): AiProviderName | null {
  const provider = readEnv("AI_PROVIDER").toLowerCase() || "deepseek";
  if (
    provider === "deepseek" ||
    provider === "local" ||
    provider === "openai_compatible"
  ) {
    return provider;
  }
  return null;
}

export function getAiProviderConfig(): AiProviderConfig | null {
  const provider = getSelectedAiProvider();
  if (!provider) {
    return null;
  }

  if (provider === "deepseek") {
    const apiKey = readEnv("DEEPSEEK_API_KEY");
    if (!apiKey) {
      return null;
    }
    return {
      provider,
      apiKey,
      baseURL: readEnv("DEEPSEEK_BASE_URL") || DEFAULT_DEEPSEEK_BASE_URL,
      model: readEnv("DEEPSEEK_MODEL") || DEFAULT_DEEPSEEK_MODEL,
    };
  }

  if (provider === "local") {
    return {
      provider,
      apiKey: readEnv("LOCAL_AI_API_KEY") || DEFAULT_LOCAL_API_KEY,
      baseURL: readEnv("LOCAL_AI_BASE_URL") || DEFAULT_LOCAL_BASE_URL,
      model: readEnv("LOCAL_AI_MODEL") || DEFAULT_LOCAL_MODEL,
    };
  }

  const apiKey = readEnv("AI_API_KEY");
  const baseURL = readEnv("AI_BASE_URL");
  const model = readEnv("AI_MODEL");
  if (!apiKey || !baseURL || !model) {
    return null;
  }

  return {
    provider,
    apiKey,
    baseURL,
    model,
  };
}

export function requireAiProviderConfig(): AiProviderConfig {
  const config = getAiProviderConfig();
  if (!config) {
    const provider = getSelectedAiProvider();
    const message =
      provider === "deepseek"
        ? "AI service is not configured. Please set DEEPSEEK_API_KEY on the server."
        : provider === "openai_compatible"
          ? "AI service is not configured. Please set AI_BASE_URL, AI_API_KEY, and AI_MODEL on the server."
          : provider === "local"
            ? "Local AI service is not configured."
            : "AI_PROVIDER must be deepseek, local, or openai_compatible.";

    throw new AiServiceError(
      "AI_CONFIG_MISSING",
      message,
    );
  }

  return config;
}
