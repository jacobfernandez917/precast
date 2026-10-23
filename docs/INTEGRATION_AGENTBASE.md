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
- **Telemetry reaches AgentBase on both paths.** A hosted agent reports traces, metrics and logs to AgentBase's governed endpoint with nothing to set; an external one needs two variables and a key issued in Studio (§4C step 6, §7.13).

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

Telemetry needs nothing either. At deploy AgentBase injects the `OTEL_*` settings (endpoint, a managed key valid for 90 days, `http/protobuf`, `OTEL_SERVICE_NAME=agent-<agentId>` and the `agentbase.*` resource attributes), and the agent's traces, metrics and logs appear on its **Telemetry** page in Studio (§7.13).

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

#### Step 6 — Report telemetry to AgentBase

On the agent's page in Studio, open **Telemetry** and **issue a key** (valid 1 to 90 days). The key is write-only and bound to this organisation, this agent and one environment. Then set two variables wherever the agents run:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://<agentbase-api>/telemetry/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20<key>
```

Restart the agents; the container's log says `[otel] exporting traces, metrics, logs to <host>`. Issue a new key before the old one expires: an expired or wrong key shows up once in the agents' log as `telemetry_credential_required` (HTTP 401), and the agents keep serving. Over plain HTTP the endpoint is refused outside AgentBase's local environment.

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

Precast ships a **Next.js** app (`apps/web`) that talks to Mastra agents **only through its server-side route handler / `callAgent()` util** — client code never calls Mastra. Calls go through the AgentBase proxy; the development switch `PRECAST_LOCAL_AGENTS=1` calls the local agents app directly before the project is imported. (`ENABLE_AGENTBASE=0`, the pre-v0.10.0 spelling, is read for one release.)

```
PRECAST_LOCAL_AGENTS unset or 0  (through AgentBase, the default)
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

PRECAST_LOCAL_AGENTS=1  (local agents, development before the first import)
┌─────────┐  POST /api/a2a/:id   ┌──────────────────────────────────────────────────┐
│  Next   │ ────────────────────▶│ Mastra  POST $MASTRA_INTERNAL_URL/api/a2a/:id     │
│ (React) │  (route handler)     │ A2A message/send · Bearer AGENT_API_TOKEN         │
└─────────┘                      └──────────────────────────────────────────────────┘
```

### 7.1 Routing

| Layer                           | Route                                        | Description                                                       |
| ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| **Client component**            | `POST /api/a2a/:agentId`                     | Client sends message → route handler                              |
| **Next.js route handler**       | `POST /api/a2a/:agentId`                     | Validates input, calls `callAgent()`, returns a normalized reply  |
| **Server util**                 | `callAgent()`                                | Branches on `PRECAST_LOCAL_AGENTS` (see below)                    |
| **Through AgentBase** (default) | `POST $AGENTBASE_AGENT_URL_<AGENT_ID>`       | The plain A2A `message/send` envelope; `Bearer <Application JWT>` |
| **Local agents** (`=1`)         | `POST $MASTRA_INTERNAL_URL/api/a2a/:agentId` | A2A `message/send`; `Bearer AGENT_API_TOKEN`                      |

`callAgent()` returns a normalized `{ ok, text, error?, via, raw }`. Both modes actually send the **same request body** and share the same response shape: AgentBase's per-agent proxy takes the plain A2A `message/send` envelope as-is (org + agent are already encoded in the URL, so there's no wrapper object) and **relays Mastra's real A2A response verbatim** — `buildA2aMessageEnvelope()` in `a2a-client.ts` is shared by both modes. **Guard rail:** if AgentBase mode is active but the target agent's `AGENTBASE_AGENT_URL_<AGENT_ID>` isn't set, or the Application credentials (`AGENTBASE_CLIENT_ID`/`_SECRET`/`AGENTBASE_TOKEN_URL`) aren't fully set, `callAgent()` returns a clear error reply instead of a broken request.

> **Multi-agent routing.** AgentBase assigns **each imported agent its own registry row** with its own `slug` (always `<derived-name>-<random8>`, **never** the same as your Mastra `agentId`) — and its own full **proxy URL**: `https://<host>/proxy/a2a/<orgSlug>/<agentSlug>`. Copy that "Invocation Endpoint" straight from the agent's listing page in AgentBase Studio into **one env var per agent**: `AGENTBASE_AGENT_URL_<AGENT_ID>` (uppercase, non-alphanumeric → `_`; e.g. `example-agent` → `AGENTBASE_AGENT_URL_EXAMPLE_AGENT`). No skill id to resolve or track — this endpoint routes purely by the org+agent in the URL path; skill selection is the agent's own job once the message arrives. Registering more agents on the Mastra instance (`agents: { … }` in `apps/agents/src/mastra/index.ts`) is all the API-side work — each one auto-serves its own card at `/api/.well-known/:id/agent-card.json` and gets discovered/registered on import (§4A); add one `AGENTBASE_AGENT_URL_*` line per agent once you know its listing URL.

### 7.2 Files

- `apps/web/app/lib/a2a-client.ts` — `callAgent()` util; branches on `PRECAST_LOCAL_AGENTS` (proxy vs local), reads the target agent's full proxy URL from `AGENTBASE_AGENT_URL_<AGENT_ID>`, and normalizes the reply
- `apps/web/app/lib/agentbase-auth.ts` — mints + caches the Application's OAuth2 `client_credentials` access token (RS256 JWT, ~30 min TTL, auto-refreshed)
- `apps/web/app/api/a2a/[agentId]/route.ts` — Next.js route handler exposed to the frontend
- `apps/web/app/AgentChat.tsx` — client component with an agent chat input (shows which transport handled the reply)
- Env: `PRECAST_LOCAL_AGENTS` (development switch), `MASTRA_INTERNAL_URL` (local base), `AGENTBASE_CLIENT_ID`/`AGENTBASE_CLIENT_SECRET`/`AGENTBASE_TOKEN_URL` (Application auth) + `AGENTBASE_AGENT_URL_<AGENT_ID>` per agent (proxy), `AGENT_API_TOKEN` (Mastra bearer)

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

**Through AgentBase (the default):** the web app is a **developer Application** on AgentBase — an OAuth2 `client_credentials` client, not a static-token holder.

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

**Local agents (`PRECAST_LOCAL_AGENTS=1`, development only):**

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
PRECAST_LOCAL_AGENTS=0                            # 1 = call the local agents app directly (development)
MASTRA_INTERNAL_URL=http://localhost:45000         # where the local agents app answers
AGENTBASE_CLIENT_ID=your-application-client-id    # from AgentBase Studio → Applications
AGENTBASE_CLIENT_SECRET=your-application-secret   # shown once at creation/rotation
AGENTBASE_TOKEN_URL=https://keycloak.example.com/realms/agentbase/protocol/openid-connect/token
AGENTBASE_AGENT_URL_EXAMPLE_AGENT=https://agentbase.example.com/proxy/a2a/your-org/example-agent-a1b2c3d4
```

### 7.7 Design rule

> **The web app talks to agents only over A2A, only through `callAgent()`.** `apps/web` interacts with Mastra agents **exclusively via the A2A protocol** (JSON-RPC 2.0) — with or without AgentBase — and always through the server-side `callAgent()` util (never from client code). `callAgent()` is the single switch point: by default it proxies through AgentBase as a developer Application (OAuth2 `client_credentials` JWT, each agent's own `AGENTBASE_AGENT_URL_<AGENT_ID>`, audit + zero-trust forwarding); the development switch `PRECAST_LOCAL_AGENTS=1` calls the local agents app directly at `POST /api/a2a/:id` (A2A `message/send`) with the `AGENT_API_TOKEN` bearer, for a project not yet imported. The web app must **never** use Mastra's non-A2A surfaces — native REST (`POST /api/agents/:id/generate` | `/stream`), agent listing (`GET /api/agents`), or Studio. This is enforced by `apps/web/test/a2a-only.spec.ts` (fails the build on any non-A2A agent route in web source).

### 7.8 Related: Mastra → AgentBase registration

The second integration axis — registering the Mastra agent itself on AgentBase so it's discoverable and invocable — is independent of the Next wiring and follows the flow in §4.

### 7.9 Org-admin LLM configuration for imported agents

This is a **third, separate integration axis** from §7 (which covers Next ↔ Mastra) — it's about **which model each imported Mastra agent itself calls**, and who controls that choice.

**The rule:** the model always comes from the organisation's AgentBase gateway. _Locally_ an agent uses the account-level `AGENTBASE_LLM_MODEL` with the Application credentials in `.env` (`pnpm bootstrap --llm-provider=agentbase`); _on AgentBase_ the org admin's per-agent choice from Studio's "LLM configuration" card is injected and wins. No vendor key is read anywhere since v0.10.0.

1. Import the repo (§4A). AgentBase always injects `AGENTBASE_HOSTED=1` into the container. On the **first** deploy no model can be set yet (see the one-deploy lag below) — the container still boots and its agents are discoverable, but _calling_ an unconfigured agent returns a clear error telling you to set its model in Studio (it never falls back to an env key on AgentBase).
2. In Studio, open the agent → **LLM configuration** → pick one of the org's already-onboarded models (from the **Models** page — that's where the org's own provider key lives) → **Save**.
3. **Redeploy** ("Pull latest & redeploy"). AgentBase mints this agent a fresh service Application and injects its gateway env into the container (reserved, never read from this repo's `.env`/Variables):

   ```
   AGENTBASE_HOSTED=1                          marks the container AgentBase-hosted (always)
   AGENTBASE_LLM_BASE_URL                      shared gateway base URL
   AGENTBASE_LLM_MODEL_<AGENT_ID>              "<provider>/<model>", admin-chosen
   AGENTBASE_LLM_TOKEN_URL                     shared Keycloak token endpoint
   AGENTBASE_LLM_CLIENT_ID_<AGENT_ID>          this agent's own service Application
   AGENTBASE_LLM_CLIENT_SECRET_<AGENT_ID>
   ```

   `<AGENT_ID>` is the agent's own Mastra `id` (uppercased/underscored — same convention as `AGENTBASE_AGENT_URL_<AGENT_ID>` in §7), since one container can host several agents, each with its own choice.

   **On the `LLM_` infix in the last three.** Those are _credentials_, and credentials are not LLM-specific — the very same Application token authenticates the MCP proxy (§7.10) and the A2A proxy (§7). Precast's canonical names therefore drop the infix:

   ```
   AGENTBASE_TOKEN_URL / AGENTBASE_CLIENT_ID[_<AGENT_ID>] / AGENTBASE_CLIENT_SECRET[_<AGENT_ID>]
   ```

   Those are what you write in `.env` and what `pnpm bootstrap` emits. The `AGENTBASE_LLM_*` credential forms above are still **read**, and must be: AgentBase injects them and this repo does not control the injector. Resolution order per setting is per-agent canonical → per-agent legacy → account canonical → account legacy, so an admin's Studio choice still outranks anything in a repo `.env`. Capability-specific _settings_ keep their infix — `AGENTBASE_LLM_BASE_URL`, `AGENTBASE_LLM_MODEL`, `AGENTBASE_MCP_BASE_URL` — because those genuinely differ per capability.

4. `apps/agents/src/mastra/lib/agentbase-model.ts`'s `resolveAgentModel(agentId)` implements the rule: the per-agent model injected on a hosted container wins, else the account-level `AGENTBASE_LLM_MODEL`, else a model that fails at call time naming what to set (Studio when hosted, `.env` locally). The gateway route is derived from `AGENTBASE_URL` and the model's subscription (`AGENTBASE_LLM_BASE_URL` overrides it).

**Note the one-deploy lag:** a brand-new agent's own Mastra `id` isn't knowable to AgentBase until its first container boots and gets probed (for manifest-less repos) — so gateway wiring only takes effect starting from the deploy _after_ the agent is first known to the registry, once an admin has configured it. This is why the fail-fast is at **call time**, not boot time: crashing at construction would stop the container from booting and deadlock that first discovery deploy. It's a one-time bootstrapping gap per agent, not an ongoing one.

---

### 7.10 Runtime MCP discovery for imported agents

The MCP counterpart to §7.9. An imported agent learns **which MCP servers it may call** at
runtime, rather than having their URLs hardcoded in this repo's `.env`.

AgentBase already proxies MCP: `POST /proxy/mcp/:org/:slug/mcp` sits behind the same
`PublicProxyGuard` as the LLM gateway, injects the upstream credential, and enforces the
subscription. The missing piece was discovery — knowing _which_ `:org/:slug` pairs this agent
is entitled to. Two surfaces answer that question and **neither works for a hosted agent**:
`/developer/subscriptions` needs a human Studio session, and AgentBase's native
`agentbase.list_subscriptions` MCP tool resolves the caller via `ownerDeveloperId` — which
the per-agent service applications minted for hosted containers do not have, so it returns
`developer_app_required`. Hence a dedicated endpoint for exactly that caller.

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

### 7.11 Acting as the end user (OBO), and addressing a subscribed server

Two things a hosted agent needs that used to require a bespoke path in each project.

#### The end-user subject

AgentBase supports **end-user delegation**: a caller sends
`X-AgentBase-On-Behalf-Of: <subject>` and the platform resolves _that person's_ connected
account for a user-mode MCP server. Without forwarding it, every MCP call an agent makes runs
as the container's own identity — and a user-mode server answers
`401 mcp_server_authorization_required`, which reaches the operator as _"connect your account"_
for an account that is already connected.

The boilerplate now carries it end to end:

|               |                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Captured**  | `middleware/auth.ts` reads the header into an `AsyncLocalStorage` request context                                  |
| **Forwarded** | `lib/agentbase-mcp.ts` attaches it to every discovered MCP tool call                                               |
| **Available** | `currentOnBehalfOf()` / `resolveOnBehalfOf()` from `lib/request-context.ts`, for a project's own MCP or HTTP calls |

Three properties are deliberate, and each is pinned by a test:

- **Header only — never a request body.** The header is trustworthy because AgentBase's proxy
  sets it, and only for an OBO-enabled Application against an agent it hosts. A body field is
  attacker-controlled; reading a subject from one would let any caller impersonate any user.
- **Sent only back to AgentBase.** The outbound wrapper compares _origins_ and returns early for
  anything else — a string prefix would accept `https://api.agentbase.example.com.evil.com`.
  An agent calling a third-party endpoint must not tell it who its user is.
- **Absent means absent.** No header → nothing is attached → behaviour is exactly as before.

Precedence when a project has its own source as well:
`explicit input > inbound header > project-specific source > none`.

```ts
import { resolveOnBehalfOf } from '../lib/request-context';

const subject = resolveOnBehalfOf({
  explicit: input.actAsUser, // a tool that was told whom to act for
  projectFallback: () => sessionUser(), // your own mapping, consulted last
});
```

The header is decided **per request**, not at construction. The `MCPClient` is built once when
the agent is created, so a static `requestInit` would have frozen whatever was true at boot —
an empty subject for every real turn, and an access token that expires under it.

#### Addressing a subscribed server without configuring it

`GET {AGENTBASE_MCP_BASE_URL}/subscriptions` already returns a ready-made address for every
attached server. That list drives the LLM toolset; `resolveSubscribedServer()` exposes it for a
**deterministic** call — invoking a specific tool yourself rather than letting the model choose:

```ts
const url = await resolveSubscribedServer(AGENT_ID, { slug: 'slack-mcp-2e688547' });
const url = await resolveSubscribedServer(AGENT_ID, { titleMatch: /slack/i });
```

No env var, and nothing to update when a server is renamed. It **fails loudly** on zero matches
(naming what _was_ subscribed) and refuses to choose on several — sending a user's data to the
wrong server is far worse than an error read once.

### 7.12 Interactive cards (A2UI)

An agent can attach one interactive card to a reply: a title, text, label and value fields, up to
five buttons and one dropdown. The card travels as an A2UI v0.9.1 surface in the catalog
`raya.blocks.v1`, the same vocabulary Raya renders and AgentBase's composed agents emit, so a
Precast agent's cards show in Raya with no AgentBase change.

Turn it on per agent:

```ts
import { cardTools, SHOW_CARD_INSTRUCTIONS } from '../tools/show-card';

export const myAgent = new Agent({
  instructions: `${myInstructions}\n\n${SHOW_CARD_INSTRUCTIONS}`,
  tools: { ...myTools, ...cardTools },
  // ...
});
```

The example agent ships with cards on. Remove both lines to answer in text only.

| Piece            | Where                    | What it does                                                                                                                                                        |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `show_card` tool | `tools/show-card.ts`     | The model fills a flat card against a JSON Schema built from the catalog's limits. It never writes A2UI, so model text cannot decide what a person sees             |
| Card slot        | `lib/request-context.ts` | Holds the card for the current turn only; concurrent turns never see each other's                                                                                   |
| A2UI middleware  | `middleware/a2ui.ts`     | Appends the card to the A2A reply as one `application/a2ui+json` data part, in the form the caller's A2A version expects, and lists the extension on the agent card |
| Shared package   | `packages/a2ui/`         | The pinned catalog, the card format, and the A2A part helpers                                                                                                       |

A button press comes back to the agent as a text message with a JSON payload, either
`raya.interaction` from Raya or `a2ui.action` from other A2UI clients. Mastra fails a whole turn on
any `data` part, so the middleware turns a press with no text into text and drops every other data
part. AgentBase's proxy already strips data parts for imported agents; this covers the direct
transport too.

Current limits:

- Cards attach to `message/send` replies. A streamed reply (`message/stream`) and a non-blocking
  send whose answer arrives later go out as text, and the middleware logs the dropped card.
- A signed agent card is left as it is, so it does not list the extension.
- A caller that declares `a2uiClientCapabilities` without `raya.blocks.v1` gets no card. A caller
  that declares nothing gets it, since the text reply stands on its own.

#### In the Precast web app

`apps/web` renders the cards under each reply. `callAgent()` sends the extension header and
`a2uiClientCapabilities` on every call and returns the attached messages as `AgentReply.a2ui`.
`app/a2ui/AgentCards.tsx` feeds them to `@a2ui/react`'s message processor, which validates each
component against the catalog in `app/a2ui/catalog.tsx` (the thirteen `raya.blocks.v1` components
on Astryx, so cards follow the APC theme) and drops what it does not name. The renderer loads
client-only with `next/dynamic`, because `@a2ui/react` extends `HTMLElement` at import.

A press posts `{ action }` to `/api/a2a/:agentId` on the same conversation, and the route turns it
into the `a2ui.action` text above, so direct and AgentBase transports behave the same. Two
rendering choices differ from Raya: `Embed` is drawn as a link rather than an iframe, and `Image`
is a plain `<img>` with `referrerPolicy="no-referrer"`, since the URL is agent-authored and on no
allowlist.

### 7.13 Telemetry: traces, metrics and logs to AgentBase

**What is sent.** The agents container exports three OTLP signals to `POST {AGENTBASE_API}/telemetry/otlp/v1/{traces|metrics|logs}`:

- **Traces.** The inbound A2A request (continuing the `traceparent` AgentBase's proxy sends), the crew's in-process hops, and every egress call (token mint, model gateway, MCP proxy), all in one trace.
- **Metrics,** read every 30 s: `process.memory.usage`, `v8js.memory.heap.used`, `process.cpu.utilization` by `cpu.mode`, and the HTTP server and client request durations.
- **Logs.** One `agent.request` record per A2A call (agent id, status, duration; INFO, WARN on 4xx, ERROR on 5xx) and one `agents.telemetry.started` at boot, each correlated to the active trace.

Liveness probes (`GET /api/agents`, which the Compose health check calls every 10 s, and `/health`) are left out of traces and HTTP metrics.

**Configuration** is the standard OpenTelemetry environment and nothing else. The exporters read their own per-signal endpoint, headers and protocol (`OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_*` over the unsuffixed ones), so the values AgentBase injects are used as given. `http/protobuf` is the default and `http/json` is honoured; `grpc` is not supported and disables that signal with a warning. `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` flow onto every signal. `OTEL_<SIGNAL>_EXPORTER=none` turns one signal off and `OTEL_SDK_DISABLED=true` turns telemetry off entirely. With no endpoint nothing is exported and the trace context is still carried through.

| Hosting                       | What to set                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imported (AgentBase hosts it) | Nothing. AgentBase injects the endpoint, a managed key valid for 90 days, the protocol, `OTEL_SERVICE_NAME=agent-<agentId>` and `agentbase.org`, `agentbase.agent_id`, `deployment.environment.name`. |
| External (you host it)        | `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`, with a key issued in Studio (§4C step 6).                                                                                             |
| Local development             | Nothing; context propagation only. Set the two variables to watch a local run on the Telemetry page.                                                                                                  |

**What never leaves the container.** Exported span attributes pass an allowlist: HTTP method, status and route, URLs with the query string cut, network peer, model id, token counts, agent id. Everything else is dropped, along with status messages and exception messages; an exception keeps only its type. This matters because Mastra bundles the AI SDK, which records `ai.prompt`, `ai.response.text` and `ai.toolCall.args` on its spans whenever a caller turns its telemetry on. Log records carry a fixed event name and allowlisted attributes, never message text. AgentBase redacts again before storing and drops log bodies, but the agent does not rely on that. Mastra's own usage analytics, which it would otherwise send to a third-party service from every server and every CLI run, are switched off (`MASTRA_TELEMETRY_DISABLED=1` in the runtime image and in the agents' `dev`, `build` and `start` scripts), so what leaves the container goes to AgentBase.

**Start order.** The production container runs `node --import ./telemetry.mjs index.mjs`: `telemetry.mjs` is built next to the Mastra bundle from `src/mastra/telemetry/preload.ts`, so the SDK, the W3C propagator and the http/fetch instrumentation are in place before the app graph loads. `mastra/index.ts` also calls `startAgentTelemetry()` (a no-op once started), which is what runs under `mastra dev`. It is a call, not a bare `import`, because Mastra's bundler tree-shakes with `treeshake: "smallest"` and dropped the side-effect import that Precast used before v0.10.2; built containers started no telemetry at all.

**Failure and shutdown.** A telemetry failure never stops the agents from serving; export problems are printed once each as `[otel] …`, with the key cut out, and a 401 says to issue a new key. The exporters retry 429 and 503 after `Retry-After`. On SIGTERM everything buffered is flushed within 5 s before the process exits; Mastra's own shutdown waits for it.

---

## 8. Source references

**Precast**

- `apps/agents/src/mastra/index.ts` — Mastra instance + server config (host/port)
- `apps/agents/src/mastra/agents/example-agent.ts` — agent definition (`id`, tools)
- `apps/agents/src/mastra/lib/agentbase-model.ts` — `resolveAgentModel()` (§7.9: org-admin LLM config per imported agent, else fallback)
- `apps/agents/Dockerfile` — the image AgentBase builds on import (repo root as context); its CMD preloads `telemetry.mjs`
- `apps/agents/src/mastra/telemetry/otel.ts` — telemetry: OTLP exporters from `OTEL_*`, the attribute allowlist, metrics, log records, shutdown (§7.13); `preload.ts` is the container's first module
- `apps/agents/src/mastra/middleware/telemetry.ts` — one `agent.request` log record per A2A call
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
