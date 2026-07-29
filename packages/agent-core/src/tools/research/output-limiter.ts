export interface CharacterLimiter {
  remaining: number;
  wasTruncated: boolean;
}

export function createCharacterLimiter(maxCharacters: number): CharacterLimiter {
  return { remaining: maxCharacters, wasTruncated: false };
}

export function takeLimitedContent(
  value: string | undefined,
  maxCharacters: number,
  limiter: CharacterLimiter,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const allowed = Math.min(maxCharacters, limiter.remaining);
  if (allowed <= 0 && value.length > 0) {
    limiter.wasTruncated = true;
    return undefined;
  }
  const normalized = value.slice(0, allowed);
  limiter.remaining -= normalized.length;
  if (normalized.length < value.length) {
    limiter.wasTruncated = true;
  }
  return normalized;
}
