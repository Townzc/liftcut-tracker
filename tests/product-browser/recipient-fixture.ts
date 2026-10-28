import { expect, type APIRequestContext } from "@playwright/test";
import { aiRecipientSchema } from "@liftcut/core/ai-recipient";
/** Synthetic fixture policy only; this helper never grants consent to a real provider. */
export async function fixtureRecipient(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/ai/coach");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return aiRecipientSchema.parse((await response.json()).recipient).id;
}
