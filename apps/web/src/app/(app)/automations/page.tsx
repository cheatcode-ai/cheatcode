"use client";

import type { AutomationSummary } from "@cheatcode/types";
import { ModalShell } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Plus, Search, Trash2 } from "@/components/ui/icons";
import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  runAutomationNow,
  updateAutomation,
} from "@/lib/api/automations";
import { cn } from "@/lib/ui/cn";

const AUTOMATIONS_QUERY_KEY = ["automations"] as const;

export default function AutomationsPage() {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto bg-white px-4 pt-12 pb-16 text-[#1b1b1b] sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-[740px]">
        <AutomationsClient />
      </div>
    </section>
  );
}

function AutomationsClient() {
  const { getToken, isSignedIn } = useAuth();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: () => listAutomations(getToken),
    queryKey: AUTOMATIONS_QUERY_KEY,
  });

  const automations = query.data ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return automations;
    }
    return automations.filter((automation) => automation.name.toLowerCase().includes(term));
  }, [automations, search]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-[30px] leading-9 tracking-[-0.01em]">Automations</h1>
        <button
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#1b1b1b] px-4 font-medium text-[14px] text-white transition-colors hover:bg-black"
          onClick={() => setCreating(true)}
          type="button"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New
        </button>
      </div>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#a0a0a0]"
        />
        <input
          className="h-9 w-full rounded-full border-0 bg-[#f7f7f7] pr-3 pl-10 font-medium text-[#1b1b1b] text-[14px] outline-none placeholder:text-[#a0a0a0]"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search automations…"
          value={search}
        />
      </div>

      {query.isLoading ? (
        <p className="py-10 text-center text-[#a0a0a0] text-[13px]">Loading automations…</p>
      ) : query.isError ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-[#707070] text-[14px]">Couldn’t load automations.</p>
          <button
            className="rounded-full border border-[#e5e5e5] px-4 py-1.5 font-medium text-[13px] hover:bg-[#f7f7f7]"
            onClick={() => void query.refetch()}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasAutomations={automations.length > 0} onCreate={() => setCreating(true)} />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((automation) => (
            <AutomationCard automation={automation} key={automation.id} />
          ))}
        </div>
      )}

      {creating ? <NewAutomationDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function EmptyState({
  hasAutomations,
  onCreate,
}: {
  hasAutomations: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#f0f0f0] bg-[#fafafa] py-12 text-center">
      <p className="font-medium text-[#1b1b1b] text-[15px]">
        {hasAutomations ? "No automations match your search." : "No automations yet."}
      </p>
      <p className="max-w-sm text-[#707070] text-[13px] leading-relaxed">
        Create an automation to run an agent on a schedule or when something happens in a connected
        app.
      </p>
      {hasAutomations ? null : (
        <button
          className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1b1b1b] px-4 font-medium text-[14px] text-white hover:bg-black"
          onClick={onCreate}
          type="button"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New automation
        </button>
      )}
    </div>
  );
}

function triggerSummary(automation: AutomationSummary): string {
  if (automation.kind === "scheduled") {
    return automation.schedule ? `Scheduled · ${automation.schedule} (UTC)` : "Scheduled";
  }
  if (automation.triggerToolkit && automation.triggerSlug) {
    return `Triggered by ${automation.triggerToolkit}: ${automation.triggerSlug}`;
  }
  return "Event-triggered";
}

function AutomationCard({ automation }: { automation: AutomationSummary }) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY });

  const statusMutation = useMutation({
    mutationFn: (status: "running" | "paused") =>
      updateAutomation(getToken, automation.id, { status }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
    onSuccess: (updated) => {
      toast.success(updated.status === "paused" ? "Paused" : "Resumed");
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAutomation(getToken, automation.id),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed"),
    onSuccess: () => {
      toast.success(`Deleted ${automation.name}`);
      invalidate();
    },
  });

  const runMutation = useMutation({
    mutationFn: () => runAutomationNow(getToken, automation.id),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Run failed"),
    onSuccess: () => toast.success("Run queued"),
  });

  const isPaused = automation.status === "paused";

  return (
    <div className="rounded-2xl border border-[#f0f0f0] bg-white">
      <div className="flex items-start justify-between gap-3 p-4">
        <button
          className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#1b1b1b] text-[15px]">{automation.name}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium text-[11px]",
                isPaused ? "bg-[#f0f0f0] text-[#707070]" : "bg-[#e8f5e9] text-[#2e7d32]",
              )}
            >
              {isPaused ? "Paused" : "Running"}
            </span>
          </div>
          <span className="truncate text-[#707070] text-[13px]">{triggerSummary(automation)}</span>
        </button>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "mt-1 h-4 w-4 shrink-0 text-[#a0a0a0] transition-transform",
            expanded && "rotate-180",
          )}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-[#f5f5f5] border-t px-4 py-2.5">
        <CardAction
          disabled={runMutation.isPending}
          label={runMutation.isPending ? "Running…" : "Run now"}
          onClick={() => runMutation.mutate()}
        />
        <CardAction
          disabled={statusMutation.isPending}
          label={isPaused ? "Resume" : "Pause"}
          onClick={() => statusMutation.mutate(isPaused ? "running" : "paused")}
        />
        <button
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium text-[#a0a0a0] text-[13px] transition-colors hover:bg-[#fff0f0] hover:text-red-600 disabled:opacity-45"
          disabled={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
          type="button"
        >
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>

      {expanded ? <RunHistory automationId={automation.id} /> : null}
    </div>
  );
}

function CardAction({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-7 items-center rounded-full border border-[#ececec] px-3 font-medium text-[#1b1b1b] text-[13px] transition-colors hover:bg-[#f7f7f7] disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function RunHistory({ automationId }: { automationId: string }) {
  const { getToken } = useAuth();
  const query = useQuery({
    queryFn: () => listAutomationRuns(getToken, automationId),
    queryKey: ["automation-runs", automationId],
  });

  if (query.isLoading) {
    return <p className="px-4 py-3 text-[#a0a0a0] text-[12px]">Loading runs…</p>;
  }
  const runs = query.data ?? [];
  if (runs.length === 0) {
    return <p className="px-4 py-3 text-[#a0a0a0] text-[12px]">No runs yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2 border-[#f5f5f5] border-t px-4 py-3">
      {runs.map((run) => (
        <li className="flex items-start justify-between gap-3 text-[13px]" key={run.id}>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[#1b1b1b]">{run.summary ?? run.error ?? "—"}</span>
            <span className="text-[#a0a0a0] text-[11px]">
              {new Date(run.startedAt).toLocaleString()}
            </span>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px]",
              run.status === "succeeded"
                ? "bg-[#e8f5e9] text-[#2e7d32]"
                : run.status === "failed"
                  ? "bg-[#fdecea] text-[#c62828]"
                  : "bg-[#f0f0f0] text-[#707070]",
            )}
          >
            {run.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface NewAutomationForm {
  name: string;
  kind: "scheduled" | "event";
  schedule: string;
  triggerToolkit: string;
  triggerSlug: string;
  prompt: string;
}

function NewAutomationDialog({ onClose }: { onClose: () => void }) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewAutomationForm>({
    name: "",
    kind: "scheduled",
    schedule: "0 8 * * *",
    triggerToolkit: "",
    triggerSlug: "",
    prompt: "",
  });

  const set = <K extends keyof NewAutomationForm>(key: K, value: NewAutomationForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const mutation = useMutation({
    mutationFn: () =>
      createAutomation(getToken, {
        name: form.name.trim(),
        kind: form.kind,
        prompt: form.prompt.trim(),
        deliveryChannels: [],
        ...(form.kind === "scheduled"
          ? { schedule: form.schedule.trim() }
          : { triggerToolkit: form.triggerToolkit.trim(), triggerSlug: form.triggerSlug.trim() }),
      }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create automation"),
    onSuccess: (created) => {
      toast.success(`Created ${created.name}`);
      void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY });
      onClose();
    },
  });

  const canSubmit =
    form.name.trim().length > 0 &&
    form.prompt.trim().length > 0 &&
    (form.kind === "scheduled"
      ? form.schedule.trim().length > 0
      : form.triggerToolkit.trim().length > 0 && form.triggerSlug.trim().length > 0);

  return (
    <ModalShell
      ariaLabel="New automation"
      className="m-auto w-full max-w-lg"
      onClose={onClose}
      open
    >
      <form
        className="flex flex-col gap-4 p-5 text-[#1b1b1b]"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !mutation.isPending) {
            mutation.mutate();
          }
        }}
      >
        <h2 className="font-semibold text-[18px]">New automation</h2>

        <Field label="Name">
          <input
            className={inputClass}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Daily NYT summary"
            value={form.name}
          />
        </Field>

        <Field label="Trigger">
          <div className="flex gap-2">
            {(["scheduled", "event"] as const).map((kind) => (
              <button
                className={cn(
                  "h-8 flex-1 rounded-full border font-medium text-[13px] transition-colors",
                  form.kind === kind
                    ? "border-[#1b1b1b] bg-[#1b1b1b] text-white"
                    : "border-[#ececec] text-[#5f5f5f] hover:bg-[#f7f7f7]",
                )}
                key={kind}
                onClick={() => set("kind", kind)}
                type="button"
              >
                {kind === "scheduled" ? "On a schedule" : "On an event"}
              </button>
            ))}
          </div>
        </Field>

        {form.kind === "scheduled" ? (
          <Field hint="5-field cron, UTC. e.g. 0 8 * * * = every day at 08:00." label="Schedule">
            <input
              className={inputClass}
              onChange={(event) => set("schedule", event.target.value)}
              placeholder="0 8 * * *"
              value={form.schedule}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="App (toolkit)">
              <input
                className={inputClass}
                onChange={(event) => set("triggerToolkit", event.target.value)}
                placeholder="gmail"
                value={form.triggerToolkit}
              />
            </Field>
            <Field label="Trigger">
              <input
                className={inputClass}
                onChange={(event) => set("triggerSlug", event.target.value)}
                placeholder="new_email"
                value={form.triggerSlug}
              />
            </Field>
          </div>
        )}

        <Field label="Instructions">
          <textarea
            className={cn(inputClass, "min-h-[96px] resize-y py-2")}
            onChange={(event) => set("prompt", event.target.value)}
            placeholder="Summarize the top NYT headlines and send me the highlights."
            value={form.prompt}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <button
            className="rounded-full border border-[#ececec] px-4 py-1.5 font-medium text-[13px] hover:bg-[#f7f7f7]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-full bg-[#1b1b1b] px-4 py-1.5 font-medium text-[13px] text-white hover:bg-black disabled:opacity-50"
            disabled={!canSubmit || mutation.isPending}
            type="submit"
          >
            {mutation.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

const inputClass =
  "h-9 w-full rounded-lg border border-[#ececec] bg-white px-3 text-[#1b1b1b] text-[14px] outline-none focus:border-[#1b1b1b]/40";

function Field({ children, hint, label }: { children: ReactNode; hint?: string; label: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the form control is passed in via children
    <label className="flex flex-col gap-1.5">
      <span className="font-medium text-[#5f5f5f] text-[12px]">{label}</span>
      {children}
      {hint ? <span className="text-[#a0a0a0] text-[11px]">{hint}</span> : null}
    </label>
  );
}
