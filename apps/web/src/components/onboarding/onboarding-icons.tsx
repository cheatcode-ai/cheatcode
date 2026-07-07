// Onboarding iconography — SVG paths lifted verbatim from the Paper "Bud System"
// 15-series artboards (15b–15f) so the first-run flow is pixel-identical to the design.

export function Sparkle({ size = 48 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2C12.6 7.2 16.8 11.4 22 12C16.8 12.6 12.6 16.8 12 22C11.4 16.8 7.2 12.6 2 12C7.2 11.4 11.4 7.2 12 2Z"
        fill="#FBA62A"
      />
    </svg>
  );
}

export function IconComputer() {
  return (
    <svg
      aria-hidden="true"
      height="15"
      viewBox="0 0 16 16"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        fill="none"
        height="9"
        rx="1.5"
        stroke="#1B1B1B"
        strokeWidth="1.3"
        width="12"
        x="2"
        y="3"
      />
      <path
        d="M4.5 6L6.5 7.5L4.5 9M7.5 9.5H10"
        fill="none"
        stroke="#1B1B1B"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function IconBrowser() {
  return (
    <svg
      aria-hidden="true"
      height="15"
      viewBox="0 0 16 16"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" fill="none" r="6" stroke="#1B1B1B" strokeWidth="1.3" />
      <path
        d="M2 8H14M8 2C9.5 3.8 10.3 5.8 10.3 8C10.3 10.2 9.5 12.2 8 14C6.5 12.2 5.7 10.2 5.7 8C5.7 5.8 6.5 3.8 8 2Z"
        fill="none"
        stroke="#1B1B1B"
        strokeWidth="1.1"
      />
    </svg>
  );
}

export function IconSkills() {
  return (
    <svg
      aria-hidden="true"
      height="15"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2C12.6 7.2 16.8 11.4 22 12C16.8 12.6 12.6 16.8 12 22C11.4 16.8 7.2 12.6 2 12C7.2 11.4 11.4 7.2 12 2Z"
        fill="none"
        stroke="#1B1B1B"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function IconKeys() {
  return (
    <svg
      aria-hidden="true"
      height="15"
      viewBox="0 0 16 16"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="5.5" cy="10.5" fill="none" r="3" stroke="#1B1B1B" strokeWidth="1.3" />
      <path
        d="M7.7 8.3L13.5 2.5M11 5L13 7M9.5 6.5L11 8"
        fill="none"
        stroke="#1B1B1B"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

export function IconPhone() {
  return (
    <svg
      aria-hidden="true"
      height="15"
      viewBox="0 0 16 16"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        fill="none"
        height="12"
        rx="1.8"
        stroke="#1B1B1B"
        strokeWidth="1.3"
        width="7"
        x="4.5"
        y="2"
      />
      <path d="M7 12.2H9" fill="none" stroke="#1B1B1B" strokeLinecap="round" strokeWidth="1.2" />
    </svg>
  );
}

export function GitHubMark() {
  return (
    <svg
      aria-hidden="true"
      height="14"
      viewBox="0 0 16 16"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 1C4.13 1 1 4.13 1 8C1 11.09 3.01 13.71 5.79 14.64C6.14 14.7 6.27 14.49 6.27 14.31C6.27 14.14 6.26 13.58 6.26 12.98C4.5 13.3 4.04 12.55 3.9 12.16C3.82 11.96 3.48 11.34 3.18 11.17C2.93 11.04 2.58 10.72 3.17 10.71C3.73 10.7 4.13 11.22 4.26 11.43C4.9 12.5 5.92 12.2 6.3 12.02C6.36 11.56 6.55 11.25 6.75 11.07C5.18 10.89 3.53 10.28 3.53 7.58C3.53 6.81 3.82 6.18 4.28 5.69C4.21 5.51 3.96 4.79 4.35 3.82C4.35 3.82 4.94 3.63 6.27 4.52C6.83 4.37 7.42 4.29 8.01 4.29C8.6 4.29 9.19 4.37 9.75 4.52C11.08 3.62 11.67 3.82 11.67 3.82C12.06 4.79 11.81 5.51 11.74 5.69C12.2 6.18 12.49 6.8 12.49 7.58C12.49 10.29 10.83 10.89 9.26 11.07C9.51 11.29 9.73 11.71 9.73 12.37C9.73 13.31 9.72 14.07 9.72 14.31C9.72 14.49 9.85 14.71 10.2 14.64C12.97 13.71 14.98 11.08 14.98 8C14.98 4.13 11.85 1 7.98 1H8Z"
        fill="#1B1B1B"
      />
    </svg>
  );
}

export function ReturnArrow() {
  return (
    <svg
      aria-hidden="true"
      height="11"
      viewBox="0 0 12 12"
      width="11"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 2V6H2.5M2.5 6L5 3.5M2.5 6L5 8.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      height="13"
      viewBox="0 0 16 16"
      width="13"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="7" cy="7" fill="none" r="4.5" stroke="#9B9B9B" strokeWidth="1.4" />
      <path
        d="M10.5 10.5L13.5 13.5"
        fill="none"
        stroke="#9B9B9B"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}
