import "server-only";
import { z } from "zod";
import type { Outcome } from "@/lib/agent/contracts";

export function sameOrigin(request: Request): boolean {
  // These cookie-authenticated mutation routes are not model tool endpoints.
  return request.headers.get("origin") === new URL(request.url).origin &&
    [null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site")) &&
    request.headers.get("content-type")?.split(";")[0] === "application/json";
}
export async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_JSON");
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 256 * 1024) { await reader.cancel(); throw new Error("REQUEST_TOO_LARGE"); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
export function outcomeResponse(result: Outcome<unknown>) {
  return Response.json(result, { status: result.ok ? 200 : result.error === "NOT_FOUND" ? 404 : 409,
    headers: { "Cache-Control": "no-store" } });
}
export function errorResponse(error: unknown) {
  const invalid = error instanceof z.ZodError || error instanceof SyntaxError ||
    (error instanceof Error && ["INVALID_JSON", "REQUEST_TOO_LARGE"].includes(error.message));
  // A network error can follow COMMIT. Only querying the durable receipt resolves it.
  return Response.json({ ok: false, error: invalid ? "INVALID_REQUEST" : "OUTCOME_UNKNOWN", retryable: !invalid },
    { status: invalid ? 400 : 503, headers: { "Cache-Control": "no-store" } });
}
