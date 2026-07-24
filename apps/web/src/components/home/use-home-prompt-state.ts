"use client";

import { useCallback, useRef, useState } from "react";

export function useHomePromptState() {
  const [value, setValue] = useState("");
  const latestValueRef = useRef(value);

  const publishValue = useCallback((nextValue: string) => {
    latestValueRef.current = nextValue;
    setValue(nextValue);
  }, []);

  return {
    actions: { publishValue },
    refs: { latestValueRef },
    state: { value },
  };
}
