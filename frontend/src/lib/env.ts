/**
 * Centralized environment variable validation.
 * Import validated values from here instead of accessing process.env directly.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Required public environment variables
export const NEXT_PUBLIC_SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
export const NEXT_PUBLIC_SUPABASE_ANON_KEY = requireEnv(
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
);
export const NEXT_PUBLIC_BACKEND_URL = requireEnv('NEXT_PUBLIC_BACKEND_URL');
