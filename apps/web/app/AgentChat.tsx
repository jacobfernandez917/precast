'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { A2aResponse } from './lib/a2a-client';

/**
 * Agent chat demo — sends a message to a Mastra agent through the Next → AgentBase
 * A2A proxy route (`/api/a2a/:agentId`). The agent id is editable so the demo
 * proves multi-agent routing (e.g. `example-agent`, `summary-agent`).
 */
export function AgentChat() {
  const [agentId, setAgentId] = useState('example-agent');
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState<A2aResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() || isSending) return;

    setIsSending(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch(`/api/a2a/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      // The proxy route returns an A2aResponse, or `{ error: string }` on a 400.
      const data = (await res.json()) as A2aResponse | { error: string };

      if ('error' in data && data.error) {
        setError(typeof data.error === 'string' ? data.error : data.error.message);
      } else {
        setResponse(data as A2aResponse);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setIsSending(false);
    }
  }

  const answer = response?.result?.result.message.content?.[0]?.text;

  return (
    <Card>
      <form onSubmit={sendMessage} className="flex flex-col gap-4">
        <Heading level={2}>Agent chat (via AgentBase A2A proxy)</Heading>

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

        {answer !== undefined && (
          <div className="rounded-lg border border-border bg-surface p-3">
            <Text type="supporting">Agent response</Text>
            <Text as="p">{answer || '(no text content)'}</Text>
          </div>
        )}
      </form>
    </Card>
  );
}
