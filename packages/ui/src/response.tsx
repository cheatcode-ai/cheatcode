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

    void (async () => {
      const nextPlugins: StreamdownPlugins = { ...plugins };
      if (needsMath) {
        nextPlugins.math = (await import("@streamdown/math")).math;
      }
      if (needsMermaid) {
        nextPlugins.mermaid = (await import("@streamdown/mermaid")).mermaid;
      }
      setPlugins(nextPlugins);
    })();
  }, [children, plugins]);

  return (
    <div className="max-w-none text-sm leading-6 [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted [&_pre]:p-3">
      <Streamdown
        animated={{ animation: "blurIn", stagger: 40 }}
        controls={{ code: { copy: true, download: true }, table: { copy: true, fullscreen: true } }}
        plugins={plugins}
        shikiTheme={["github-light", "github-dark"]}
      >
        {children}
      </Streamdown>
    </div>
  );
}
