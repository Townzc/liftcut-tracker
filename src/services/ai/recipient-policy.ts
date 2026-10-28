import { createHash } from "node:crypto";
import { aiRecipientSchema, type AiRecipient } from "@liftcut/core/ai-recipient";
import { COACH_CONSENT_VERSION } from "@liftcut/core/coach-chat";
import { MODEL_DATA_HASH } from "@liftcut/core/model-data";
import type { AiProviderConfig } from "./types";

/** Reviewed direct API origins only; an SDK's provider label does not identify a recipient. */
const recipients: Readonly<Record<string, "DeepSeek" | "OpenAI">> = {
  "https://api.deepseek.com": "DeepSeek",
  "https://api.openai.com": "OpenAI",
};
const RECIPIENT_POLICY_VERSION = "direct-api-v1";

/** No secrets or URL paths leave the server. Unknown/relay endpoints need a separate policy review. */
export function resolveAiRecipient(config: Pick<AiProviderConfig, "baseURL" | "model"> | null): AiRecipient | null {
  if (!config) return null;
  let url: URL;
  try { url = new URL(config.baseURL); } catch { return null; }
  if (url.username || url.password || url.search || url.hash) return null;
  const name = recipients[url.origin];
  // These are the reviewed API bases, not arbitrary paths on a recognized host.
  if (!name || !["/", "/v1", "/v1/"].includes(url.pathname)) return null;
  const path = url.pathname.replace(/\/$/, "");
  const model = config.model.trim();
  const id = createHash("sha256").update(JSON.stringify([
    RECIPIENT_POLICY_VERSION, COACH_CONSENT_VERSION, MODEL_DATA_HASH, url.origin, path, model,
  ])).digest("hex");
  const result = aiRecipientSchema.safeParse({ id, name, origin: url.origin, model });
  return result.success ? result.data : null;
}

/** Use before data reads/quota/model calls; the final wiring must pass the same configuration to the model. */
export function recipientConsentError(token: unknown, recipient: AiRecipient | null): "AI_RECIPIENT_UNREVIEWED" | "AI_CONSENT_REQUIRED" | null {
  if (!recipient) return "AI_RECIPIENT_UNREVIEWED";
  return token === recipient.id ? null : "AI_CONSENT_REQUIRED";
}
