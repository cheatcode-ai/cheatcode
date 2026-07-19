import { z } from "zod";

export const PRODUCTION_CLERK_FRONTEND_HOSTNAME = "clerk.trycheatcode.com";
const PRODUCTION_GATEWAY_ORIGIN = "https://gateway.trycheatcode.com";
const PRODUCTION_PREVIEW_HOSTNAME = "trycheatcode.com";
const VercelEnvironmentSchema = z.enum(["development", "preview", "production"]);
const OptionalVercelEnvironmentSchema = VercelEnvironmentSchema.optional();
const VercelHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+vercel\.app$/u,
    "VERCEL_URL must be a Vercel hostname without a scheme or path",
  );

/** App variables allowed to remain after the root local env is loaded for Next. */
export const WEB_APPLICATION_ENV_KEYS: ReadonlySet<string> = new Set([
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_GATEWAY_URL",
  "NEXT_PUBLIC_PREVIEW_HOSTNAME",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
]);

export type WebDeploymentInput = Readonly<{
  VERCEL_ENV: string | undefined;
  VERCEL_TARGET_ENV: string | undefined;
}>;

export type ClerkPublishableKeyIdentity = Readonly<{
  environmentType: "development" | "production";
  frontendApiHostname: string;
}>;

const ClerkPublishableKeyIdentitySchema = z
  .string()
  .trim()
  .regex(/^pk_(?:live|test)_[A-Za-z0-9_-]+$/u, "Clerk publishable key is malformed")
  .transform((key, context): ClerkPublishableKeyIdentity => {
    const isProduction = key.startsWith("pk_live_");
    const prefix = isProduction ? "pk_live_" : "pk_test_";
    const decoded = decodeClerkFrontendHostname(key.slice(prefix.length));
    if (decoded === undefined || !decoded.endsWith("$") || decoded.slice(0, -1).includes("$")) {
      context.addIssue({ code: "custom", message: "Clerk publishable key payload is malformed" });
      return z.NEVER;
    }
    const frontendApiHostname = decoded.slice(0, -1).toLowerCase();
    if (!isMultiLabelHostname(frontendApiHostname)) {
      context.addIssue({
        code: "custom",
        message: "Clerk publishable key contains an invalid Frontend API hostname",
      });
      return z.NEVER;
    }
    return {
      environmentType: isProduction ? "production" : "development",
      frontendApiHostname,
    };
  });

/** Decode only the non-secret environment and Frontend API identity carried by a Clerk key. */
export function parseClerkPublishableKeyIdentity(value: unknown): ClerkPublishableKeyIdentity {
  return ClerkPublishableKeyIdentitySchema.parse(value);
}

export type WebBuildEnvironmentInput = WebDeploymentInput &
  Readonly<{
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string | undefined;
    NEXT_PUBLIC_GATEWAY_URL: string | undefined;
    NEXT_PUBLIC_PREVIEW_HOSTNAME: string | undefined;
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: string | undefined;
  }>;

export type WebDeployment = Readonly<{
  environment: z.infer<typeof VercelEnvironmentSchema>;
  isRuntimeDeployment: boolean;
  isVercelDeployment: boolean;
  runtimeEnvironment: z.infer<typeof OptionalVercelEnvironmentSchema>;
  targetEnvironment: z.infer<typeof OptionalVercelEnvironmentSchema>;
}>;

const WebDeploymentInputSchema = z
  .strictObject({
    VERCEL_ENV: OptionalVercelEnvironmentSchema,
    VERCEL_TARGET_ENV: OptionalVercelEnvironmentSchema,
  })
  .superRefine((value, context) => {
    if (
      value.VERCEL_ENV !== undefined &&
      value.VERCEL_TARGET_ENV !== undefined &&
      value.VERCEL_ENV !== value.VERCEL_TARGET_ENV
    ) {
      context.addIssue({
        code: "custom",
        message: "VERCEL_ENV and VERCEL_TARGET_ENV must not select different environments",
        path: ["VERCEL_TARGET_ENV"],
      });
    }
  });

export function parseWebDeployment(input: WebDeploymentInput): WebDeployment {
  const parsed = WebDeploymentInputSchema.parse(input);
  const environment = parsed.VERCEL_ENV ?? parsed.VERCEL_TARGET_ENV ?? "development";
  return {
    environment,
    isRuntimeDeployment: parsed.VERCEL_ENV === "preview" || parsed.VERCEL_ENV === "production",
    isVercelDeployment: environment === "preview" || environment === "production",
    runtimeEnvironment: parsed.VERCEL_ENV,
    targetEnvironment: parsed.VERCEL_TARGET_ENV,
  };
}

export function createWebEnvironmentSchemas(deployment: WebDeployment) {
  const clerkPublishableConfiguration = clerkPublishableConfigurationSchema(deployment);
  return {
    clerkPublishableConfiguration,
    clerkPublishableKey: clerkPublishableConfiguration.transform(({ key }) => key),
    clerkSecretKey: clerkSecretKeySchema(deployment),
    gatewayOrigin: gatewayOriginSchema(deployment),
    previewHostname: previewHostnameSchema(deployment),
    releaseSha: releaseShaSchema(deployment),
    vercelEnvironment: OptionalVercelEnvironmentSchema,
    vercelTargetEnvironment: OptionalVercelEnvironmentSchema,
    vercelUrl: deployment.isRuntimeDeployment
      ? VercelHostnameSchema
      : VercelHostnameSchema.optional(),
  };
}

export function parseWebBuildEnvironment(input: WebBuildEnvironmentInput) {
  const deployment = parseWebDeployment({
    VERCEL_ENV: input.VERCEL_ENV,
    VERCEL_TARGET_ENV: input.VERCEL_TARGET_ENV,
  });
  const schemas = createWebEnvironmentSchemas(deployment);
  const clerk = schemas.clerkPublishableConfiguration.parse(
    input.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  return {
    clerkFrontendHostname: clerk.frontendHostname,
    clerkPublishableKey: clerk.key,
    deployment,
    gatewayOrigin: schemas.gatewayOrigin.parse(input.NEXT_PUBLIC_GATEWAY_URL),
    previewHostname: schemas.previewHostname.parse(input.NEXT_PUBLIC_PREVIEW_HOSTNAME),
    releaseSha: schemas.releaseSha.parse(input.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA),
  };
}

function clerkPublishableConfigurationSchema(deployment: WebDeployment) {
  const expectedEnvironment = deployment.isVercelDeployment ? "live" : "test";
  const prefix = `pk_${expectedEnvironment}_`;
  return z
    .string()
    .trim()
    .startsWith(
      prefix,
      `${deployment.isVercelDeployment ? "Vercel" : "Local development"} requires a Clerk ${prefix} publishable key`,
    )
    .transform((key, context) => {
      const inspected = inspectClerkFrontendHostname(key, deployment);
      if (!inspected.success) {
        context.addIssue({ code: "custom", message: inspected.message });
        return z.NEVER;
      }
      return { frontendHostname: inspected.hostname, key };
    });
}

function clerkSecretKeySchema(deployment: WebDeployment) {
  const environment = deployment.isVercelDeployment ? "live" : "test";
  const prefix = `sk_${environment}_`;
  return z
    .string()
    .trim()
    .min(prefix.length + 1)
    .startsWith(
      prefix,
      `${deployment.isVercelDeployment ? "Vercel" : "Local development"} requires a Clerk ${prefix} secret key`,
    );
}

function gatewayOriginSchema(deployment: WebDeployment) {
  return z
    .string()
    .trim()
    .url()
    .transform((value, context) => {
      const parsed = new URL(value);
      if (value !== parsed.origin) {
        context.addIssue({
          code: "custom",
          message: "Gateway URL must be an origin without credentials, path, query, or fragment",
        });
      }
      validateGatewayProtocol(parsed, context);
      if (deployment.isVercelDeployment && parsed.origin !== PRODUCTION_GATEWAY_ORIGIN) {
        context.addIssue({
          code: "custom",
          message: `Vercel deployments require ${PRODUCTION_GATEWAY_ORIGIN}`,
        });
      }
      return parsed.origin;
    });
}

function previewHostnameSchema(deployment: WebDeployment) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (hostname) =>
        (!deployment.isVercelDeployment && hostname === "localhost") ||
        isMultiLabelHostname(hostname),
      "Preview hostname must be localhost locally or a multi-label DNS hostname",
    )
    .refine(
      (hostname) => !deployment.isVercelDeployment || hostname === PRODUCTION_PREVIEW_HOSTNAME,
      `Vercel deployments require ${PRODUCTION_PREVIEW_HOSTNAME}`,
    );
}

function releaseShaSchema(deployment: WebDeployment) {
  const exactShaSchema = z
    .string()
    .trim()
    .regex(/^[0-9a-f]{40}$/u);
  return deployment.isVercelDeployment
    ? exactShaSchema
    : z.union([exactShaSchema, z.literal("development")]);
}

function validateGatewayProtocol(parsed: URL, context: z.RefinementCtx): void {
  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(isLoopback && parsed.protocol === "http:")) {
    context.addIssue({
      code: "custom",
      message: "Gateway URL must use HTTPS except for a loopback development origin",
    });
  }
}

function decodeClerkFrontendHostname(encoded: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) {
    return undefined;
  }
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  try {
    const decoded = atob(padded);
    const canonical = btoa(decoded).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    return canonical === encoded ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function inspectClerkFrontendHostname(
  key: string,
  deployment: WebDeployment,
): { hostname: string; success: true } | { message: string; success: false } {
  const parsed = ClerkPublishableKeyIdentitySchema.safeParse(key);
  if (!parsed.success)
    return { message: parsed.error.issues[0]?.message ?? "Invalid Clerk key", success: false };
  const hostname = parsed.data.frontendApiHostname;
  if (deployment.isVercelDeployment && hostname !== PRODUCTION_CLERK_FRONTEND_HOSTNAME) {
    return {
      message: `Vercel requires the ${PRODUCTION_CLERK_FRONTEND_HOSTNAME} Clerk instance`,
      success: false,
    };
  }
  if (!deployment.isVercelDeployment && !hostname.endsWith(".clerk.accounts.dev")) {
    return { message: "Local development requires a Clerk development instance", success: false };
  }
  return { hostname, success: true };
}

function isMultiLabelHostname(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.includes(".")) {
    return false;
  }
  return hostname
    .split(".")
    .every(
      (label) =>
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    );
}
