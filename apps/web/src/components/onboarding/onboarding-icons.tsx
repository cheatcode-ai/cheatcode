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

export function GitHubLogo({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 1C4.13 1 1 4.13 1 8C1 11.09 3.01 13.71 5.79 14.64C6.14 14.7 6.27 14.49 6.27 14.31C6.27 14.14 6.26 13.58 6.26 12.98C4.5 13.3 4.04 12.55 3.9 12.16C3.82 11.96 3.48 11.34 3.18 11.17C2.93 11.04 2.58 10.72 3.17 10.71C3.73 10.7 4.13 11.22 4.26 11.43C4.9 12.5 5.92 12.2 6.3 12.02C6.36 11.56 6.55 11.25 6.75 11.07C5.18 10.89 3.53 10.28 3.53 7.58C3.53 6.81 3.82 6.18 4.28 5.69C4.21 5.51 3.96 4.79 4.35 3.82C4.35 3.82 4.94 3.63 6.27 4.52C6.83 4.37 7.42 4.29 8.01 4.29C8.6 4.29 9.19 4.37 9.75 4.52C11.08 3.62 11.67 3.82 11.67 3.82C12.06 4.79 11.81 5.51 11.74 5.69C12.2 6.18 12.49 6.8 12.49 7.58C12.49 10.29 10.83 10.89 9.26 11.07C9.51 11.29 9.73 11.71 9.73 12.37C9.73 13.31 9.72 14.07 9.72 14.31C9.72 14.49 9.85 14.71 10.2 14.64C12.97 13.71 14.98 11.08 14.98 8C14.98 4.13 11.85 1 7.98 1H8Z"
        fill="#1B1B1B"
      />
    </svg>
  );
}

export function NotionLogo({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 100 100"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.017 4.313l55.333-4.087c6.797-.583 8.543-.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277-1.553 6.807-6.99 7.193l-64.257 3.89c-4.08.193-6.023-.39-8.16-3.113L3.3 79.94c-2.333-3.113-3.3-5.443-3.3-8.167V11.113c0-3.497 1.553-6.413 6.017-6.8z"
        fill="#fff"
      />
      <path
        clipRule="evenodd"
        d="M61.35.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723.967 5.053 3.3 8.167l12.99 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257-3.89c5.433-.387 6.99-2.917 6.99-7.193V20.64c0-2.21-.873-2.847-3.443-4.733L74.167 3.143c-4.273-3.107-6.02-3.5-12.817-2.917zM25.92 19.523c-5.247.353-6.437.433-9.417-1.99L8.927 11.507c-.77-.78-.383-1.753 1.557-1.947l53.193-3.887c4.467-.39 6.793 1.167 8.54 2.527l9.123 6.61c.39.197 1.36 1.36.193 1.36l-54.933 3.307-.68.046zM19.803 88.3V30.367c0-2.53.777-3.697 3.103-3.893L86 22.78c2.14-.193 3.107 1.167 3.107 3.693v57.547c0 2.53-.39 4.67-3.883 4.863l-60.377 3.5c-3.493.193-5.043-.97-5.043-4.083zm59.6-54.827c.387 1.75 0 3.5-1.75 3.7l-2.913.577v42.773c-2.527 1.36-4.853 2.137-6.797 2.137-3.107 0-3.883-.973-6.21-3.887l-19.03-29.94v28.967l6.02 1.363s0 3.5-4.857 3.5l-13.39.777c-.39-.78 0-2.723 1.357-3.11l3.497-.97v-38.3L34.15 44.94c-.39-1.75.58-4.277 3.3-4.473l14.367-.967 19.8 30.327v-26.83l-5.047-.58c-.39-2.143 1.163-3.7 3.103-3.89l9.73-.62z"
        fill="#000"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function SlackLogo({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
        fill="#E01E5A"
      />
      <path
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
        fill="#36C5F0"
      />
      <path
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
        fill="#2EB67D"
      />
      <path
        d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
        fill="#ECB22E"
      />
    </svg>
  );
}
