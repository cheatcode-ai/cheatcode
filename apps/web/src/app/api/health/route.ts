import { env } from "@cheatcode/env/web";

export function GET(): Response {
  return Response.json(
    {
      ok: true,
      releaseSha: env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
      service: "web",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
