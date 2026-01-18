import { cn } from '@/lib/utils';
import { type ReactNode } from 'react';

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

interface NavLink {
  id: string;
  name: string;
  href: string;
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
    links: [] as NavLink[],
  },
};

export type SiteConfig = typeof siteConfig;
