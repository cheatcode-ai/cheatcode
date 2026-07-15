import { z } from "zod";
import type {
  ComposioAuthConfigPage,
  ComposioConnectedAccountPage,
  ComposioConnectionLink,
  ComposioTool,
  ComposioToolExecution,
  ComposioToolkit,
  ComposioToolPage,
} from "./types";

const IdentifierSchema = z.string().min(1).max(500);
const SlugSchema = z.string().min(1).max(200);
const TimestampSchema = z.string().datetime();

const RawConnectedAccountSchema = z
  .object({
    alias: z.string().max(500).nullable().optional(),
    created_at: TimestampSchema,
    id: IdentifierSchema,
    is_disabled: z.boolean(),
    status: z.string().min(1).max(100),
    toolkit: z.object({ slug: SlugSchema }).strip(),
    updated_at: TimestampSchema,
    word_id: z.string().max(500).nullable().optional(),
  })
  .strip();

const RawConnectedAccountPageSchema = z
  .object({
    items: z.array(RawConnectedAccountSchema).max(100),
    next_cursor: z.string().max(2_000).nullish(),
  })
  .strip();

const RawAuthConfigPageSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            status: z.enum(["DISABLED", "ENABLED"]),
          })
          .strip(),
      )
      .max(1_000),
    next_cursor: z.string().max(2_000).nullish(),
  })
  .strip();

const RawAuthConfigCreateSchema = z
  .object({
    auth_config: z.object({ id: IdentifierSchema }).strip(),
  })
  .strip();

const RawConnectionLinkSchema = z
  .object({
    connected_account_id: IdentifierSchema,
    redirect_url: z.string().url().max(2_048),
  })
  .strip();

const RawToolkitSchema = z
  .object({
    composio_managed_auth_schemes: z.array(z.string().max(200)).max(20).optional(),
    meta: z
      .object({
        categories: z
          .array(z.object({ id: SlugSchema, name: z.string().max(200) }).strip())
          .max(50)
          .optional(),
        description: z.string().max(4_000).optional(),
      })
      .strip()
      .optional(),
    name: z.string().min(1).max(200),
    no_auth: z.boolean().optional(),
    slug: SlugSchema,
  })
  .strip();

const RawToolkitPageSchema = z.object({ items: z.array(RawToolkitSchema).max(500) }).strip();

const RawToolSchema = z
  .object({
    description: z.string().max(4_000).optional(),
    input_parameters: z.unknown().optional(),
    is_deprecated: z.boolean().optional(),
    name: z.string().max(200).optional(),
    slug: z.string().min(1).max(200),
    version: z.string().max(120).optional(),
  })
  .strip();

const RawToolPageSchema = z
  .object({
    items: z.array(RawToolSchema).max(1_000),
    next_cursor: z.string().max(2_000).nullish(),
  })
  .strip();

const RawToolExecutionSchema = z
  .object({
    data: z.unknown(),
    error: z.string().max(1_000).nullable(),
    log_id: z.string().max(500).optional(),
    successful: z.boolean(),
  })
  .strip();

export function parseConnectedAccountPage(value: unknown): ComposioConnectedAccountPage {
  const page = RawConnectedAccountPageSchema.parse(value);
  return {
    items: page.items.map((item) => ({
      ...(item.alias !== undefined ? { alias: item.alias } : {}),
      createdAt: item.created_at,
      id: item.id,
      isDisabled: item.is_disabled,
      status: item.status,
      toolkit: item.toolkit,
      updatedAt: item.updated_at,
      ...(item.word_id !== undefined ? { wordId: item.word_id } : {}),
    })),
    nextCursor: page.next_cursor ?? null,
  };
}

export function parseAuthConfigPage(value: unknown): ComposioAuthConfigPage {
  const page = RawAuthConfigPageSchema.parse(value);
  return { items: page.items, nextCursor: page.next_cursor ?? null };
}

export function parseAuthConfigId(value: unknown): string {
  return RawAuthConfigCreateSchema.parse(value).auth_config.id;
}

export function parseConnectionLink(value: unknown): ComposioConnectionLink {
  const link = RawConnectionLinkSchema.parse(value);
  return { id: link.connected_account_id, redirectUrl: link.redirect_url };
}

export function parseToolkits(value: unknown): ComposioToolkit[] {
  return RawToolkitPageSchema.parse(value).items.map((item) => ({
    ...(item.composio_managed_auth_schemes
      ? { composioManagedAuthSchemes: item.composio_managed_auth_schemes }
      : {}),
    ...(item.meta
      ? {
          meta: {
            ...(item.meta.categories
              ? {
                  categories: item.meta.categories.map((category) => ({
                    name: category.name,
                    slug: category.id,
                  })),
                }
              : {}),
            ...(item.meta.description ? { description: item.meta.description } : {}),
          },
        }
      : {}),
    name: item.name,
    ...(item.no_auth !== undefined ? { noAuth: item.no_auth } : {}),
    slug: item.slug,
  }));
}

export function parseToolPage(value: unknown): ComposioToolPage {
  const page = RawToolPageSchema.parse(value);
  const items: ComposioTool[] = page.items.map((item) => {
    const inputParameters = normalizeToolParameters(item.input_parameters);
    return {
      ...(item.description !== undefined ? { description: item.description } : {}),
      ...(inputParameters !== undefined ? { inputParameters } : {}),
      ...(item.is_deprecated !== undefined ? { isDeprecated: item.is_deprecated } : {}),
      ...(item.name !== undefined ? { name: item.name } : {}),
      slug: item.slug,
      ...(item.version !== undefined ? { version: item.version } : {}),
    };
  });
  return { items, nextCursor: page.next_cursor ?? null };
}

export function parseToolExecution(value: unknown): ComposioToolExecution {
  const execution = RawToolExecutionSchema.parse(value);
  return {
    data: execution.data,
    error: execution.error,
    ...(execution.log_id !== undefined ? { logId: execution.log_id } : {}),
    successful: execution.successful,
  };
}

function normalizeToolParameters(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    return undefined;
  }
  return value;
}
