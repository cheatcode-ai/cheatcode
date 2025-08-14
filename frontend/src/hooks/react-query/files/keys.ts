import { createQueryKeys } from '@/hooks/use-query';

export const sandboxKeys = createQueryKeys({
  all: ['sandbox'] as const,
  files: (sandboxId: string, path: string) => [...sandboxKeys.all, sandboxId, 'files', path] as const,
  fileContent: (sandboxId: string, path: string) => [...sandboxKeys.all, sandboxId, 'content', path] as const,
});

export const healthKeys = createQueryKeys({
  all: ['health'] as const,
  api: () => [...healthKeys.all, 'api'] as const,
}); 