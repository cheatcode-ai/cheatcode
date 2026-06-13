import Link from "next/link";
import { ArrowUpRight } from "@/components/ui/icons";
import { fetchFeaturedReplays } from "@/lib/api/replays";

/**
 * Home "Watch replays" card — async server component fed by
 * `GET /v1/replays/featured`. Empty list renders `null` so the card hides
 * entirely (per decision #9). Functional/minimal: the Paper 3PV-0 visual
 * treatment (per-`accentKind` icons, chevrons, card chrome) is the later UI
 * round and reuses this same data contract.
 */
export async function FeaturedReplays() {
  const featured = await fetchFeaturedReplays();
  if (featured.data.length === 0) {
    return null;
  }
  return (
    <section className="w-full font-mono">
      <h2 className="mb-4 text-[11px] text-zinc-500 uppercase tracking-[0.22em]">Watch replays</h2>
      <ul className="flex flex-col gap-2">
        {featured.data.map((replay) => (
          <li key={replay.id}>
            <Link
              className="group flex items-center justify-between gap-4 border border-zinc-800/60 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              href={`/replay/${replay.id}`}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium text-sm text-white">{replay.title}</span>
                <span className="truncate text-xs text-zinc-500">{replay.previewText}</span>
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-zinc-600 group-hover:text-zinc-300"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
