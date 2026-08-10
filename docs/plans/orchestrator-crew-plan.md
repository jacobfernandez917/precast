# Orchestrator Crew — Design Plan

> **Status:** In build — **Phases 1–4 DONE** (2026-08-11); Phase 5 deferred. See §8 for the per-phase record.
>
> - **P1 (Precast crew):** `mastra/crew.ts` + `lib/crew.ts` (`defineCrew`/`crewAgents`) + `agents/orchestrator.ts` (in-process Agent Network) + `index.ts`.
> - **P2 (Precast manifest):** `emit-import-manifest.mjs` emits `orchestration`; guarded by `orchestration-manifest.spec.ts`.
> - **P3 (AgentBase import):** `import-manifest.ts` parses it; `agents.exposure` + `orchestrator_agent_id` (migration `0007`); pipeline registers full-crew vs orchestrator-only; Studio drawer offers the choice.
> - **P4 (telemetry):** R1 pre-existing; R4 (span attrs) + R5 (OTLP endpoint injection) in AgentBase; R2/R3 (OTel bootstrap) in Precast `telemetry/otel.ts`.
> - Verified by typecheck/lint/tests/`mastra build`. **Not live-verified:** e2e trace stitch through the built container + the Studio drawer render (need a running stack). **P5 deferred:** `CREW_ROUTE_VIA_AGENTBASE`, Studio Expose/Hide.
>   **Origin:** Precast boilerplate idea — ship a default _orchestrator_ agent as the single point of contact for every Precast Mastra `apps/agents`, while each subagent keeps its own A2A card and stays independently usable. On AgentBase import, the operator chooses **full crew** vs **orchestrator only**.
>   **Scope:** spans **Precast** (boilerplate), **AgentBase** (import contract + registry + telemetry), and the **ecosystem** (`precast`, `precast-plugin`, `precast-ground-zero`). Mirror per the ecosystem-alignment rule.

---

## 1. Goals

1. **Single point of contact.** A consumer can talk to one agent (the orchestrator); it routes to the right specialist.
2. **Subagents stay first-class.** Each subagent keeps its own A2A card (`/api/.well-known/:id/agent-card.json`) and is directly invocable — standalone, not swallowed.
3. **Operator choice at import.** Importing the repo into AgentBase asks: **full crew** (register orchestrator + every subagent) or **orchestrator only** (register just the front door; subagents stay internal).
4. **Complete telemetry across the full blast radius** even with in-process routing (see §5).
5. **No dead weight at N=1.** A single-agent project shouldn't pay for an orchestrator hop.

---

## 2. Orchestrator model (Precast boilerplate)

**Transport decision: in-process by default.** The orchestrator calls subagents as in-process members (Mastra **Agent Network** / agents-as-tools), not over the network. An opt-in `CREW_ROUTE_VIA_AGENTBASE=1` can route sub-hops through AgentBase's `/proxy/a2a` for orgs that want per-hop governance/billing — **off by default**.

**Single source of truth — `crew.ts`:**

```
apps/agents/src/mastra/
  crew.ts              # export { orchestrator, members }  ← the ONLY place the crew is declared
  agents/
    orchestrator.ts    # Agent Network over members; routes by their cards/skills
    <member>.ts        # normal Mastra agents — own cards, standalone
  index.ts             # registers orchestrator + members from crew.ts
```

- `index.ts` registers everything from `crew.ts`; `emit:import-manifest` is extended to emit the manifest's `orchestration` block **from `crew.ts`** (same "derive, don't hand-edit" pattern as `requiredEnv`). No drift between the Mastra wiring and the import contract.
- **N=1:** `defineCrew()` makes the orchestrator a transparent pass-through (or skips it) when there is a single member. Scaffold it always; it activates at **2+ members**.
- **Model:** the orchestrator uses `resolveAgentModel` like any agent (org-admin-configurable when AgentBase-hosted).
- **Routing:** LLM-decided (natural-language front door — the actual value), prompt kept tight ("pick the member whose card/skills match; call it; return its output; if ambiguous, ask a clarifying question — never guess"). Explicit skill routing still works for callers who know the target.
- **Context threading:** the member-call wrapper forwards inbound A2A message context — session id, and OBO subject (`onBehalfOf`) — into each member call (generalize what the Slack digest already does), so governed egress from a member still runs as the right end user.
- **Guards:** cap crew depth (a member may itself be an orchestrator → cycle risk); bound fan-out.

Subagents remain plain Mastra agents → own cards, directly invocable at `/api/a2a/:subagent`. The orchestrator is purely additive.

---

## 3. Import contract (AgentBase)

Add an optional `orchestration` block to `agentbase.import.json` (absent ⇒ today's flat "register all" behavior; backward-compatible):

```jsonc
{
  "dockerfile": "apps/agents/Dockerfile",
  "port": 45000,
  "authEnv": "AGENT_API_TOKEN",
  "requiredEnv": ["DATABASE_URL"],
  "orchestration": {
    "orchestrator": "crew-orchestrator", // front-door agent id
    "members": ["research-agent", "writer-agent"], // optional; default = all non-orchestrator discovered agents
    "defaultImport": "orchestrator-only", // UI default: "full-crew" | "orchestrator-only"
  },
}
```

**Import flow (`apps/api/src/source-imports/`):**

1. Clone → build → host → `GET /api/agents` (discover all, as today).
2. If `orchestration` present, **validate against discovery** (named orchestrator + members must appear; mismatch → warn, don't silently drop).
3. Studio presents the choice, pre-selected to `defaultImport`:
   - **Full crew** → registry row + listing + proxy URL + subscription per agent (orchestrator _and_ each member).
   - **Orchestrator only** → registry row/listing **only** for the orchestrator; members recorded as **internal** (tracked as children for observability, but no listing, not subscribable, no proxy URL).
4. **Re-import drift** (_Pull latest_): new members stay internal (orchestrator-only) or auto-register (full-crew, via the existing APPROVED-by-default skill review).

**Coupling to call out in the UI:** orchestrator-only presumes **in-process** routing. If a member is reached _through_ AgentBase, it needs a governed endpoint — which contradicts "internal." So the manifest choice and the routing transport are linked.

**AgentBase data model:**

- `agents.orchestrator_agent_id` (self-FK, nullable) — a member points at its orchestrator.
- `agents.exposure` — `registered` (has a listing/proxy URL) vs `internal` (reachable only via its orchestrator, in-container).
- Enables Studio to render _"Orchestrator → [members]"_ even when members are internal, plus a reversible **"Expose subagent" / "Hide"** action (promote/demote an internal member to/from its own listing).

**Governance:** orchestrator-only publishes/approves only the orchestrator's skills (smaller surface). Full-crew lets each specialist be approved/suspended individually.

---

## 4. Metering / product model

Billing surface, all expressible with AgentBase's existing PER_CALL / PER_TOKEN listing pricing:

| Model                                          | Consumer pays                             | Fits                           | Internal fan-out cost                  |
| ---------------------------------------------- | ----------------------------------------- | ------------------------------ | -------------------------------------- |
| **Front door** (orchestrator-only, in-process) | one price per orchestrator call           | packaged outcome; simplest SKU | absorbed into the orchestrator's price |
| **Per hop** (full-crew, A2A routing)           | each subagent call metered                | usage-based, granular          | itemized (can surprise consumers)      |
| **Hybrid**                                     | orchestrator routing fee + subagent usage | most transparent               | most complex                           |

Two product framings from the **same repo** (provider picks at import, matching `defaultImport`):

- **Managed crew** = orchestrator-only + front-door price → sell the result, hide the machinery.
- **Composable agents** = full-crew, each subagent independently subscribable/priced, orchestrator optional.

**Principle: decouple billing granularity from audit granularity.** Even front-door billing records _which member ran_ — as OTel spans + (for governed egress) `audit_calls` rows — without itemizing the invoice. "Bill the front door, audit the whole tree."

---

## 5. Telemetry & complete visibility (the full blast radius)

**Question answered:** in-process routing does **not** cost visibility — but visibility comes from **OpenTelemetry distributed tracing**, not from AgentBase's proxy `audit_calls` alone. In-process hops never touch the network, so they produce **spans**, not proxy rows.

**Two planes:**

1. **AgentBase audit ledger (`audit_calls`)** — one row per _governed network hop_ through the proxy: the inbound orchestrator invocation, and each member's **egress** back through AgentBase (`/proxy/mcp`, `/proxy/llm`, or `/proxy/a2a` if a member calls another registered agent). Carries credits, status, org, subscription, `on_behalf_of`, and **`trace_id`**. → billing + governance plane.
2. **OpenTelemetry traces** — spans for _everything_, including the in-process routing that never hits the wire: the orchestrator's routing LLM decision, each member agent run, each member tool call, and the egress calls (which also produce audit rows). → observability plane.

**The stitch — W3C `traceparent` propagation end-to-end:**

```
AgentBase proxy: POST /proxy/a2a/<org>/<orchestrator>     [audit_call · billed · starts trace]
└─ orchestrator.run  (Mastra container, continues traceparent)
   ├─ orchestrator route decision (LLM)                   [span] + [audit_call via /proxy/llm]
   ├─ member: research-agent.run  (IN-PROCESS)            [span — no proxy call]
   │  ├─ tool: web-search                                 [span]
   │  └─ LLM via gateway                                  [span] + [audit_call · billed]
   └─ member: writer-agent.run   (IN-PROCESS)             [span]
      └─ slack_read_channel via MCP proxy (OBO)           [span] + [audit_call · OBO]
```

One trace tree: routing internals = spans; governed/billed hops = `audit_calls`; **both share `trace_id`** → complete, correlatable visibility across the full blast radius, with front-door billing intact.

**Requirements to guarantee "complete" (all must hold):**

- **R1 — Proxy injects context.** AgentBase injects `traceparent` on every `/proxy/*` egress relay (inbound A2A → container).
- **R2 — Container continues the trace.** Precast adopts AgentBase's rule: initialize the OTel SDK **before any other import** in the agents entrypoint; continue the inbound `traceparent`.
- **R3 — In-process + egress propagation.** The member-call wrapper keeps trace context across in-process hops (same async context) **and** forwards `traceparent` on egress to `/proxy/mcp` and `/proxy/llm`, so those proxy spans + audit rows join the same trace.
- **R4 — Consistent attributes** on spans and audit rows: `agentbase.org`, `agent.id`, `agent.orchestrator`, `agent.member`, `subscription.id`, `on_behalf_of` (redacted), `credits`.
- **R5 — Shared OTLP backend.** AgentBase injects `OTEL_EXPORTER_OTLP_ENDPOINT` into hosted containers, pointing at the org's bring-your-own backend, so both AgentBase and container spans land in one place and the backend assembles the tree.

**Gap to design around:** if an org does **not** wire an OTLP backend for the hosted container, the in-process spans are lost (only `audit_calls` remain → governed hops visible, routing internals not). So "complete visibility" is contingent on R5. AgentBase should make OTLP export **turnkey for hosted containers** (inject the endpoint at deploy, default to the org's configured backend) rather than leaving it to each repo.

**Net:** front-door **billing** (one charge) + full-tree **telemetry** (every hop, in-process included) — achievable in-process, contingent on trace propagation (R1–R4) and hosted-container OTLP export (R5).

---

## 6. Cross-cutting risks / decisions

- **Routing failure modes:** misroute (LLM picks wrong member), ambiguity (ask, don't guess), latency + cost of the routing hop. Keep the router prompt tight; consider a cheap router model.
- **Loops / recursion:** a member that is itself an orchestrator → cycle. Cap depth; detect self-reference.
- **Rate limits:** fan-out multiplies calls against per-listing limits (full-crew / A2A mode). Budget accordingly.
- **OBO / context correctness:** the subject must survive orchestrator → member → egress. This is the subtlest correctness bit; test it explicitly (the Slack digest is the reference case).
- **N=1:** transparent pass-through; no orchestrator hop.

---

## 7. Ecosystem blast radius (mirror per alignment rule)

| Repo                    | Change                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **precast**             | `crew.ts` + orchestrator (Agent Network, in-process); `defineCrew()`; extend `emit:import-manifest` to write `orchestration`; OTel-init-before-imports; member-call wrapper (context + traceparent propagation).                                                                                                                  |
| **precast-plugin**      | Mirror the crew scaffolding + manifest emission so plugin-generated projects are import-choice-aware.                                                                                                                                                                                                                             |
| **precast-ground-zero** | Mirror the boilerplate structure + docs.                                                                                                                                                                                                                                                                                          |
| **AgentBase**           | `source-imports`: read `orchestration`, present full-crew/orchestrator-only, register accordingly; data model (`orchestrator_agent_id`, `exposure`); Studio import UI + "Expose/Hide subagent"; proxy `traceparent` injection (R1); inject `OTEL_EXPORTER_OTLP_ENDPOINT` into hosted containers (R5); audit/span attributes (R4). |

---

## 8. Phased build (smallest slice first)

1. **Precast:** `crew.ts` + orchestrator (Agent Network, in-process), active at 2+ members. Verify subagents keep cards + standalone. — **DONE (2026-08-11).** `mastra/crew.ts` (single source) + `lib/crew.ts` (`defineCrew`/`crewAgents`, N=1 pass-through, 2+ activation, reserved-id/duplicate/nested-crew guards) + `agents/orchestrator.ts` (`createOrchestrator`, in-process `agents:` Agent Network, tight router prompt, no memory by design) + `index.ts` registers `crewAgents(crew)`. Members unchanged → keep their own cards. Verified: typecheck, lint, 51 agents tests (8 new `lib/crew.spec.ts`), `mastra build`. Live A2A-card fetch deferred — checkout has placeholder DB creds only (see HANDOFF §1 carry-forward).
2. **Precast:** extend `emit:import-manifest` to emit `orchestration`. — **DONE (2026-08-11).** `scripts/emit-import-manifest.mjs` reads `ORCHESTRATOR_ID` (single source, regex — no TS loader/DB) and writes `orchestration` (`members` omitted → discovered; `defaultImport: orchestrator-only`); guarded by `apps/agents/src/mastra/orchestration-manifest.spec.ts`.
3. **AgentBase:** read `orchestration` → full-crew vs orchestrator-only prompt → register accordingly (+ `exposure`, `orchestrator_agent_id`). — **DONE (2026-08-11).** `import-manifest.ts` zod-parses it; migration `0007` adds `agents.exposure` + `agents.orchestrator_agent_id` (self-FK); `source-imports.service.ts` `resolveCrewMembership()` reconciles vs discovery + registers accordingly (internal members bound, not synced; declared-but-undiscovered ⇒ flat; re-import mode inferred from existing rows); `agents.dto`/repo surface the fields; `ImportRepoDrawer.vue` offers the choice pre-selected to `defaultImport`. Tests in `import-manifest.spec.ts` + `source-imports.service.spec.ts`.
4. **Telemetry:** R1–R5 — proxy traceparent injection, container OTel init + propagation, hosted OTLP endpoint injection, consistent attributes. — **DONE (2026-08-11).** R1 pre-existing (`buildHeaders`); R4 mirrors audit dims onto the egress span (`proxy.service.ts` + `OTelAttributes`); R5 `resolveAgentOtlpEndpoint()` injects `OTEL_EXPORTER_OTLP_ENDPOINT` into imported + composed containers (best-effort); Precast `telemetry/otel.ts` (imported first) gives R2/R3. **Live e2e stitch through the built container is a carry-forward** (needs a running stack; ESM instrumentation wants a `node --import` preload).
5. **Later opt-in:** `CREW_ROUTE_VIA_AGENTBASE` (per-hop governed routing) + per-hop metering; "Expose/Hide subagent" Studio action. — **DEFERRED (not built).**

---

## 9. Open questions

1. Router model — reuse the org's chosen model, or a dedicated cheap router?
2. Should `members` be authored in the manifest or fully derived from `crew.ts` (preferred — single source)?
3. Internal members' skills — surfaced read-only in Studio for transparency, or fully hidden?
4. Trace retention / cost — full-tree spans on every call can be voluminous; sampling policy for hosted containers?
5. Does `defaultImport` belong in the repo (provider's suggestion) or purely a Studio-side org choice?
