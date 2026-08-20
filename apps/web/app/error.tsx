'use client';

import { useEffect } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';

/**
 * Route-level error boundary.
 *
 * Without this file Next renders its own error page — unstyled, off-theme, and
 * in production stripped to "Application error: a client-side exception has
 * occurred", which tells the user nothing and gives them nothing to do.
 *
 * `digest` is deliberately the only detail shown. Next replaces the real message
 * with that hash on the server precisely so internals don't reach the browser,
 * and it is the string that ties this screen to the server log entry — so it is
 * worth surfacing, and the underlying error is not.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side errors never reach the server logger on their own.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Heading level={1}>Something went wrong</Heading>
        <Text type="supporting">
          This page didn&apos;t load. The error was recorded — trying again is usually enough.
        </Text>
      </div>

      <Card>
        <div className="flex flex-col items-start gap-4">
          {error.digest ? (
            <Text type="supporting">
              Reference: <code>{error.digest}</code>
            </Text>
          ) : null}
          <Button label="Try again" type="button" variant="primary" onClick={reset} />
        </div>
      </Card>
    </main>
  );
}
