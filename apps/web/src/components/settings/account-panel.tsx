"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/ui/icons";
import { getMe, updateMe } from "@/lib/api/me";
import { SettingsHeading } from "./settings-heading";

const ME_QUERY_KEY = ["me"] as const;

export function AccountPanel() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: () => getMe(getToken),
    queryKey: ME_QUERY_KEY,
  });
  const me = meQuery.data;
  const [displayName, setDisplayName] = useState("");

  // Seed the editable field once the account loads (and after a successful save).
  useEffect(() => {
    if (me) {
      setDisplayName(me.displayName ?? "");
    }
  }, [me]);

  const mutation = useMutation({
    mutationFn: () => updateMe(getToken, { displayName: displayName.trim() || null }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save account"),
    onSuccess: (updated) => {
      toast.success("Account saved");
      queryClient.setQueryData(ME_QUERY_KEY, updated);
    },
  });

  const isDirty = (me?.displayName ?? "") !== displayName.trim();

  return (
    <div className="text-[#1b1b1b]">
      <SettingsHeading description="Your account details." title="Account" />

      {meQuery.isLoading ? (
        <p className="text-[#a0a0a0] text-[14px]">Loading…</p>
      ) : meQuery.isError ? (
        <div className="flex items-center gap-3">
          <p className="text-[#707070] text-[14px]">Couldn’t load your account.</p>
          <button
            className="rounded-full border border-[#e6e6e6] px-4 py-1.5 font-medium text-[13px] hover:bg-[#f7f7f7]"
            onClick={() => void meQuery.refetch()}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : (
        <section className="flex flex-col gap-5 rounded-3xl bg-[#f7f7f7] p-5">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-[#5f5f5f] text-[12px]">Display name</span>
            <input
              className="h-10 w-full rounded-lg border border-[#ececec] bg-white px-3 text-[#1b1b1b] text-[14px] outline-none focus:border-[#1b1b1b]/40"
              maxLength={120}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              value={displayName}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-[#5f5f5f] text-[12px]">Email</span>
            <p className="flex h-10 items-center rounded-lg border border-[#f0f0f0] bg-[#fafafa] px-3 text-[#707070] text-[14px]">
              {me?.email ?? "—"}
            </p>
            <span className="text-[#a0a0a0] text-[11px]">Managed by your sign-in provider.</span>
          </div>

          <div className="flex justify-end">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#1b1b1b] px-5 font-medium text-[14px] text-white transition-colors hover:bg-black disabled:opacity-50"
              disabled={!isDirty || mutation.isPending}
              onClick={() => mutation.mutate()}
              type="button"
            >
              {mutation.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
              Save
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
