import { DEFAULT_DAYTONA_TARGET } from "@cheatcode/env";

/** Best-effort first-instantiation hint aligned with the configured sandbox region. */
export function durableObjectLocationHint(target: string | undefined): DurableObjectLocationHint {
  const normalized = (target ?? DEFAULT_DAYTONA_TARGET).trim().toLowerCase();
  if (/^(?:eu|europe|eu-)/u.test(normalized)) return "weur";
  if (/^(?:apac|asia|sg|singapore|jp|japan|kr|korea|in|india)/u.test(normalized)) return "apac";
  if (/^(?:au|australia|oc)/u.test(normalized)) return "oc";
  if (/^(?:me|middle-east)/u.test(normalized)) return "me";
  return "enam";
}
