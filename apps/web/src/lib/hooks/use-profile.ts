"use client";

import type { UpdateUserProfile, UserProfile } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getProfile, updateProfile } from "@/lib/api/profile";

const PROFILE_QUERY_KEY = ["me-profile"] as const;

export function useProfileQuery() {
  const { getToken, isSignedIn } = useAuth();
  return useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: ({ signal }) => getProfile(getToken, signal),
    queryKey: PROFILE_QUERY_KEY,
    staleTime: 30_000,
  });
}

interface ProfileMutationContext {
  previous: UserProfile | undefined;
}

export function useUpdateProfileMutation() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<UserProfile, Error, UpdateUserProfile, ProfileMutationContext>({
    mutationFn: (patch: UpdateUserProfile) => updateProfile(getToken, patch),
    onError: (error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(PROFILE_QUERY_KEY, context.previous);
      }
      toast.error(error instanceof Error ? error.message : "Profile update failed");
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: PROFILE_QUERY_KEY });
      const previous = queryClient.getQueryData<UserProfile>(PROFILE_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<UserProfile>(
          PROFILE_QUERY_KEY,
          applyProfilePatch(previous, patch),
        );
      }
      return { previous };
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, profile);
    },
  });
}

function applyProfilePatch(previous: UserProfile, patch: UpdateUserProfile): UserProfile {
  const next: UserProfile = { ...previous };
  if (patch.agentDisplayName !== undefined) {
    next.agentDisplayName = patch.agentDisplayName;
  }
  if (patch.globalMemory !== undefined) {
    next.globalMemory = patch.globalMemory;
  }
  if (patch.disabledModels !== undefined) {
    next.disabledModels = patch.disabledModels;
  }
  if (patch.onboardingStep) {
    next.onboardingState = {
      steps: {
        ...previous.onboardingState.steps,
        [patch.onboardingStep.step]: patch.onboardingStep.status,
      },
    };
  }
  return next;
}
