/**
 * Centralized environment variable access.
 * Import validated values from here instead of accessing process.env directly.
 *
 * IMPORTANT: Next.js only inlines NEXT_PUBLIC_* vars when accessed as literal
 * `process.env.NEXT_PUBLIC_X` expressions. Dynamic access like `process.env[name]`
 * will be undefined on the client side. Each var must be accessed literally.
 */

// Required public environment variables (literal access for Next.js inlining)
export const NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const NEXT_PUBLIC_BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? '';
