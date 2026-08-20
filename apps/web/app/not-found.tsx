import Link from 'next/link';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';

/**
 * 404 page. A server component on purpose — nothing here needs interactivity,
 * and this route should render even when the client bundle fails.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Heading level={1}>Page not found</Heading>
        <Text type="supporting">That address doesn&apos;t match anything in this app.</Text>
      </div>

      <Card>
        <Link href="/">Back to the home page</Link>
      </Card>
    </main>
  );
}
