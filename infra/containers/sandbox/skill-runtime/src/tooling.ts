import { parseArgs } from "node:util";

import { ensureProjectEnvLoaded } from "./runtime";
import type {
  BooleanOptionDefinition,
  InferOptions,
  IntegerOptionDefinition,
  NormalizedSubcommand,
  ParsedOptionValue,
  SkillLogger,
  SkillOptionDefinition,
  SkillOptionsShape,
  SkillSubcommandConfig,
  SkillToolConfig,
  StringOptionDefinition,
} from "./types";

const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHORT_FLAG_PATTERN = /^[a-z]$/;

function assertCommandName(value: string, label: string): void {
  if (!COMMAND_NAME_PATTERN.test(value)) {
    throw new Error(
      `${label} must be lowercase kebab-case without spaces: "${value}"`,
    );
  }
}

function assertShortFlag(short: string | undefined, label: string): void {
  if (!short) {
    return;
  }

  if (!SHORT_FLAG_PATTERN.test(short)) {
    throw new Error(
      `${label} shorthand must be a single lowercase letter: "${short}"`,
    );
  }
}

function assertUniqueOptionNames(options: SkillOptionsShape | undefined): void {
  if (!options) {
    return;
  }

  const seenShortFlags = new Set<string>();

  for (const [optionName, option] of Object.entries(options)) {
    assertCommandName(optionName, `Option "${optionName}"`);
    assertShortFlag(option.short, `Option "${optionName}"`);

    if (option.short) {
      if (seenShortFlags.has(option.short)) {
        throw new Error(`Duplicate shorthand flag: "-${option.short}"`);
      }

      seenShortFlags.add(option.short);
    }
  }
}

function toParseArgsOptions(options: SkillOptionsShape | undefined) {
  if (!options) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(options).map(([optionName, option]) => [
      optionName,
      {
        type: option.kind === "boolean" ? "boolean" : "string",
        ...(option.short ? { short: option.short } : {}),
      } as const,
    ]),
  );
}

function coerceOptionValue(
  optionName: string,
  definition: SkillOptionDefinition,
  rawValue: string | boolean | undefined,
): ParsedOptionValue {
  if (definition.kind === "boolean") {
    if (typeof rawValue === "boolean") {
      return rawValue;
    }

    if (typeof rawValue === "undefined") {
      return definition.defaultValue ?? false;
    }

    throw new Error(`Option "--${optionName}" must be a boolean flag.`);
  }

  if (typeof rawValue !== "string") {
    if (
      typeof rawValue === "undefined" &&
      typeof definition.defaultValue !== "undefined"
    ) {
      return definition.defaultValue;
    }

    if (definition.required) {
      throw new Error(`Option "--${optionName}" requires a value.`);
    }

    return undefined;
  }

  if (definition.kind === "string") {
    return rawValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Option "--${optionName}" must be an integer.`);
  }

  if (typeof definition.min === "number" && parsedValue < definition.min) {
    throw new Error(
      `Option "--${optionName}" must be at least ${definition.min}.`,
    );
  }

  if (typeof definition.max === "number" && parsedValue > definition.max) {
    throw new Error(
      `Option "--${optionName}" must be at most ${definition.max}.`,
    );
  }

  return parsedValue;
}

function parseDefinedOptions<TOptions extends SkillOptionsShape | undefined>(
  options: TOptions,
  argv: string[],
): { values: InferOptions<TOptions>; positionals: string[] } {
  const definedOptions = (options ?? {}) as SkillOptionsShape;
  const parsed = parseArgs({
    args: argv,
    options: toParseArgsOptions(definedOptions),
    allowPositionals: true,
    strict: true,
  });

  const values = Object.fromEntries(
    Object.entries(definedOptions).map(([optionName, definition]) => [
      optionName,
      coerceOptionValue(
        optionName,
        definition,
        parsed.values[optionName] as string | boolean | undefined,
      ),
    ]),
  ) as InferOptions<TOptions>;

  return {
    values,
    positionals: parsed.positionals,
  };
}

function formatOptionHelp(options: SkillOptionsShape | undefined): string[] {
  if (!options || Object.keys(options).length === 0) {
    return [];
  }

  return Object.entries(options).map(([optionName, option]) => {
    const shortPrefix = option.short ? `-${option.short}, ` : "";
    const valueSuffix =
      option.kind === "boolean"
        ? ""
        : option.kind === "integer"
          ? " <number>"
          : " <value>";
    const defaultSuffix =
      typeof option.defaultValue !== "undefined"
        ? ` (default: ${String(option.defaultValue)})`
        : "";
    const requiredSuffix = option.required ? " (required)" : "";

    return `  ${shortPrefix}--${optionName}${valueSuffix}  ${option.description}${requiredSuffix}${defaultSuffix}`;
  });
}

function renderToolHelp(params: {
  name: string;
  description: string;
  help?: string;
  options?: SkillOptionsShape;
  subcommands: Array<NormalizedSubcommand<SkillOptionsShape | undefined>>;
}): string {
  const { name, description, help, options, subcommands } = params;
  const lines = [`${name}`, "", description];

  if (help) {
    lines.push("", help);
  }

  if (subcommands.length > 0) {
    lines.push("", "Subcommands:");
    for (const subcommand of subcommands) {
      lines.push(`  ${subcommand.name}  ${subcommand.description}`);
    }
    lines.push("", `Run "${name} <subcommand> --help" for more detail.`);
  } else {
    const optionLines = formatOptionHelp(options);
    if (optionLines.length > 0) {
      lines.push("", "Options:", ...optionLines);
    }
  }

  lines.push("", "Flags:", "  -h, --help  Show help");
  return lines.join("\n");
}

function renderSubcommandHelp(params: {
  toolName: string;
  subcommand: NormalizedSubcommand<SkillOptionsShape | undefined>;
}): string {
  const { toolName, subcommand } = params;
  const lines = [
    `${toolName} ${subcommand.name}`,
    "",
    subcommand.description,
  ];

  if (subcommand.help) {
    lines.push("", subcommand.help);
  }

  const optionLines = formatOptionHelp(subcommand.options);
  if (optionLines.length > 0) {
    lines.push("", "Options:", ...optionLines);
  }

  lines.push("", "Flags:", "  -h, --help  Show help");
  return lines.join("\n");
}

function printHelpAndExit(helpText: string): void {
  console.log(helpText);
  process.exit(0);
}

function buildLogger(): SkillLogger {
  return {
    log: (...values) => console.log(...values),
    error: (...values) => console.error(...values),
  };
}

function isHelpRequested(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function stringOption(
  config: Omit<StringOptionDefinition, "kind">,
): StringOptionDefinition {
  assertShortFlag(config.short, "String option");
  return {
    ...config,
    kind: "string",
  };
}

export function integerOption(
  config: Omit<IntegerOptionDefinition, "kind">,
): IntegerOptionDefinition {
  assertShortFlag(config.short, "Integer option");
  return {
    ...config,
    kind: "integer",
  };
}

export function booleanOption(
  config: Omit<BooleanOptionDefinition, "kind">,
): BooleanOptionDefinition {
  assertShortFlag(config.short, "Boolean option");
  return {
    ...config,
    kind: "boolean",
  };
}

export function createSubcommand<TOptions extends SkillOptionsShape | undefined>(
  config: SkillSubcommandConfig<TOptions>,
): NormalizedSubcommand<TOptions> {
  assertCommandName(config.name, "Subcommand name");
  assertUniqueOptionNames(config.options);

  return {
    ...config,
  };
}

class SkillToolBuilder<TOptions extends SkillOptionsShape | undefined> {
  private readonly config: SkillToolConfig<TOptions>;
  private readonly subcommands: Array<
    NormalizedSubcommand<SkillOptionsShape | undefined>
  > = [];

  constructor(config: SkillToolConfig<TOptions>) {
    assertCommandName(config.name, "Skill tool name");
    assertUniqueOptionNames(config.options);
    this.config = config;
  }

  subcommand<TSubOptions extends SkillOptionsShape | undefined>(
    config: NormalizedSubcommand<TSubOptions>,
  ): SkillToolBuilder<TOptions> {
    if (this.subcommands.some((subcommand) => subcommand.name === config.name)) {
      throw new Error(`Duplicate subcommand "${config.name}".`);
    }

    this.subcommands.push(
      config as NormalizedSubcommand<SkillOptionsShape | undefined>,
    );
    return this;
  }

  async run(argv = process.argv.slice(2)): Promise<void> {
    if (isHelpRequested(argv)) {
      printHelpAndExit(
        renderToolHelp({
          name: this.config.name,
          description: this.config.description,
          help: this.config.help,
          options: this.config.options,
          subcommands: this.subcommands,
        }),
      );
      return;
    }

    if (this.subcommands.length > 0) {
      const [subcommandName, ...restArgs] = argv;
      if (!subcommandName) {
        printHelpAndExit(
          renderToolHelp({
            name: this.config.name,
            description: this.config.description,
            help: this.config.help,
            options: this.config.options,
            subcommands: this.subcommands,
          }),
        );
        return;
      }

      const selectedSubcommand =
        this.subcommands.find((subcommand) => subcommand.name === subcommandName) ??
        null;

      if (!selectedSubcommand) {
        throw new Error(
          `Unknown subcommand "${subcommandName}" for ${this.config.name}.`,
        );
      }

      if (isHelpRequested(restArgs)) {
        printHelpAndExit(
          renderSubcommandHelp({
            toolName: this.config.name,
            subcommand: selectedSubcommand,
          }),
        );
        return;
      }

      const parsed = parseDefinedOptions(selectedSubcommand.options, restArgs);
      await ensureProjectEnvLoaded();
      await selectedSubcommand.action({
        options: parsed.values,
        positionals: parsed.positionals,
        logger: buildLogger(),
      });
      return;
    }

    if (!this.config.action) {
      throw new Error(
        `Skill tool "${this.config.name}" is missing an action.`,
      );
    }

    const parsed = parseDefinedOptions(this.config.options, argv);
    await ensureProjectEnvLoaded();
    await this.config.action({
      options: parsed.values as InferOptions<TOptions>,
      positionals: parsed.positionals,
      logger: buildLogger(),
    });
  }
}

export function createSkillTool<TOptions extends SkillOptionsShape | undefined>(
  config: SkillToolConfig<TOptions>,
): SkillToolBuilder<TOptions> {
  return new SkillToolBuilder(config);
}
