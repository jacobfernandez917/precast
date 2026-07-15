import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
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
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
