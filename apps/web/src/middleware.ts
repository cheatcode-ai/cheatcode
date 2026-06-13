import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/projects(.*)", "/settings(.*)", "/skills(.*)"]);

const middleware = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
});

export default middleware;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
