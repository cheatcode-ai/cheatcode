"use client";

import { code } from "@streamdown/code";
import { type ComponentProps, useEffect, useState } from "react";
import { Streamdown } from "streamdown";

type StreamdownPlugins = NonNullable<ComponentProps<typeof Streamdown>["plugins"]>;

const BASE_PLUGINS: StreamdownPlugins = { code };

export function Response({ children }: { children: string }) {
  const [plugins, setPlugins] = useState<StreamdownPlugins>(BASE_PLUGINS);

  useEffect(() => {
    const needsMath = !plugins.math && /(?:\$\$|\\\(|\\\[)/.test(children);
    const needsMermaid = !plugins.mermaid && /```mermaid/.test(children);
    if (!needsMath && !needsMermaid) {
      return;
    }

    let cancelled = false;
    const imports: Promise<Partial<StreamdownPlugins>>[] = [];
    if (needsMath) {
      imports.push(import("@streamdown/math").then(({ math }) => ({ math })));
    }
    if (needsMermaid) {
      imports.push(import("@streamdown/mermaid").then(({ mermaid }) => ({ mermaid })));
    }
    void Promise.all(imports)
      .then((loaded) => {
        if (!cancelled) {
          setPlugins((current) => Object.assign({}, current, ...loaded));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [children, plugins.math, plugins.mermaid]);

  return (
    <div className="max-w-none text-sm leading-6 [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted [&_pre]:p-3">
      <Streamdown
        animated={{ animation: "fadeIn", duration: 400, stagger: 40 }}
        controls={{ code: { copy: true, download: true }, table: { copy: true, fullscreen: true } }}
        plugins={plugins}
        shikiTheme={["github-light", "github-dark"]}
      >
        {children}
      </Streamdown>
    </div>
  );
}
