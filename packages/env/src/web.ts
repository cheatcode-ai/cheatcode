import { createEnv } from "@t3-oss/env-nextjs";
import { createWebEnvironmentSchemas, parseWebDeployment } from "./web-config";

type NextPublicEnv = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_GATEWAY_URL?: string;
  NEXT_PUBLIC_PREVIEW_HOSTNAME?: string;
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?: string;
};

const deployment = parseWebDeployment({
  VERCEL_ENV: process.env["VERCEL_ENV"],
  VERCEL_TARGET_ENV: process.env["VERCEL_TARGET_ENV"],
});
const schemas = createWebEnvironmentSchemas(deployment);

export const env = createEnv({
  server: {
    CLERK_SECRET_KEY: schemas.clerkSecretKey,
    VERCEL_ENV: schemas.vercelEnvironment,
    VERCEL_TARGET_ENV: schemas.vercelTargetEnvironment,
    VERCEL_URL: schemas.vercelUrl,
  },
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: schemas.clerkPublishableKey,
    NEXT_PUBLIC_GATEWAY_URL: schemas.gatewayOrigin,
    NEXT_PUBLIC_PREVIEW_HOSTNAME: schemas.previewHostname,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: schemas.releaseSha,
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: (process.env as NextPublicEnv)
      .NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_GATEWAY_URL: (process.env as NextPublicEnv).NEXT_PUBLIC_GATEWAY_URL,
    NEXT_PUBLIC_PREVIEW_HOSTNAME: (process.env as NextPublicEnv).NEXT_PUBLIC_PREVIEW_HOSTNAME,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: (process.env as NextPublicEnv)
      .NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  },
});
