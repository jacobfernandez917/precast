'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { A2aTransport } from './lib/a2a-client';
import { createConversationGate, interpretRouteReply } from './lib/chat-turns';
import type { CardPress } from './a2ui/AgentCards';

// Client-only: `@a2ui/react` extends HTMLElement at import, which has no server equivalent.
const AgentCards = dynamic(() => import('./a2ui/AgentCards').then((m) => m.AgentCards), {
  ssr: false,
});

/**
 * Agent chat demo — sends a message to a Mastra agent through the
 * `/api/a2a/:agentId` route handler, which either proxies via AgentBase or
 * calls the local agents app directly (per `PRECAST_LOCAL_AGENTS`). The agent id is
 * editable so the demo proves multi-agent routing.
 *
 * MEMORY: the route handler returns a `conversationId`; sending it back on the
 * next turn keeps the agent in the same thread, so it remembers what was said.
 * The browser never sees or sets the `resourceId` that scopes that memory —
 * that is derived server-side from the signed-in account (see
 * `app/lib/agent-context.ts`). Starting a new conversation drops the id and the
 * agent begins a fresh thread — though anything it recorded in working memory
 * follows the user across threads, which is the visible difference between the
 * two kinds of memory.
 *
 * CARDS: a reply may carry A2UI messages (`AgentReply.a2ui`), drawn under the
 * text by `AgentCards`. A press on a card posts `{ action }` to the same route,
 * which sends it to the agent as text on the same thread, so the agent answers
 * the press like any other turn.
 *
 * START OVER while a turn is in flight: the agent keeps working (the browser
 * cannot stop it), and its answer belongs to the cleared conversation. A turn
 * that finishes after a reset changes nothing here, typed message or card press
 * alike (see `lib/chat-turns.ts`).
 *
 * SCROLLING: the card fills the screen, the turns scroll inside it, and the
 * message box stays at its bottom. A new turn brings the log to its end. Cards
 * load client-side and grow a turn after it lands, so the log follows that
 * growth too, unless the reader has scrolled up to read.
 */
interface Turn {
  question: string;
  answer: string;
  a2ui: unknown[];
  via: A2aTransport;
}

export function AgentChat() {
  const [agentId, setAgentId] = useState('example-agent');
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const gate = useRef(createConversationGate());
  const logRef = useRef<HTMLDivElement>(null);
  const followEnd = useRef(true);

  useEffect(() => {
    followEnd.current = true;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns]);

  useEffect(() => {
    const log = logRef.current;
    const content = log?.firstElementChild;
    if (!log || !content) return;
    const onScroll = () => {
      followEnd.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    };
    const growth = new ResizeObserver(() => {
      if (followEnd.current) log.scrollTop = log.scrollHeight;
    });
    log.addEventListener('scroll', onScroll);
    growth.observe(content);
    return () => {
      log.removeEventListener('scroll', onScroll);
      growth.disconnect();
    };
  }, []);

  function startNewConversation() {
    gate.current.reset();
    setConversationId(null);
    setTurns([]);
    setError(null);
    // The new conversation is not waiting on anything; the old turn's answer, if
    // it ever arrives, is dropped by the gate.
    setIsSending(false);
  }

  /** One turn: `body` is either `{ text }` or `{ action }`; `question` is what the log shows. */
  async function sendTurn(body: Record<string, unknown>, question: string): Promise<boolean> {
    if (isSending) return false;
    const token = gate.current.begin();
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/a2a/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only the conversation id travels from the browser. Identity is the
        // server's business — sending a resourceId from here would be the bug
        // this whole seam exists to prevent.
        body: JSON.stringify({ ...body, ...(conversationId ? { conversationId } : {}) }),
      });
      const outcome = interpretRouteReply(res.status, await res.text());
      if (!gate.current.isCurrent(token)) return false;

      // Adopt the server's id even on a failed turn, so a retry stays in thread.
      if (outcome.conversationId) setConversationId(outcome.conversationId);
      if (outcome.kind === 'error') {
        setError(outcome.error);
        return false;
      }
      setTurns((prev) => [
        ...prev,
        { question, answer: outcome.answer, a2ui: outcome.a2ui, via: outcome.via },
      ]);
      return true;
    } catch {
      if (gate.current.isCurrent(token)) setError('Could not reach the server. Try again.');
      return false;
    } finally {
      if (gate.current.isCurrent(token)) setIsSending(false);
    }
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const question = message.trim();
    if (!question) return;
    if (await sendTurn({ text: question }, question)) setMessage('');
  }

  async function sendPress(press: CardPress): Promise<void> {
    const label = typeof press.context.label === 'string' ? press.context.label : press.name;
    const selection =
      typeof press.context.selection === 'string' ? ` · ${press.context.selection}` : '';
    await sendTurn({ action: press }, `Pressed ${label}${selection}`);
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={sendMessage} className="flex min-h-0 flex-1 flex-col gap-4">
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

        <div
          ref={logRef}
          role="log"
          aria-label="Conversation"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="flex flex-col gap-3">
            {turns.map((turn, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
                  <Text type="supporting">You</Text>
                  <Text as="p">{turn.question}</Text>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                  <Text type="supporting">
                    Agent · {turn.via === 'agentbase' ? 'via AgentBase proxy' : 'direct A2A'}
                  </Text>
                  <Text as="p">{turn.answer}</Text>
                  {turn.a2ui.length > 0 && <AgentCards messages={turn.a2ui} onPress={sendPress} />}
                </div>
              </div>
            ))}
            {turns.length > 0 && (
              <Text type="supporting">
                This agent remembers the turns above. Tell it your name, start over, then ask for it
                — the thread resets, but what it saved about you carries across. Ask for a card to
                see buttons it can draw.
              </Text>
            )}
          </div>
        </div>

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
