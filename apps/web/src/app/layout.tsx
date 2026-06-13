import { env } from "@cheatcode/env/web";
import { ClerkProvider } from "@clerk/nextjs";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import "./globals.css";
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
  const messages = await getMessages();
  const clerkPublishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>
        <ClerkProvider {...(clerkPublishableKey ? { publishableKey: clerkPublishableKey } : {})}>
          <NextIntlClientProvider locale="en" messages={messages}>
            <Providers>
              <ClientObservability />
              {children}
            </Providers>
          </NextIntlClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
