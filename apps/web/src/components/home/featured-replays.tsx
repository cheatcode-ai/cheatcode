import type { FeaturedReplays as FeaturedReplayResponse } from "@cheatcode/types";
import Link from "next/link";
import type { ComponentType } from "react";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import {
  ArrowUpRight,
  BookOpen,
  FileSpreadsheet,
  Globe,
  Monitor,
  Star,
  TrendingUp,
} from "@/components/ui/icons";
import { fetchFeaturedReplays } from "@/lib/api/replays";
import { SEEDED_REPLAY_ROWS } from "../replay/seeded-replays";

type ReplayRow = FeaturedReplayResponse["data"][number];

export async function FeaturedReplays() {
  const featured = await fetchFeaturedReplays();
  const rows = featured.data.length > 0 ? featured.data : SEEDED_REPLAY_ROWS;

  return (
    <section className="mt-2 w-full max-w-[448px] overflow-hidden rounded-[17px] border border-[#f1f1f1] bg-[#f7f7f7]/60">
      <h2 className="px-3 py-1.5 font-medium text-[#707070] text-[11px] leading-[16.5px]">
        Watch replays
      </h2>
      <ul className="flex flex-col gap-1 rounded-[16px] bg-white p-1">
        {rows.map((replay) => (
          <li key={replay.id}>
            <Link
              className="group flex w-full items-start justify-between rounded-full px-2.5 py-1.5 transition-colors duration-150 hover:bg-[#f7f7f7]"
              href={`/replay/${replay.id}`}
            >
              <span className="flex min-w-0 items-start gap-2.5">
                <ReplayIcon accentKind={replay.accentKind} />
                <span className="min-w-0 font-medium text-[#1b1b1b] text-[13px] leading-snug">
                  <span className="line-clamp-1">{replay.title}</span>
                  <span className="sr-only">{replay.previewText}</span>
                </span>
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-[#a0a0a0] transition-colors group-hover:text-[#1b1b1b]"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReplayIcon({ accentKind }: { accentKind: ReplayRow["accentKind"] }) {
  const Icon = iconForAccent(accentKind);
  return <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8a8a8a]" />;
}

type ReplayIconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "false" | "true";
}>;

function iconForAccent(accentKind: ReplayRow["accentKind"]): ReplayIconComponent {
  switch (accentKind) {
    case "app":
      return Monitor;
    case "deck":
      return Star;
    case "research":
      return CheatcodeMark;
    case "data":
      return TrendingUp;
    case "landing":
      return Globe;
    case "social":
      return BookOpen;
    default:
      return FileSpreadsheet;
  }
}
