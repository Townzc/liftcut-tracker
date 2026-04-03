import OpenAI from "openai";

import { getDeepSeekConfig } from "@/services/ai/config";
import { AiServiceError } from "@/services/ai/errors";

let cachedClient: OpenAI | null = null;
let cachedKey = "";
let cachedBaseUrl = "";

function getClient(): OpenAI {
  const config = getDeepSeekConfig();
  if (
    cachedClient &&
    cachedKey === config.apiKey &&
    cachedBaseUrl === config.baseUrl
  ) {
    return cachedClient;
  }

  cachedKey = config.apiKey;
  cachedBaseUrl = config.baseUrl;
  cachedClient = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: 30_000,
  });

  return cachedClient;
}

function stripCodeFence(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("```")) {
    return text;
  }

  return text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
}

export interface DeepSeekJsonRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface DeepSeekJsonResponse {
  model: string;
  rawText: string;
  json: unknown;
}

export async function callDeepSeekForJson(input: DeepSeekJsonRequest): Promise<DeepSeekJsonResponse> {
  const client = getClient();
  const config = getDeepSeekConfig();

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
      error instanceof Error ? error.message : String(error),
    );
  }

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new AiServiceError("AI_EMPTY_RESPONSE", "AI returned an empty response.");
  }

  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(content));
  } catch (error) {
    throw new AiServiceError(
      "AI_INVALID_JSON",
      "AI returned invalid JSON.",
      error instanceof Error ? error.message : String(error),
    );
  }

  return {
    model: completion.model || config.model,
    rawText: content,
    json,
  };
}
