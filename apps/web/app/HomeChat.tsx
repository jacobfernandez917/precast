'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { AccountBar } from './AccountBar';
import { AgentChat } from './AgentChat';
import { authClient } from './lib/auth-client';

/**
 * Sign-in comes first: the chat is shown only to a signed-in person. The route
 * enforces the same rule (401 without a session); this is the page's half.
 */
export function HomeChat() {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();

  if (isPending) return <Text type="supporting">Checking whether you are signed in…</Text>;

  if (!data) {
    return (
      <Card>
        <div className="flex flex-col gap-3">
          <Heading level={2}>Sign in to chat with your agent</Heading>
          <Text type="supporting">
            Your conversations are kept with your account, so the agent remembers you on any device
            you sign in from.
          </Text>
          <div>
            <Button label="Sign in" variant="primary" onClick={() => router.push('/sign-in')} />
          </div>
        </div>
      </Card>
    );
  }

  // Fills the rest of the screen, so the chat's own log scrolls and the page does not.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AccountBar email={data.user.email} />
      <AgentChat />
    </div>
  );
}
