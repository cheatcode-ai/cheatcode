'use client';

import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
} from '@tanstack/react-query';
import { handleApiError, type ErrorContext } from '@/lib/error-handler';

type QueryKeyItem =
  | readonly unknown[]
  | ((...args: never[]) => readonly unknown[]);

export const createQueryKeys = <T extends Record<string, QueryKeyItem>>(
  keys: T,
): T => keys;

export function createQueryHook<
  TData,
  TError = Error,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryKey: TQueryKey,
  queryFn: () => Promise<TData>,
  options?: Omit<
    UseQueryOptions<TData, TError, TData, TQueryKey>,
    'queryKey' | 'queryFn'
  >,
) {
  return (
    customOptions?: Omit<
      UseQueryOptions<TData, TError, TData, TQueryKey>,
      'queryKey' | 'queryFn'
    >,
  ) => {
    return useQuery<TData, TError, TData, TQueryKey>({
      queryKey,
      queryFn,
      ...options,
      ...customOptions,
    });
  };
}

export function createMutationHook<
  TData,
  TVariables,
  TError = Error,
  TContext = unknown,
>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: Omit<
    UseMutationOptions<TData, TError, TVariables, TContext>,
    'mutationFn'
  > & {
    errorContext?: ErrorContext;
  },
) {
  return (
    customOptions?: Omit<
      UseMutationOptions<TData, TError, TVariables, TContext>,
      'mutationFn'
    > & {
      errorContext?: ErrorContext;
    },
  ) => {
    const { errorContext: baseErrorContext, ...baseOptions } = options || {};
    const { errorContext: customErrorContext, ...customMutationOptions } =
      customOptions || {};

    return useMutation<TData, TError, TVariables, TContext>({
      mutationFn,
      onError: (error, variables, context, mutation) => {
        const errorContext = customErrorContext || baseErrorContext;
        if (!customMutationOptions?.onError && !baseOptions?.onError) {
          handleApiError(error, errorContext);
        }
        baseOptions?.onError?.(error, variables, context, mutation);
        customMutationOptions?.onError?.(error, variables, context, mutation);
      },
      ...baseOptions,
      ...customMutationOptions,
    });
  };
}
