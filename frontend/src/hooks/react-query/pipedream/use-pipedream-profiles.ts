import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePipedreamApi } from './utils';
import { pipedreamKeys } from './keys';
import type {
  PipedreamProfile,
  CreateProfileRequest,
  UpdateProfileRequest,
} from '@/types/pipedream-profiles';
import { toast } from 'sonner';

export const usePipedreamProfiles = (params?: { app_slug?: string; is_active?: boolean }) => {
  const pipedreamApi = usePipedreamApi();
  
  return useQuery({
    queryKey: pipedreamKeys.profiles.list(params),
    queryFn: () => pipedreamApi.getProfiles(params),
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get a single profile
export const usePipedreamProfile = (profileId: string, enabled = true) => {
  const pipedreamApi = usePipedreamApi();
  
  return useQuery({
    queryKey: pipedreamKeys.profiles.detail(profileId),
    queryFn: () => pipedreamApi.getProfile(profileId),
    enabled: enabled && !!profileId,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get profile connections
export const usePipedreamProfileConnections = (profileId: string, enabled = true) => {
  const pipedreamApi = usePipedreamApi();
  
  return useQuery({
    queryKey: pipedreamKeys.profiles.connections(profileId),
    queryFn: () => pipedreamApi.getProfileConnections(profileId),
    enabled: enabled && !!profileId,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to create a new profile
export const useCreatePipedreamProfile = () => {
  const queryClient = useQueryClient();
  const pipedreamApi = usePipedreamApi();

  return useMutation({
    mutationFn: (request: CreateProfileRequest) => pipedreamApi.createProfile(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
      toast.success(`Profile "${data.app_name}" created successfully`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create profile');
    },
  });
};

// Hook to update an existing profile
export const useUpdatePipedreamProfile = () => {
  const queryClient = useQueryClient();
  const pipedreamApi = usePipedreamApi();

  return useMutation({
    mutationFn: ({ profileId, request }: { profileId: string; request: UpdateProfileRequest }) =>
      pipedreamApi.updateProfile(profileId, request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
      queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.detail(data.profile_id) });
      toast.success(`Profile "${data.app_name}" updated successfully`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update profile');
    },
  });
};

// Hook to delete a profile
export const useDeletePipedreamProfile = () => {
  const queryClient = useQueryClient();
  const pipedreamApi = usePipedreamApi();

  return useMutation({
    mutationFn: (profileId: string) => pipedreamApi.deleteProfile(profileId),
    onSuccess: (_, profileId) => {
      queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
      queryClient.removeQueries({ queryKey: pipedreamKeys.profiles.detail(profileId) });
      queryClient.removeQueries({ queryKey: pipedreamKeys.profiles.connections(profileId) });
      toast.success('Profile deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete profile');
    },
  });
};

export const useConnectPipedreamProfile = () => {
  const queryClient = useQueryClient();
  const pipedreamApi = usePipedreamApi();

  return useMutation({
    mutationFn: ({ profileId, app }: { profileId: string; app?: string }) =>
      pipedreamApi.connectProfile(profileId, app),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
      queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.detail(data.profile_id) });
      queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.connections(data.profile_id) });
      if (data.link) {
        const connectWindow = window.open(data.link, '_blank', 'width=600,height=700');
        if (connectWindow) {
          const checkClosed = setInterval(() => {
            if (connectWindow.closed) {
              clearInterval(checkClosed);
              queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
              queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.detail(data.profile_id) });
              queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.connections(data.profile_id) });
              toast.success('Connection process completed');
            }
          }, 1000);
          setTimeout(() => {
            clearInterval(checkClosed);
          }, 5 * 60 * 1000);
        } else {
          toast.error('Failed to open connection window. Please check your popup blocker.');
        }
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to connect profile');
    },
  });
}; 