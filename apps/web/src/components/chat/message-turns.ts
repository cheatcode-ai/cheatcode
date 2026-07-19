import type { CheatcodeUIMessage } from "@cheatcode/types";

export interface MessageTurn {
  id: string;
  messages: readonly CheatcodeUIMessage[];
}

/** Groups a user prompt with every response segment that follows it. */
export function groupMessagesIntoTurns(messages: readonly CheatcodeUIMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let current: CheatcodeUIMessage[] = [];

  for (const message of messages) {
    if (message.role === "user" && current.length > 0) {
      turns.push(toTurn(current));
      current = [];
    }
    current.push(message);
  }

  if (current.length > 0) {
    turns.push(toTurn(current));
  }
  return turns;
}

function toTurn(messages: CheatcodeUIMessage[]): MessageTurn {
  return {
    id: messages[0]?.id ?? `turn-${messages.length}`,
    messages,
  };
}
