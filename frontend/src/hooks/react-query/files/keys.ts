export const sandboxKeys = {
  all: ['sandbox'] as const,
  files: (sandboxId: string, path: string) => [...sandboxKeys.all, sandboxId, 'files', path] as const,
  fileContent: (sandboxId: string, path: string) => [...sandboxKeys.all, sandboxId, 'content', path] as const,
};

export const healthKeys = {
  all: ['health'] as const,
  api: () => [...healthKeys.all, 'api'] as const,
}; 