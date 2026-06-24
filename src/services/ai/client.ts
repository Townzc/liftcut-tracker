import "server-only";

import OpenAI from "openai";

import { requireAiProviderConfig } from "@/services/ai/config";
import { AiServiceError } from "@/services/ai/errors";
import type {
  AiProviderConfig,
  AiProviderName,
} from "@/services/ai/types";

let cachedClient: OpenAI | null = null;
let cachedConfigKey = "";

function getConfigCacheKey(config: AiProviderConfig): string {
  return JSON.stringify([
    config.provider,
    config.baseURL,
    config.apiKey,
    config.model,
  ]);
}

export function createAiClient(config: AiProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 30_000,
  });
}

function getAiClient(config: AiProviderConfig): OpenAI {
  const configKey = getConfigCacheKey(config);
  if (cachedClient && cachedConfigKey === configKey) {
    return cachedClient;
  }

  cachedClient = createAiClient(config);
  cachedConfigKey = configKey;
  return cachedClient;
}

function trimCodeFence(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("```")) {
    return text;
  }
  return text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
}

export function sanitizeModelJsonText(rawText: string): string {
  return trimCodeFence(rawText).trim();
}

// Extract the first complete JSON object from mixed model output text.
export function extractJsonObjectFromText(rawText: string): string {
  const text = sanitizeModelJsonText(rawText);
  const start = text.indexOf("{");
  if (start < 0) {
    throw new AiServiceError(
      "AI_INVALID_JSON",
      "AI response does not contain a JSON object.",
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  throw new AiServiceError(
    "AI_INVALID_JSON",
    "Could not extract a complete JSON object from AI response.",
  );
}

function safeErrorDetail(error: unknown, apiKey: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (!apiKey) {
    return detail;
  }
  return detail.split(apiKey).join("[redacted]");
}

export interface AiJsonRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface AiJsonResponse {
  provider: AiProviderName;
  model: string;
  rawText: string;
  extractedJsonText: string;
  json: unknown;
}

export async function callAiProviderForJson(
  input: AiJsonRequest,
): Promise<AiJsonResponse> {
  const config = requireAiProviderConfig();
  const client = getAiClient(config);

  let completion: Awaited<ReturnType<typeof client.chat.completions.create>>;
  try {
    completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
    });
  } catch (error) {
    throw new AiServiceError(
      "AI_REQUEST_FAILED",
      "Failed to request AI service.",
      safeErrorDetail(error, config.apiKey),
    );
  }

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new AiServiceError("AI_EMPTY_RESPONSE", "AI returned an empty response.");
  }

  let json: unknown;
  let extractedJsonText = "";
  try {
    extractedJsonText = extractJsonObjectFromText(content);
    json = JSON.parse(extractedJsonText);
  } catch (error) {
    throw new AiServiceError(
      "AI_INVALID_JSON",
      "AI returned invalid JSON.",
      safeErrorDetail(error, config.apiKey),
    );
  }

  return {
    provider: config.provider,
    model: completion.model || config.model,
    rawText: content,
    extractedJsonText,
    json,
  };
}
