import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { DeletionError, type DeletionAdapter } from "./operations";

export function deletionAvailable() {
  return process.env.FEATURE_ACCOUNT_DELETION === "true" && !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (process.env.COACH_SIGNING_SECRET?.length ?? 0) >= 32;
}
export function accountDeletionAdapter(): DeletionAdapter & { pending(owner: string): Promise<string | null> } {
  if (!deletionAvailable()) throw new DeletionError("unavailable");
  const admin = createClient(getSupabaseEnv().url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async exists(owner) {
      const { data, error } = await admin.auth.admin.getUserById(owner);
      if (error?.code === "user_not_found") return false;
      if (error || !data.user) throw new DeletionError("pending");
      return true;
    },
    async pending(owner) {
      const { data, error } = await admin.rpc("account_deletion_status", { target: owner });
      if (error || (data !== null && (data?.status !== "pending" || typeof data?.requestId !== "string"))) throw new DeletionError("pending");
      return data?.requestId ?? null;
    },
    async begin(owner, requestId, session) {
      const { data, error } = await admin.rpc("begin_account_deletion", { target: owner, request: requestId, session: session ?? null });
      if (error || data?.requestId !== requestId || data?.status !== "pending") throw new DeletionError("pending");
    },
    async files(owner, requestId) {
      const { data, error } = await admin.rpc("account_deletion_files", { target: owner, request: requestId });
      if (error || !Array.isArray(data) || data.some(path => typeof path !== "string")) throw new DeletionError("pending");
      return data;
    },
    async remove(paths) {
      const { error } = await admin.storage.from("avatars").remove(paths);
      if (error) throw new DeletionError("pending");
    },
    async deleteUser(owner) {
      const { error } = await admin.auth.admin.deleteUser(owner, false);
      if (error) throw new DeletionError("pending");
    },
  };
}
