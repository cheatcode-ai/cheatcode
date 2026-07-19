"use client";

import { useAuth } from "@clerk/nextjs";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/search/command-palette-event";
import { searchWorkspace } from "@/lib/api/search";

interface PaletteState {
  open: boolean;
  query: string;
}

const CLOSED_PALETTE: PaletteState = { open: false, query: "" };

export function useCommandPalette() {
  const { getToken, isSignedIn } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<PaletteState>(CLOSED_PALETTE);
  const trimmed = state.query.trim();
  usePaletteOpenEvents(setState);
  const searchResults = useQuery({
    enabled: state.open && Boolean(isSignedIn) && trimmed.length > 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => searchWorkspace(getToken, trimmed, signal),
    queryKey: ["command-palette-search", trimmed],
    staleTime: 10_000,
  });
  const results = searchResults.data?.results ?? [];
  return {
    close: () => setState(CLOSED_PALETTE),
    isSignedIn,
    navigate: (href: string) => {
      setState(CLOSED_PALETTE);
      router.push(href);
    },
    open: state.open,
    projects: results.filter((result) => result.type === "project"),
    query: state.query,
    results,
    searchResults,
    setQuery: (query: string) => setState((current) => ({ ...current, query })),
    threads: results.filter((result) => result.type === "thread"),
    trimmed,
  };
}

function usePaletteOpenEvents(setState: Dispatch<SetStateAction<PaletteState>>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setState((current) => (current.open ? CLOSED_PALETTE : { ...current, open: true }));
      }
    };
    const onOpenRequest = () => setState((current) => ({ ...current, open: true }));
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    };
  }, [setState]);
}
