import { type CodeRuntimeContext, CodeRuntimeContextSchema } from "@cheatcode/sandbox-contracts";
import { ResearchRuntimeContextSchema } from "@cheatcode/tools-research";
import { EXA_API_KEY_CONTEXT_KEY, FIRECRAWL_API_KEY_CONTEXT_KEY } from "../research-context";
import { browserRuntimeFromRequestContext } from "./browser-runtime";

const requestContextReaderSchema = {
  parse(value: unknown): RequestContextReader {
    if (!value || typeof value !== "object") {
      throw new Error("Mastra request context is required for runCode.");
    }
    const candidate = value as { get?: unknown };
    if (typeof candidate.get !== "function") {
      throw new Error("Mastra request context does not expose get().");
    }
    return candidate as RequestContextReader;
  },
};

export type RequestContextReader = { get(key: string): unknown };

export function requestContextFromToolContext(context: unknown): RequestContextReader {
  return requestContextReaderSchema.parse(
    typeof context === "object" && context !== null
      ? (context as { requestContext?: unknown }).requestContext
      : undefined,
  );
}

export function codeRuntimeFromContext(context: unknown): CodeRuntimeContext {
  const requestContext = requestContextFromToolContext(context);
  return CodeRuntimeContextSchema.parse(requestContext.get("codeRuntime"));
}

export async function workspaceRuntimeFromContext(context: unknown) {
  const runtime = codeRuntimeFromContext(context);
  if (!runtime.workspaceDir) {
    const workspace = await runtime.ensureWorkspace?.();
    if (workspace) {
      runtime.workspaceDir = workspace.workspaceDir;
    }
  }
  if (!runtime.workspaceDir) {
    throw new Error("This tool requires a project workspace.");
  }
  return runtime;
}

export function browserRuntimeFromContext(context: unknown) {
  const requestContext = requestContextFromToolContext(context);
  return browserRuntimeFromRequestContext(requestContext);
}

export function researchRuntimeFromContext(context: unknown) {
  const requestContext = requestContextFromToolContext(context);
  return ResearchRuntimeContextSchema.parse({
    exaApiKey: requestContext.get(EXA_API_KEY_CONTEXT_KEY),
    firecrawlApiKey: requestContext.get(FIRECRAWL_API_KEY_CONTEXT_KEY),
  });
}
