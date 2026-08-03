type ClerkTokenGetter = (options?: { skipCache?: boolean }) => Promise<null | string>;

export async function resolveComposerAuthToken(
  getAuthToken: ClerkTokenGetter,
): Promise<null | string> {
  return getAuthToken({ skipCache: true });
}
