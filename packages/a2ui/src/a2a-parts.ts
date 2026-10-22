import { A2UI_MIME_TYPE } from './protocol.js';

/**
 * A2UI on the A2A wire, for both protocol versions an agent server may speak:
 *
 *   0.3  parts carry a `kind` discriminator: `{ kind: 'data', data, metadata }`
 *   1.0  parts have no `kind`; the member present says what it is: `{ data, mediaType, metadata }`
 *
 * Framework-free on purpose: the same helpers serve a Mastra middleware, an A2A proxy, or a test.
 */
export type A2aWire = '0.3' | '1.0';

type Part = Record<string, unknown>;
type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** The wire a request asked for, from its `A2A-Version` header (absent → 0.3). */
export function a2aWireFromHeader(value: string | null | undefined): A2aWire {
  return value?.trim() === '1.0' ? '1.0' : '0.3';
}

export function isDataPart(part: unknown): boolean {
  if (!isObject(part)) return false;
  if (part.kind !== undefined) return part.kind === 'data';
  return 'data' in part && !('text' in part) && !('raw' in part) && !('url' in part);
}

export function isA2uiPart(part: unknown): boolean {
  if (!isDataPart(part)) return false;
  const p = part as Part;
  const meta = isObject(p.metadata) ? p.metadata : {};
  return meta.mimeType === A2UI_MIME_TYPE || p.mediaType === A2UI_MIME_TYPE;
}

function textOf(part: unknown): string | null {
  if (!isObject(part)) return null;
  if (part.kind !== undefined && part.kind !== 'text') return null;
  return typeof part.text === 'string' ? part.text : null;
}

/** One data part holding a list of A2UI server-to-client messages. */
export function a2uiDataPart(messages: unknown[], wire: A2aWire): Part {
  const metadata = { mimeType: A2UI_MIME_TYPE };
  return wire === '1.0'
    ? { data: messages, mediaType: A2UI_MIME_TYPE, metadata }
    : { kind: 'data', metadata, data: messages };
}

/**
 * The part list a reply's text sits in, for either wire and either result kind:
 * the last artifact of a task, else a message's own parts, else the task's status message.
 */
function replyParts(result: unknown): unknown[] | null {
  if (!isObject(result)) return null;
  const r = isObject(result.task)
    ? result.task
    : isObject(result.message)
      ? result.message
      : result;
  const artifacts = Array.isArray(r.artifacts) ? r.artifacts : [];
  const last = artifacts[artifacts.length - 1];
  if (isObject(last)) {
    if (!Array.isArray(last.parts)) last.parts = [];
    return last.parts as unknown[];
  }
  if (Array.isArray(r.parts)) return r.parts;
  const status = isObject(r.status) ? r.status : null;
  if (status && isObject(status.message)) {
    if (!Array.isArray(status.message.parts)) status.message.parts = [];
    return status.message.parts as unknown[];
  }
  return null;
}

/**
 * Append `part` to a JSON-RPC success response, in place. Returns false, and changes nothing,
 * for an error response or a result with nowhere to put it.
 */
export function attachPartToReply(payload: unknown, part: Part): boolean {
  if (!isObject(payload) || payload.error) return false;
  const parts = replyParts(payload.result);
  if (!parts) return false;
  parts.push(part);
  return true;
}

const MAX_REPLY_MESSAGES = 100;
const MAX_REPLY_JSON = 64_000;

/** Every part list a reply carries: each artifact, a message's parts, the status message. */
function allReplyParts(result: unknown): unknown[] {
  if (!isObject(result)) return [];
  const r = isObject(result.task)
    ? result.task
    : isObject(result.message)
      ? result.message
      : result;
  const lists: unknown[][] = [];
  for (const a of Array.isArray(r.artifacts) ? r.artifacts : []) {
    if (isObject(a) && Array.isArray(a.parts)) lists.push(a.parts);
  }
  if (Array.isArray(r.parts)) lists.push(r.parts);
  const status = isObject(r.status) ? r.status : null;
  if (status && isObject(status.message) && Array.isArray(status.message.parts)) {
    lists.push(status.message.parts);
  }
  return lists.flat();
}

/**
 * The A2UI server-to-client messages in a JSON-RPC reply, in order, for either wire. Bounded so a
 * runaway agent cannot push an unbounded payload at a browser: past the limits, the rest is
 * dropped. Returns [] for an error, or a reply with no A2UI.
 */
export function a2uiMessagesFromReply(payload: unknown): unknown[] {
  if (!isObject(payload) || payload.error) return [];
  const out: unknown[] = [];
  let size = 0;
  for (const part of allReplyParts(payload.result)) {
    if (!isA2uiPart(part)) continue;
    const data = (part as Part).data;
    for (const message of Array.isArray(data) ? data : [data]) {
      if (!isObject(message)) continue;
      size += JSON.stringify(message).length;
      if (out.length >= MAX_REPLY_MESSAGES || size > MAX_REPLY_JSON) return out;
      out.push(message);
    }
  }
  return out;
}

// ── Inbound ─────────────────────────────────────────────────────────────────

const ACTION_NAME = /^[a-zA-Z0-9._:-]{1,64}$/;
const MAX_CONTEXT_JSON = 4000;
const MAX_ID = 128;

export interface PressAction {
  name: string;
  value?: string;
  surfaceId?: string;
  sourceComponentId?: string;
  context?: unknown;
}

/**
 * One press, keeping only known, bounded fields, or null when it has no valid name. Accepts both
 * the catalog's own `{ name, value }` and A2UI's dispatched `{ name, context, surfaceId, ... }`.
 */
export function readPressAction(action: unknown): PressAction | null {
  if (!isObject(action) || typeof action.name !== 'string' || !ACTION_NAME.test(action.name)) {
    return null;
  }
  const press: PressAction = { name: action.name };
  if (typeof action.value === 'string') press.value = action.value.slice(0, 2000);
  for (const key of ['surfaceId', 'sourceComponentId'] as const) {
    const v = action[key];
    if (typeof v === 'string' && v.length <= MAX_ID) press[key] = v;
  }
  if (action.context !== undefined) {
    const json = JSON.stringify(action.context);
    if (json && json.length <= MAX_CONTEXT_JSON) press.context = action.context;
  }
  return press;
}

/** The actions an A2UI client-to-server data part reports. */
function actionsOf(part: Part): PressAction[] {
  const data = part.data;
  const items = Array.isArray(data) ? data : [data];
  return items
    .map((item) => (isObject(item) ? readPressAction(item.action) : null))
    .filter((p): p is PressAction => p !== null);
}

/**
 * The text an agent receives for a press. The values stay inside a JSON block rather than being
 * woven into the sentence, so a value written to look like an instruction stays a value.
 */
export function pressText(action: PressAction): string {
  return [
    'A control on a card you sent earlier was used. This is a press on your card, not a new ' +
      'message to analyse: do what that control offers, using the name, value and context below.',
    '```json',
    JSON.stringify({ a2ui: { action } }),
    '```',
  ].join('\n');
}

export interface InboundResult {
  body: unknown;
  /** Data parts removed. */
  dropped: number;
  /** A2UI presses turned into text, because the message had no text of its own. */
  converted: number;
}

/**
 * Make an inbound A2A request safe for a runtime that rejects data parts (Mastra fails the whole
 * turn on one). A2UI presses become a text part when the message has no text, since a client
 * that also wrote text, as Raya does, already said the same thing there. Every other data part is
 * dropped. Returns the body unchanged, by identity, when there is nothing to do.
 */
export function prepareInboundMessage(body: unknown): InboundResult {
  const params = isObject(body) && isObject(body.params) ? body.params : null;
  const message = params && isObject(params.message) ? params.message : null;
  if (!message || !Array.isArray(message.parts)) return { body, dropped: 0, converted: 0 };
  const parts = message.parts as unknown[];
  if (!parts.some(isDataPart)) return { body, dropped: 0, converted: 0 };

  const hasText = parts.some((p) => (textOf(p) ?? '').trim().length > 0);
  const out: unknown[] = [];
  let dropped = 0;
  let converted = 0;
  for (const part of parts) {
    if (!isDataPart(part)) {
      out.push(part);
      continue;
    }
    const p = part as Part;
    const presses = !hasText && isA2uiPart(p) ? actionsOf(p) : [];
    for (const action of presses) {
      out.push(
        p.kind === undefined
          ? { text: pressText(action) }
          : { kind: 'text', text: pressText(action) },
      );
      converted++;
    }
    if (!presses.length) dropped++;
  }
  const next = { ...(body as Json), params: { ...params, message: { ...message, parts: out } } };
  return { body: next, dropped, converted };
}
