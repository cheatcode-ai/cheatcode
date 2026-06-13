import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

type NextPublicEnv = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_GATEWAY_URL?: string;
  NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

export const env = createEnv({
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_GATEWAY_URL: z.string().url().default("http://localhost:8787"),
    NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID: z.string().min(1).optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: (process.env as NextPublicEnv)
      .NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_GATEWAY_URL: (process.env as NextPublicEnv).NEXT_PUBLIC_GATEWAY_URL,
    NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID: (process.env as NextPublicEnv)
      .NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: (process.env as NextPublicEnv).NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: (process.env as NextPublicEnv).NEXT_PUBLIC_SUPABASE_URL,
  },
  emptyStringAsUndefined: true,
});
