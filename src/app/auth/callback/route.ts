import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

function getSafeRedirectPath(value: string | null): string {
  if (!value) {
    return "/onboarding";
  }

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return "/onboarding";
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const next = searchParams.get("next");

  if (error) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "oauth_cancelled");
    return NextResponse.redirect(url);
  }

  if (!code) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "missing_oauth_code");
    return NextResponse.redirect(url);
  }

  const supabase = await getSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error("[auth/callback] exchangeCodeForSession failed:", exchangeError.message);
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "oauth_exchange_failed");
    return NextResponse.redirect(url);
  }

  const redirectPath = getSafeRedirectPath(next);
  const url = request.nextUrl.clone();
  url.pathname = redirectPath;
  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("next");
  return NextResponse.redirect(url);
}
