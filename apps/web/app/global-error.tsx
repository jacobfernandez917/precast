'use client';

/**
 * The last-resort boundary: it catches failures in the root layout itself,
 * which `error.tsx` cannot — that one renders INSIDE the layout, so a layout
 * that throws takes the boundary down with it.
 *
 * Because the layout is what failed, this component must supply its own
 * <html>/<body>, and it deliberately uses plain elements and inline styles:
 * the design system, the theme provider and the stylesheet all live in the
 * layout that just threw, so relying on any of them here would risk failing
 * inside the error screen itself.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <main style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ marginBottom: '1.5rem', lineHeight: 1.6 }}>
            The application failed to start. The error was recorded.
            {error.digest ? ` Reference: ${error.digest}` : ''}
          </p>
          <button
            onClick={reset}
            style={{ padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
