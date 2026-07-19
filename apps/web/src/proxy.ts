import { env } from "@cheatcode/env/web";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { safeLocalRedirect } from "@/lib/navigation/safe-local-redirect";

const PRODUCTION_WEB_ORIGIN = "https://trycheatcode.com";
const REJECTED_AUTHORIZED_PARTY = "https://invalid.invalid";
const AUTH_PATH_PATTERN = /^\/sign-(?:in|up)(?:\/|$)/u;
const PROTECTED_PATH_PATTERN =
  /^\/(?:101|billing|chats|models|onboarding|personalization|projects|skills)(?:\/|$)/u;
const ONBOARDING_PATH_PATTERN = /^\/onboarding(?:\/|$)/u;

const proxy = clerkMiddleware(async (auth, request) => {
  const requestOrigin = authorizedParty(request);
  if (!requestOrigin) {
    return new NextResponse(null, { status: 421, statusText: "Misdirected Request" });
  }
  const pathname = request.nextUrl.pathname;
  if (isAuthPath(pathname)) {
    const { userId } = await auth();
    return userId ? NextResponse.redirect(signedInRedirectUrl(request, requestOrigin)) : undefined;
  }
  const isPublicHome = pathname === "/";
  if (!isPublicHome && !PROTECTED_PATH_PATTERN.test(pathname)) {
    return;
  }
  const { sessionClaims, userId } = await auth();
  if (!userId) {
    if (isPublicHome) {
      return;
    }
    const signInUrl = new URL("/sign-in", requestOrigin);
    signInUrl.searchParams.set(
      "redirect_url",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(signInUrl);
  }
  const complete = readOnboardingComplete(sessionClaims);
  const isOnboardingRoute = ONBOARDING_PATH_PATTERN.test(pathname);
  if (!complete && !isOnboardingRoute) {
    return NextResponse.redirect(onboardingRedirectUrl(request, requestOrigin));
  }
  if (complete && isOnboardingRoute) {
    return NextResponse.redirect(completedOnboardingRedirectUrl(request, requestOrigin));
  }
  return undefined;
}, clerkOptions);

function clerkOptions(request: NextRequest) {
  return {
    authorizedParties: [authorizedParty(request) ?? REJECTED_AUTHORIZED_PARTY],
  };
}

function authorizedParty(request: NextRequest): string | null {
  const { hostname, origin, protocol } = request.nextUrl;
  if (env.VERCEL_ENV === "production") {
    const deploymentOrigin = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null;
    return origin === PRODUCTION_WEB_ORIGIN || origin === deploymentOrigin ? origin : null;
  }
  if (env.VERCEL_ENV === "preview") {
    const deploymentOrigin = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null;
    return origin === deploymentOrigin ? origin : null;
  }
  return localAuthorizedParty(request, protocol, hostname, origin);
}

function localAuthorizedParty(
  request: NextRequest,
  protocol: string,
  hostname: string,
  origin: string,
): string | null {
  if (isLoopbackHostname(hostname) && (protocol === "http:" || protocol === "https:")) {
    return origin;
  }
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (!host || (protocol !== "http:" && protocol !== "https:")) {
    return null;
  }
  let forwardedOrigin: URL;
  try {
    forwardedOrigin = new URL(`${protocol}//${host}`);
  } catch {
    return null;
  }
  return forwardedOrigin.host === host &&
    forwardedOrigin.username === "" &&
    forwardedOrigin.password === "" &&
    isLoopbackHostname(forwardedOrigin.hostname)
    ? forwardedOrigin.origin
    : null;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function signedInRedirectUrl(request: NextRequest, requestOrigin: string): URL {
  const candidate = request.nextUrl.searchParams.get("redirect_url") ?? "/";
  const redirectPath = safeLocalRedirect(candidate, requestOrigin) ?? "/";
  const redirectUrl = new URL(redirectPath, requestOrigin);
  return isAuthPath(redirectUrl.pathname) ? new URL("/", requestOrigin) : redirectUrl;
}

function onboardingRedirectUrl(request: NextRequest, requestOrigin: string): URL {
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const onboardingUrl = new URL("/onboarding", requestOrigin);
  onboardingUrl.searchParams.set("redirect_url", target);
  return onboardingUrl;
}

function completedOnboardingRedirectUrl(request: NextRequest, requestOrigin: string): URL {
  const candidate = request.nextUrl.searchParams.get("redirect_url") ?? "/";
  const redirectPath = safeLocalRedirect(candidate, requestOrigin) ?? "/";
  const redirectUrl = new URL(redirectPath, requestOrigin);
  return ONBOARDING_PATH_PATTERN.test(redirectUrl.pathname)
    ? new URL("/", requestOrigin)
    : redirectUrl;
}

function isAuthPath(pathname: string): boolean {
  return AUTH_PATH_PATTERN.test(pathname);
}

function readOnboardingComplete(claims: unknown): boolean {
  if (!isRecord(claims)) {
    return false;
  }
  const metadata = claims["metadata"];
  return isRecord(metadata) && metadata["onboarding_complete"] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
