'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { PrdBlueprint, PrdRecord } from '@precast/shared';
import { authClient } from './lib/auth-client';
import { AccountBar } from './AccountBar';
import { AgentChat } from './AgentChat';

export function PrdWorkspace({ brief }: { brief: PrdBlueprint }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [selected, setSelected] = useState(brief.collections[0]!.id);
  const [records, setRecords] = useState<PrdRecord[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [editing, setEditing] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const collection = brief.collections.find((item) => item.id === selected)!;
  const userId = session?.user.id;
  const reload = useCallback(async () => {
    if (!userId) return;
    const response = await fetch(`/api/project-records?collection=${encodeURIComponent(selected)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load your records.');
    setRecords(result.records);
  }, [selected, userId]);
  useEffect(() => {
    setRecords([]);
    setValues({});
    setEditing(undefined);
    setError(null);
    void reload().catch((e: Error) => setError(e.message));
  }, [reload]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(
      collection.fields.flatMap((field) => {
        const raw = values[field.id];
        if (!field.required && (raw === undefined || raw === '')) return [];
        const value =
          field.type === 'boolean'
            ? raw === true
            : field.type === 'number'
              ? Number(raw)
              : String(raw ?? '');
        return [[field.id, value]];
      }),
    );
    try {
      const response = await fetch('/api/project-records', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ collection: selected, data, ...(editing ? { id: editing } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save your changes.');
      setValues({});
      setEditing(undefined);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/project-records', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ collection: selected, id }),
      });
      if (!response.ok) throw new Error('Could not delete that record.');
      if (editing === id) {
        setEditing(undefined);
        setValues({});
      }
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isPending) return <Text type="supporting">Checking your account…</Text>;
  if (!session)
    return (
      <Card>
        <div className="flex flex-col gap-4">
          <Heading level={2}>Your workspace starts here</Heading>
          <Text>
            Sign in or create an account to manage your records and work with your assistant.
          </Text>
          <Button label="Sign in" variant="primary" onClick={() => router.push('/sign-in')} />
        </div>
      </Card>
    );

  const visible = records.filter((record) =>
    Object.values(record.data).join(' ').toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="flex min-h-0 flex-col gap-6">
      <AccountBar email={session.user.email} />
      <nav aria-label="Collections" className="flex flex-wrap gap-2">
        {brief.collections.map((item) => (
          <Button
            key={item.id}
            label={item.label}
            variant={selected === item.id ? 'primary' : 'secondary'}
            onClick={() => setSelected(item.id)}
          />
        ))}
      </nav>
      {error && (
        <div role="alert" className="rounded-lg border border-border bg-surface p-3">
          <Text color="accent">{error}</Text>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="flex flex-col gap-4 lg:col-span-2" aria-label={collection.label}>
          <div className="flex items-center justify-between gap-4">
            <Heading level={2}>{collection.label}</Heading>
            <Text type="supporting">{records.length} saved</Text>
          </div>
          <TextInput
            label={`Search ${collection.label.toLowerCase()}`}
            value={search}
            onChange={setSearch}
          />
          {visible.length === 0 && (
            <Card>
              <Text>
                {records.length
                  ? 'No matching records.'
                  : `No ${collection.label.toLowerCase()} yet. Add your first one.`}
              </Text>
            </Card>
          )}
          {visible.map((record) => (
            <Card key={record.id}>
              <article className="flex flex-col gap-3">
                {collection.fields.map((field) => (
                  <div key={field.id} className="flex flex-wrap justify-between gap-2">
                    <Text type="supporting">{field.label}</Text>
                    <Text>
                      {typeof record.data[field.id] === 'boolean'
                        ? record.data[field.id]
                          ? 'Yes'
                          : 'No'
                        : String(record.data[field.id] ?? '—')}
                    </Text>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button
                    label={`Edit ${collection.singular.toLowerCase()}`}
                    variant="secondary"
                    onClick={() => {
                      setEditing(record.id);
                      setValues(
                        Object.fromEntries(
                          Object.entries(record.data).map(([key, value]) => [
                            key,
                            typeof value === 'boolean' ? value : String(value),
                          ]),
                        ),
                      );
                    }}
                  />
                  <Button
                    label={`Delete ${collection.singular.toLowerCase()}`}
                    variant="secondary"
                    isDisabled={busy}
                    onClick={() => void remove(record.id)}
                  />
                </div>
              </article>
            </Card>
          ))}
        </section>
        <Card>
          <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
            <Heading level={2}>
              {editing ? 'Edit' : 'Add'} {collection.singular.toLowerCase()}
            </Heading>
            {collection.fields.map((field) =>
              field.type === 'choice' ? (
                <label key={field.id} className="flex flex-col gap-2 text-sm">
                  {field.label}
                  <select
                    aria-label={field.label}
                    required={field.required}
                    value={String(values[field.id] ?? '')}
                    onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                    className="rounded-lg border border-border bg-surface p-3 text-primary"
                  >
                    <option value="">Choose…</option>
                    {field.choices.map((choice) => (
                      <option key={choice}>{choice}</option>
                    ))}
                  </select>
                </label>
              ) : field.type === 'boolean' ? (
                <label key={field.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={values[field.id] === true}
                    onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.checked }))}
                  />
                  {field.label}
                </label>
              ) : field.type === 'number' || field.type === 'date' ? (
                <label key={field.id} className="flex flex-col gap-2 text-sm">
                  {field.label}
                  <input
                    aria-label={field.label}
                    type={field.type}
                    required={field.required}
                    step={field.type === 'number' ? 'any' : undefined}
                    value={String(values[field.id] ?? '')}
                    onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                    className="rounded-lg border border-border bg-surface p-3 text-primary"
                  />
                </label>
              ) : (
                <TextInput
                  key={field.id}
                  label={field.label}
                  value={String(values[field.id] ?? '')}
                  onChange={(value) => setValues((v) => ({ ...v, [field.id]: value }))}
                  isRequired={field.required}
                />
              ),
            )}
            <Button
              label={editing ? 'Save changes' : `Add ${collection.singular.toLowerCase()}`}
              variant="primary"
              type="submit"
              isLoading={busy}
            />
            {editing && (
              <Button
                label="Cancel edit"
                variant="secondary"
                onClick={() => {
                  setEditing(undefined);
                  setValues({});
                }}
              />
            )}
          </form>
        </Card>
      </div>
      <section
        aria-label="Assistant"
        className="flex h-[32rem] min-h-0 flex-col gap-3 rounded-xl border border-border p-4"
      >
        <Heading level={2}>{brief.title} assistant</Heading>
        <Text type="supporting">{brief.agentJob}</Text>
        <AgentChat />
      </section>
    </div>
  );
}
