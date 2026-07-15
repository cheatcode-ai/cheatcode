type SidebarSettingsIconProps = {
  className?: string;
};

export function SidebarPricingIcon(props: SidebarSettingsIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        d="M4 17.98V9.71C4 6.07 4 4.26 5.17 3.13C6.34 2 8.23 2 12 2C15.77 2 17.66 2 18.83 3.13C20 4.26 20 6.07 20 9.71V17.98C20 20.29 20 21.44 19.23 21.85C17.73 22.65 14.92 19.99 13.59 19.18C12.82 18.72 12.43 18.48 12 18.48C11.57 18.48 11.18 18.72 10.41 19.18C9.08 19.99 6.27 22.65 4.77 21.85C4 21.44 4 20.29 4 17.98Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarUsageIcon(props: SidebarSettingsIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M7 17V13M12 17V7M17 17V11" strokeLinecap="round" />
      <path
        d="M2.5 12C2.5 7.52 2.5 5.28 3.89 3.89C5.28 2.5 7.52 2.5 12 2.5C16.48 2.5 18.72 2.5 20.11 3.89C21.5 5.28 21.5 7.52 21.5 12C21.5 16.48 21.5 18.72 20.11 20.11C18.72 21.5 16.48 21.5 12 21.5C7.52 21.5 5.28 21.5 3.89 20.11C2.5 18.72 2.5 16.48 2.5 12Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarSystemThemeIcon(props: SidebarSettingsIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        d="M20.5 16.5V8.5C20.5 6.14 20.5 4.96 19.77 4.23C19.04 3.5 17.86 3.5 15.5 3.5H8.5C6.14 3.5 4.96 3.5 4.23 4.23C3.5 4.96 3.5 6.14 3.5 8.5V16.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21.98 20.5H2.02C1.63 20.5 1.38 20.11 1.56 19.78L3.5 16.5H20.5L22.44 19.78C22.62 20.11 22.37 20.5 21.98 20.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarLightThemeIcon(props: SidebarSettingsIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <circle cx="12" cy="12" r="5" />
      <path
        d="M12 2V3.5M12 20.5V22M19.07 19.07L18.01 18.01M5.99 5.99L4.93 4.93M22 12H20.5M3.5 12H2M19.07 4.93L18.01 5.99M5.99 18.01L4.93 19.07"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SidebarDarkThemeIcon(props: SidebarSettingsIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        d="M21.5 14.08C20.3 14.72 18.93 15.08 17.48 15.08C12.75 15.08 8.92 11.25 8.92 6.52C8.92 5.07 9.28 3.7 9.92 2.5C5.67 3.5 2.5 7.32 2.5 11.87C2.5 17.19 6.81 21.5 12.13 21.5C16.68 21.5 20.5 18.33 21.5 14.08Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
