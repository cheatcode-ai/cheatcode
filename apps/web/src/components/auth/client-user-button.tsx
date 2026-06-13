"use client";

import { UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export function ClientUserButton() {
  const [isMounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isMounted) {
    return <div aria-hidden className="h-8 w-8 rounded-full bg-violet-500/70" />;
  }

  return <UserButton />;
}
