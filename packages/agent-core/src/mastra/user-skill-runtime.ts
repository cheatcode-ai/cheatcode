import { CONTEXT } from "./context";

/** Body-less custom-skill metadata carried on every run. */
export interface UserSkillRuntime {
  name: string;
  description: string;
  category?: string;
}

/** A custom skill definition loaded only when `skill_invoke` selects it. */
export interface UserSkillDefinition extends UserSkillRuntime {
  body: string;
  rootPath: string;
}

/** Loads a single custom skill body from the request's user-scoped store. */
export interface UserSkillLoader {
  load(name: string): Promise<UserSkillDefinition | null>;
}

/** Validated metadata passed to the user-scoped Skill Creator persistence boundary. */
export interface UserSkillCreateInput {
  body: string;
  category: string;
  description: string;
  name: string;
  sourceSlug: string;
  tags: string[];
}

/** Client-safe identity returned only after the complete skill package is durable. */
export interface UserSkillCreateResult {
  description: string;
  filePath: string;
  id: string;
  name: string;
  slug: string;
}

/** Persists one authored skill package within the active user's run context. */
export interface UserSkillCreator {
  create(input: UserSkillCreateInput): Promise<UserSkillCreateResult>;
}

export function userSkillLoaderFromRequestContext(
  requestContext: { get(key: string): unknown } | undefined,
): UserSkillLoader | null {
  const value = requestContext?.get(CONTEXT.userSkillLoader);
  if (value && typeof (value as UserSkillLoader).load === "function") {
    return value as UserSkillLoader;
  }
  return null;
}

export function userSkillCreatorFromRequestContext(
  requestContext: { get(key: string): unknown } | undefined,
): UserSkillCreator | null {
  const value = requestContext?.get(CONTEXT.userSkillCreator);
  if (value && typeof (value as UserSkillCreator).create === "function") {
    return value as UserSkillCreator;
  }
  return null;
}
