'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { authClient } from '../lib/auth-client';

type Mode = 'sign-in' | 'create';

/**
 * Email and password, plus the organisation's identity provider when one is set
 * up. Accounts are kept in the project's own database (app/lib/auth.ts).
 */
export function SignInForm({ withOrganisationSignIn }: { withOrganisationSignIn: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setIsBusy(true);
    setError(null);
    const result =
      mode === 'create'
        ? await authClient.signUp.email({ name: name.trim() || email, email, password })
        : await authClient.signIn.email({ email, password });
    setIsBusy(false);
    if (result.error) {
      setError(result.error.message ?? 'That did not work. Check the details and try again.');
      return;
    }
    router.push('/');
    router.refresh();
  }

  async function organisationSignIn() {
    setError(null);
    const result = await authClient.signIn.social({ provider: 'oidc', callbackURL: '/' });
    if (result.error) setError(result.error.message ?? 'Could not reach your sign-in service.');
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Heading level={1}>{mode === 'create' ? 'Create your account' : 'Sign in'}</Heading>
          <Text type="supporting">
            {mode === 'create'
              ? 'The agent will remember you on any device you sign in from.'
              : 'Sign in so the agent remembers you wherever you use it.'}
          </Text>
        </div>

        {/* The chat's error style: Banner's error fill is not yet mapped to APC and reads poorly in dark themes. */}
        {error && (
          <div role="alert" className="rounded-lg border border-border bg-surface p-3">
            <Text color="accent">{error}</Text>
          </div>
        )}

        {mode === 'create' && (
          <TextInput label="Name" value={name} onChange={setName} placeholder="Jamie Rivera" />
        )}
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          isRequired
        />
        <TextInput
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          description={mode === 'create' ? 'At least 8 characters.' : undefined}
          isRequired
        />

        <Button
          label={mode === 'create' ? 'Create account' : 'Sign in'}
          type="submit"
          variant="primary"
          isLoading={isBusy}
          isDisabled={!email || !password}
        />

        {withOrganisationSignIn && (
          <>
            <Divider />
            <Button
              label="Continue with your organisation's sign-in"
              type="button"
              variant="secondary"
              onClick={organisationSignIn}
            />
          </>
        )}

        <Button
          label={mode === 'create' ? 'I already have an account' : 'Create an account instead'}
          type="button"
          variant="ghost"
          onClick={() => {
            setMode(mode === 'create' ? 'sign-in' : 'create');
            setError(null);
          }}
        />
      </form>
    </Card>
  );
}
