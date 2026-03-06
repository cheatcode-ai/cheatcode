/**
 * Thread Screen Color System
 * =========================
 *
 * This is the SINGLE SOURCE OF TRUTH for all thread screen colors.
 * All colors are defined as CSS variables in globals.css and mapped here
 * for use in React components.
 *
 * To change the thread color scheme:
 * 1. Update the CSS variables in globals.css (search for "THREAD SCREEN COLOR SYSTEM")
 * 2. The changes will automatically apply to all thread components
 *
 * Usage in components:
 * - For Tailwind classes: Use the `threadStyles.*` values
 * - For cn() utility: Import and spread the class names
 */

// Pre-composed class combinations for common patterns
export const threadStyles = {
  // Header bar style
  header:
    'bg-thread-panel-translucent backdrop-blur-md border-b border-thread-border-subtle',

  // Side panel style
  sidePanel:
    'bg-thread-panel-translucent backdrop-blur-md border-l border-thread-border-subtle',

  // Card/surface style
  card: 'bg-thread-surface border border-thread-border rounded-lg',

  // Input field style
  input:
    'bg-thread-surface-subtle border border-thread-border text-thread-text-primary placeholder:text-thread-text-placeholder focus:border-thread-border-hover',

  // Button styles
  buttonGhost:
    'text-thread-text-secondary hover:text-thread-text-primary hover:bg-thread-hover',
  buttonOutline:
    'border border-thread-border bg-thread-surface hover:bg-thread-surface-hover hover:border-thread-border-hover text-thread-text-secondary hover:text-thread-text-primary',

  // Tab styles
  tabInactive: 'text-thread-text-tertiary hover:text-thread-text-secondary',
  tabActive: 'text-thread-text-primary',

  // Tooltip style
  tooltip:
    'bg-thread-surface border border-thread-border text-thread-text-primary',

  // Status badge styles
  statusBadgeSuccess:
    'bg-thread-status-success-bg text-thread-status-success border border-[var(--thread-status-success-border)]',
  statusBadgeWarning:
    'bg-thread-status-warning-bg text-thread-status-warning border border-[var(--thread-status-warning-border)]',
  statusBadgeError:
    'bg-thread-status-error-bg text-thread-status-error border border-[var(--thread-status-error-border)]',

  // Status indicator dot
  statusDotActive:
    'bg-thread-status-success shadow-[0_0_8px_var(--thread-status-success-glow)]',
  statusDotWarning: 'bg-thread-status-warning animate-pulse',

  // Message bubble styles
  userMessage: 'bg-thread-user-message rounded-2xl',
  assistantMessage:
    'bg-[var(--thread-assistant-message-bg)] border border-[var(--thread-assistant-message-border)] backdrop-blur-sm',

  // Skeleton loading
  skeleton: 'bg-thread-skeleton animate-pulse',

  // Tool/code block
  toolBlock: 'bg-[var(--thread-code-bg)] border-l border-thread-border',
} as const;
