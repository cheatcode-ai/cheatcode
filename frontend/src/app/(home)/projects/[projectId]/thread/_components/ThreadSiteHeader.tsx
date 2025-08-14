import React from 'react';
import { SiteHeader } from '@/components/thread/thread-site-header';

// Simple wrapper that ensures SiteHeader gets the context it needs
export function ThreadSiteHeader() {
  return <SiteHeader />;
}