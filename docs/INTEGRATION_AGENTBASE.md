# INTEGRATION_AGENTBASE.md — How Precast fits with AgentBase

> **What this is.** A verified integration note describing how an agent built on the **Precast** boilerplate (Mastra API app) is registered and invoked on **AgentBase**. The compatibility claims here were confirmed by booting the Precast `example-agent`, fetching its live A2A card, and running that card through AgentBase's actual registration validator.

**Last Updated:** 2026-08-04
**Status:** Verified against Precast `apps/agents` (Mastra `@mastra/core@1.49`) and AgentBase `apps/api` (A2A registry + **SRCIMP repo import**). AgentBase can now **import this repo directly** — clone → build the Dockerfile → host the container → register the agent(s) — in addition to the original register-an-endpoint flow.

---

## 1. TL;DR

- **Yes — a Precast Mastra agent runs on AgentBase with no code changes.** There are now **two** ways in, both zero-code:
  - **Path A — Import from repo (recommended).** AgentBase clones this repo, builds `apps/agents/Dockerfile`, **hosts** the container, mints the inbound bearer, and registers the agent(s) it serves. The repo ships an **`agentbase.import.json`** manifest (see §4A / §5b) that makes it import-ready; a manifest-less repo still works via Precast-convention fallback.
  - **Path B — Connect an external agent (manual).** You deploy the Mastra app yourself and use Studio's **Connect Agent** flow with the card URL. The underlying registration API remains available to Studio (see §4C).
- The two systems speak the **same protocol family**: **A2A 0.3.x, JSON-RPC 2.0 over HTTP**. Mastra ships it natively (`@a2a-js/sdk@0.3.13`); AgentBase's registry is built around it.
- AgentBase already carries a **Mastra-shaped compatibility shim** in its card validator — it explicitly names A2A 0.3.0 (Mastra's dialect) as the case it normalizes.
- Both paths are Studio flows: **Import from Repo** for Path A and **Connect Agent** for Path B. Either way, **no Precast code changes**.

---

## 2. The two sides

### 2.1 Precast — produces the agent

Precast's `apps/agents` is a **Mastra** app. A running instance exposes (default port **45000**, `MASTRA_PORT`):

| Purpose                    | Endpoint                                          | Protocol                                         |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| A2A agent card (discovery) | `GET /api/.well-known/:agentId/agent-card.json`   | A2A 0.3.0 card JSON                              |
| A2A invocation             | `POST /api/a2a/:agentId`                          | JSON-RPC 2.0 over HTTP                           |
| Mastra-native invocation   | `POST /api/agents/:agentId/generate` \| `/stream` | Mastra REST (not used by the web app — A2A only) |
| Agent listing              | `GET /api/agents`                                 | Mastra-native JSON                               |
| Studio playground          | `/`                                               | Browser UI                                       |

Key facts:

- **Agents** are defined in `apps/agents/src/mastra/index.ts` and identified by `id` (e.g. `example-agent`).
- **Skills = tools.** Each Mastra tool becomes one A2A skill in the card (tag `"tool"`). An agent with no tools still registers (AgentBase synthesizes a fallback `chat` skill).
- **Card advertises the auth scheme when enabled.** With `AGENT_API_TOKEN` unset, the agent is public and the card declares no security schemes. When it's set, the boilerplate's server middleware augments the card (Mastra owns the `.well-known` route and offers no hook) to declare a standard bearer scheme — typed with `@a2a-js/sdk` — so discovery is truthful: `securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }` + `security: [{ bearerAuth: [] }]`. (Enforced/advertised by the built server; `mastra dev` runs open.)
- **Direct A2A access with a bearer token.** Any A2A client (JSON-RPC 2.0) can invoke the agents directly at `POST /api/a2a/:agentId` by sending `Authorization: Bearer <token>`, where the token **must match the server's `AGENT_API_TOKEN`**. When `AGENT_API_TOKEN` is set, `/api/a2a/*` and `/api/agents/*` reject any request without that exact bearer (401); when unset, they are open (local dev). AgentBase is one such client — it injects the token when proxying (§7) — but external clients can call the agents directly with the same token. Studio (`/`) and card discovery stay open regardless.
- Card is emitted in **A2A 0.3.0 shape**: top-level `url`, `additionalInterfaces`, `capabilities`, `defaultInputModes` / `defaultOutputModes`, `skills`.

### 2.2 AgentBase — registry + proxy, and (now) host for imported agents

AgentBase is an A2A registry + zero-trust proxy. An "Agent" is an A2A-defined registry entry (identity + endpoint + capabilities + skills), distinct from any auth subject. It relates to an agent's runtime in one of two ways:

- **EXTERNAL (Path B):** AgentBase registers an external agent _endpoint_ you host, and proxies calls to it. It does not run your code.
- **IMPORTED (Path A, new):** AgentBase **hosts** the agent — it clones the repo, builds the Dockerfile, runs the container on its own network + tunnel, and registers the agent(s) that container serves. The direct container URL is AgentBase-internal; callers only ever reach it through the proxy.

Common to both:

- **Invoke at runtime:** `POST /a2a` — AgentBase validates the caller, resolves the target agent + skill, injects the agent's declared credential, **strips the inbound caller auth (zero-trust)**, forwards to the agent's service endpoint, streams the response back, and writes an audit record.
- Registration/sync is gated by the A2A card schema `a2aAgentCardSchema` (in `@agentbase/mcp`), with a normalizer in `apps/api/src/sync/a2a/agentCard.validator.ts`.
- **Import pipeline** (IMPORTED): `apps/api/src/source-imports/` — a VCS-provider abstraction (GitHub App + generic HTTPS git) acquires the source; the composed deployer builds + hosts it; synchronized skills are `APPROVED` by default while preserving any existing status on later sync.

---

## 3. Why they fit — the protocol match

```
        PRECAST (Mastra app, :45000)                 AGENTBASE (registry + proxy, :8028)
        ┌───────────────────────────┐               ┌────────────────────────────────────┐
        │ Agent (example-agent)      │               │  POST /agents  (register)            │
        │                            │  card URL     │    ├─ fetch card                     │
        │ GET /api/.well-known/      │◀──────────────┤    ├─ validateAgentCard()            │
        │   :id/agent-card.json      │               │    │    └─ normalize A2A 0.3.0 shim   │
        │                            │               │    ├─ derive serviceEndpointUrl      │
        │ POST /api/a2a/:id          │◀──────────────┤    └─ materialize skills (APPROVED)  │
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

## 4. How to publish a Precast agent on AgentBase

Two paths. **A is recommended** (AgentBase hosts it for you, straight from the repo); **B** is the original manual flow (you host, AgentBase proxies).

### 4A. Import from repo (recommended — AgentBase hosts it)

No deploy, no `POST /agents`, no reachable URL to stand up — AgentBase does it all from the repo.

1. **Push this repo** to a git host (GitHub, or any HTTPS git remote).
2. In AgentBase Studio → **Agents → Import from Repo**:
   - **GitHub:** add a GitHub App connection from the UI via GitHub's App Manifest flow — on your **personal account** or an **organization** (you own the App; multiple connections supported) — install it on the repo, then pick the repo.
   - **Any git URL:** paste the HTTPS clone URL; for a private repo attach a **VCS Deploy Token** credential.
   - Attach **Variables namespaces** (see §4B), choose an **environment** (Development / Staging / Production or a custom one, from the attached namespaces; default Production), and set a branch/tag.
3. AgentBase reads **`agentbase.import.json`** (§5b), clones the repo, builds `apps/agents/Dockerfile` (repo root as build context), **hosts** the container, injects the chosen environment's values, mints a random inbound bearer into `AGENT_API_TOKEN`, and registers each Mastra agent the container serves. Newly discovered skills are **`APPROVED`** by default; review them before publishing.
4. **Updates are org-initiated** — new commits are _not_ auto-deployed. On the imported agent's edit page, **Pull latest & redeploy** re-clones the ref, rebuilds, redeploys, and rotates the inbound token; **Redeploy in environment** switches which environment's values back the live agent. (Webhook auto-deploy is deliberately out of scope for now.)

The repo needs no changes to be import-ready — Precast ships the manifest and a Dockerfile that already match the contract.

### 4B. Environment variables (Variables → namespaces → environments)

Imported agents get their env from AgentBase **Variables** (Studio → **Variables**), organised as **namespace → environment → variable**:

- A **namespace** (e.g. `Slack Daily Digest`) is a reusable, org-scoped set you attach to an agent at import time (or later).
- Each namespace declares its own **environments** — **Development, Staging, Production** by default, plus any **custom** ones (e.g. `qa`).
- A **variable**'s value is set **per environment** — `DATABASE_URL` in Development and `DATABASE_URL` in Staging are independent values.

An import runs in a **chosen environment** and gets only that environment's values; the agent's active environment (the one backing the live/registry agent) is set at import and switchable with **Redeploy in environment**. Values are encrypted at rest and injected at **build** (`--build-arg`) and/or **runtime** (container env) per each var's scope. Reserved names AgentBase controls — `AGENT_API_TOKEN`, `PORT`, `MASTRA_PORT`, `MASTRA_HOST` — are rejected. You can bulk-load a namespace's environment by pasting or uploading a **`.env`** file in the Variables editor. This is the AgentBase-side home for what your local `.env` holds — keep committing `.env.example` (documentation), never real `.env` values.

### 4C. Connect an external agent (manual — you host, AgentBase proxies)

#### Step 1 — Deploy the Mastra app reachably

The card's `url` must be reachable by AgentBase's proxy. For real cross-service use, terminate TLS in front so the card advertises an `https://` endpoint. (The schema accepts `http` URLs, so local wiring works, but production should be HTTPS.)

#### Step 2 — Register the agent

In Studio, open **Agents → Connect Agent** and provide the Agent Card URL. Inline card JSON is available as a fallback. Studio submits the equivalent registration payload:

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

#### Step 3 — AgentBase syncs the card

On create, AgentBase's sync service fetches the card, runs `validateAgentCard` (with the 0.3.0 normalizer), stores the derived `serviceEndpointUrl`, and materializes the agent's **skills**.

#### Step 4 — Review skills

Newly synchronized skills land as **`APPROVED`**. Review the imported surface and suspend or change the status of any skill that should not be invocable. Later synchronization preserves existing status and deprecates skills that disappear from the Agent Card.

#### Step 5 — Invoke via the proxy

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

## 5b. The import contract (`agentbase.import.json`)

Path A (§4A) reads a manifest at the **repo root**. Precast ships one:

```jsonc
{
  "dockerfile": "apps/agents/Dockerfile", // built with the repo ROOT as context
  "port": 45000, // the container's listen port
  "authEnv": "AGENT_API_TOKEN", // env var AgentBase mints the inbound bearer into
  "requiredEnv": ["DATABASE_URL"], // must be settled before build (derived; see below)
  // "agents": [...] intentionally omitted — see below
}
```

What a repo must satisfy to import cleanly (provider-independent):

1. **A Dockerfile** buildable with the **repo root** as build context (Precast's
   `apps/agents/Dockerfile` already is — it needs the pnpm workspace root).
2. The built container **serves A2A 0.3.x** per agent on `port`: card at
   `GET /api/.well-known/<id>/agent-card.json`, JSON-RPC at `POST /api/a2a/<id>`.
3. It honors a **bearer-auth env var** (`authEnv`): when set, `/api/a2a/*` requires
   that bearer. AgentBase mints the value per import and injects it — you never
   commit it. (Precast's `agentAuthMiddleware` already does exactly this with
   `AGENT_API_TOKEN`.)

**`agents` is intentionally omitted.** AgentBase discovers the hosted agents
post-boot via `GET /api/agents`, so the manifest never goes stale when you replace
the placeholder agents in `apps/agents/src/mastra/index.ts`. Pin an explicit
`agents: [{ id, name }]` list only if you want fixed display names.

**`requiredEnv` — settle env before build.** These are the env var **names** (no
values) that must have a value in the selected AgentBase namespace/environment
**before** AgentBase builds; if any is missing, the import is refused with
`import_env_unsettled` (listing the missing names + environment) rather than
crashing the container at boot. The list is **derived** from the zod env schema
in `packages/shared/src/env.ts` (a var is required iff it has no default and
isn't optional), minus AgentBase-managed names — run `pnpm emit:import-manifest`
after changing the schema; the **WEB-005** test guards that the committed manifest
matches. Don't hand-edit `requiredEnv`.

**Fallback:** a repo with **no** `agentbase.import.json` still imports via
Precast conventions (Dockerfile discovered at `./Dockerfile` then
`apps/agents/Dockerfile`, port 45000, `AGENT_API_TOKEN`, post-boot agent
discovery). Shipping the manifest just makes the contract explicit.

---

## 6. Caveats (not blockers)

- **Path A hosts; Path B you host.** Under import (Path A) AgentBase builds + runs the container and reachability is its problem. Under Path B the card's `url` must be reachable by AgentBase (production wants TLS); the boilerplate serves plain `http://0.0.0.0:45000`.
- **Skills are only as good as your tools.** Mastra maps each tool → one A2A skill. Define meaningful tools; the placeholder exposes only `exampleTool`.
- **New skills start `APPROVED`** on both paths. Governance still requires reviewing the synchronized surface before publication; later sync preserves existing status and deprecates missing skills.
- **Updates are org-initiated** (Path A). New commits are not auto-deployed; use **Pull latest & redeploy** on the imported agent's edit page. Webhook auto-deploy is out of scope for now.
- **Auth.** Precast ships auth-off locally; on import AgentBase mints + injects `AGENT_API_TOKEN` for you. For Path B, register with the matching `declaredAuthScheme` + a `credentialRef`. AgentBase supports `Bearer`, `ApiKey`, `Basic`, `None`, `OAuth2ClientCredentials`; plain `OAuth2` and `mTLS` currently return `501` in the proxy.

---

## 7. Next ↔ Mastra wiring

Precast ships a **Next.js** app (`apps/web`) that talks to Mastra agents **only through its server-side route handler / `callAgent()` util** — client code never calls Mastra. The transport is selected by the `ENABLE_AGENTBASE` env flag, and **AgentBase is the default** (guard rail — a missing flag proxies through the audited path, not directly at Mastra):

```
ENABLE_AGENTBASE=1 or unset  (proxy mode — DEFAULT)
┌─────────┐  POST /api/a2a/:id   ┌──────────────┐  POST <per-agent proxy URL>  ┌──────────┐
│  Next   │ ────────────────────▶│  AgentBase   │  the plain A2A envelope      │  Mastra  │
│ (React) │  (route handler)     │  (proxy)     │  Bearer <Application JWT>    │ (agents) │
└─────────┘                      └──────────────┘                             └──────────┘
                                        │ mints its own JWT via                 ▲
                                        │ client_credentials, then       injects
                                        │ injects the agent's declared   AGENT_API_TOKEN
                                        ▼ credential
                              Keycloak /realms/agentbase/protocol/openid-connect/token
                              (grant_type=client_credentials, AGENTBASE_CLIENT_ID/_SECRET)

ENABLE_AGENTBASE=0  (direct mode — explicit opt-out)
┌─────────┐  POST /api/a2a/:id   ┌──────────────────────────────────────────────────┐
│  Next   │ ────────────────────▶│ Mastra  POST $MASTRA_INTERNAL_URL/api/a2a/:id     │
│ (React) │  (route handler)     │ A2A message/send · Bearer AGENT_API_TOKEN         │
└─────────┘                      └──────────────────────────────────────────────────┘
```

### 7.1 Routing

| Layer                        | Route                                        | Description                                                       |
| ---------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| **Client component**         | `POST /api/a2a/:agentId`                     | Client sends message → route handler                              |
| **Next.js route handler**    | `POST /api/a2a/:agentId`                     | Validates input, calls `callAgent()`, returns a normalized reply  |
| **Server util**              | `callAgent()`                                | Branches on `ENABLE_AGENTBASE` (see modes below)                  |
| **Proxy mode** (default, ≠0) | `POST $AGENTBASE_AGENT_URL_<AGENT_ID>`       | The plain A2A `message/send` envelope; `Bearer <Application JWT>` |
| **Direct mode** (`=0`)       | `POST $MASTRA_INTERNAL_URL/api/a2a/:agentId` | A2A `message/send`; `Bearer AGENT_API_TOKEN`                      |

`callAgent()` returns a normalized `{ ok, text, error?, via, raw }`. Both modes actually send the **same request body** and share the same response shape: AgentBase's per-agent proxy takes the plain A2A `message/send` envelope as-is (org + agent are already encoded in the URL, so there's no wrapper object) and **relays Mastra's real A2A response verbatim** — `buildA2aMessageEnvelope()` in `a2a-client.ts` is shared by both modes. **Guard rail:** if AgentBase mode is active but the target agent's `AGENTBASE_AGENT_URL_<AGENT_ID>` isn't set, or the Application credentials (`AGENTBASE_CLIENT_ID`/`_SECRET`/`AGENTBASE_TOKEN_URL`) aren't fully set, `callAgent()` returns a clear error reply instead of a broken request.

> **Multi-agent routing.** AgentBase assigns **each imported agent its own registry row** with its own `slug` (always `<derived-name>-<random8>`, **never** the same as your Mastra `agentId`) — and its own full **proxy URL**: `https://<host>/proxy/a2a/<orgSlug>/<agentSlug>`. Copy that "Invocation Endpoint" straight from the agent's listing page in AgentBase Studio into **one env var per agent**: `AGENTBASE_AGENT_URL_<AGENT_ID>` (uppercase, non-alphanumeric → `_`; e.g. `example-agent` → `AGENTBASE_AGENT_URL_EXAMPLE_AGENT`). No skill id to resolve or track — this endpoint routes purely by the org+agent in the URL path; skill selection is the agent's own job once the message arrives. Registering more agents on the Mastra instance (`agents: { … }` in `apps/agents/src/mastra/index.ts`) is all the API-side work — each one auto-serves its own card at `/api/.well-known/:id/agent-card.json` and gets discovered/registered on import (§4A); add one `AGENTBASE_AGENT_URL_*` line per agent once you know its listing URL.

### 7.2 Files

- `apps/web/app/lib/a2a-client.ts` — `callAgent()` util; branches on `ENABLE_AGENTBASE` (proxy vs direct), reads the target agent's full proxy URL from `AGENTBASE_AGENT_URL_<AGENT_ID>`, and normalizes the reply
- `apps/web/app/lib/agentbase-auth.ts` — mints + caches the Application's OAuth2 `client_credentials` access token (RS256 JWT, ~30 min TTL, auto-refreshed)
- `apps/web/app/api/a2a/[agentId]/route.ts` — Next.js route handler exposed to the frontend
- `apps/web/app/AgentChat.tsx` — client component with an agent chat input (shows which transport handled the reply)
- Env: `ENABLE_AGENTBASE` (toggle), `MASTRA_INTERNAL_URL` (direct base), `AGENTBASE_CLIENT_ID`/`AGENTBASE_CLIENT_SECRET`/`AGENTBASE_TOKEN_URL` (Application auth) + `AGENTBASE_AGENT_URL_<AGENT_ID>` per agent (proxy), `AGENT_API_TOKEN` (Mastra bearer)

### 7.3 Configuration

```bash
# .env (or environment)
AGENTBASE_CLIENT_ID=
AGENTBASE_CLIENT_SECRET=
AGENTBASE_TOKEN_URL=https://keycloak.example.com/realms/agentbase/protocol/openid-connect/token
AGENTBASE_AGENT_URL_EXAMPLE_AGENT=https://agentbase.example.com/proxy/a2a/your-org/example-agent-a1b2c3d4
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

**Proxy mode (`ENABLE_AGENTBASE=1`):** the web app is a **developer Application** on AgentBase — an OAuth2 `client_credentials` client, not a static-token holder.

```
Next server (a2a-client.ts)
  ↓  POST $AGENTBASE_TOKEN_URL  (grant_type=client_credentials, AGENTBASE_CLIENT_ID/_SECRET)
Keycloak (AgentBase's realm)  →  RS256 JWT, ~30 min TTL  (cached + auto-refreshed in-memory)
  ↓
Next server → POST $AGENTBASE_AGENT_URL_<AGENT_ID>   (the plain A2A envelope)
  ↓  Authorization: Bearer <minted JWT>
AgentBase proxy
  ↓  (checks the Application is SUBSCRIBED to that agent's listing, then
  ↓   validates caller, strips inbound auth, injects the agent's declared credential)
Mastra agent → POST /api/a2a/:agentId  (verifies Bearer <AGENT_API_TOKEN>)
```

**Direct mode (`ENABLE_AGENTBASE=0`):**

```
Next route handler → POST $MASTRA_INTERNAL_URL/api/a2a/:agentId
  ↓  (sends Authorization: Bearer <AGENT_API_TOKEN>)
Mastra agent  (verifies Bearer <AGENT_API_TOKEN>)
```

| Mode   | Token the web app sends                         | Reaches Mastra as                   |
| ------ | ----------------------------------------------- | ----------------------------------- |
| Proxy  | Application JWT it minted itself (to AgentBase) | AgentBase injects `AGENT_API_TOKEN` |
| Direct | `AGENT_API_TOKEN` (straight to Mastra)          | `AGENT_API_TOKEN`                   |

**Key points:**

- **Set up once, in AgentBase Studio:** create a developer **Application**; copy its `clientId`/`clientSecret`/`tokenUrl` (the secret is shown once) into `.env`. **Subscribe that Application to each agent's registry listing** — this is required even to call your _own_ imported agent; there's no same-org exemption.
- The web app **mints its own token** on demand (`agentbase-auth.ts`) and caches it in memory per server process, refreshing ~30s before expiry. **Never** paste a copied/static JWT into `.env` — it would go stale in ~30 minutes.
- In **proxy** mode the web app never knows `AGENT_API_TOKEN` — AgentBase strips inbound auth (zero-trust) and injects the agent's declared credential.
- In **direct** mode the web app holds `AGENT_API_TOKEN` and sends it as the bearer itself.
- When `AGENT_API_TOKEN` is unset in the Mastra environment, auth is off (open for local dev).

### 7.6 Configuration

```bash
# .env (or environment) — Mastra side
AGENT_API_TOKEN=your-secret-token

# .env (or environment) — Next side
ENABLE_AGENTBASE=1                                # default (proxy); set 0 for direct A2A
MASTRA_INTERNAL_URL=http://localhost:45000         # direct-mode Mastra base URL
AGENTBASE_CLIENT_ID=your-application-client-id    # from AgentBase Studio → Applications
AGENTBASE_CLIENT_SECRET=your-application-secret   # shown once at creation/rotation
AGENTBASE_TOKEN_URL=https://keycloak.example.com/realms/agentbase/protocol/openid-connect/token
AGENTBASE_AGENT_URL_EXAMPLE_AGENT=https://agentbase.example.com/proxy/a2a/your-org/example-agent-a1b2c3d4
```

### 7.7 Design rule

> **The web app talks to agents only over A2A, only through `callAgent()`.** `apps/web` interacts with Mastra agents **exclusively via the A2A protocol** (JSON-RPC 2.0) — with or without AgentBase — and always through the server-side `callAgent()` util (never from client code). `callAgent()` is the single switch point: `ENABLE_AGENTBASE=1` (default) proxies through AgentBase as a developer Application (OAuth2 `client_credentials` JWT, each agent's own `AGENTBASE_AGENT_URL_<AGENT_ID>`, audit + zero-trust forwarding); `=0` calls Mastra directly at `POST /api/a2a/:id` (A2A `message/send`) with the `AGENT_API_TOKEN` bearer. The web app must **never** use Mastra's non-A2A surfaces — native REST (`POST /api/agents/:id/generate` | `/stream`), agent listing (`GET /api/agents`), or Studio. This is enforced by `apps/web/test/a2a-only.spec.ts` (fails the build on any non-A2A agent route in web source).

### 7.8 Related: Mastra → AgentBase registration

The second integration axis — registering the Mastra agent itself on AgentBase so it's discoverable and invocable — is independent of the Next wiring and follows the flow in §4.

### 7.9 Org-admin LLM configuration for imported agents

This is a **third, separate integration axis** from §7 (which covers Next ↔ Mastra) — it's about **which model each imported Mastra agent itself calls**, and who controls that choice.

**The rule:** _locally_ (and in Standalone/External deployment mode) an agent uses `resolveDefaultModel()` (`apps/agents/src/mastra/lib/default-model.ts`), which auto-detects a model from whichever provider key is set in this repo's own `.env` — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY` — or reads an explicit `DEFAULT_LLM_MODEL` override; no provider is hardcoded. _On AgentBase_ (an imported, AgentBase-hosted container) the model is instead **set per agent from the org's onboarded models** — and an agent with no model set does **not** silently read an env key; it fails loudly until configured.

1. Import the repo (§4A). AgentBase always injects `AGENTBASE_HOSTED=1` into the container. On the **first** deploy no model can be set yet (see the one-deploy lag below) — the container still boots and its agents are discoverable, but _calling_ an unconfigured agent returns a clear error telling you to set its model in Studio (it never falls back to an env key on AgentBase).
2. In Studio, open the agent → **LLM configuration** → pick one of the org's already-onboarded models (from the **Models** page — that's where the org's own provider key lives) → **Save**.
3. **Redeploy** ("Pull latest & redeploy"). AgentBase mints this agent a fresh service Application and injects its gateway env into the container (reserved, never read from this repo's `.env`/Variables):

   ```
   AGENTBASE_HOSTED=1                          marks the container AgentBase-hosted (always)
   AGENTBASE_LLM_BASE_URL                      shared gateway base URL
   AGENTBASE_LLM_TOKEN_URL                     shared Keycloak token endpoint
   AGENTBASE_LLM_CLIENT_ID_<AGENT_ID>           this agent's own service Application
   AGENTBASE_LLM_CLIENT_SECRET_<AGENT_ID>
   AGENTBASE_LLM_MODEL_<AGENT_ID>               "<provider>/<model>", admin-chosen
   ```

   `<AGENT_ID>` is the agent's own Mastra `id` (uppercased/underscored — same convention as `AGENTBASE_AGENT_URL_<AGENT_ID>` in §7), since one container can host several agents, each with its own choice.

4. `apps/agents/src/mastra/lib/agentbase-model.ts`'s `resolveAgentModel(agentId, fallback)` implements the rule: when both `AGENTBASE_LLM_BASE_URL` and this agent's `AGENTBASE_LLM_MODEL_<AGENT_ID>` are set, it builds an OpenAI-compatible model (`@ai-sdk/openai-compatible`) pointed at the gateway, minting/caching its own client_credentials bearer per call (mirrors `agentbase-auth.ts`'s pattern) — the org's real provider key never reaches the container. When `AGENTBASE_HOSTED=1` but this agent has no model, it returns a model that **fails at call time** with an actionable message (never an env key). Only when _not_ AgentBase-hosted does it return `fallback` unchanged — each agent passes `resolveDefaultModel()`'s result as that `fallback` (see §7.9 above).

**Note the one-deploy lag:** a brand-new agent's own Mastra `id` isn't knowable to AgentBase until its first container boots and gets probed (for manifest-less repos) — so gateway wiring only takes effect starting from the deploy _after_ the agent is first known to the registry, once an admin has configured it. This is why the fail-fast is at **call time**, not boot time: crashing at construction would stop the container from booting and deadlock that first discovery deploy. It's a one-time bootstrapping gap per agent, not an ongoing one.

---

### 7.10 Runtime MCP discovery for imported agents

The MCP counterpart to §7.9. An imported agent learns **which MCP servers it may call** at
runtime, rather than having their URLs hardcoded in this repo's `.env`.

AgentBase already proxies MCP: `POST /proxy/mcp/:org/:slug/mcp` sits behind the same
`PublicProxyGuard` as the LLM gateway, injects the upstream credential, and enforces the
subscription. The missing piece was discovery — knowing _which_ `:org/:slug` pairs this agent
is entitled to. That lived only behind `/developer/subscriptions`, which requires a human
developer token.

1. AgentBase injects **`AGENTBASE_MCP_BASE_URL`** into every hosted container —
   unconditionally, unlike the per-agent LLM vars. An agent with no subscriptions gets an
   empty list, which is a real answer rather than a missing variable.
2. The agent calls **`GET {AGENTBASE_MCP_BASE_URL}/subscriptions`** with the _same_ per-agent
   Application credentials minted for the LLM gateway — one guard, one credential, no second
   secret to manage.
3. The response carries only `{org, slug, title, scopes, url}`. **Never `baseUrl`, never
   `authConfig`.** The proxy is what enforces subscription, rate limits, metering and audit,
   so discovery must not hand out anything that could be used to bypass it.
4. `apps/agents/src/mastra/lib/agentbase-mcp.ts`'s `resolveAgentMcpTools(agentId)` builds an
   `MCPClient` against those proxied endpoints and returns the namespaced toolset. It uses
   `listToolsWithErrors()` and **throws** if any subscribed server fails to connect — a
   partially-connected agent must not present as one that simply has fewer tools.

**Unlike §7.9, this fails at BOOT, not at call time.** The toolset is part of the agent's
identity and has to be settled before its A2A card is served, so it is resolved with a
top-level `await`. On a hosted container a discovery failure therefore fails the deploy —
loudly, in the build/runtime logs — instead of serving an agent that is quietly missing half
its capabilities. Off AgentBase (`AGENTBASE_HOSTED` unset) the whole path is inert: `{}`, no
network call, no throw.

---

## 8. Source references

**Precast**

- `apps/agents/src/mastra/index.ts` — Mastra instance + server config (host/port)
- `apps/agents/src/mastra/agents/example-agent.ts` — agent definition (`id`, tools)
- `apps/agents/src/mastra/lib/agentbase-model.ts` — `resolveAgentModel()` (§7.9: org-admin LLM config per imported agent, else fallback)
- `apps/agents/Dockerfile` — the image AgentBase builds on import (repo root as context)
- `agentbase.import.json` — the import contract manifest (repo root; see §5b)
- A2A routes come from `@mastra/server` (`/api/a2a/:agentId`, `/api/.well-known/:agentId/agent-card.json`)

**AgentBase** (`/apps/api`)

- `src/agents/agents.dto.ts` — `createAgentSchema` (Path B registration payload)
- `src/agents/agents.service.ts` — `create()` → `a2aSyncService.syncAgent()`
- `src/sync/a2a/agentCard.validator.ts` — `validateAgentCard()` + `normalizeAgentCard()` (the A2A 0.3.0 shim)
- `src/sync/a2a/a2a-sync.service.ts` — fetch → validate → derive endpoint → materialize skills
- `src/source-imports/*` — Path A import: `vcs/` provider abstraction (GitHub App + generic git), `import-manifest.ts` (the `agentbase.import.json` reader + fallback), `source-imports.service.ts` (acquire → build/host → mint token → register)
- `src/env-groups/*` — Environments (reusable org-scoped env var groups injected at build/deploy)
- `packages/mcp/src/a2a/agentCard.schema.ts` — `a2aAgentCardSchema`
- `src/proxy/*` — `POST /a2a` invocation proxy (credential injection, zero-trust, audit)
- `src/agent-llm-config/*` — §7.9: `GET/PUT /agents/:id/llm-config` (org admin picks a model for an imported agent)
- `src/llm-gateway/llm-gateway.service.ts` `resolveTarget()` — resolves both COMPOSED (`agent_definitions`) and IMPORTED (`agent_llm_configs`) callers
- `src/source-imports/source-imports.service.ts` `injectLlmGatewayEnv()` — mints the per-agent service Application + injects its gateway env on (re)deploy
