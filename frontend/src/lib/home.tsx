import { cn } from '@/lib/utils';
import React, { type ReactNode } from 'react';

export const Highlight = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <span
      className={cn(
        'p-1 py-0.5 font-medium dark:font-semibold text-secondary',
        className,
      )}
    >
      {children}
    </span>
  );
};

export const BLUR_FADE_DELAY = 0.15;

export interface PricingTier {
  name: string;
  price: string;
  yearlyPrice?: string;
  originalYearlyPrice?: string;
  discountPercentage?: number;
  description: string;
  features: string[];
  isPopular?: boolean;
  hidden?: boolean;
  buttonColor?: string;

  planId?: string; // For DodoPayments integration
}

export const siteConfig = {
  name: 'Cheatcode AI',
  description: 'Your technical co-founder - an AI agent that can build web and mobile apps by chatting.',
  cta: 'Start Free',
  url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  keywords: ['AI Agent', 'Coding Agent', 'Lovable', 'Bolt', 'Build mobile apps with AI', 'Build startups with AI'],
  links: {
    email: 'founders@trycheatcode.com',
    twitter: 'https://x.com/trycheatcode',
    discord: 'https://discord.gg/s3y5bUKUEF',
    linkedin: 'https://www.linkedin.com/company/cheatcode-ai/',
  },
  nav: {
    links: [
      // Navigation items removed
    ],
  },
  // Legacy pricing configuration - replaced by API-driven plans
  cloudPricingItems: [] as PricingTier[],
};

export type SiteConfig = typeof siteConfig;
