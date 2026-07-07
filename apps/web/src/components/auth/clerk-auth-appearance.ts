import { dark } from "@clerk/themes";

// Dark auth modal matching cheatcode V1. V2 runs Clerk's new @clerk/ui theming, which ignores
// the legacy `baseTheme` preset for colors — the palette is driven by `variables` (the original
// light modal set colorBackground:#fff here). We keep `baseTheme: dark` as the base and set the
// dark palette + a few element overrides so Clerk's native chrome renders fully dark and native.
export const clerkAuthAppearance = {
  baseTheme: dark,
  elements: {
    card: "!border-0 !bg-[#161616] !shadow-none",
    cardBox: "!bg-[#161616] !shadow-none",
    developmentMode: "!hidden",
    footer: "!border-[#262626] !border-t !bg-[#121212]",
    footerActionLink: "!text-[#f2f2f2] hover:!text-white",
    footerActionText: "!text-[#9a9a9a]",
    formButtonPrimary: "!bg-white !text-[#111111] hover:!bg-[#e6e6e6]",
    formFieldInput: "!border-[#2f2f2f] !bg-[#1f1f1f] !text-[#ededed] placeholder:!text-[#6f6f6f]",
    headerSubtitle: "!text-[#a1a1a1]",
    headerTitle: "!text-[#f2f2f2]",
    rootBox: "!mx-auto !w-full",
    socialButtonsBlockButton: "!border-[#2f2f2f] !bg-[#1f1f1f] !text-[#ededed] hover:!bg-[#262626]",
  },
  variables: {
    borderRadius: "10px",
    colorBackground: "#161616",
    colorInputBackground: "#1f1f1f",
    colorInputText: "#ededed",
    colorNeutral: "#ffffff",
    colorPrimary: "#ffffff",
    colorText: "#ededed",
    colorTextSecondary: "#a1a1a1",
    fontFamily: "var(--font-geist-sans), Arial, sans-serif",
  },
};
