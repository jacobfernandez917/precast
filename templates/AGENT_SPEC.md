# AGENT_SPEC — Mastra Agent Specification

> **Template + worked example.** Specify each agent's job, its tools, and its
> guardrails _before_ implementing, so behavior is intentional rather than
> emergent. The example specs the **reservation agent** shipped in
> `apps/agents/src/mastra/` — replace with your agents.

**Last updated:** [ISO date] · **Runtime:** Mastra (see [TECH_STACK](../docs/TECH_STACK.md))

---

## 1. Agent: Reservation Agent

**Id:** `reservation-agent` · **Model:** `<provider>/<model>` — e.g. `anthropic/claude-sonnet-5`, `openai/gpt-5.1`, or `google/gemini-2.5-flash` (via Mastra model gateway; no provider is hardcoded as the default — see `apps/agents/src/mastra/lib/default-model.ts`)

**Job:** Turn a natural-language request into a confirmed room booking through
chat, asking for missing details and never inventing data.

### Instructions (behavioral contract)

- Always call **check-availability** before **book-room**. Never invent room ids.
- Ask for any missing detail (time window, party size, organizer) before acting.
- Restate relative times ("tomorrow 2pm") as absolute ISO times before booking.
- After booking, confirm room name, time, and organizer back to the user.

### Tools

| Tool                 | Purpose                                      | Input (zod)                                   | Output                                 |
| -------------------- | -------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| `check-availability` | Find rooms free for a window + min capacity. | `{ start, end, minCapacity }` (ISO datetimes) | `{ available: Room[] }`                |
| `book-room`          | Reserve a specific room for a window.        | `{ roomId, start, end, organizer, title }`    | `{ reservationId, roomId, confirmed }` |

> Tool input/output schemas are the source of truth and must mirror
> [DATA_MODEL.md](DATA_MODEL.md). Implement under `apps/agents/src/mastra/tools/`
> (the boilerplate ships only a neutral `example-tool.ts` placeholder).

### Guardrails

- **Grounding:** room ids only come from `check-availability` output; `book-room`
  rejects unknown ids.
- **Confirmation:** never book without an explicit time window and organizer.
- **Idempotency (todo):** dedupe identical `{roomId, start, end}` requests.

## 2. Conversation examples

**Happy path**

```
User:  Book a room for 6 people tomorrow 2–3pm.
Agent: (check-availability start=2026-07-11T14:00Z end=…T15:00Z minCapacity=6)
       Birch (8 seats, floor 2) and Cedar (16, floor 3) are free. Which one?
User:  Birch.
Agent: (book-room roomId=room-birch …)
       Booked Birch, 2–3pm tomorrow, organizer you. Reservation res-room-birch-…
```

**Missing detail**

```
User:  Get me a room.
Agent: Sure — for when, how long, and how many people?
```

## 3. Memory & storage

Agent memory/threads persist via the Mastra `storage` adapter (LibSQL by
default; see `apps/agents/src/mastra/index.ts` and `MASTRA_DB_URL`). Not durable
until a real store is configured for production.

## 4. Evaluation (todo)

- Add scorers for: booked-the-right-capacity, asked-before-assuming,
  never-double-booked. Track pass rate as an acceptance gate.
