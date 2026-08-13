import type { ComposioTool } from "@cheatcode/composio";
import type { ToolkitAction } from "@cheatcode/types/api";

const DESTRUCTIVE_ACTION_PATTERN =
  /\b(delete|destroy|disconnect|empty|erase|purge|remove|revoke|uninstall)\b/i;
const READ_ACTION_PATTERN =
  /^(check|download|export|find|inspect|list|look up|read|retrieve|search|show|view)\b/i;
const DRAFT_ACTION_PATTERN = /^(compose|create|write)\b.*\bdraft\b/i;
const SEND_EXISTING_ACTION_PATTERN = /^(publish|send)\b.*\b(draft|post)\b/i;
const MESSAGE_ACTION_PATTERN = /^(forward|post|reply|send)\b/i;
const CHANGE_ACTION_PATTERN =
  /^(add|approve|archive|assign|cancel|close|connect|create|disable|edit|enable|invite|log|mark|merge|move|publish|record|reject|restore|schedule|set|start|stop|update|upload)\b/i;
const ARTICLE_ACTION_PATTERN =
  /^(add|create|delete|edit|find|forward|move|open|post|publish|remove|reply to|restore|search|send|update|upload|view)\s+(.+)$/i;
const DETERMINER_PATTERN = /^(a|all|an|any|every|my|one|some|the|these|this|those|your)\b/i;
const PREPOSITION_PATTERN = /^(and|by|for|from|in|inside|on|or|to|with)\b/i;
const UNCOUNTABLE_NOUNS = new Set(["access", "content", "data", "information", "mail"]);
const IRREGULAR_PLURAL_NOUNS = new Set(["children", "feet", "men", "people", "teeth", "women"]);
const SINGULAR_NOUNS_ENDING_IN_S = new Set([
  "alias",
  "analysis",
  "basis",
  "crisis",
  "source",
  "status",
]);
const CONSONANT_SOUND_VOWEL_WORDS =
  /^(ewe|euro|one|uni(?:corn|form|que|t|vers)|user|utility|u[rs]l)\b/i;

export function presentIntegrationAction(
  tool: ComposioTool,
  toolkitDisplayName?: string,
): ToolkitAction {
  const fallbackName = actionNameFromSlug(tool.slug);
  const toolkitName = toolkitDisplayName ?? tool.toolkit?.name;
  const name = humanizeActionName(tool.name ?? fallbackName, toolkitName) || fallbackName;
  return {
    name,
    prompt: actionPrompt(name, tool),
    slug: tool.slug,
  };
}

function humanizeActionName(value: string, toolkitName: string | undefined): string {
  const cleaned = value
    .trim()
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\bfrom natural language\b/giu, "")
    .replace(/\bauth(?:enticated)? user\b/giu, "your account")
    .replace(/\s+by\s+user IDs?\b/giu, " for an account")
    .replace(/\s+(?:by|using|with)\s+(?:its\s+)?(?:[A-Za-z]+\s+){0,2}IDs?\b/giu, "")
    .replace(/\buser IDs?\b/giu, "account")
    .replace(/\bCRM object\b/giu, "CRM record")
    .replace(/^get about user$/iu, "View user profile")
    .replace(/^get about me$/iu, "View my profile")
    .replace(/^trash\s+(.+)$/iu, "Move $1 to trash")
    .replace(/^move to trash$/iu, "Move an item to trash")
    .replace(/^untrash\s+(.+)$/iu, "Restore $1 from trash")
    .replace(/^insert row database\b/iu, "Add database row")
    .replace(/^insert\b/iu, "Add")
    .replace(/^patch\b/iu, "Update")
    .replace(/^query\b/iu, "Search")
    .replace(/^replace\b/iu, "Update")
    .replace(/^batch modify\b/iu, "Update multiple")
    .replace(/^(fetch|get|list|retrieve)\b/iu, "View")
    .replace(/^real-time search\b/iu, "Search")
    .replace(/\bsend-as alias\b/giu, "email alias")
    .replace(/\bpage markdown\b/giu, "page content")
    .replace(/\bview query results\b/giu, "filtered results")
    .replace(/\bview query\b/giu, "filtered view")
    .replace(/\b(?:([A-Za-z]+)\s+)?block children\b/giu, "content inside $1 block")
    .replace(/\bfile upload\b/giu, "uploaded file")
    .replace(/\bchanges start page token\b/giu, "change tracking token")
    .replace(/\bgoogle about this result\b/giu, "details about this result")
    .replace(/\bwith filter\b/giu, "with filters")
    .replace(/\s+/gu, " ")
    .trim();
  return sentenceCaseActionName(cleaned, toolkitName);
}

function sentenceCaseActionName(value: string, toolkitName: string | undefined): string {
  const brandWords = new Map(
    toolkitName?.split(/\s+/u).map((word) => [word.toLocaleLowerCase(), word]) ?? [],
  );
  return value
    .split(" ")
    .map((word, index) => {
      const brandedWord = brandWords.get(word.toLocaleLowerCase());
      if (brandedWord) {
        return brandedWord;
      }
      if (index === 0) {
        return word;
      }
      return /^[A-Z][a-z]+$/u.test(word) ? word.toLocaleLowerCase() : word;
    })
    .join(" ");
}

function actionNameFromSlug(slug: string): string {
  const words = slug.split("_").slice(1).join(" ").toLocaleLowerCase();
  return words ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : "Use this action";
}

function actionPrompt(name: string, tool: ComposioTool): string {
  const goal = naturalActionGoal(lowerFirst(name));
  if (isDestructiveAction(name, tool)) {
    return `Help me ${goal}. Find the right item and ask for confirmation before making permanent changes.`;
  }
  if (DRAFT_ACTION_PATTERN.test(name)) {
    return `Help me ${goal}. Ask who it is for, the subject, and what it should say.`;
  }
  if (SEND_EXISTING_ACTION_PATTERN.test(name)) {
    return `Help me ${goal}. Find the right one and show it to me before sending.`;
  }
  if (MESSAGE_ACTION_PATTERN.test(name)) {
    return `Help me ${goal}. Ask for the recipient and content, then show me the final version before sending.`;
  }
  if (READ_ACTION_PATTERN.test(name)) {
    return `Help me ${goal}. Ask what I am looking for if needed.`;
  }
  if (CHANGE_ACTION_PATTERN.test(name)) {
    return `Help me ${goal}. Ask for the details you need, then show me what will change before doing it.`;
  }
  return `Help me ${goal}. Ask for any details you need in plain language.`;
}

function isDestructiveAction(name: string, tool: ComposioTool): boolean {
  if (DESTRUCTIVE_ACTION_PATTERN.test(`${name} ${tool.slug.replaceAll("_", " ")}`)) {
    return true;
  }
  return /\bpermanently\b/i.test(`${tool.humanDescription ?? ""} ${tool.description ?? ""}`);
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLocaleLowerCase() + value.slice(1);
}

function naturalActionGoal(value: string): string {
  const match = ARTICLE_ACTION_PATTERN.exec(value);
  if (
    !match?.[1] ||
    !match[2] ||
    DETERMINER_PATTERN.test(match[2]) ||
    PREPOSITION_PATTERN.test(match[2])
  ) {
    return value;
  }
  const nounPhrase = match[2].split(/\s+(?:by|for|from|in|inside|on|to|with)\s+/iu)[0] ?? match[2];
  const firstNoun = nounPhrase.split(/\s+/u)[0]?.toLocaleLowerCase() ?? "";
  const noun = nounPhrase.split(/\s+/u).at(-1)?.toLocaleLowerCase() ?? "";
  if (!noun || UNCOUNTABLE_NOUNS.has(noun) || isPluralNoun(firstNoun) || isPluralNoun(noun)) {
    return value;
  }
  const article = articleFor(match[2]);
  return `${match[1]} ${article} ${match[2]}`;
}

function articleFor(value: string): "a" | "an" {
  if (CONSONANT_SOUND_VOWEL_WORDS.test(value)) {
    return "a";
  }
  return /^[aeiou]/iu.test(value) ? "an" : "a";
}

function isPluralNoun(value: string): boolean {
  return (
    IRREGULAR_PLURAL_NOUNS.has(value) ||
    (value.endsWith("s") && !value.endsWith("ss") && !SINGULAR_NOUNS_ENDING_IN_S.has(value))
  );
}
