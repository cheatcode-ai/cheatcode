export interface ParsedOption {
  name: string;
  nextIndex: number;
  value?: string;
}

export interface ParsedValue {
  nextIndex: number;
  value: string;
}

export function readOption(argv: readonly string[], index: number): ParsedOption {
  const arg = argv[index];
  if (!arg) {
    throw new Error(`Missing argument at index ${index}.`);
  }
  if (arg === "--") {
    return { name: "--", nextIndex: index };
  }
  const equalsIndex = arg.indexOf("=");
  if (arg.startsWith("--") && equalsIndex > 0) {
    return {
      name: arg.slice(0, equalsIndex),
      nextIndex: index,
      value: arg.slice(equalsIndex + 1),
    };
  }
  return { name: arg, nextIndex: index };
}

export function readRequiredOptionValue(
  argv: readonly string[],
  index: number,
  option: ParsedOption,
  description: string,
): ParsedValue {
  if (option.value !== undefined) {
    if (option.value.length === 0) {
      throw new Error(`${option.name} requires ${description}.`);
    }
    return { nextIndex: index, value: option.value };
  }

  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${option.name} requires ${description}.`);
  }
  return { nextIndex: index + 1, value };
}
