import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { safeAuthRedirect } from "@/lib/supabase/recovery-policy";

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const next = searchParams.get("next");

  if (error) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "oauth_cancelled");
    return NextResponse.redirect(url);
  }

  if (!code) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "missing_oauth_code");
    return NextResponse.redirect(url);
  }

  const supabase = await getSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "oauth_exchange_failed");
    return NextResponse.redirect(url);
  }

  const url = new URL(safeAuthRedirect(next), request.url);
  return NextResponse.redirect(url);
}
