import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Shared protected-route matcher. The onboarding gate wraps every protected
// route, so app routes added by other clusters (discovery-misc "/101(.*)",
// automations "/automations(.*)") MUST be appended here to stay gated. The
// public "/replay" page is intentionally NOT matched so it stays unauthenticated.
const isProtectedRoute = createRouteMatcher([
  "/projects(.*)",
  "/settings(.*)",
  "/skills(.*)",
  "/onboarding(.*)",
]);
const isOnboardingRoute = createRouteMatcher(["/onboarding(.*)"]);

const middleware = clerkMiddleware(async (auth, request) => {
  if (!isProtectedRoute(request)) {
    return;
  }
  const { sessionClaims } = await auth.protect();
  const complete = readOnboardingComplete(sessionClaims);
  if (!complete && !isOnboardingRoute(request)) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }
  if (complete && isOnboardingRoute(request)) {
    return NextResponse.redirect(new URL("/projects", request.url));
  }
  return undefined;
});

function readOnboardingComplete(claims: unknown): boolean {
  if (!isRecord(claims)) {
    return false;
  }
  const metadata = claims["metadata"];
  if (!isRecord(metadata)) {
    return false;
  }
  return metadata["onboarding_complete"] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default middleware;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
