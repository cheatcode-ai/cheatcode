import type { RequiredKey } from "./local-env-contract";

export interface KeyMeta {
  label: string;
  secret: boolean;
}

export const SETUP_KEY_META: Record<RequiredKey, KeyMeta> = {
  CLERK_SECRET_KEY: { label: "Clerk secret key", secret: true },
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: {
    label: "Agent database-context signing secret",
    secret: true,
  },
  DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY: {
    label: "Gateway database-context signing secret",
    secret: true,
  },
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: {
    label: "Webhooks database-context signing secret",
    secret: true,
  },
  DAYTONA_API_KEY: { label: "Daytona API key", secret: true },
  DAYTONA_API_URL: { label: "Daytona API URL", secret: false },
  DAYTONA_SANDBOX_SNAPSHOT: { label: "Daytona sandbox snapshot", secret: false },
  DAYTONA_TARGET: { label: "Daytona target", secret: false },
  DAYTONA_WEBHOOK_SIGNING_SECRET: {
    label: "Daytona webhook signing secret",
    secret: true,
  },
  DAYTONA_WORKSPACE_VOLUME: { label: "Daytona workspace volume", secret: false },
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: { label: "Clerk publishable key", secret: false },
  NEXT_PUBLIC_GATEWAY_URL: { label: "Local gateway URL", secret: false },
  MORPH_API_KEY: { label: "Morph API key", secret: true },
  OUTPUT_DOWNLOAD_SIGNING_SECRET: { label: "Output-download signing secret", secret: true },
  PREVIEW_TOKEN_SECRET: { label: "Preview-token signing secret", secret: true },
  SUPABASE_AGENT_DATABASE_URL: { label: "Agent database URL", secret: true },
  SUPABASE_GATEWAY_DATABASE_URL: { label: "Gateway database URL", secret: true },
  SUPABASE_WEBHOOKS_DATABASE_URL: { label: "Webhooks database URL", secret: true },
};
