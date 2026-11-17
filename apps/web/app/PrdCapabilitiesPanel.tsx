'use client';
import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { prdCapabilities, type PrdBlueprint } from '@precast/shared';

export function PrdCapabilitiesPanel({
  brief,
  workspace,
  onWorkspace,
}: {
  brief: PrdBlueprint;
  workspace: string;
  onWorkspace: (id: string, role: string) => void;
}) {
  const caps = prdCapabilities(brief);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; role: string }>>(
    [],
  );
  const [account, setAccount] = useState('');
  const [name, setName] = useState('');
  const [member, setMember] = useState('');
  const [role, setRole] = useState('viewer');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [amount, setAmount] = useState('100');
  const [outcome, setOutcome] = useState('succeeded');
  const [jobs, setJobs] = useState<Array<{ id: string; kind: string; state: string }>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
  async function loadWorkspaces() {
    if (caps.collaboration !== 'team') return;
    const response = await fetch('/api/project-workspaces');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setWorkspaces(result.workspaces);
    setAccount(result.accountId);
  }
  async function loadJobs() {
    if (!caps.reminders && caps.payments !== 'test') return;
    const response = await fetch(`/api/project-workflows${query}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setJobs(result.workflows);
  }
  useEffect(() => {
    void loadWorkspaces().catch((e: Error) => setError(e.message));
  }, []); // Account is mounted only after sign-in.
  useEffect(() => {
    void loadJobs().catch((e: Error) => setError(e.message));
  }, [workspace]);
  async function change(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the change.');
      await loadWorkspaces();
      await loadJobs();
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const owner = workspaces.find((w) => w.id === workspace)?.role === 'owner';
  const viewer = workspaces.find((w) => w.id === workspace)?.role === 'viewer';
  if (
    caps.collaboration !== 'team' &&
    !caps.reminders &&
    caps.payments !== 'test' &&
    !caps.computer
  )
    return null;
  return (
    <Card>
      <div className="flex flex-col gap-4">
        {caps.collaboration === 'team' && (
          <section className="flex flex-col gap-3" aria-label="Workspaces">
            <Heading level={2}>Workspace</Heading>
            <Text type="supporting">
              Your account ID: {account}. The owner can add an existing account as an editor or
              viewer.
            </Text>
            <select
              aria-label="Workspace"
              value={workspace}
              onChange={(e) =>
                onWorkspace(
                  e.target.value,
                  workspaces.find((w) => w.id === e.target.value)?.role ?? 'owner',
                )
              }
              className="rounded-lg border border-border bg-surface p-3 text-primary"
            >
              <option value="">Private workspace</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.role})
                </option>
              ))}
            </select>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void change('/api/project-workspaces', { action: 'create', name }).then(
                  (result) => {
                    if (result) {
                      onWorkspace(result.id, 'owner');
                      setName('');
                    }
                  },
                );
              }}
            >
              <TextInput label="New workspace name" value={name} onChange={setName} isRequired />
              <Button
                label="Create workspace"
                type="submit"
                variant="secondary"
                isDisabled={busy}
              />
            </form>
            {owner && (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void change('/api/project-workspaces', {
                    action: 'member',
                    workspace,
                    member,
                    role: role === 'remove' ? null : role,
                  });
                }}
              >
                <TextInput
                  label="Member account ID"
                  value={member}
                  onChange={setMember}
                  isRequired
                />
                <select
                  aria-label="Member role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="rounded-lg border border-border bg-surface p-3 text-primary"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="remove">Remove access</option>
                </select>
                <Button label="Update member" variant="secondary" type="submit" isDisabled={busy} />
              </form>
            )}
          </section>
        )}
        {(caps.reminders || caps.payments === 'test') && (
          <Text>
            Test mode: reminders are recorded here and payments are simulated. No email is sent and
            no money is charged.
          </Text>
        )}
        {caps.reminders && (
          <section className="flex flex-col gap-3" aria-label="Test reminders">
            <Heading level={3}>Test reminders</Heading>
            <Text type="supporting">
              Schedule a reminder, then process due reminders to preview delivery. Scheduled
              reminders persist across restarts. Production scheduling and email delivery require a
              separately configured service.
            </Text>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void change(`/api/project-workflows${query}`, {
                  action: 'reminder',
                  key: crypto.randomUUID(),
                  title,
                  dueAt: new Date(due).toISOString(),
                });
              }}
            >
              <TextInput label="Reminder title" value={title} onChange={setTitle} isRequired />
              <label>
                Due time
                <input
                  aria-label="Due time"
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  required
                  className="rounded-lg border border-border bg-surface p-3 text-primary"
                />
              </label>
              <Button
                label="Schedule test reminder"
                variant="secondary"
                type="submit"
                isDisabled={busy || viewer}
              />
            </form>
            <Button
              label="Process due test reminders"
              variant="secondary"
              isDisabled={busy || viewer}
              onClick={() =>
                void change(`/api/project-workflows${query}`, { action: 'process-due' })
              }
            />
          </section>
        )}
        {caps.payments === 'test' && (
          <section className="flex flex-col gap-3" aria-label="Test payments">
            <Heading level={3}>Test payments</Heading>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void change(`/api/project-workflows${query}`, {
                  action: 'payment',
                  key: crypto.randomUUID(),
                  amountCents: Number(amount),
                  currency: 'USD',
                  outcome,
                });
              }}
            >
              <label>
                Amount in cents
                <input
                  aria-label="Amount in cents"
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="rounded-lg border border-border bg-surface p-3 text-primary"
                />
              </label>
              <select
                aria-label="Test payment outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="rounded-lg border border-border bg-surface p-3 text-primary"
              >
                <option value="succeeded">Success</option>
                <option value="failed">Failure</option>
                <option value="canceled">Canceled</option>
              </select>
              <Button
                label="Simulate payment"
                variant="secondary"
                type="submit"
                isDisabled={busy || viewer}
              />
            </form>
          </section>
        )}
        {jobs.map((job) => (
          <Text key={job.id}>
            {job.kind === 'reminder' ? 'Reminder' : 'Payment'}: {job.state.replaceAll('_', ' ')}
          </Text>
        ))}
        {caps.computer && (
          <section aria-label="Agent Computer access">
            <Heading level={3}>Assistant’s Computer access</Heading>
            <Text>
              The assistant can request browser access to {caps.computer.domains.join(', ')} when
              used through Raya. Approve its own Computer access in AgentBase first. You complete
              sign-in, MFA and CAPTCHA yourself. This app does not inherit the scaffold builder’s
              access.
            </Text>
            {caps.computer.interactionMode === 'observe' && (
              <Text>
                The assistant can read the page you choose. It cannot click controls or open
                individual messages.
              </Text>
            )}
          </section>
        )}
        {error && (
          <div role="alert">
            <Text color="accent">{error}</Text>
          </div>
        )}
      </div>
    </Card>
  );
}
