'use client';

import { Theme } from '@astryxdesign/core';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import type { ReactNode } from 'react';

/**
 * Astryx theme provider. Client component (Astryx's <Theme> uses context), so
 * the theme object stays out of the server→client serialization boundary.
 * `mode="system"` follows the OS light/dark preference; pair with the
 * pre-built theme.css imported in globals.css for flash-free SSR.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <Theme theme={neutralTheme} mode="system">
      {children}
    </Theme>
  );
}
