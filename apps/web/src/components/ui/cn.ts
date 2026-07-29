type ClassValue = false | null | string | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}
