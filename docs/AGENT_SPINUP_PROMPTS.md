# Agent Spin-up Prompts (reusable)

> Reusable prompt scaffolding for building a domain agent on top of Precast with a
> coding agent (Claude Code, etc.). Fill the `<PLACEHOLDERS>`, then drive the build
> turn by turn. This file ships intentionally lean — extend it with your project's
> own prompts as you go.

## Placeholders

| Token           | Description                                   |
| --------------- | --------------------------------------------- |
| `<AGENT_NAME>`  | Agent identifier (e.g. `support-bot`)         |
| `<DOMAIN>`      | Domain of expertise                           |
| `<MCP_NAME>`    | External MCP/tool source, if any              |
| `<MCP_URL>`     | MCP endpoint URL                              |
| `<MODEL>`       | LLM model string (e.g. `anthropic/claude-sonnet-5`, `openai/gpt-5.1`, or `google/gemini-2.5-flash`) |

## Suggested sequence

1. **Plan** — copy the relevant `templates/*.md` (PRD, DATA_MODEL, AGENT_SPEC, DESIGN_SYSTEM) into `docs/` and fill them in for `<DOMAIN>`.
2. **Model** — choose `<MODEL>` and add its provider key (Anthropic/OpenAI/Google) to the root `.env`; leave `DEFAULT_LLM_MODEL` unset to let `resolveDefaultModel()` auto-detect it, or set `DEFAULT_LLM_MODEL=<MODEL>` explicitly.
3. **Build the agent** — define the Mastra agent + tools in `apps/agents/src/mastra/`; attach external tools via `@mastra/mcp` if using `<MCP_NAME>`.
4. **Persist** — add your data model to `packages/shared` / the remote Postgres (`DATABASE_URL`) as needed.
5. **Auth** — protect the agent API with the static bearer `AGENT_API_TOKEN` (Mastra middleware).
6. **Verify live** — boot the app, exercise the agent end to end, confirm the A2A card + logs.

> One-shot fire-off prompt (short form):
>
> Build `<AGENT_NAME>` on this Precast monorepo (Mastra + Next.js): a `<DOMAIN>` agent
> using `<MODEL>`. Update the feed-forward docs first, wire the tools, protect the API
> with `AGENT_API_TOKEN`, keep secrets in the root `.env`, and verify it live before
> reporting done.
