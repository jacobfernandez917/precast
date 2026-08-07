'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { AgentReply } from './lib/a2a-client';

/**
 * Agent chat demo — sends a message to a Mastra agent through the
 * `/api/a2a/:agentId` route handler, which either proxies via AgentBase or
 * calls Mastra directly over A2A (per `ENABLE_AGENTBASE`). The agent id is
 * editable so the demo proves multi-agent routing.
 *
 * MEMORY: the route handler returns a `conversationId`; sending it back on the
 * next turn keeps the agent in the same thread, so it remembers what was said.
 * The browser never sees or sets the `resourceId` that scopes that memory —
 * that is derived server-side from an httpOnly cookie (see
 * `app/lib/agent-context.ts`). Starting a new conversation drops the id and the
 * agent begins a fresh thread — though anything it recorded in working memory
 * follows the user across threads, which is the visible difference between the
 * two kinds of memory.
 */
interface Turn {
  question: string;
  answer: string;
  via: AgentReply['via'];
}

export function AgentChat() {
  const [agentId, setAgentId] = useState('example-agent');
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  function startNewConversation() {
    setConversationId(null);
    setTurns([]);
    setError(null);
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const question = message.trim();
    if (!question || isSending) return;

    setIsSending(true);
    setError(null);

    try {
      const res = await fetch(`/api/a2a/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only the conversation id travels from the browser. Identity is the
        // server's business — sending a resourceId from here would be the bug
        // this whole seam exists to prevent.
        body: JSON.stringify({ text: question, ...(conversationId ? { conversationId } : {}) }),
      });
      // 200 → normalized AgentReply + conversationId; non-2xx → { error: string }.
      const data = (await res.json()) as
        (AgentReply & { conversationId: string }) | { error: string };

      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Request failed');
        return;
      }

      const r = data as AgentReply & { conversationId: string };
      // Adopt the server's id even on a failed turn, so a retry stays in thread.
      setConversationId(r.conversationId);

      if (r.ok) {
        setTurns((prev) => [
          ...prev,
          { question, answer: r.text || '(no text content)', via: r.via },
        ]);
        setMessage('');
      } else {
        setError(r.error ?? 'Agent error');
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
        <div className="flex items-start justify-between gap-4">
          <Heading level={2}>Agent chat (A2A)</Heading>
          {turns.length > 0 && (
            <Button
              label="Start over"
              type="button"
              variant="secondary"
              onClick={startNewConversation}
            />
          )}
        </div>

        <TextInput
          label="Agent"
          value={agentId}
          onChange={setAgentId}
          placeholder="example-agent"
        />

        {turns.length > 0 && (
          <div className="flex flex-col gap-3">
            {turns.map((turn, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="rounded-lg border border-border p-3">
                  <Text type="supporting">You</Text>
                  <Text as="p">{turn.question}</Text>
                </div>
                <div className="rounded-lg border border-border bg-surface p-3">
                  <Text type="supporting">
                    Agent · {turn.via === 'agentbase' ? 'via AgentBase proxy' : 'direct A2A'}
                  </Text>
                  <Text as="p">{turn.answer}</Text>
                </div>
              </div>
            ))}
            <Text type="supporting">
              This agent remembers the turns above. Tell it your name, start over, then ask for it —
              the thread resets, but what it saved about you carries across.
            </Text>
          </div>
        )}

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
      </form>
    </Card>
  );
}
