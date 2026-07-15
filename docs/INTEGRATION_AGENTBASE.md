# INTEGRATION_AGENTBASE.md — How Precast fits with AgentBase

> **What this is.** A verified integration note describing how an agent built on the **Precast** boilerplate (Mastra API app) is registered and invoked on **AgentBase**. The compatibility claims here were confirmed by booting the Precast `example-agent`, fetching its live A2A card, and running that card through AgentBase's actual registration validator.

**Last Updated:** 2026-07-07
**Status:** Verified against Precast `apps/api` (Mastra `@mastra/core@1.49`) and AgentBase `apps/api` (A2A registry).

---

## 1. TL;DR

- **Yes — a Precast Mastra agent registers on AgentBase with no code changes**, only deployment/config work.
- The two systems speak the **same protocol family**: **A2A 0.3.x, JSON-RPC 2.0 over HTTP**. Mastra ships it natively (`@a2a-js/sdk@0.3.13`); AgentBase's registry is built around it.
- AgentBase already carries a **Mastra-shaped compatibility shim** in its card validator — it explicitly names A2A 0.3.0 (Mastra's dialect) as the case it normalizes.
- The work to connect them is **operational**, not code: deploy Mastra reachably (TLS), `POST /agents` to AgentBase with the card URL, then approve the synced skills.

---

## 2. The two sides

### 2.1 Precast — produces the agent

Precast's `apps/api` is a **Mastra** app. A running instance exposes (default port **4111**, `MASTRA_PORT`):

| Purpose                    | Endpoint                                        | Protocol                                       |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| A2A agent card (discovery) | `GET /api/.well-known/:agentId/agent-card.json` | A2A 0.3.0 card JSON                            |
| A2A invocation             | `POST /api/a2a/:agentId`                        | JSON-RPC 2.0 over HTTP                         |
| Mastra-native invocation   | `POST /agents/:agentId/messages`                | Mastra REST (`{text, threadId?, resourceId?}`) |
| Agent listing              | `GET /api/agents`                               | Mastra-native JSON                             |
| Studio playground          | `/`                                             | Browser UI                                     |

Key facts:

- **Agents** are defined in `apps/api/src/mastra/index.ts` and identified by `id` (e.g. `example-agent`).
- **Skills = tools.** Each Mastra tool becomes one A2A skill in the card (tag `"tool"`). An agent with no tools still registers (AgentBase synthesizes a fallback `chat` skill).
- **Auth is off by default** in the boilerplate — the card declares no security schemes.
- **Direct A2A access with a bearer token.** Any A2A client (JSON-RPC 2.0) can invoke the agents directly at `POST /api/a2a/:agentId` by sending `Authorization: Bearer <token>`, where the token **must match the server's `AGENT_API_TOKEN`**. When `AGENT_API_TOKEN` is set, `/api/a2a/*` and `/api/agents/*` reject any request without that exact bearer (401); when unset, they are open (local dev). AgentBase is one such client — it injects the token when proxying (§7) — but external clients can call the agents directly with the same token. Studio (`/`) and card discovery stay open regardless.
- Card is emitted in **A2A 0.3.0 shape**: top-level `url`, `additionalInterfaces`, `capabilities`, `defaultInputModes` / `defaultOutputModes`, `skills`.

### 2.2 AgentBase — hosts the registry + proxy

AgentBase **does not host external agents**; it registers external agent _endpoints_ and proxies calls to them. An "Agent" is an A2A-defined registry entry (identity + endpoint + capabilities + skills), distinct from any auth subject.

- **Register:** `POST /agents` (see §4).
- **Invoke at runtime:** `POST /a2a` — AgentBase validates the caller, resolves the target agent + skill, injects the agent's declared credential, **strips the inbound caller auth (zero-trust)**, forwards to the agent's service endpoint, streams the response back, and writes an audit record.
- Registration is gated by the A2A card schema `a2aAgentCardSchema` (in `@agentbase/mcp`), with a normalizer in `apps/api/src/sync/a2a/agentCard.validator.ts`.

---

## 3. Why they fit — the protocol match

```
        PRECAST (Mastra app, :4111)                 AGENTBASE (registry + proxy, :8028)
        ┌───────────────────────────┐               ┌────────────────────────────────────┐
        │ Agent (example-agent)      │               │  POST /agents  (register)            │
        │                            │  card URL     │    ├─ fetch card                     │
        │ GET /api/.well-known/      │◀──────────────┤    ├─ validateAgentCard()            │
        │   :id/agent-card.json      │               │    │    └─ normalize A2A 0.3.0 shim   │
        │                            │               │    ├─ derive serviceEndpointUrl      │
        │ POST /api/a2a/:id          │◀──────────────┤    └─ materialize skills (DRAFT)     │
        │   (JSON-RPC 2.0)           │  proxied call │                                      │
        └───────────────────────────┘  POST /a2a ──▶│  inject cred · strip inbound · audit │
                                                     └────────────────────────────────────┘
```

Contract-by-contract:

| Contract point      | Precast Mastra emits                                              | AgentBase requires                        | Fit                    |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------------- | ---------------------- |
| Wire protocol       | A2A 0.3.0, JSON-RPC 2.0 / HTTP                                    | A2A card + `/a2a` proxy                   | ✅ native              |
| Agent card location | `GET /api/.well-known/:id/agent-card.json`                        | any `agentCardUrl`, or inline `agentCard` | ✅                     |
| Card shape          | top-level `url`, `additionalInterfaces`, no `supportedInterfaces` | `supportedInterfaces[]` (earlier draft)   | ✅ via normalizer shim |
| Service endpoint    | `POST /api/a2a/:id` (in card `url`)                               | `serviceEndpointUrl` derived from card    | ✅ auto-derived        |
| Skills              | 1 per tool, tag `"tool"`                                          | ≥1 skill w/ ≥1 tag (else synthesized)     | ✅                     |
| Auth                | None (default)                                                    | `declaredAuthScheme: None` supported      | ✅                     |

**The shim that makes it seamless:** AgentBase's `normalizeAgentCard()` maps the Mastra/A2A-0.3.0 card (top-level `url` + `additionalInterfaces`, no `supportedInterfaces`) into the internal `supportedInterfaces[]` shape, and synthesizes a `chat` skill if the card declares none. Its own code comment names Mastra 0.3.0 as the target case.

---

## 4. How to register a Precast agent on AgentBase

### Step 1 — Deploy the Mastra app reachably

The card's `url` must be reachable by AgentBase's proxy. For real cross-service use, terminate TLS in front so the card advertises an `https://` endpoint. (The schema accepts `http` URLs, so local wiring works, but production should be HTTPS.)

### Step 2 — Register the agent

`POST /agents` to AgentBase with **either** the card URL **or** an inline card:

```jsonc
// URL-first (recommended)
{
  "name": "My Agent",
  "version": "1.0",
  "agentCardUrl": "https://<host>/api/.well-known/my-agent/agent-card.json",
  "declaredAuthScheme": "None", // set to match the agent's real auth
}
```

Required: `name`, `version`, and **one of** `agentCardUrl` / `agentCard`. `serviceEndpointUrl` is optional — AgentBase derives it from the card's `url`.

### Step 3 — AgentBase syncs the card

On create, AgentBase's sync service fetches the card, runs `validateAgentCard` (with the 0.3.0 normalizer), stores the derived `serviceEndpointUrl`, and materializes the agent's **skills**.

### Step 4 — Approve skills

Synced skills land as **`DRAFT`**. Only **`APPROVED`** skills are invocable through the proxy — move them via AgentBase's governance flow.

### Step 5 — Invoke via the proxy

Callers hit `POST /a2a` on AgentBase (with a slug + skill id). AgentBase injects the declared credential, strips the caller's inbound auth, and forwards a JSON-RPC request to the Mastra `POST /api/a2a/:id` endpoint.

---

## 5. Verification evidence

Confirmed on 2026-07-07 by running the real card through AgentBase's real validator:

```
VALID ✅ — precast Mastra card passes AgentBase a2aAgentCardSchema
→ serviceEndpointUrl (derived): http://<host>/api/a2a/example-agent
→ protocolBinding: JSONRPC
→ skills: exampleTool [tool]
```

The live Precast `example-agent` card (abridged):

```jsonc
{
  "name": "example-agent",
  "url": "http://<host>/api/a2a/example-agent",
  "provider": { "organization": "Mastra", "url": "https://mastra.ai" },
  "version": "1.0",
  "protocolVersion": "0.3.0",
  "capabilities": { "streaming": true, "pushNotifications": true },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [{ "id": "exampleTool", "name": "exampleTool", "tags": ["tool"], "description": "…" }],
}
```

---

## 6. Caveats (not blockers)

- **HTTPS + reachability (deployment).** The card's `url` must be reachable by AgentBase; production wants TLS. The boilerplate serves plain `http://0.0.0.0:4111`.
- **Skills are only as good as your tools.** Mastra maps each tool → one A2A skill. Define meaningful tools; the placeholder exposes only `exampleTool`.
- **Skills start `DRAFT`.** Governance requires promoting to `APPROVED` before proxy invocation — a process step, not a compatibility gap.
- **Auth in production.** Precast ships auth-off. If you add Keycloak/Bearer to the Mastra server, register with the matching `declaredAuthScheme` + a `credentialRef`. AgentBase supports `Bearer`, `ApiKey`, `Basic`, `None`, `OAuth2ClientCredentials`; plain `OAuth2` and `mTLS` currently return `501` in the proxy.

---

## 7. Next ↔ Mastra wiring

Precast ships a **Next.js** app (`apps/web`) that talks to Mastra agents **only through its server-side route handler / `callAgent()` util** — client code never calls Mastra. The transport is selected by the `ENABLE_AGENTBASE` env flag, and **AgentBase is the default** (guard rail — a missing flag proxies through the audited path, not directly at Mastra):

```
ENABLE_AGENTBASE=1 or unset  (proxy mode — DEFAULT)
┌─────────┐  POST /api/a2a/:id   ┌────────────┐  POST /a2a (tasks/send)   ┌──────────┐
│  Next   │ ────────────────────▶│  AgentBase  │ ─────────────────────────▶│  Mastra  │
│ (React) │  (route handler)     │  (proxy)    │  Bearer AGENTBASE→AGENT   │ (agents) │
└─────────┘                      └────────────┘                           └──────────┘

ENABLE_AGENTBASE=0  (direct mode — explicit opt-out)
┌─────────┐  POST /api/a2a/:id   ┌──────────────────────────────────────────────────┐
│  Next   │ ────────────────────▶│ Mastra  POST $MASTRA_INTERNAL_URL/api/a2a/:id     │
│ (React) │  (route handler)     │ A2A message/send · Bearer AGENT_API_TOKEN         │
└─────────┘                      └──────────────────────────────────────────────────┘
```

### 7.1 Routing

| Layer                        | Route                                        | Description                                                        |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| **Client component**         | `POST /api/a2a/:agentId`                     | Client sends message → route handler                               |
| **Next.js route handler**    | `POST /api/a2a/:agentId`                     | Validates input, calls `callAgent()`, returns a normalized reply   |
| **Server util**              | `callAgent()`                                | Branches on `ENABLE_AGENTBASE` (see modes below)                   |
| **Proxy mode** (default, ≠0) | `POST $AGENTBASE_URL/a2a`                    | JSON-RPC `tasks/send` + `params.agentId`; `Bearer AGENTBASE_TOKEN` |
| **Direct mode** (`=0`)       | `POST $MASTRA_INTERNAL_URL/api/a2a/:agentId` | A2A `message/send`; `Bearer AGENT_API_TOKEN`                       |

`callAgent()` returns a normalized `{ ok, text, error?, via, raw }` so the UI is independent of each mode's wire format (AgentBase and Mastra return different response shapes). Direct mode speaks A2A 0.3.0 (`message/send` with a `Message` envelope — Mastra rejects the older `tasks/send`); proxy mode uses AgentBase's `tasks/send` contract. **Guard rail:** if AgentBase mode is active but `AGENTBASE_URL` is unset or still the `example.com` placeholder, `callAgent()` returns an error reply telling you to configure it or set `ENABLE_AGENTBASE=0`.

> **Multi-agent routing.** `POST /api/a2a/:agentId` is per-agent: the route handler reads `:agentId`. In direct mode it's the Mastra URL path; in proxy mode `callAgent()` forwards it into `params.agentId`. Registering more agents on the Mastra instance (`agents: { … }` in `apps/api/src/mastra/index.ts`) is all the API-side work — each one auto-serves its own card at `/api/.well-known/:id/agent-card.json`. In proxy mode, every agent must also be registered separately on AgentBase (§4) with its own `agentCardUrl`.

### 7.2 Files

- `apps/web/app/lib/a2a-client.ts` — `callAgent()` util; branches on `ENABLE_AGENTBASE` (proxy vs direct) and normalizes the reply
- `apps/web/app/api/a2a/[agentId]/route.ts` — Next.js route handler exposed to the frontend
- `apps/web/app/AgentChat.tsx` — client component with an agent chat input (shows which transport handled the reply)
- Env: `ENABLE_AGENTBASE` (toggle), `MASTRA_INTERNAL_URL` (direct base), `AGENTBASE_URL`/`AGENTBASE_TOKEN` (proxy), `AGENT_API_TOKEN` (Mastra bearer)

### 7.3 Configuration

```bash
# .env (or environment)
AGENTBASE_URL=https://agentbase.example.com
AGENTBASE_TOKEN=          # optional; off when unset
```

### 7.4 Usage from a client component

```typescript
const res = await fetch('/api/a2a/example-agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Hello, agent!' }),
});
const data = await res.json();
```

### 7.5 Auth flow

Mastra protects its A2A/agent routes with a static bearer (`AGENT_API_TOKEN`) — enforced when set, open when unset (local dev). Studio (`/`) and card discovery stay open. The token that reaches Mastra depends on the mode:

**Proxy mode (`ENABLE_AGENTBASE=1`):**

```
Next route handler → POST $AGENTBASE_URL/a2a
  ↓  (sends AGENTBASE_TOKEN)
AgentBase proxy
  ↓  (validates caller, strips inbound auth, injects AGENT_API_TOKEN)
Mastra agent → POST /api/a2a/:agentId  (verifies Bearer <AGENT_API_TOKEN>)
```

**Direct mode (default):**

```
Next route handler → POST $MASTRA_INTERNAL_URL/api/a2a/:agentId
  ↓  (sends Authorization: Bearer <AGENT_API_TOKEN>)
Mastra agent  (verifies Bearer <AGENT_API_TOKEN>)
```

| Mode   | Token the web app sends                | Reaches Mastra as                   |
| ------ | -------------------------------------- | ----------------------------------- |
| Proxy  | `AGENTBASE_TOKEN` (to AgentBase)       | AgentBase injects `AGENT_API_TOKEN` |
| Direct | `AGENT_API_TOKEN` (straight to Mastra) | `AGENT_API_TOKEN`                   |

**Key points:**

- In **proxy** mode the web app never knows `AGENT_API_TOKEN` — AgentBase strips inbound auth (zero-trust) and injects the agent's declared credential.
- In **direct** mode the web app holds `AGENT_API_TOKEN` and sends it as the bearer itself.
- When `AGENT_API_TOKEN` is unset in the Mastra environment, auth is off (open for local dev).

### 7.6 Configuration

```bash
# .env (or environment) — Mastra side
AGENT_API_TOKEN=your-secret-token

# .env (or environment) — Next side
ENABLE_AGENTBASE=1                              # default (proxy); set 0 for direct A2A
MASTRA_INTERNAL_URL=http://localhost:4111       # direct-mode Mastra base URL
AGENTBASE_URL=https://agentbase.example.com     # proxy mode (required when enabled)
AGENTBASE_TOKEN=your-agentbase-token            # proxy mode only
```

### 7.7 Design rule

> **The web app must reach Mastra only through its server-side route handler / `callAgent()` util — never from client code.** That util is the single switch point: with `ENABLE_AGENTBASE=1` it proxies through AgentBase (auth, audit, zero-trust forwarding); otherwise it calls Mastra directly over A2A with the `AGENT_API_TOKEN` bearer.

### 7.8 Related: Mastra → AgentBase registration

The second integration axis — registering the Mastra agent itself on AgentBase so it's discoverable and invocable — is independent of the Next wiring and follows the flow in §4.

---

## 8. Source references

**Precast** (`/apps/api`)

- `src/mastra/index.ts` — Mastra instance + server config (host/port)
- `src/mastra/agents/example-agent.ts` — agent definition (`id`, tools)
- A2A routes come from `@mastra/server` (`/api/a2a/:agentId`, `/api/.well-known/:agentId/agent-card.json`)

**AgentBase** (`/apps/api`)

- `src/agents/agents.dto.ts` — `createAgentSchema` (registration payload)
- `src/agents/agents.service.ts` — `create()` → `a2aSyncService.syncAgent()`
- `src/sync/a2a/agentCard.validator.ts` — `validateAgentCard()` + `normalizeAgentCard()` (the A2A 0.3.0 shim)
- `src/sync/a2a/a2a-sync.service.ts` — fetch → validate → derive endpoint → materialize skills
- `packages/mcp/src/a2a/agentCard.schema.ts` — `a2aAgentCardSchema`
- `src/proxy/*` — `POST /a2a` invocation proxy (credential injection, zero-trust, audit)
