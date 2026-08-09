import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { type MorphApplyRuntime, MorphClient } from "@cheatcode/morph";

interface MorphProviderEnv {
  MORPH_API_KEY: WorkerSecret;
}

export type MorphApplyResolver = () => Promise<MorphApplyRuntime>;

/** Resolves the deployment secret only when a run actually applies an existing-file edit. */
export function createMorphApplyResolver(env: MorphProviderEnv): MorphApplyResolver {
  let pending: Promise<MorphApplyRuntime> | null = null;
  return () => {
    pending ??= resolveWorkerSecret(env.MORPH_API_KEY)
      .then((apiKey) => {
        if (!apiKey) {
          throw new Error("Morph API key is unavailable.");
        }
        return new MorphClient(apiKey);
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
}
