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
 * - For Tailwind classes: Use the `threadColors.tw.*` values
 * - For inline styles: Use the `threadColors.css.*` values
 * - For cn() utility: Import and spread the class names
 */

// CSS Variable references (for inline styles or CSS-in-JS)
export const threadCssVars = {
  // Panel Backgrounds
  panelBg: 'var(--thread-panel-bg)',
  panelBgTranslucent: 'var(--thread-panel-bg-translucent)',
  surface: 'var(--thread-surface)',
  surfaceHover: 'var(--thread-surface-hover)',
  surfaceSubtle: 'var(--thread-surface-subtle)',

  // Borders
  border: 'var(--thread-border)',
  borderSubtle: 'var(--thread-border-subtle)',
  borderHover: 'var(--thread-border-hover)',
  divider: 'var(--thread-divider)',

  // Text Colors
  textPrimary: 'var(--thread-text-primary)',
  textSecondary: 'var(--thread-text-secondary)',
  textTertiary: 'var(--thread-text-tertiary)',
  textMuted: 'var(--thread-text-muted)',
  textPlaceholder: 'var(--thread-text-placeholder)',

  // Interactive States
  hoverBg: 'var(--thread-hover-bg)',
  activeBg: 'var(--thread-active-bg)',
  focusRing: 'var(--thread-focus-ring)',

  // Status Colors
  statusSuccess: 'var(--thread-status-success)',
  statusSuccessBg: 'var(--thread-status-success-bg)',
  statusSuccessBorder: 'var(--thread-status-success-border)',
  statusSuccessGlow: 'var(--thread-status-success-glow)',

  statusWarning: 'var(--thread-status-warning)',
  statusWarningBg: 'var(--thread-status-warning-bg)',
  statusWarningBorder: 'var(--thread-status-warning-border)',

  statusError: 'var(--thread-status-error)',
  statusErrorBg: 'var(--thread-status-error-bg)',
  statusErrorBorder: 'var(--thread-status-error-border)',
  statusErrorText: 'var(--thread-status-error-text)',

  statusInfo: 'var(--thread-status-info)',

  // Accent Colors
  accentPurple: 'var(--thread-accent-purple)',
  accentPurpleGlow: 'var(--thread-accent-purple-glow)',

  // Message Bubbles
  userMessageBg: 'var(--thread-user-message-bg)',
  assistantMessageBg: 'var(--thread-assistant-message-bg)',
  assistantMessageBorder: 'var(--thread-assistant-message-border)',

  // Code/Tool
  codeBg: 'var(--thread-code-bg)',
  toolBorder: 'var(--thread-tool-border)',

  // Loading/Skeleton
  skeletonBg: 'var(--thread-skeleton-bg)',
  loadingDot: 'var(--thread-loading-dot)',
} as const;

// Tailwind class mappings using the CSS variables
// These can be used directly in className props
export const threadTw = {
  // === BACKGROUNDS ===
  // Panel backgrounds (header, side panel, etc.)
  panelBg: 'bg-thread-panel',
  panelBgTranslucent: 'bg-thread-panel-translucent backdrop-blur-md',
  surface: 'bg-thread-surface',
  surfaceHover: 'hover:bg-thread-surface-hover',
  surfaceSubtle: 'bg-thread-surface-subtle',

  // === BORDERS ===
  border: 'border-thread-border',
  borderSubtle: 'border-thread-border-subtle',
  borderHover: 'hover:border-thread-border-hover',
  divider: 'bg-thread-divider',

  // === TEXT ===
  textPrimary: 'text-thread-text-primary',
  textSecondary: 'text-thread-text-secondary',
  textTertiary: 'text-thread-text-tertiary',
  textMuted: 'text-thread-text-muted',
  textPlaceholder: 'placeholder:text-thread-text-placeholder',

  // === INTERACTIVE ===
  hoverBg: 'hover:bg-thread-hover',
  activeBg: 'active:bg-thread-active',

  // === STATUS ===
  statusSuccess: 'text-thread-status-success',
  statusSuccessBg: 'bg-thread-status-success-bg',
  statusWarning: 'text-thread-status-warning',
  statusWarningBg: 'bg-thread-status-warning-bg',
  statusError: 'text-thread-status-error',
  statusErrorBg: 'bg-thread-status-error-bg',
  statusInfo: 'text-thread-status-info',

  // === ACCENT ===
  accentPurple: 'text-thread-accent-purple',
  accentPurpleBg: 'bg-thread-accent-purple',

  // === LOADING ===
  skeleton: 'bg-thread-skeleton',
  loadingDot: 'bg-thread-loading',
} as const;

// Pre-composed class combinations for common patterns
export const threadStyles = {
  // Header bar style
  header: 'bg-thread-panel-translucent backdrop-blur-md border-b border-thread-border-subtle',

  // Side panel style
  sidePanel: 'bg-thread-panel-translucent backdrop-blur-md border-l border-thread-border-subtle',

  // Card/surface style
  card: 'bg-thread-surface border border-thread-border rounded-lg',

  // Input field style
  input: 'bg-thread-surface-subtle border border-thread-border text-thread-text-primary placeholder:text-thread-text-placeholder focus:border-thread-border-hover',

  // Button styles
  buttonGhost: 'text-thread-text-secondary hover:text-thread-text-primary hover:bg-thread-hover',
  buttonOutline: 'border border-thread-border bg-thread-surface hover:bg-thread-surface-hover hover:border-thread-border-hover text-thread-text-secondary hover:text-thread-text-primary',

  // Tab styles
  tabInactive: 'text-thread-text-tertiary hover:text-thread-text-secondary',
  tabActive: 'text-thread-text-primary',

  // Tooltip style
  tooltip: 'bg-thread-surface border border-thread-border text-thread-text-primary',

  // Status badge styles
  statusBadgeSuccess: 'bg-thread-status-success-bg text-thread-status-success border border-[var(--thread-status-success-border)]',
  statusBadgeWarning: 'bg-thread-status-warning-bg text-thread-status-warning border border-[var(--thread-status-warning-border)]',
  statusBadgeError: 'bg-thread-status-error-bg text-thread-status-error border border-[var(--thread-status-error-border)]',

  // Status indicator dot
  statusDotActive: 'bg-thread-status-success shadow-[0_0_8px_var(--thread-status-success-glow)]',
  statusDotWarning: 'bg-thread-status-warning animate-pulse',

  // Message bubble styles
  userMessage: 'bg-thread-user-message rounded-2xl',
  assistantMessage: 'bg-[var(--thread-assistant-message-bg)] border border-[var(--thread-assistant-message-border)] backdrop-blur-sm',

  // Skeleton loading
  skeleton: 'bg-thread-skeleton animate-pulse',

  // Tool/code block
  toolBlock: 'bg-[var(--thread-code-bg)] border-l border-thread-border',
} as const;

// Export everything as a single object for convenience
export const threadColors = {
  css: threadCssVars,
  tw: threadTw,
  styles: threadStyles,
} as const;

export default threadColors;
