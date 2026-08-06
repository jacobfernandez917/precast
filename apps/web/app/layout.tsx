import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { APC_THEME } from './theme/apc-theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Precast',
  description: 'Precast — agent-ready TypeScript monorepo boilerplate.',
};

// Astryx themes support light/dark; let the browser render the matching UA
// surfaces (form controls, scrollbars) for whichever the theme resolves to.
export const viewport: Viewport = {
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `data-apc-theme` selects the APC token set in theme/apc-themes.css.
    // Server-rendered, so the first paint is already themed.
    <html lang="en" data-apc-theme={APC_THEME}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
