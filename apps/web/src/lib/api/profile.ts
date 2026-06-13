"use client";

import {
  type UpdateUserProfile,
  UpdateUserProfileSchema,
  type UserProfile,
  UserProfileSchema,
} from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

const PROFILE_PATH = "/v1/me/profile";

export async function getProfile(getToken: () => Promise<null | string>): Promise<UserProfile> {
  const response = await authorizedFetch(getToken, PROFILE_PATH);
  return UserProfileSchema.parse(await response.json());
}

export async function updateProfile(
  getToken: () => Promise<null | string>,
  patch: UpdateUserProfile,
): Promise<UserProfile> {
  const body = UpdateUserProfileSchema.parse(patch);
  const response = await authorizedFetch(getToken, PROFILE_PATH, {
    body: JSON.stringify(body),
    method: "PATCH",
  });
  return UserProfileSchema.parse(await response.json());
}
