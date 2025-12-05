'use client';

import { ThemeProvider } from 'next-themes';
import { ReactQueryProvider } from '@/providers/react-query-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { AuthTokenProvider } from '@/contexts/AuthTokenContext';
import { CurrencyConverterProvider } from 'react-currency-localizer';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <AuthTokenProvider>
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
          <ReactQueryProvider>
            <CurrencyConverterProvider>
              {children}
            </CurrencyConverterProvider>
          </ReactQueryProvider>
        </ThemeProvider>
      </AuthTokenProvider>
    </ClerkProvider>
  );
}
