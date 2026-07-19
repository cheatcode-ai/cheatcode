import { requestCheatcodeSkillJson } from "./runtime";
import type {
  CheatcodeComposioProxyRequest,
  CheatcodeComposioToolEnvelope,
  CheatcodeComposioToolError,
  CheatcodeComposioToolRequest,
  CheatcodeSkillRequestMethod,
  SkillRuntimeConfig,
} from "./types";

function getCheatcodeComposioToolErrorMessage(
  error: CheatcodeComposioToolError | undefined,
): string | null {
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message.trim();
  }

  return null;
}

export function unwrapCheatcodeComposioToolData<
  TData,
  TError extends CheatcodeComposioToolError = CheatcodeComposioToolError,
>(
  response: CheatcodeComposioToolEnvelope<TData, TError>,
  errorMessage: string,
  options?: {
    allowEmptyData?: boolean;
  },
): TData | null {
  if (!response.successful) {
    throw new Error(getCheatcodeComposioToolErrorMessage(response.error) ?? errorMessage);
  }

  if (typeof response.data === "undefined") {
    if (options?.allowEmptyData) {
      return null;
    }

    throw new Error(errorMessage);
  }

  return response.data;
}

export async function requestCheatcodeComposioProxyJson<TResponse>(
  params: CheatcodeComposioProxyRequest,
): Promise<TResponse> {
  return requestCheatcodeSkillJson<TResponse>({
    config: params.config,
    path: "/composio/proxy",
    body: {
      ...(params.config.projectId ? { projectId: params.config.projectId } : {}),
      toolkitSlug: params.toolkitSlug,
      method: params.method ?? "POST",
      endpoint: params.endpoint,
      ...(typeof params.body === "undefined" ? {} : { body: params.body }),
    },
  });
}

export function createCheatcodeComposioProxyJsonRequester(toolkitSlug: string) {
  return async function requestToolkitProxyJson<TResponse>(params: {
    config: SkillRuntimeConfig;
    endpoint: string;
    method?: CheatcodeSkillRequestMethod;
    body?: unknown;
  }): Promise<TResponse> {
    return requestCheatcodeComposioProxyJson<TResponse>({
      config: params.config,
      toolkitSlug,
      endpoint: params.endpoint,
      ...(params.method ? { method: params.method } : {}),
      ...(typeof params.body === "undefined" ? {} : { body: params.body }),
    });
  };
}

export async function requestCheatcodeComposioToolJson<TResponse>(
  params: CheatcodeComposioToolRequest,
): Promise<TResponse> {
  return requestCheatcodeSkillJson<TResponse>({
    config: params.config,
    path: "/composio/tool",
    body: {
      ...(params.config.projectId ? { projectId: params.config.projectId } : {}),
      toolkitSlug: params.toolkitSlug,
      toolSlug: params.toolSlug,
      ...(typeof params.arguments === "undefined"
        ? {}
        : { arguments: params.arguments }),
    },
  });
}

export async function requestCheatcodeComposioToolData<
  TData,
  TError extends CheatcodeComposioToolError = CheatcodeComposioToolError,
>(
  params: CheatcodeComposioToolRequest & {
    errorMessage: string;
    allowEmptyData: true;
  },
): Promise<TData | null>;

export async function requestCheatcodeComposioToolData<
  TData,
  TError extends CheatcodeComposioToolError = CheatcodeComposioToolError,
>(
  params: CheatcodeComposioToolRequest & {
    errorMessage: string;
    allowEmptyData?: false | undefined;
  },
): Promise<TData>;

export async function requestCheatcodeComposioToolData<
  TData,
  TError extends CheatcodeComposioToolError = CheatcodeComposioToolError,
>(
  params: CheatcodeComposioToolRequest & {
    errorMessage: string;
    allowEmptyData?: boolean;
  },
): Promise<TData | null> {
  const response = await requestCheatcodeComposioToolJson<
    CheatcodeComposioToolEnvelope<TData, TError>
  >(params);

  return unwrapCheatcodeComposioToolData(response, params.errorMessage, {
    allowEmptyData: params.allowEmptyData,
  });
}

export function createCheatcodeComposioToolJsonRequester(toolkitSlug: string) {
  return async function requestToolkitToolJson<TResponse>(params: {
    config: SkillRuntimeConfig;
    toolSlug: string;
    arguments?: Record<string, unknown>;
  }): Promise<TResponse> {
    return requestCheatcodeComposioToolJson<TResponse>({
      config: params.config,
      toolkitSlug,
      toolSlug: params.toolSlug,
      ...(typeof params.arguments === "undefined"
        ? {}
        : { arguments: params.arguments }),
    });
  };
}

export function createCheatcodeComposioToolDataRequester(toolkitSlug: string) {
  async function requestToolkitToolData<
    TData,
    TError extends CheatcodeComposioToolError = CheatcodeComposioToolError,
  >(params: {
    config: SkillRuntimeConfig;
    toolSlug: string;
    arguments?: Record<string, unknown>;
    errorMessage: string;
    allowEmptyData: true;
  }): Promise<TData | null>;
  async function requestToolkitToolData<
    TData,
    TError extends CheatcodeComposioToolError = CheatcodeComposioToolError,
  >(params: {
    config: SkillRuntimeConfig;
    toolSlug: string;
    arguments?: Record<string, unknown>;
    errorMessage: string;
    allowEmptyData?: false | undefined;
  }): Promise<TData>;
  async function requestToolkitToolData<
    TData,
    TError extends CheatcodeComposioToolError = CheatcodeComposioToolError,
  >(params: {
    config: SkillRuntimeConfig;
    toolSlug: string;
    arguments?: Record<string, unknown>;
    errorMessage: string;
    allowEmptyData?: boolean;
  }): Promise<TData | null> {
    if (params.allowEmptyData) {
      return requestCheatcodeComposioToolData<TData, TError>({
        config: params.config,
        toolkitSlug,
        toolSlug: params.toolSlug,
        errorMessage: params.errorMessage,
        allowEmptyData: true,
        ...(typeof params.arguments === "undefined"
          ? {}
          : { arguments: params.arguments }),
      });
    }

    return requestCheatcodeComposioToolData<TData, TError>({
      config: params.config,
      toolkitSlug,
      toolSlug: params.toolSlug,
      errorMessage: params.errorMessage,
      ...(typeof params.arguments === "undefined"
        ? {}
        : { arguments: params.arguments }),
    });
  }

  return requestToolkitToolData;
}
