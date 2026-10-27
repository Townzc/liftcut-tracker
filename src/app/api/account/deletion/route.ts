import { getRequestUser } from "@/lib/supabase/server";
import { bearerToken } from "@/lib/supabase/bearer";
import { accountDeletionAdapter, deletionAvailable } from "@/services/account-deletion/server";
import { DeletionError, deletionReceipt, executeDeletion, recentAuthentication, resumeDeletion, startDeletion, verifyDeletionReceipt } from "@/services/account-deletion/operations";

export const runtime = "nodejs", maxDuration = 60;
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function GET() { return response({ available: deletionAvailable() }); }
function allowed(request: Request) {
  // Next may reconstruct request.url with its internal listening hostname.
  // Compare the browser's Origin with the actual Host, never a supplied redirect.
  if (request.headers.has("authorization")) return true;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    return origin.host === request.headers.get("host") &&
      (origin.protocol === "https:" || (origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) &&
      [null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site"));
  } catch { return false; }
}
async function input(request: Request) {
  if (!allowed(request)) throw new DeletionError("reauthenticate");
  const text = await request.text();
  if (text.length > 4096) throw new DeletionError("invalid_receipt");
  return JSON.parse(text);
}
function failure(error: unknown) {
  const code = error instanceof DeletionError ? error.code : "invalid_request";
  // A failed transport may have lost a successful delete response. Never label
  // that account "not deleted"; retain the receipt and reconcile by retrying.
  return response({ error: code }, code === "unavailable" ? 503 : code === "pending" ? 409 : code === "reauthenticate" ? 401 : 400);
}
/** Explicit confirmation + fresh, server-verified authentication starts deletion.
 * The signed, one-hour receipt is scoped only to resuming this owner's deletion.
 * It cannot read data, perform training changes, or change the selected account.
 */
export async function POST(request: Request) {
  try {
    const body = startDeletion.parse(await input(request)), adapter = accountDeletionAdapter();
    const { user, supabase, bearer } = await getRequestUser();
    if (!user) throw new DeletionError("reauthenticate");
    const token = bearer ? bearerToken(request.headers.get("authorization")) : (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new DeletionError("reauthenticate");
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data || !recentAuthentication(data.claims, user.id)) throw new DeletionError("reauthenticate");
    // Reauthentication can resume a pending request even on a new device that
    // lost the original receipt. No caller selects another owner's operation.
    const requestId = await adapter.pending(user.id) ?? body.requestId;
    await adapter.begin(user.id, requestId, String(data.claims.session_id));
    return response({ status: "pending", requestId,
      receipt: deletionReceipt(user.id, requestId, process.env.COACH_SIGNING_SECRET!) }, 202);
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const body = resumeDeletion.parse(await input(request));
    const identity = verifyDeletionReceipt(body.receipt, process.env.COACH_SIGNING_SECRET ?? "");
    return response(await executeDeletion(accountDeletionAdapter(), identity));
  } catch (error) { return failure(error); }
}
