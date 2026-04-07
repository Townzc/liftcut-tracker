import { NextResponse } from "next/server";

import { GUEST_COOKIE_NAME, GUEST_COOKIE_VALUE } from "@/lib/guest-mode";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AiServiceError } from "@/services/ai/errors";
import { getDeepSeekConfigOptional } from "@/services/ai/config";
import { normalizeAiError } from "@/services/ai/errors";

const GUEST_AI_QUOTA_COOKIE_NAME = "liftcut_guest_ai_quota";
const GUEST_AI_DAILY_LIMIT = 10;

type ApiAuthMode = "authenticated" | "guest" | "none";

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseCookies(request: Request): Record<string, string> {
  const raw = request.headers.get("cookie") ?? "";
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, item) => {
      const index = item.indexOf("=");
      if (index <= 0) {
        return acc;
      }
      const key = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function isGuestCookieEnabled(request: Request): boolean {
  const cookies = parseCookies(request);
  return cookies[GUEST_COOKIE_NAME] === GUEST_COOKIE_VALUE;
}

function parseGuestQuotaCookie(value: string | undefined): { date: string; count: number } {
  if (!value) {
    return { date: getTodayKey(), count: 0 };
  }

  const [date, countText] = value.split(":");
  const count = Number(countText ?? 0);
  if (!date || !Number.isFinite(count) || count < 0) {
    return { date: getTodayKey(), count: 0 };
  }

  if (date !== getTodayKey()) {
    return { date: getTodayKey(), count: 0 };
  }

  return { date, count };
}

export interface GuestQuotaToken {
  used: number;
  remaining: number;
  apply: (response: NextResponse) => void;
}

export async function consumeGuestAiQuotaFromRequest(
  request: Request,
  mode: ApiAuthMode,
  limit = GUEST_AI_DAILY_LIMIT,
): Promise<GuestQuotaToken | null> {
  if (mode !== "guest") {
    return null;
  }

  const cookies = parseCookies(request);
  const quota = parseGuestQuotaCookie(cookies[GUEST_AI_QUOTA_COOKIE_NAME]);
  if (quota.count >= limit) {
    throw new AiServiceError(
      "AI_GUEST_QUOTA_REACHED",
      "Guest AI quota reached for today. Sign in to continue.",
    );
  }

  const nextCount = quota.count + 1;
  return {
    used: nextCount,
    remaining: Math.max(0, limit - nextCount),
    apply: (response) => {
      response.cookies.set(GUEST_AI_QUOTA_COOKIE_NAME, `${getTodayKey()}:${nextCount}`, {
        path: "/",
        maxAge: 60 * 60 * 24 * 31,
        sameSite: "lax",
      });
    },
  };
}

export async function requireApiContext(request: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (!error && user) {
    return {
      mode: "authenticated" as ApiAuthMode,
      errorResponse: null,
      supabase,
      user,
    };
  }

  if (isGuestCookieEnabled(request)) {
    return {
      mode: "guest" as ApiAuthMode,
      errorResponse: null,
      supabase,
      user: null,
    };
  }

  return {
    mode: "none" as ApiAuthMode,
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
