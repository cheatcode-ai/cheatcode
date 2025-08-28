'use client';

import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { createQueryHook } from '@/hooks/use-query';
import { 
  usePipedreamApi, 
  type CreateConnectionTokenRequest,
  type ConnectionTokenResponse,
  type ConnectionResponse,
  type PipedreamAppResponse,
  type PipedreamToolsResponse,
} from './utils';
import { pipedreamKeys } from './keys';
import { useRefetchControl } from '@/hooks/use-refetch-control';

export const useCreateConnectionToken = () => {
  const queryClient = useQueryClient();
  const pipedreamApi = usePipedreamApi();
  
  return useMutation({
    mutationFn: async (request: CreateConnectionTokenRequest): Promise<ConnectionTokenResponse> => {
      return await pipedreamApi.createConnectionToken(request);
    },
    onSuccess: (data, variables) => {
      // Only invalidate connections query - do NOT cache single-use tokens
      queryClient.invalidateQueries({ queryKey: pipedreamKeys.connections() });
      // Note: Connection tokens are single-use and expire quickly, so we don't cache them
    },
    onError: (error) => {
      console.error('Failed to create connection token:', error);
    },
  });
};

export const usePipedreamConnections = () => {
  const pipedreamApi = usePipedreamApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();
  
  return useQuery({
    queryKey: pipedreamKeys.connections(),
    queryFn: () => pipedreamApi.getConnections(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

export const usePipedreamHealthCheck = () => {
  const pipedreamApi = usePipedreamApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();
  
  return useQuery({
    queryKey: pipedreamKeys.health(),
    queryFn: () => pipedreamApi.getHealthCheck(),
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

export const usePipedreamApps = (page = 1, search?: string, category?: string) => {
  const pipedreamApi = usePipedreamApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();
  
  return useQuery({
    queryKey: pipedreamKeys.apps(page, search, category),
    queryFn: () => pipedreamApi.getApps(page, search, category),
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

export const usePipedreamAvailableTools = (forceRefresh = false) => {
  const pipedreamApi = usePipedreamApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();
  
  return useQuery({
    queryKey: pipedreamKeys.availableTools(),
    queryFn: () => pipedreamApi.getAvailableTools(forceRefresh),
    staleTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

export const useDiscoverMCPServers = () => {
  const pipedreamApi = usePipedreamApi();
  
  return useMutation({
    mutationFn: async (request: { app_slug?: string; oauth_app_id?: string } = {}) => {
      return await pipedreamApi.discoverMCPServers(request);
    },
    onError: (error) => {
      console.error('Failed to discover MCP servers:', error);
    },
  });
};

export const useDiscoverCustomMCPTools = () => {
  const pipedreamApi = usePipedreamApi();
  
  return useMutation({
    mutationFn: async () => {
      return await pipedreamApi.discoverCustomMCPTools();
    },
    onError: (error) => {
      console.error('Failed to discover custom MCP tools:', error);
    },
  });
}; 
