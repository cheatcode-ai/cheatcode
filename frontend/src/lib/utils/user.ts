/**
 * User-related utility functions
 * Consolidated from navbar.tsx, thread-site-header.tsx, and nav-user.tsx
 */

/**
 * Get initials from a user's name for avatar fallback display
 * @param name - The full name to extract initials from
 * @returns Up to 2 uppercase letters representing the name
 */
export function getUserInitials(name: string): string {
  if (!name) return 'U';

  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
