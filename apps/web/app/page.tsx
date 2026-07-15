import { headers } from 'next/headers';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { HealthStatus } from '@precast/shared';
import { AgentChat } from './AgentChat';

// The page fetches its own health route on each request, so render dynamically.
export const dynamic = 'force-dynamic';

async function getHealth(): Promise<HealthStatus> {
  const h = await headers();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const res = await fetch(`${proto}://${host}/api/health`, { cache: 'no-store' });
  return res.json() as Promise<HealthStatus>;
}

export default async function Home() {
  const health = await getHealth();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Heading level={1}>Precast</Heading>
        <Text type="supporting">
          Your web app is running. Edit <code>app/page.tsx</code> to get started.
        </Text>
      </div>

      <Card>
        <div className="flex flex-col gap-2">
          <Heading level={2}>Server health</Heading>
          <pre className="overflow-x-auto text-sm">{JSON.stringify(health, null, 2)}</pre>
        </div>
      </Card>

      <AgentChat />
    </main>
  );
}
