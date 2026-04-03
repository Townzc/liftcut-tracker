import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getDeepSeekConfigOptional } from "@/services/ai/config";
import { normalizeAiError } from "@/services/ai/errors";

export async function requireApiUser() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: "UNAUTHORIZED",
          message: "You need to sign in before using AI features.",
        },
        { status: 401 },
      ),
      supabase,
      user: null,
    };
  }

  return {
    errorResponse: null,
    supabase,
    user,
  };
}

export function aiConfigStatus() {
  return {
    configured: Boolean(getDeepSeekConfigOptional()),
  };
}

export function toAiErrorResponse(error: unknown) {
  const normalized = normalizeAiError(error);
  if (process.env.NODE_ENV !== "production") {
    console.error("[api/ai]", normalized.code, normalized.detail || normalized.message);
  }
  return NextResponse.json(
    {
      ok: false,
      error: normalized.code,
      message: normalized.message,
      detail: process.env.NODE_ENV !== "production" ? normalized.detail || undefined : undefined,
    },
    { status: normalized.status },
  );
}
