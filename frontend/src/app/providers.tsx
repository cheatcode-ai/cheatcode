'use client';

import { ReactQueryProvider } from '@/providers/react-query-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { AuthTokenProvider } from '@/contexts/AuthTokenContext';
// @ts-expect-error - react-currency-localizer has no type definitions
import { CurrencyConverterProvider } from 'react-currency-localizer';
import { LazyMotion, domAnimation } from 'motion/react';

// Note: ThemeProvider removed - it's already provided at the root layout level
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <AuthTokenProvider>
        <ReactQueryProvider>
          <CurrencyConverterProvider>
            <LazyMotion features={domAnimation} strict>
              {children}
            </LazyMotion>
          </CurrencyConverterProvider>
        </ReactQueryProvider>
      </AuthTokenProvider>
    </ClerkProvider>
  );
}
