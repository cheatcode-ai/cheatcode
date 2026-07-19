/** Read one exact cookie value without decoding or normalizing the credential. */
export function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const cookie of cookieHeader.split(";")) {
    const trimmed = cookie.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex !== -1 && trimmed.slice(0, separatorIndex) === name) {
      return trimmed.slice(separatorIndex + 1);
    }
  }
  return null;
}
