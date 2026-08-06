/**
 * The APC Design System theme this project uses.
 *
 * Set once at scaffold time — `pnpm bootstrap` asks for it, and `pnpm set-theme
 * <name>` changes it later. It is a plain constant rather than an env var so the
 * value is present during SSR: reading it from the environment at runtime would
 * render the first paint unthemed and flash on hydration.
 *
 * Preview all five: https://apc-design-system.917v.dev
 */
export const APC_THEMES = ['stockholm', 'prague', 'arctic', 'nova', 'melbourne'] as const;

export type ApcTheme = (typeof APC_THEMES)[number];

/** Rewritten by `pnpm set-theme` — keep the literal on one line. */
export const APC_THEME: ApcTheme = 'stockholm';
