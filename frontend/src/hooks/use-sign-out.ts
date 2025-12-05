'use client';

import { useCallback } from 'react';
import { useClerk } from '@clerk/nextjs';

/**
 * Hook for handling user sign out
 * Consolidated from navbar.tsx, thread-site-header.tsx, and nav-user.tsx
 */
export function useSignOut() {
  const { signOut } = useClerk();

  const handleSignOut = useCallback(async () => {
    await signOut({ redirectUrl: '/' });
  }, [signOut]);

  return { signOut: handleSignOut };
}
