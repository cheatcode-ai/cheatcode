import type { SignIn } from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";
import type { ComponentProps } from "react";

// Clerk's out-of-the-box dark theme, verbatim. V2 renders Clerk via @clerk/ui, whose native themes
// live in "@clerk/ui/themes" (NOT the legacy @clerk/themes). The stock `dark` prebuilt appearance is
// applied as-is (no custom overrides); the cast only reconciles @clerk/ui's `| undefined` optionals
// with our exactOptionalPropertyTypes — the object is exactly what Clerk ships.
export const clerkAuthAppearance = dark as unknown as NonNullable<
  ComponentProps<typeof SignIn>["appearance"]
>;
