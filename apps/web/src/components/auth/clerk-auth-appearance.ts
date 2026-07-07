import { dark } from "@clerk/themes";

// Exact parity with cheatcode V1's auth modal: Clerk's native dark theme with the card's own
// border/shadow removed (the modal shell provides the surface). Keeping Clerk's default chrome
// — header, social buttons, divider, fields, footer — so it looks and feels 100% native.
export const clerkAuthAppearance = {
  baseTheme: dark,
  elements: {
    card: "shadow-none border-0",
    developmentMode: "hidden",
    rootBox: "mx-auto",
  },
  variables: {
    fontFamily: "var(--font-geist-sans), Arial, sans-serif",
  },
};
