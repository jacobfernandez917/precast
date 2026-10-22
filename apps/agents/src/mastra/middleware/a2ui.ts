import {
  a2aWireFromHeader,
  a2uiAgentCardExtension,
  a2uiDataPart,
  A2UI_EXTENSION_URI,
  attachPartToReply,
  clientAcceptsCatalog,
  prepareInboundMessage,
  SHOW_CARD_TOOL,
} from '@precast/a2ui';
import { takePendingCard } from '../lib/request-context';

/**
 * A2UI for Mastra's A2A server, which has no hook for either half of it:
 *
 *  1. **Inbound.** Mastra fails the whole turn on any `data` part ("Data parts are not supported
 *     in core messages", still true in 1.78), and an A2UI button press arrives as one. A press with
 *     no text of its own becomes a text message; every other data part is dropped. AgentBase does
 *     the same in its proxy, so this matters most on the direct transport.
 *  2. **Outbound.** `show_card` holds a card in the request context; after Mastra answers, the card
 *     is appended to the reply as one `application/a2ui+json` data part, in the form the caller's
 *     A2A version expects (0.3 or 1.0, from `A2A-Version`).
 *  3. **Discovery.** An agent whose card lists the `show_card` skill also lists the A2UI
 *     extension, so a client knows to send its capabilities.
 *
 * Must run INSIDE the auth middleware: it reads the per-request store that one opens.
 *
 * Covers `message/send`. A streamed reply (`message/stream`, SSE) is passed through as Mastra sent
 * it and its card is dropped, and so is a non-blocking send whose answer arrives later.
 */

/** Minimal slice of Hono's Context we rely on (avoids a direct `hono` dep). */
interface A2uiContext {
  req: {
    header: (name: string) => string | undefined;
    path: string;
    method: string;
    raw: Request;
    bodyCache: Record<string, unknown>;
  };
  res: Response;
}

type Logger = {
  warn: (msg: string, meta?: unknown) => void;
  debug?: (msg: string, meta?: unknown) => void;
};

const isA2aExecution = (c: A2uiContext) =>
  c.req.method === 'POST' && /^\/api\/a2a\/[^/]+\/?$/.test(c.req.path);

const isAgentCard = (c: A2uiContext) =>
  c.req.method === 'GET' &&
  c.req.path.startsWith('/api/.well-known/') &&
  c.req.path.endsWith('/agent-card.json');

const isJson = (res: Response) =>
  (res.headers.get('content-type') ?? '').toLowerCase().includes('application/json');

function replaceResponse(c: A2uiContext, body: unknown, extraHeaders?: Record<string, string>) {
  const headers = new Headers(c.res.headers);
  headers.delete('content-length'); // body length changed after the rewrite
  for (const [k, v] of Object.entries(extraHeaders ?? {})) headers.set(k, v);
  c.res = new Response(JSON.stringify(body), { status: c.res.status, headers });
}

/** Swap the request body Mastra is about to read. Hono serves `c.req.json()` from `bodyCache`. */
function replaceRequestBody(c: A2uiContext, body: unknown) {
  const raw = c.req.raw;
  const headers = new Headers(raw.headers);
  headers.delete('content-length');
  c.req.raw = new Request(raw.url, { method: raw.method, headers, body: JSON.stringify(body) });
  c.req.bodyCache = {};
}

async function readJson(c: A2uiContext): Promise<unknown> {
  try {
    return JSON.parse(await c.req.raw.clone().text());
  } catch {
    return undefined;
  }
}

async function advertiseOnCard(c: A2uiContext, log: Logger) {
  if (c.res.status !== 200 || !isJson(c.res)) return;
  let card: Record<string, unknown>;
  try {
    card = (await c.res.clone().json()) as Record<string, unknown>;
  } catch {
    return;
  }
  const skills = Array.isArray(card.skills) ? (card.skills as Array<{ id?: unknown }>) : [];
  if (!skills.some((s) => s?.id === SHOW_CARD_TOOL)) return;
  // A signed card would fail verification once edited; leave it as signed.
  if (Array.isArray(card.signatures) && card.signatures.length) {
    log.warn('A2UI extension not advertised: the agent card is signed');
    return;
  }
  const caps = (card.capabilities ?? {}) as { extensions?: Array<{ uri?: string }> };
  const extensions = Array.isArray(caps.extensions) ? caps.extensions : [];
  if (extensions.some((e) => e?.uri === A2UI_EXTENSION_URI)) return;
  card.capabilities = { ...caps, extensions: [...extensions, a2uiAgentCardExtension()] };
  replaceResponse(c, card);
}

export function createA2uiMiddleware(log: Logger = console) {
  return async (c: A2uiContext, next: () => Promise<void>): Promise<Response | void> => {
    if (isAgentCard(c)) {
      await next();
      await advertiseOnCard(c, log);
      return;
    }
    if (!isA2aExecution(c)) return next();

    const wire = a2aWireFromHeader(c.req.header('A2A-Version'));
    const body = await readJson(c);
    const metadata = (body as { params?: { message?: { metadata?: unknown } } } | undefined)?.params
      ?.message?.metadata;

    const inbound = prepareInboundMessage(body);
    if (inbound.body !== body) {
      replaceRequestBody(c, inbound.body);
      log.debug?.('A2UI inbound data parts handled', {
        converted: inbound.converted,
        dropped: inbound.dropped,
      });
    }

    // A card left over from an earlier turn cannot exist (the store is per request), but take it
    // anyway so this turn only ever attaches what this turn drew.
    takePendingCard();
    await next();
    const card = takePendingCard();
    if (!card) return;

    if (!isJson(c.res)) {
      log.warn('A2UI card dropped: cards attach to message/send replies only, not streams');
      return;
    }
    if (!clientAcceptsCatalog(metadata)) return;

    let payload: unknown;
    try {
      payload = await c.res.clone().json();
    } catch {
      return;
    }
    if (!attachPartToReply(payload, a2uiDataPart(card, wire))) return;
    replaceResponse(c, payload, { 'X-A2A-Extensions': A2UI_EXTENSION_URI });
  };
}

export const a2uiMiddleware = createA2uiMiddleware();
