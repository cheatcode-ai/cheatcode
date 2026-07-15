import type { ReactNode } from "react";

type SidebarNavIconProps = {
  "aria-hidden"?: boolean | "false" | "true";
  className?: string;
};

export function SidebarPanelToggleIcon({
  className,
  expanded = false,
}: SidebarNavIconProps & { expanded?: boolean }) {
  const dividerPath = expanded ? "M5.67 12.25V1.75" : "M4.67 9.336V4.67";

  return (
    <svg
      aria-hidden="true"
      className={["overflow-visible", className].filter(Boolean).join(" ")}
      fill="none"
      height="14"
      viewBox="0 0 14 14"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        className="transition-[d] duration-300 ease-in-out motion-reduce:transition-none"
        d={`M6.417 1.75h1.166c2.2 0 3.3 0 3.984.683.683.684.683 1.784.683 3.984v1.166c0 2.2 0 3.3-.683 3.984-.684.683-1.784.683-3.984.683H6.417c-2.2 0-3.3 0-3.984-.683-.683-.684-.683-1.784-.683-3.984V6.417c0-2.2 0-3.3.683-3.984.684-.683 1.784-.683 3.984-.683${dividerPath}`}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function SidebarNavIcon({ children, className }: SidebarNavIconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      color="currentColor"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function SidebarNewChatIcon(props: SidebarNavIconProps) {
  return (
    <SidebarNavIcon {...props}>
      <path
        d="M22 12C22 6.477 17.523 2 12 2S2 6.477 2 12s4.477 10 10 10 10-4.477 10-10Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 8v8m4-4H8" strokeLinecap="round" strokeLinejoin="round" />
    </SidebarNavIcon>
  );
}

export function SidebarChatsIcon(props: SidebarNavIconProps) {
  return (
    <SidebarNavIcon {...props}>
      <path d="M8.009 12h.009M12.005 12h.009M16 12h.009" strokeLinecap="round" />
      <path
        d="M21.5 12a9.5 9.5 0 0 1-14 8.369c-1.868-1.007-3.125-.071-4.234.097a.52.52 0 0 1-.456-.156.61.61 0 0 1-.117-.703c.436-1.025.835-2.969.29-4.607A9.5 9.5 0 1 1 21.5 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SidebarNavIcon>
  );
}

export function SidebarSkillsIcon(props: SidebarNavIconProps) {
  return (
    <SidebarNavIcon {...props}>
      <path
        d="M13.338 10h-2.676c-1.535 0-2.302 0-2.577-.507-.274-.507.132-1.173.946-2.504l1.338-2.191C11.101 3.599 11.467 3 12 3s.899.599 1.631 1.798l1.338 2.19c.814 1.332 1.22 1.998.946 2.505-.275.507-1.042.507-2.577.507Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17.5" cy="17.5" r="3.5" strokeLinejoin="round" />
      <path
        d="M9.663 20.111C10 19.607 10 18.904 10 17.5s0-2.107-.337-2.611a2 2 0 0 0-.552-.552C8.607 14 7.904 14 6.5 14s-2.107 0-2.611.337a2 2 0 0 0-.552.552C3 15.393 3 16.096 3 17.5s0 2.107.337 2.611a2 2 0 0 0 .552.552C4.393 21 5.096 21 6.5 21s2.107 0 2.611-.337a2 2 0 0 0 .552-.552Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SidebarNavIcon>
  );
}

export function SidebarPersonalizationIcon(props: SidebarNavIconProps) {
  return (
    <SidebarNavIcon {...props}>
      <path
        d="M12 19V5a3 3 0 0 0-6 0 1 1 0 0 1-1 1 3 3 0 0 0 0 6 3 3 0 0 0 0 6 1 1 0 0 1 1 1 3 3 0 0 0 6 0Z"
        strokeLinejoin="round"
      />
      <path
        d="M12 19V5a3 3 0 0 1 6 0 1 1 0 0 0 1 1 3 3 0 0 1 0 6 3 3 0 0 1 0 6 1 1 0 0 0-1 1 3 3 0 0 1-6 0Z"
        strokeLinejoin="round"
      />
    </SidebarNavIcon>
  );
}

export function SidebarModelsIcon(props: SidebarNavIconProps) {
  return (
    <SidebarNavIcon {...props}>
      <path
        d="M20.354 3.646c-1.846-1.846-7.082.399-11.696 5.012-4.613 4.614-6.858 9.85-5.012 11.696 1.845 1.846 7.082-.399 11.696-5.012 4.613-4.614 6.858-9.85 5.012-11.696Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.646 3.646C1.8 5.49 4.045 10.728 8.658 15.342c4.614 4.613 9.85 6.858 11.696 5.012 1.846-1.845-.399-7.082-5.012-11.696C10.728 4.045 5.49 1.8 3.646 3.646Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.009 12H12" strokeLinecap="round" />
    </SidebarNavIcon>
  );
}

export function SidebarProjectsIcon(props: SidebarNavIconProps) {
  return (
    <SidebarNavIcon {...props}>
      <path
        d="M2 19V7.549c0-1.444 0-2.166.243-2.733a3 3 0 0 1 1.573-1.573C4.383 3 5.098 3 6.549 3h.494c.605 0 1.178.274 1.557.745L10.418 6H16c1.4 0 2.1 0 2.635.272a2.5 2.5 0 0 1 1.092 1.093C20 7.9 20 8.6 20 10v1M10.418 6H7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m3.158 15.514.298-.742c.734-1.827 1.101-2.74 1.866-3.256C6.088 11 7.076 11 9.052 11h8.06c2.688 0 4.033 0 4.63.879.598.878.099 2.121-.9 4.607l-.298.742c-.734 1.827-1.101 2.74-1.866 3.256-.766.516-1.754.516-3.73.516h-8.06c-2.688 0-4.033 0-4.63-.879-.598-.878-.099-2.121.9-4.607Z"
        strokeLinejoin="round"
      />
    </SidebarNavIcon>
  );
}
