# Agent Spin-up Prompts (reusable)

> The concise prompts used to build this agent, in order. Copy a block, replace
> the `<PLACEHOLDERS>`, and paste into a coding agent working on a Precast-based
> monorepo. Each block is one turn.

## Fire-off (short version)

> The whole thing in one informal instruction — paste this to build what
> gallygal-agent is today.

```
Build me Gallygal on this Precast monorepo (Mastra + Next.js + Postgres): a
Philippine-law Q&A agent that answers ONLY from the AgentBase Philippine Law MCP
(bearer AGENTBASE_TOKEN) — no web, no training data, fail closed if it finds
nothing. Gemini writes the summaries. Name the agent "gallygal". Log its MCP,
LLM, and A2A calls (tokens redacted). Persist every Q&A turn — question, grounded
answer, citations — to Postgres with Drizzle. Protect the API with a single
static bearer token (AGENT_API_TOKEN) — off when unset. Secrets live in the root
.env; migrate the DB and verify it live.
```

---

**Placeholders**

| Token          | This project                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------- |
| `<AGENT_NAME>` | Gallygal (`gallygal`)                                                                        |
| `<DOMAIN>`     | Philippine law                                                                               |
| `<MCP_NAME>`   | Philippine Law MCP                                                                           |
| `<MCP_URL>`    | `https://agentbase.example.com/proxy/mcp/<org>/<mcp-slug>/mcp` (your AgentBase MCP endpoint)  |
| `<MODEL>`      | `google/gemini-2.5-flash` (Gemini)                                                           |
| `<DB>`         | PostgreSQL via Drizzle ORM (`packages/db`), `DATABASE_URL`                                   |

---

## 1 — Product spec (PRD, data model, agent spec, design system)

```
Update the PRD, Data Model, agent spec and design system.

PRD — Integrate with the AgentBase-hosted MCP server called <MCP_NAME> (<MCP_URL>).
Add an entry to .env called AGENTBASE_TOKEN where I will put the AgentBase
Application Token. The agent's role is to answer <DOMAIN> queries and respond
with a summary. The agent must strictly refer only to the <MCP_NAME> — do not
look up answers using web search or training data.

Data model — Create a Q&A-based conversation schema.

Add a DATABASE_URL entry to .env (I will provide the value later).

Review the simplest authentication scheme we can use to protect the agent.
```

## 2 — Model

```
Use <MODEL> for the generation of the summary. I will add the API key value in .env.
```

## 3 — Logging + one structured prompt

```
The agent must have its own logging for the outbound MCP calls, LLM calls, and
incoming A2A calls. Construct my inputted prompts into one big structured prompt.
```

## 4 — Build end to end

```
Build the agent end to end. I have added the env values. Verify it live: the
agent must connect to <MCP_NAME>, answer only from it (fail closed otherwise),
and emit the mcp / llm / a2a logs.
```

## 5 — Implement the database

```
Implement the Postgres database. Create the Q&A conversation schema (<DB>) as a
shared package with Drizzle: User -> Conversation -> QA -> Citation, with the
grounded-only invariants (an answered turn must be grounded and have answer text;
citations only from MCP output). Generate and run migrations against DATABASE_URL.

Add a route that persists each turn: create/continue a conversation, record the
question, call the agent, then store the result — a grounded answer (with the
answer's Sources as citations) when the agent actually called the MCP, or a
no_answer when it declined or made no MCP call. Add a route to read a
conversation back. Verify a live turn lands rows in Postgres.
```

## 6 — Protect the agent (inbound auth)

```
Add inbound auth to the agent API: a single static bearer token (AGENT_API_TOKEN).
Implement it as Mastra server middleware — when the token is unset, auth is off
(dev); when set, requests to the cost-bearing endpoints (agent invocation, A2A,
the persistence routes) must send `Authorization: Bearer <AGENT_API_TOKEN>` or
get 401. Keep discovery (the A2A card) and the Studio UI open. Put the decision
logic in a pure, unit-tested function. Verify live: 401 without/with a wrong
token, 200 with the right one.
```

---

## One-shot version (all of the above in a single prompt)

```
Build a <DOMAIN> Q&A agent named "gallygal" on the Precast monorepo
(Mastra + Next.js), end to end.

Behavior: answer <DOMAIN> questions with a concise summary sourced EXCLUSIVELY
from the AgentBase-hosted <MCP_NAME> (<MCP_URL>). No web search, no training-data
answers. If the MCP returns nothing relevant, fail closed (say so, don't guess).
Use <MODEL> as the writer. Assemble these rules into one structured system prompt.

Config: read the repo-root .env. Add AGENTBASE_TOKEN (bearer for the MCP),
PHILIPPINE_LAW_MCP_URL (default <MCP_URL>), DATABASE_URL, and AGENT_API_TOKEN
(inbound auth). I will supply the secret values.

Wiring: attach the MCP tools as the agent's only toolset via @mastra/mcp; throw
at boot if the token is missing or the MCP won't connect.

Logging: the agent must log its own outbound MCP calls, LLM calls, and incoming
A2A calls (structured, bearer tokens redacted, one `channel` field per line).

Database: implement a Q&A conversation schema (User → Conversation → QA →
Citation) in Postgres (<DB>) as a shared Drizzle package with migrations against
DATABASE_URL, plus a route that persists each turn (grounded answer + citations,
or no_answer when the agent declines / makes no MCP call) and a route to read a
conversation back.

Auth: protect the API with a single static bearer token (AGENT_API_TOKEN) via
Mastra server middleware — off when unset; protected endpoints require
`Authorization: Bearer <token>`, discovery + Studio stay open.

Update the feed-forward docs (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM) and the
doc contract (HANDOFF, PROGRESS, TECH_STACK). Verify live before reporting done.
```
