import { z } from "zod";
import { COACH_CONSENT_VERSION } from "./coach-chat";

/** A public policy binding, not a credential or permission to save any record. */
export const recipientTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const aiRecipientSchema = z.strictObject({
  id: recipientTokenSchema,
  name: z.enum(["DeepSeek", "OpenAI"]),
  origin: z.enum(["https://api.deepseek.com", "https://api.openai.com"]),
  model: z.string().trim().min(1).max(200).regex(/^[\x20-\x7e]+$/),
}).refine(value => value.origin === (value.name === "DeepSeek" ? "https://api.deepseek.com" : "https://api.openai.com"), "Recipient identity mismatch");
export type AiRecipient = z.infer<typeof aiRecipientSchema>;

export function recipientConsentValue(recipient: AiRecipient): string {
  return `${COACH_CONSENT_VERSION}:${aiRecipientSchema.parse(recipient).id}`;
}
export function hasRecipientConsent(saved: unknown, recipient: AiRecipient | null | undefined): boolean {
  return !!recipient && aiRecipientSchema.safeParse(recipient).success && saved === recipientConsentValue(recipient);
}
