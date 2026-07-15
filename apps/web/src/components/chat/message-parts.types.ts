import type { CheatcodeUIMessage } from "@cheatcode/types";

export type MessagePart = CheatcodeUIMessage["parts"][number];
export type ArtifactData = Extract<MessagePart, { type: "data-artifact" }>["data"];

export type TimelineItem =
  | { kind: "activity"; key: string; parts: MessagePart[] }
  | { kind: "part"; key: string; part: MessagePart };
