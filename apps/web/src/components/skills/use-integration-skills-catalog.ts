"use client";

import type { IntegrationName, ToolkitCatalogEntry } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { IntegrationDrawerHandlers } from "@/components/skills/integration-skill-drawer";
import {
  connectIntegration,
  disconnectIntegrationAccount,
  fetchIntegrationCatalog,
  INTEGRATION_CATALOG_QUERY,
  INTEGRATIONS_QUERY,
  makeIntegrationAccountDefault,
} from "@/lib/api/integrations";

const ALL_CATEGORY = "all";
const EMPTY_TOOLKITS: ToolkitCatalogEntry[] = [];

export function useIntegrationSkillsCatalog() {
  const { getToken } = useAuth();
  const controller = useCatalogController(getToken);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);
  const toolkits = controller.query.data?.toolkits ?? EMPTY_TOOLKITS;
  const selection = useToolkitSelection(toolkits);
  const filteredToolkits = useMemo(
    () => filterToolkits(toolkits, category, search),
    [category, search, toolkits],
  );
  return {
    ...selection,
    categories: controller.query.data?.categories ?? [],
    category,
    filteredToolkits,
    getToken,
    handlers: controller.handlers,
    query: controller.query,
    search,
    setCategory,
    setSearch,
  };
}

function useToolkitSelection(toolkits: readonly ToolkitCatalogEntry[]) {
  const searchParams = useSearchParams();
  const [selectedName, setSelectedName] = useState<IntegrationName | null>(null);
  const lastSelectedRef = useRef<IntegrationName | null>(null);
  const processedCallbackRef = useRef(false);
  useEffect(() => {
    if (processedCallbackRef.current) {
      return;
    }
    const requested = searchParams.get("toolkit");
    const toolkit = toolkits.find((entry) => entry.name === requested);
    if (toolkit) {
      processedCallbackRef.current = true;
      setSelectedName(toolkit.name);
      if (searchParams.get("status") === "success") {
        toast.success(`${toolkit.displayName} connected`);
      }
      window.history.replaceState(window.history.state, "", "/skills");
    }
  }, [searchParams, toolkits]);
  useEffect(() => {
    if (selectedName) {
      lastSelectedRef.current = selectedName;
    }
  }, [selectedName]);
  const displayedName = selectedName ?? lastSelectedRef.current;
  return {
    closeToolkit: () => setSelectedName(null),
    displayedToolkit: toolkits.find((toolkit) => toolkit.name === displayedName) ?? null,
    isDrawerOpen: selectedName !== null,
    openToolkit: setSelectedName,
  };
}

function useCatalogController(getToken: () => Promise<null | string>) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryFn: ({ signal }) => fetchIntegrationCatalog(getToken, signal),
    queryKey: INTEGRATION_CATALOG_QUERY,
    staleTime: 30_000,
  });
  const connectMutation = useMutation({
    mutationFn: (name: IntegrationName) => connectIntegration(getToken, name),
    onError: (error) => toast.error(error.message),
    onSuccess: (oauthUrl) => window.location.assign(oauthUrl),
  });
  const accounts = useCatalogAccountMutations(getToken, queryClient);
  return {
    handlers: {
      connectingName: connectMutation.isPending ? connectMutation.variables : undefined,
      defaultingId: accounts.defaultMutation.isPending
        ? accounts.defaultMutation.variables.connectionId
        : undefined,
      disconnectingId: accounts.disconnectMutation.isPending
        ? accounts.disconnectMutation.variables.connectionId
        : undefined,
      onConnect: (name: IntegrationName) => connectMutation.mutate(name),
      onDisconnect: (name: IntegrationName, connectionId: string) =>
        accounts.disconnectMutation.mutate({ connectionId, name }),
      onMakeDefault: (name: IntegrationName, connectionId: string) =>
        accounts.defaultMutation.mutate({ connectionId, name }),
    } satisfies IntegrationDrawerHandlers,
    query,
  };
}

function useCatalogAccountMutations(
  getToken: () => Promise<null | string>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const refresh = () => refreshCatalog(queryClient);
  const disconnectMutation = useMutation({
    mutationFn: (input: { connectionId: string; name: IntegrationName }) =>
      disconnectIntegrationAccount(getToken, input.name, input.connectionId),
    onError: (error) => toast.error(error.message),
    onSuccess: () => {
      refresh();
      toast.success("Account disconnected");
    },
  });
  const defaultMutation = useMutation({
    mutationFn: (input: { connectionId: string; name: IntegrationName }) =>
      makeIntegrationAccountDefault(getToken, input.name, input.connectionId),
    onError: (error) => toast.error(error.message),
    onSuccess: () => {
      refresh();
      toast.success("Default account updated");
    },
  });
  return { defaultMutation, disconnectMutation };
}

function refreshCatalog(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: INTEGRATION_CATALOG_QUERY });
  void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY });
}

function filterToolkits(
  toolkits: readonly ToolkitCatalogEntry[],
  category: string,
  search: string,
): ToolkitCatalogEntry[] {
  const needle = search.trim().toLowerCase();
  return toolkits
    .filter((toolkit) => toolkitMatches(toolkit, category, needle))
    .sort((left, right) => Number(right.status === "active") - Number(left.status === "active"));
}

function toolkitMatches(toolkit: ToolkitCatalogEntry, category: string, needle: string): boolean {
  if (category !== ALL_CATEGORY && !toolkit.categorySlugs.includes(category)) {
    return false;
  }
  return (
    !needle ||
    toolkit.displayName.toLowerCase().includes(needle) ||
    toolkit.description.toLowerCase().includes(needle)
  );
}
