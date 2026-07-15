import { env } from "@cheatcode/env/web";
import { ClerkProvider } from "@clerk/nextjs";
import { ui } from "@clerk/ui";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./chat-markdown.css";
import "./effects.css";
import { ClientObservability } from "@/components/observability/client-observability";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Cheatcode",
  description: "AI agents that build, research, and ship.",
  metadataBase: new URL("https://trycheatcode.com"),
  openGraph: {
    description: "Your keys. Your models. Your sandbox.",
    images: [{ alt: "Cheatcode", height: 630, url: "/opengraph-image", width: 1200 }],
    siteName: "Cheatcode",
    title: "Cheatcode",
    type: "website",
    url: "https://trycheatcode.com",
  },
  twitter: {
    card: "summary_large_image",
    description: "Your keys. Your models. Your sandbox.",
    images: ["/opengraph-image"],
    title: "Cheatcode",
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const clerkPublishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>
        <a
          className="fixed top-2 left-2 z-[100] -translate-y-[calc(100%+1rem)] rounded-full bg-foreground px-4 py-2 font-semibold text-background text-sm transition-transform focus-visible:translate-y-0 motion-reduce:transition-none"
          href="#main-content"
        >
          Skip to main content
        </a>
        <ClerkProvider
          {...(clerkPublishableKey ? { publishableKey: clerkPublishableKey } : {})}
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          ui={ui}
        >
          <Providers>
            <ClientObservability />
            {children}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
