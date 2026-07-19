type MaybePromise<T> = T | Promise<T>;

export type SkillRuntimeConfig = {
  backendBaseUrl: string;
  accessToken: string;
  projectId?: string;
  runId?: string;
  assistantClientMessageId?: string;
  chatSessionId?: string;
  sandboxContext?: "message" | "project";
  deliveryChannel?: "telegram" | "imessage";
};

export type CheatcodeSkillRequestMethod =
  | "DELETE"
  | "GET"
  | "PATCH"
  | "POST"
  | "PUT";

export type SkillLogger = {
  log: (...values: unknown[]) => void;
  error: (...values: unknown[]) => void;
};

type BaseOptionDefinition = {
  description: string;
  short?: string;
  required?: boolean;
};

export type StringOptionDefinition = BaseOptionDefinition & {
  kind: "string";
  defaultValue?: string;
};

export type IntegerOptionDefinition = BaseOptionDefinition & {
  kind: "integer";
  defaultValue?: number;
  min?: number;
  max?: number;
};

export type BooleanOptionDefinition = BaseOptionDefinition & {
  kind: "boolean";
  defaultValue?: boolean;
};

export type SkillOptionDefinition =
  | StringOptionDefinition
  | IntegerOptionDefinition
  | BooleanOptionDefinition;

export type SkillOptionsShape = Record<string, SkillOptionDefinition>;

type OptionValue<TOption extends SkillOptionDefinition> =
  TOption extends StringOptionDefinition
    ? TOption["defaultValue"] extends string
      ? string
      : string | undefined
    : TOption extends IntegerOptionDefinition
      ? TOption["defaultValue"] extends number
        ? number
        : number | undefined
      : TOption extends BooleanOptionDefinition
        ? boolean
        : never;

export type InferOptions<TOptions extends SkillOptionsShape | undefined> =
  TOptions extends SkillOptionsShape
    ? {
        [TKey in keyof TOptions]: OptionValue<TOptions[TKey]>;
      }
    : Record<string, never>;

type SkillActionContext<TOptions extends SkillOptionsShape | undefined> = {
  options: InferOptions<TOptions>;
  positionals: string[];
  logger: SkillLogger;
};

export type SkillToolConfig<TOptions extends SkillOptionsShape | undefined> = {
  name: string;
  description: string;
  help?: string;
  options?: TOptions;
  action?: (
    context: SkillActionContext<TOptions>,
  ) => MaybePromise<void>;
};

export type SkillSubcommandConfig<
  TOptions extends SkillOptionsShape | undefined,
> = {
  name: string;
  description: string;
  help?: string;
  options?: TOptions;
  action: (
    context: SkillActionContext<TOptions>,
  ) => MaybePromise<void>;
};

export type NormalizedSubcommand<
  TOptions extends SkillOptionsShape | undefined,
> = {
  name: string;
  description: string;
  help?: string;
  options?: TOptions;
  action: (
    context: SkillActionContext<TOptions>,
  ) => MaybePromise<void>;
};

export type ParsedOptionValue =
  | string
  | number
  | boolean
  | undefined;

export type CheatcodeSkillFrontendEvent = {
  type: string;
  data?: Record<string, unknown>;
};

export type CheatcodeComposioProxyRequest = {
  config: SkillRuntimeConfig;
  toolkitSlug: string;
  method?: CheatcodeSkillRequestMethod;
  endpoint: string;
  body?: unknown;
};

export type CheatcodeComposioToolRequest = {
  config: SkillRuntimeConfig;
  toolkitSlug: string;
  toolSlug: string;
  arguments?: Record<string, unknown>;
};

export type CheatcodeComposioToolError =
  | string
  | {
      message?: string | null;
    }
  | null;

export type CheatcodeComposioToolEnvelope<
  TData,
  TError extends CheatcodeComposioToolError = CheatcodeComposioToolError,
> = {
  successful: boolean;
  data?: TData;
  error?: TError;
};

export type RuntimeBoundSkillRequester<
  TOperation extends string,
  TResponseMap extends Record<string, unknown>,
> = {
  <TSpecificOperation extends keyof TResponseMap & TOperation>(params: {
    operation: TSpecificOperation;
    body?: Record<string, unknown>;
  }): Promise<TResponseMap[TSpecificOperation]>;
  <TResponse>(params: {
    operation: TOperation;
    body?: Record<string, unknown>;
  }): Promise<TResponse>;
};
