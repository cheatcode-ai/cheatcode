"use client";

type ClerkBrowserSession = {
  session?: {
    getToken?: () => Promise<null | string>;
    lastActiveToken?: {
      getRawString?: () => string;
    };
  };
};

export async function resolveComposerAuthToken(
  getAuthToken: () => Promise<null | string>,
): Promise<null | string> {
  const browserSession = (window as Window & { Clerk?: ClerkBrowserSession }).Clerk?.session;
  const rawToken = browserSession?.lastActiveToken?.getRawString?.();
  if (rawToken) {
    return rawToken;
  }
  const browserToken = browserSession?.getToken
    ? await Promise.race([browserSession.getToken(), composerDelay(500).then(() => null)])
    : null;
  if (browserToken) {
    return browserToken;
  }
  return Promise.race([getAuthToken(), composerDelay(300).then(() => null)]);
}

function composerDelay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
