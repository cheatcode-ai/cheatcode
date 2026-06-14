import type { Metadata } from "next";
import { Suspense } from "react";
import { ReplayView } from "@/components/replay/replay-view";

/**
 * Public replay page — lives outside the `(app)` route group (no `AppChrome`)
 * and is intentionally absent from the Clerk middleware matcher, so it is
 * unauthenticated and publicly reachable. Indexable by design: these are
 * operator-vetted marketing demos, protected by the gateway's defense-in-depth
 * redaction pass (no `noindex`). The shell does no data fetch — `ReplayView`
 * fetches `GET /v1/replays/:id` client-side.
 */
export const metadata: Metadata = {
  title: "Replay · Cheatcode",
};

// `cacheComponents` (Next 16) requires uncached request data — here `await params`
// on this public route outside the (app)/Clerk group — to resolve inside a
// <Suspense> boundary, else static prerender fails with "uncached data accessed
// outside <Suspense>". Matches the home-page searchParams-in-Suspense pattern.
export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <ReplayContent params={params} />
    </Suspense>
  );
}

async function ReplayContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReplayView id={id} />;
}
