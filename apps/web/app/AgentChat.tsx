'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { AgentReply } from './lib/a2a-client';

/**
 * Agent chat demo — sends a message to a Mastra agent through the `/api/a2a/:agentId`
 * route handler, which either proxies via AgentBase or calls Mastra directly
 * over A2A (per `ENABLE_AGENTBASE`). The agent id is editable so the demo proves
 * multi-agent routing (e.g. `example-agent`, `summary-agent`).
 */
export function AgentChat() {
  const [agentId, setAgentId] = useState('example-agent');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState<AgentReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() || isSending) return;

    setIsSending(true);
    setError(null);
    setReply(null);

    try {
      const res = await fetch(`/api/a2a/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      // 200 → normalized AgentReply; non-2xx → { error: string } (e.g. 400 validation).
      const data = (await res.json()) as AgentReply | { error: string };

      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Request failed');
      } else {
        const r = data as AgentReply;
        if (r.ok) setReply(r);
        else setError(r.error ?? 'Agent error');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Card>
      <form onSubmit={sendMessage} className="flex flex-col gap-4">
        <Heading level={2}>Agent chat (A2A)</Heading>

        <TextInput
          label="Agent"
          value={agentId}
          onChange={setAgentId}
          placeholder="example-agent"
        />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextInput
              label="Message"
              isLabelHidden
              value={message}
              onChange={setMessage}
              placeholder="Type a message for the agent..."
            />
          </div>
          <Button
            label="Send"
            type="submit"
            variant="primary"
            isLoading={isSending}
            isDisabled={!message.trim()}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-border bg-surface p-3">
            <Text color="accent">{error}</Text>
          </div>
        )}

        {reply && (
          <div className="rounded-lg border border-border bg-surface p-3">
            <Text type="supporting">
              Agent response · {reply.via === 'agentbase' ? 'via AgentBase proxy' : 'direct A2A'}
            </Text>
            <Text as="p">{reply.text || '(no text content)'}</Text>
          </div>
        )}
      </form>
    </Card>
  );
}
