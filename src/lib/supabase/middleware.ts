import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isBasicProfileComplete } from "@/lib/profile-completion";
import { getSupabaseEnv } from "@/lib/supabase/env";

const publicAuthRoutes = ["/login", "/register", "/forgot-password"];
const onboardingRoute = "/onboarding";

function isStaticAsset(pathname: string): boolean {
  return (
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
  if (isStaticAsset(pathname)) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = publicAuthRoutes.some((route) => pathname.startsWith(route));
  const isOnboardingRoute = pathname.startsWith(onboardingRoute);

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
    console.error("[middleware] failed to load user_settings for onboarding redirect", settingsError);
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
