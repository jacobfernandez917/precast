'use client';

import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { authClient } from './lib/auth-client';

/** Who is signed in, with sign-out. Signing out returns the page to its sign-in card. */
export function AccountBar({ email }: { email: string }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <Text type="supporting">Signed in as {email}</Text>
      <Button label="Sign out" variant="ghost" onClick={() => void authClient.signOut()} />
    </div>
  );
}
