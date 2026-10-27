import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { getSignedInUser, isOidcConfigured, signInStatus } from '../lib/auth';
import { SignInForm } from './SignInForm';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const status = signInStatus();
  if (status !== 'ready' && status !== 'starting') {
    // Without this, every attempt fails and the form can only guess at why,
    // which reads as "you typed something wrong".
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
        <Card>
          <div className="flex flex-col gap-2">
            <Heading level={1}>Sign-in is not set up yet</Heading>
            <Text type="supporting">
              This server cannot sign anyone in until its setup is finished. If this is your
              project, say “show it to me” in Claude Code and it will finish the setup.
            </Text>
          </div>
        </Card>
      </main>
    );
  }
  if (await getSignedInUser(await headers())) redirect('/');
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <SignInForm withOrganisationSignIn={isOidcConfigured()} />
    </main>
  );
}
