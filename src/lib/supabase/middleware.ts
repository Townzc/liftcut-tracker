import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { GUEST_COOKIE_NAME, GUEST_COOKIE_VALUE } from "@/lib/guest-mode";
import { isBasicProfileComplete } from "@/lib/profile-completion";
import { getSupabaseEnv } from "@/lib/supabase/env";

const publicAuthRoutes = ["/login", "/register", "/forgot-password", "/auth/callback"];
const publicContentRoutes = ["/demo"];
const onboardingRoute = "/onboarding";

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/samples") ||
    pathname.includes(".")
  );
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;
  // Help and explicit auth callbacks must work without an existing account session.
  if (["/support", "/reset-password", "/forgot-password", "/auth/callback"].includes(pathname) || isStaticAsset(pathname)) {
    return response;
  }

  let url = "";
  let anonKey = "";
  try {
    const env = getSupabaseEnv();
    url = env.url;
    anonKey = env.anonKey;
  } catch {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // This proxy only selects page shells. getClaims verifies signatures/expiry
  // using cached public keys (or the Auth server for symmetric tokens).
  // Mutation/data APIs still call getUser independently for fresh identity.
  const {data:verified,error:claimsError}=await supabase.auth.getClaims();
  const user=!claimsError&&verified?.claims.sub?{id:verified.claims.sub}:null;
  const guestEnabled = request.cookies.get(GUEST_COOKIE_NAME)?.value === GUEST_COOKIE_VALUE;

  const isAuthRoute = publicAuthRoutes.some((route) => pathname.startsWith(route));
  const isPublicContentRoute = publicContentRoutes.some((route) => pathname.startsWith(route));
  const isOnboardingRoute = pathname.startsWith(onboardingRoute);

  if (isPublicContentRoute) {
    return response;
  }

  if (!user && guestEnabled) {
    return response;
  }

  if (!user && isOnboardingRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (!user && !isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (!user) {
    return response;
  }

  let profileComplete = false;
  const { data: settingsRow, error: settingsError } = await supabase
    .from("user_settings")
    .select("gender, age, height, current_weight, target_weight, weekly_training_days")
    .eq("user_id", user.id)
    .maybeSingle();

  if (settingsError) {
    console.error("[middleware] failed to load user_settings", { code: settingsError.code });
    // A denied/unavailable read is not an incomplete profile. Keep the session
    // and offer a retry instead of sending an existing user through onboarding.
    const unavailable = new NextResponse(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>liftcut.</title><body style="font-family:system-ui;margin:12vh auto;padding:24px;max-width:480px;color:#171717;background:#fff">' +
      '<h1 style="font-size:24px">暂时无法读取资料.</h1><p>请稍后重试，无需重新填写.</p><a href="" style="color:inherit">重新加载</a></body></html>',
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "5" } },
    );
    response.cookies.getAll().forEach(cookie => unavailable.cookies.set(cookie));
    return unavailable;
  } else {
    profileComplete = isBasicProfileComplete({
      gender: String(settingsRow?.gender ?? "unknown") as "male" | "female" | "other" | "unknown",
      age: Number(settingsRow?.age ?? 0),
      height: Number(settingsRow?.height ?? 0),
      currentWeight: Number(settingsRow?.current_weight ?? 0),
      targetWeight: Number(settingsRow?.target_weight ?? 0),
      weeklyTrainingDays: Number(settingsRow?.weekly_training_days ?? 0),
    });
  }

  if (isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = profileComplete ? "/" : onboardingRoute;
    return NextResponse.redirect(redirectUrl);
  }

  if (!profileComplete && !isOnboardingRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = onboardingRoute;
    return NextResponse.redirect(redirectUrl);
  }

  if (profileComplete && isOnboardingRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
