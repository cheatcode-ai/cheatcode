export interface MorphApplyInput {
  abortSignal?: AbortSignal | undefined;
  codeEdit: string;
  instruction: string;
  originalCode: string;
}

export interface MorphApplyResult {
  mergedCode: string;
}

export interface MorphApplyRuntime {
  applyEdit(input: MorphApplyInput, timeoutMs: number): Promise<MorphApplyResult>;
}
