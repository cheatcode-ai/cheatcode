import { Metadata } from 'next';
import { siteConfig } from '@/lib/home';

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
  keywords: ['Cheatcode', 'AI', 'Agent', 'Lovable', 'bolt.new', 'build apps with AI'],
  authors: [
    {
      name: 'Cheatcode AI',
      url: 'https://trycheatcode.com',
    },
  ],
  creator: 'Cheatcode AI',

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};
