import type { Metadata } from "next";
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

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReplayView id={id} />;
}
