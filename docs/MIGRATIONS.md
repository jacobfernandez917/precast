# MIGRATIONS.md — Keeping a derived project aligned with Precast

> **What this is.** Precast's release ledger. A project scaffolded from Precast keeps
> improving on its own; so does Precast. This file is how the two stay in touch — it records
> what each release changed and, crucially, **what `pnpm precast:update` can do for you and
> what it can't**.

**Audience:** anyone (human or agent) upgrading a project that was scaffolded from Precast.
For Precast's own version/library inventory see [TECH_STACK.md](TECH_STACK.md).

---

## 1. Why a ledger instead of `git merge`

`pnpm bootstrap` deletes Precast's git history on purpose — a new project shouldn't inherit
the boilerplate's commits. The cost is that a derived project has **no common ancestor** with
upstream, so `git merge upstream/develop` isn't available.

Two mechanisms replace it:

|                 | Mechanism                                                                          | Covers                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **File sync**   | `pnpm precast:update` — 3-way comparison against the hashes in `precast.lock.json` | The framework surface: `scripts/`, `.githooks/`, `docker/`, `templates/`, the lint/TS/Turbo configs, `CLAUDE.md`                 |
| **This ledger** | Per-release notes with concrete edits                                              | Everything the sync can't touch: `apps/`, `packages/`, `package.json`, `.env.example` — i.e. anywhere your project has real code |

The sync handles the mechanical majority. The ledger handles the rest, and an agent reading
it can adapt an instruction like "add X to the A2A client" onto code you've since restructured.

---

## 2. Upgrading, start to finish

> **Easiest path — ask your coding agent.** The Precast plugin ships an **`upgrade`** skill
> that drives this whole section: say _"upgrade precast"_ (or `/precast:upgrade`) and it reads
> your lock file, runs the check, summarizes the releases in between, applies the safe set,
> then works the manual steps below against your actual codebase. The steps here are what it
> follows — and what to do by hand if you'd rather.

```bash
pnpm precast:update                 # check only — prints the plan, writes nothing
pnpm precast:update --apply         # take the safe changes
pnpm precast:update --apply --force # also overwrite conflicts (keeps a .precast-bak)
```

1. **Check first.** The plan classifies every managed file as `Update` (you never touched it —
   safe), `Yours` (you customized it, upstream didn't change — left alone), `CONFLICT` (both
   sides moved), `New`, or `Already current`.
2. **Apply the safe set.** Conflicts are skipped and their baseline is deliberately _not_
   advanced, so they keep reporting until you deal with them rather than going quiet.
3. **Read this ledger** for every version between your old and new `precastVersion`, and do
   the manual steps — that's the `apps/`/`packages/` work the sync won't attempt.
4. **Run the tests.** `pnpm verify:poc` for a quick typecheck, then `pnpm test` (and
   `pnpm test:e2e` if routes or UI changed).
5. **Record it** in `docs/PROGRESS.md` — which Precast version you moved to and what you
   ported by hand.

### First upgrade on an older project

Projects scaffolded before provenance tracking existed have no `precast.lock.json`. Record
where they came from once:

```bash
pnpm precast:update --adopt --ref=v0.2.0
```

Adoption sets the baseline to **upstream's** content at that version, so anything you have
since customized shows up as `Yours` and is left alone. `v0.2.0` is the earliest tag that
exists, so it is the right baseline for every pre-provenance project — you'll get a longer
plan to review, not a wrong result.

### Useful flags

| Flag                | Effect                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `--ref=v0.3.0`      | Target a specific tag, branch, or commit (default: the newest semver tag) |
| `--from=../precast` | Compare against a local checkout — no network, useful for testing         |
| `--repo=<url>`      | Point at a fork                                                           |
| `--force`           | Overwrite conflicts, writing `<file>.precast-bak` first                   |

### What is never written automatically

Files listed under `advisory` in `precast.manifest.json` are reported but never overwritten,
because a derived project always has real changes in them: `package.json`, `.env.example`,
`agentbase.import.json`, the fitness-guard specs (`a2a-only.spec.ts`, `ports.spec.ts`,
`docker-build.spec.ts`, …), and `packages/shared/src/{env,database}.ts`. When one shows up in
the advisory list, read the release entry below and port the change by hand.

---

## 3. How releases are numbered

Semver, applied to the boilerplate rather than to a library:

- **Patch** — fixes and doc corrections; `--apply` is safe and rarely conflicts.
- **Minor** — new capability, backward compatible. May add advisory items (a new env var, a
  new script) needing a small manual step.
- **Major** — a structural change (moved directories, a changed architectural rule, a
  replaced service). Expect real manual work and read the entry in full before applying.

Each entry below states the manual steps explicitly. **If a release needs no manual work, it
says so** — silence means the entry is incomplete, not that there's nothing to do.

---

## 4. Releases

<!--
  Newest first. Template for a new entry — keep every heading, and write "None." rather
  than dropping a section, so a reader can trust the absence of work.

  ## vX.Y.Z — <short title>  (<date>)

  **What changed.** One paragraph: what moved and why it was worth changing.

  **Handled by `pnpm precast:update`.** The managed files that carry the change.

  **Manual steps.** Numbered, concrete, with file paths. "None." if there are none.

  **Advisory files touched.** Which advisory entries will appear in the plan, and what to
  copy across for each. "None." if there are none.

  **Verify.** The command(s) that prove the upgrade landed.
-->

## v0.8.1 — an unconnected MCP account no longer fails the boot (2026-08-18)

**What changed.** `resolveAgentMcpTools()` treated **every** subscribed-server connect failure
as fatal. One of them isn't. A 401 carrying `mcp_server_authorization_required` means
"subscribed, but nobody has connected an **account** for this identity yet" — an expected,
human-actionable OAuth state that clears when someone clicks **Connect account** in the
AgentBase registry, and that **no redeploy can fix**.

Because the call sits behind a top-level `await` in the agent's `tools:`, the throw killed the
container: crash-loop, readiness probe never answers, import fails — over a state the operator
would have cleared in one click had the agent been allowed to start. For **on-behalf-of**
products it is worse still: the service identity may legitimately never hold a token, because
each end user connects their own account, so such a container could never boot at all.

Connect failures are now partitioned. Authorization-pending servers are **skipped with a loud
`console.warn`** naming the server and agent and saying its tools are omitted until an account
is connected. **Every other failure still throws, verbatim** — DNS, 5xx, upstream down. The
fail-loud design against *silent tool loss* is intact; only the OAuth-pending case is
reclassified. **Discovery** failures are not touched at all.

Reproduced live on a hosted import of a Precast-derived repo before the fix, which is where
the exact error shape in the specs comes from.

**Handled by `pnpm precast:update`.** Nothing from the fix itself — `apps/` code is yours. The
lint fix below **is** picked up automatically: `eslint.config.js` is a managed file.

**Manual steps.**

1. **Port the partition into your `apps/agents/src/mastra/lib/agentbase-mcp.ts`**, or copy the
   file wholesale if you have not customized it. You need the local `isMcpAuthError()` helper
   plus the `authPending` / `broken` split around `listToolsWithErrors()`. The helper walks
   `Error.cause` chains, accepts both `Error` and string values (the SDK surfaces both), and
   guards against cause cycles — a self-referencing `cause` would otherwise hang the boot,
   which is a worse bug than the one being fixed.
2. **Copy `apps/agents/src/mastra/lib/agentbase-mcp.spec.ts`.** Three cases, and they fix the
   *boundary* rather than the bug: auth-pending is skipped, non-auth still throws, and a
   healthy server's tools survive next to a skipped one. Widen the predicate and case 2 fails —
   which is the point, because a too-generous `isMcpAuthError` silently restores the
   silent-tool-loss failure mode this path exists to prevent.
3. **Update any comment at your `...(await resolveAgentMcpTools(...))` call sites** that says a
   hosted connect failure fails the boot. It is now true of every failure *except* one.
4. **Nothing to change in `.env` or the env schema.**

**Advisory files touched.** `apps/agents/src/mastra/lib/agentbase-mcp.spec.ts`.

**Also in this release — the scripts lint block (`eslint.config.js`, managed).** The block
granted only `process` / `console` / `URL`, but scripts from v0.4.0 onward use `fetch`,
`setTimeout` and `AbortSignal` (`poc.mjs`, `check-docker.mjs`), `precast-update.mjs` needs
`varsIgnorePattern: '^_'`, and `rename-project.mjs` trips `no-control-regex`. The effect was
that **lint-staged failed any commit that staged those scripts** — reproducible before the fix
with `pnpm exec eslint scripts/*.mjs`. The block now grants the missing readonly globals,
ignores `^_` unused vars, and turns off `no-control-regex` for scripts. If you fixed this
locally already, expect `precast:update` to report `eslint.config.js` as a **conflict**; take
whichever is the superset.

**Verify.**

```bash
pnpm test                      # the three new cases live in AGT-007
pnpm exec eslint scripts/*.mjs # clean, where it previously failed
```

---

## v0.8.0 — one credential set for all of AgentBase (2026-08-15)

**What changed.** AgentBase credentials no longer carry an `LLM_` infix. One AgentBase
Application authenticates **every** capability — the LLM gateway, the MCP proxy, and the A2A
proxy — so naming the credentials after one of them was always a misnomer. (`agentbase-mcp.ts`
already minted its token from the LLM-named pair, precisely because a token for one
authenticates the other.)

| Concern                | Write this                                       | Was                             |
| ---------------------- | ------------------------------------------------ | ------------------------------- |
| Client id              | `AGENTBASE_CLIENT_ID`                            | `AGENTBASE_LLM_CLIENT_ID`       |
| Client secret          | `AGENTBASE_CLIENT_SECRET`                        | `AGENTBASE_LLM_CLIENT_SECRET`   |
| Token endpoint         | `AGENTBASE_TOKEN_URL`                            | `AGENTBASE_LLM_TOKEN_URL`       |
| Per-agent override     | `AGENTBASE_CLIENT_ID_<AGENT_ID>`                 | `AGENTBASE_LLM_CLIENT_ID_<…>`   |
| LLM gateway URL        | `AGENTBASE_LLM_BASE_URL` — **unchanged**         | —                               |
| Model                  | `AGENTBASE_LLM_MODEL[_<AGENT_ID>]` — **unchanged** | —                             |
| MCP proxy root         | `AGENTBASE_MCP_BASE_URL` — **unchanged**         | —                               |

The rule: **identity is unprefixed; capability endpoints and settings keep their infix.** The
web app's `AGENTBASE_CLIENT_ID` was already the unprefixed form, so this consolidates two
parallel credential sets into one rather than inventing a name.

**Nothing breaks if you do nothing.** The old names are still read, and deliberately so:
AgentBase *injects* `AGENTBASE_LLM_CLIENT_ID_<AGENT_ID>` into a hosted container, and this repo
does not control the injector. Resolution per setting is per-agent canonical → per-agent legacy
→ account canonical → account legacy, so an org admin's Studio choice still outranks anything in
a repo `.env`. Pinned by `agentbase-model.spec.ts`.

**What the sync does.** `scripts/bootstrap.mjs` is managed, so `precast:update` takes it. The
rest is advisory and yours to port: `packages/shared/src/env.ts`, `.env.example`, and
`apps/agents/src/mastra/lib/agentbase-{model,mcp}.ts` if you have customized them.

**Migrating your `.env` (optional but recommended).** One rename, and a check for the duplicate
that would otherwise bite:

```bash
# 1. Adopt the canonical credential names.
sed -i '' \
  -e 's/^AGENTBASE_LLM_CLIENT_ID=/AGENTBASE_CLIENT_ID=/' \
  -e 's/^AGENTBASE_LLM_CLIENT_SECRET=/AGENTBASE_CLIENT_SECRET=/' \
  -e 's/^AGENTBASE_LLM_TOKEN_URL=/AGENTBASE_TOKEN_URL=/' \
  .env

# 2. CRITICAL — check for duplicates. If your .env already had the web app's
#    AGENTBASE_CLIENT_ID, step 1 just created a SECOND assignment. dotenv lets
#    the LAST one win, so an empty duplicate silently blanks a real credential.
grep -c '^AGENTBASE_CLIENT_ID=' .env    # must print 1
grep -c '^AGENTBASE_CLIENT_SECRET=' .env
grep -c '^AGENTBASE_TOKEN_URL=' .env
```

If any count is 2, delete the empty one. If the two held **different** values you were running
two Applications (one for web/A2A, one for agents/LLM); keep whichever is subscribed to more,
and subscribe it to the rest in Studio — one token is only as good as its subscriptions.

**If you customized `agentbase-model.ts`:** `getAgentBaseLlmToken` is now `getAgentBaseToken`,
and `llmEnvValue`/`llmEnvVarName` became `agentBaseEnv`/`envVarName` with a four-candidate
lookup. Update any local callers.

---

## v0.7.0 — the workspace scope stays `@precast/*` (2026-08-14)

**What changed.** `pnpm rename` no longer renames the **workspace package scope**. A derived
project keeps `@precast/shared`, `@precast/agents`, `@precast/web`, the `@precast/*` tsconfig
aliases, and `pnpm -F @precast/…` scripts exactly as shipped.

**Runtime identity is still renamed** — the Compose project `name:`, `container_name:`, image
tags, and the Keycloak realm/client id. That half is not optional: omitting the Compose
`name:` once caused one project's `pnpm poc` to recreate _another project's_ Keycloak
container (APP-013).

**Why.** The scope is internal — never published to npm, never installed alongside another
project — so two projects both owning `@precast/shared` cannot collide. Renaming it cost two
real things:

- **`pnpm-lock.yaml` records workspace package names**, so the rename alone moved the
  deps-image cache key. Verified: renaming a full checkout used to change the lockfile hash;
  now `f7fae34ddbc6c518` before and after.
- **`pnpm precast:update` replays this rename** over upstream and diffs, so a renamed scope
  made every one of ~36 scope-bearing files differ _by construction_ — permanent noise on
  every upgrade.

**Handled by `pnpm precast:update`.** `scripts/rename-project.mjs`.

**Manual steps — a one-time codemod, for projects scaffolded before v0.7.0.**

Your project currently has a renamed scope (`@yourproject/shared`). Until you rename it back,
`precast:update` will report every scope-bearing file as a **CONFLICT**, because the replayed
upstream now says `@precast/*` and your files do not.

From your project root, with a clean working tree:

```bash
# 1. Point every reference back at the shipped scope.
grep -rl '@yourproject/' --exclude-dir=node_modules --exclude-dir=.git . \
  | xargs sed -i '' 's|@yourproject/|@precast/|g'      # GNU sed: drop the ''

# 2. Rebuild the lockfile so it records the shipped names.
pnpm install

# 3. Confirm nothing runtime-identifying got caught up in it.
git diff --stat
grep -n '^name:\|container_name:' docker/docker-compose.yml   # must still be YOUR project
```

It is a mechanical, internal-only rename: no published package changes, no runtime behaviour
changes, and the container/Compose/Keycloak names are untouched because they never carried
the scope. Then `pnpm test` and `pnpm poc` as usual.

**Advisory files touched.** `package.json` and `packages/shared/package.json` (the `name`
fields revert to `@precast/*`); `tsconfig.base.json` aliases; `apps/web/test/deps-image.spec.ts`.

**Verify.**

```bash
pnpm test          # APP-017 now pins BOTH halves: scope preserved, runtime renamed
pnpm deps:image    # your lockfile tag should now match upstream's for an unmodified graph
```

---

## v0.6.0 — AgentBase Models as a provider, and three bugs a live database found (2026-08-14)

**What changed.**

**Three fixes, all found by pointing the stack at a real Postgres for the first time.**

1. **`sslmode=require` was being verified.** `sslmode` is a libpq convention and
   node-postgres does not implement it faithfully: under libpq `require` means _encrypt, do
   NOT verify_ — verification is what `verify-ca`/`verify-full` are for. node-postgres
   verifies anyway, so any managed instance behind a CA Node doesn't already trust (AWS RDS
   notably) crash-looped the agents container with `SELF_SIGNED_CERT_IN_CHAIN` despite a
   correct URL. New `resolvePostgresSsl()` implements libpq's mapping.
2. **`.env.example` shipped inline comments inside values.** Docker Compose's `env_file` does
   not strip them, so a line of the form `KEY=` followed by a trailing `#` comment handed
   every scaffolded project that comment **as the value** — in this case a 48-character
   "API key" containing an em dash. It silenced the no-provider warning _and_ killed every
   LLM call in HTTP header encoding.
3. **Prettier was reformatting the generated `apc-themes.css`**, breaking APC-002 on every
   `pnpm format`.

**AgentBase Models is now an LLM provider choice.** Previously the only options were vendor
keys, unless AgentBase was _hosting_ the repo. The runtime now falls back from the SUFFIXED
per-agent vars (platform-injected, ADR-016) to UNSUFFIXED account-level ones, so a developer
whose org runs AgentBase can use its onboarded models from local dev, Standalone, or External
— with no vendor key in the repo at all.

**Handled by `pnpm precast:update`.** `scripts/bootstrap.mjs` (the new provider, its five
prompts and `--agentbase-*` flags) and `.prettierignore`.

**Manual steps.**

1. **Fix any baked SSL failure.** Copy `resolvePostgresSsl()` from
   `packages/shared/src/database.ts` and apply it where you build your Postgres client —
   in Precast that is `getPrecastStore()` (`apps/agents/src/mastra/lib/storage.ts`), which
   now spreads `...(ssl === undefined ? {} : { ssl })`. Skip this only if your provider's CA
   is already in Node's trust store; if your container dies with
   `SELF_SIGNED_CERT_IN_CHAIN`, this is why.
2. **Audit your `.env.example` for inline comments on the value side.** Any
   `KEY=  # explanation` line is shipping that explanation _as the value_. Move the comment
   to its own line above. Do the same in your `.env`. Guard: APP-019.
3. **Add the account-level env vars** to your schema as optional:
   `AGENTBASE_LLM_CLIENT_ID`, `AGENTBASE_LLM_CLIENT_SECRET`, `AGENTBASE_LLM_MODEL`.
4. **Port the credential fallback** in `apps/agents/src/mastra/lib/agentbase-model.ts` —
   `llmEnvValue()` reads the per-agent var first and the unsuffixed one second. **Keep that
   order.** If account-level won, a stale value in a repo's `.env` would silently override an
   org admin's per-agent Studio choice on a hosted container.
5. **Widen the boot warning** so it stays quiet when `isAgentBaseLlmConfigured()` is true —
   a project on the gateway holds no vendor key on purpose.
6. **Add `apps/web/app/theme/apc-themes.css` to `.prettierignore`** if you generate it.

**Advisory files touched.** `packages/shared/src/{database,env}.ts`; `.env.example` (the
comment fix, plus the new AgentBase block); `package.json`;
`apps/web/test/bootstrap-llm.spec.ts` (new).

**Verify.**

```bash
pnpm test    # APP-019/APP-020, AGT-008, and 5 resolvePostgresSsl cases
pnpm poc     # agents should reach healthy against your real Postgres
```

**Known unverified.** The AgentBase Models path is unit-tested only — no token has been
minted against a live gateway, and no chat round-trip has run, so agent-memory recall across
turns remains unproven. `GET /api/agents` returning the orchestrator crew against real
Postgres _is_ verified.

---

## v0.5.0 — MCP tools discovered from AgentBase at runtime (2026-08-14)

**What changed.** An AgentBase-hosted agent now learns which **MCP servers** it may call
_at runtime_, instead of having them hardcoded in `.env`. This is the MCP counterpart to
ADR-016, which did the same for models.

AgentBase already had everything except the last mile: `POST /proxy/mcp/:org/:slug/mcp`
proxies MCP calls behind `PublicProxyGuard`, injecting the upstream credential and enforcing
the subscription. What an agent could not do was learn _which_ `:org/:slug` pairs it was
entitled to — and neither existing surface answers it for a hosted agent:
`/developer/subscriptions` needs a human session, and the native
`agentbase.list_subscriptions` tool rejects org-owned service applications with
`developer_app_required`. AgentBase gains `GET /proxy/mcp/subscriptions`, answered for the **calling
application** and returning only `{org, slug, title, scopes, url}` — never `baseUrl`, never
`authConfig`. The proxy stays the only way to reach an MCP, so subscription enforcement,
metering and audit cannot be routed around.

**Handled by `pnpm precast:update`.** Nothing — this release is entirely `apps/` and
`packages/` code.

**Manual steps.**

1. **Copy `apps/agents/src/mastra/lib/agentbase-mcp.ts`.** It exports `discoverMcpServers()`
   and `resolveAgentMcpTools()`, and reuses `getAgentBaseLlmToken()` from `agentbase-model.ts`
   — the MCP proxy and the LLM gateway share one guard, so the token minted for one
   authenticates the other. No second credential is needed or wanted.
2. **Add the dependency:** `pnpm -F <your-agents-app> add @mastra/mcp` (`^1.16`).
3. **Wire it into your conversational agents** with a **top-level `await`**:

   ```ts
   tools: { myTool, ...(await resolveAgentMcpTools(AGENT_ID)) },
   ```

   The `await` is deliberate and load-bearing. The toolset is part of the agent's identity, so
   it must be settled before the agent is constructed and its A2A card is served. On a hosted
   container a discovery failure therefore fails the **boot** — visible immediately in
   AgentBase's build and runtime logs — rather than quietly serving an agent that is missing
   half its capabilities and will answer confidently without them. (**As of v0.8.1** one
   connect failure is exempt: a subscribed server with no connected account yet is skipped
   with a warning instead of failing the boot. Take that patch with this one.) Verified to
   survive
   `mastra build`. Attach it to agents that _use_ tools; a pure transformation agent
   (a summariser) should not get them, for the same reason it should not get memory.

4. **Add `AGENTBASE_MCP_BASE_URL`** to your env schema as an optional URL
   (`packages/shared/src/env.ts`). AgentBase injects it on hosted containers; it is absent
   locally, which is what makes the whole path inert off-platform.

**Advisory files touched.** `package.json` (the `@mastra/mcp` dependency);
`packages/shared/src/env.ts`; the new `apps/agents/src/mastra/lib/agentbase-mcp.spec.ts`.
Also `.prettierignore` now excludes `apps/web/app/theme/apc-themes.css` — Prettier was
reformatting a generated file and breaking APC-002 on every `pnpm format`.

**Requires AgentBase** at a version that serves `GET /proxy/mcp/subscriptions` and injects
`AGENTBASE_MCP_BASE_URL`. Against an older AgentBase the discovery call 404s and, per the
fail-loud design, the container will refuse to boot — so upgrade the platform first, or leave
`resolveAgentMcpTools()` unwired until you have. **Discovery** failures still fail the boot in
every release; v0.8.1 narrows only the per-server **connect** case, and only for
authorization-pending.

**Verify.**

```bash
pnpm test          # AGT-007 covers inert-off-platform and loud-on-failure
pnpm build:agents  # proves the top-level await survives bundling
```

---

## v0.4.0 — Prebuilt dependency image, and two image-layer fixes (2026-08-11)

**What changed.**

**Two fixes first.** `apps/agents/Dockerfile` still baked
`MASTRA_DB_URL=file:/data/mastra.db`. v0.3.0 removed the matching override from
`docker-compose.yml` but not from the image, and since Compose deliberately sets no value,
the image's default is what the container gets — and the Postgres-only schema rejects it. The
agents container could not boot. The `/data` dir and its `mkdir` are gone too; that container
has been stateless since agent memory moved to Postgres.

**A shared dependency image.** A fresh scaffold ran **three** full installs of a ~970-package,
~1.1 GB graph: once on the host and once inside _each_ app Dockerfile, which share no layers.
`docker/deps.Dockerfile` now resolves that graph once — in CI, natively per architecture — and
publishes it to `ghcr.io/<owner>/precast-deps:lock-<hash>`. The app Dockerfiles take
`ARG BASE_IMAGE`, and `pnpm poc` swaps in the published image **only when its tag matches this
lockfile**. Measured on the web image: the in-container `pnpm install` drops from **11.4 s to
1.0 s**, with the runtime image unchanged at 326 MB. The deps image costs ~337 MB on the wire,
once per lockfile, shared by both app builds.

It is strictly an accelerator. `ARG BASE_IMAGE` defaults to `node:24-alpine`, so no registry,
no network, a fork with nothing published, or `PRECAST_DEPS_IMAGE=off` all build exactly as
before. The tag being the lockfile hash is what makes a mismatch impossible to consume
silently: a mismatched tag simply does not exist.

**Handled by `pnpm precast:update`.** `docker/deps.Dockerfile`, `docker/docker-compose.yml`
(the `BASE_IMAGE` build args), `scripts/deps-image.mjs`, `scripts/poc.mjs`, and
`scripts/rename-project.mjs` (registry references are now protected from the rename — without
that, `ghcr.io/<owner>/precast-deps` became `…/<yourproject>-deps` on the first scaffold and
404'd).

**Manual steps.**

1. **Remove any baked database URL** from your `apps/*/Dockerfile`. An `ENV MASTRA_DB_URL=` or
   `DATABASE_URL=` with a non-Postgres value is a boot failure under ADR-002, not a fallback.
   Check your local `.env` for a stale `file:` value too.
2. **Parameterise your app Dockerfiles' build stage.** Replace `FROM node:24-alpine AS build`
   with:

   ```dockerfile
   ARG BASE_IMAGE=node:24-alpine
   FROM ${BASE_IMAGE} AS build
   ```

   Keep the default exactly as shown — hard-coding a registry ref there breaks every clone
   that cannot reach it. Add `--store-dir "${PNPM_STORE_DIR:-/pnpm/store}"` to the
   `pnpm install` in that stage, or the warm store in the base image is invisible and you
   silently re-download everything.

3. **Publish your own image** (optional but the point of the feature). Copy
   `.github/workflows/deps-image.yml` — it publishes under **your** `github.repository_owner`,
   needs `permissions: { packages: write }`, and builds on native amd64 + arm64 runners rather
   than QEMU. Then set `PRECAST_DEPS_IMAGE=ghcr.io/<you>/<name>-deps`. Upstream Precast's
   images will not match your lockfile once you add a dependency, which is by design.
4. **Nothing at all** if you just want the fixes. The base-image path is opt-in and silent
   when unavailable.

**Advisory files touched.** `package.json` (gains `deps:image`);
`.github/workflows/deps-image.yml` and `apps/web/test/deps-image.spec.ts` (new — port
deliberately); `apps/web/test/docker-build.spec.ts` (its base-image guard now allows the
parameterised stage, and gained a check that no image bakes a non-Postgres database URL).

**Verify.**

```bash
pnpm deps:image     # what the build will start FROM, and why
pnpm test           # includes the new guards
pnpm poc            # should print URLs; agents must reach healthy
```

---

## v0.3.0 — Postgres-only, durable agent memory, and the orchestrator crew (2026-08-11)

**What changed.** Three changes, released together.

**Postgres-only ([ADR-002](ADRS.md), supersedes ADR-001).** `DATABASE_URL` no longer accepts
SQLite. `getDatabaseKind()` is gone, replaced by `isPostgresUrl()` / `assertPostgresUrl()` —
validation rather than engine detection. The trigger was a real bug: `docker-compose.yml`
hardcoded `MASTRA_DB_URL: file:/data/mastra.db` under `environment:`, which **overrides**
`env_file`, so agent memory went to a container-local SQLite file even for projects correctly
configured for Postgres — and vanished on every `pnpm poc agents` rebuild.

**Agent memory is wired up.** Precast previously shipped no `Memory` on any agent, and the
`sessionId` plumbing from the web app was dead — nothing consumed it. Mastra only engages
memory when the A2A message carries a `contextId`, and it defaults `resourceId` to the _agent
id_, which would put every user of a deployment into one shared memory bucket. The web app now
derives both ids server-side (`apps/web/app/lib/agent-context.ts`) and never accepts them from
the request body.

**Handled by `pnpm precast:update`.** `docker/docker-compose.yml` (removes the SQLite override
and the now-unused `agents-data` volume), `CLAUDE.md` §4.5, `templates/AGENT_SPEC.md`, and
`scripts/emit-import-manifest.mjs` (now emits the `orchestration` block).

**Manual steps.**

1. **Set a Postgres `DATABASE_URL`.** If yours is `file:`/`sqlite:`/`libsql:`, the app will now
   refuse to boot with a message naming the scheme. Point it at a managed instance. There is no
   data migration path provided — a SQLite-backed project was, by ADR-002's reasoning, a
   prototype; move any data you care about yourself.
2. **Bump the Mastra family** in `apps/agents/package.json`: `@mastra/core` `^1.57`, `mastra`
   `^1.23`, add `@mastra/pg` `^1.19` and `@mastra/memory` `^1.26`, remove `@mastra/libsql`.
   `@mastra/pg` requires `@mastra/core >= 1.53`, so the bump is not optional.
3. **Swap the store.** Replace the `LibSQLStore` in `apps/agents/src/mastra/index.ts` with the
   shared `getPrecastStore()` from the new `apps/agents/src/mastra/lib/storage.ts` (copy that
   file across). One store instance is shared with every `Memory` so the process keeps a single
   connection pool.
4. **Attach memory** to your conversational agents via `createAgentMemory()` (new
   `apps/agents/src/mastra/lib/memory.ts`). Leave it off agents that perform a pure
   transformation — a summarizer's output should depend only on its input.
5. **Derive identity server-side.** Copy `apps/web/app/lib/agent-context.ts`. In your A2A route
   handler, replace any `body.sessionId` with `resolveAgentContext(body.conversationId)` and
   pass `{ threadId, resourceId }` to `callAgent()`. **This is a security fix** — if you already
   keyed memory off a client-supplied id, users could read each other's threads.
6. **Update `callAgent()`** to send `contextId` _and_ `message.metadata.resourceId`. Omitting
   the latter silently collapses all users into one memory bucket.
7. **Return `conversationId`** from the route handler and have the UI send it back on the next
   turn, or every turn starts a new thread.

**The orchestrator crew.** `apps/agents/src/mastra/crew.ts` is now the single source of truth
for a project's agent roster. `defineCrew()` scaffolds an in-process `crew-orchestrator` that
**activates at 2+ members and collapses to the sole member at N=1**, so a single-agent project
pays no routing hop. Every member keeps its own A2A card and stays independently invocable.
`emit:import-manifest` derives an `orchestration` block into `agentbase.import.json`, so the
import contract cannot drift from the wiring, and `telemetry/otel.ts` continues AgentBase's
inbound `traceparent` across the in-process hops.

**Manual steps — the crew** (continuing the numbering above):

8. **Copy the crew files** into `apps/agents/src/mastra/`: `crew.ts`, `lib/crew.ts`,
   `agents/orchestrator.ts`, and `telemetry/otel.ts`.
9. **Register from the crew.** In `mastra/index.ts`, replace the literal
   `agents: { myAgent, … }` with `agents: crewAgents(crew)`, and declare your real agents as
   `members` in `crew.ts` instead. `crew-orchestrator` is a **reserved id** — a member may not
   use it, and a member may not itself be an orchestrator (one flat layer, by design).
10. **Import telemetry FIRST.** `import './telemetry/otel';` must be the very first line of
    `mastra/index.ts`, above `@mastra/core`. The ordering is load-bearing: OpenTelemetry has to
    patch `http` before Mastra pulls it in, or trace context silently stops propagating. Set
    `OTEL_EXPORTER_OTLP_ENDPOINT` to export spans; unset, it stays inert.
11. **Regenerate the import manifest:** `pnpm emit:import-manifest`. This writes the
    `orchestration` block (`orchestrator`, `defaultImport`). Don't hand-edit it — a guard test
    checks it matches `ORCHESTRATOR_ID`. Choose `defaultImport`: `orchestrator-only` registers
    just the front door and keeps members internal; `full-crew` registers every agent.

**Advisory files touched.** `package.json` (the Mastra bumps above); `.env.example`
(`MASTRA_DB_URL` becomes an optional Postgres URL, new `MASTRA_DB_SCHEMA=mastra`);
`packages/shared/src/{env,database}.ts` (Postgres-only validation, `resolveMastraDbUrl()`);
the fitness specs `apps/web/test/{a2a-client,agent-context}.spec.ts` and
`apps/agents/src/mastra/orchestration-manifest.spec.ts`; `agentbase.import.json` (gains the
`orchestration` block — regenerate rather than copy).

**Verify.** `pnpm verify:poc`, then `pnpm test`. Then `pnpm poc` and, in the chat demo, tell the
agent your name, send a second message asking for it back, and confirm it answers — that proves
`contextId` is threading. Press **Start over** and ask again: it should still know your name,
because that fact lives in resource-scoped working memory rather than the thread.

For the crew: `GET /api/agents` should list `crew-orchestrator` alongside your members once you
have two or more. With exactly one member it is correctly **absent** — dormant, not broken.

---

## v0.2.0 — APC Design System themes + narrower port range (2026-08-06)

**What changed.** The web app now ships the **APC Design System**'s five themes — Stockholm
(default), Prague, Arctic, Nova, Melbourne — layered onto Astryx as token overrides rather
than replacing it. `pnpm bootstrap` asks which theme to use; `pnpm set-theme <name>` changes
it later. Separately, the auto-assigned port block's floor moved from 40000 to **45000**
(ceiling unchanged at 49100 — 49152 is where the OS ephemeral range starts).

**Handled by `pnpm precast:update`.** `scripts/build-apc-theme.mjs`, `scripts/set-theme.mjs`,
the updated `scripts/bootstrap.mjs` and `scripts/set-ports.mjs`, plus the generated
`apps/web/app/theme/apc-themes.css` and `apc.tokens.json`.

**Manual steps.**

1. **Wire the theme into your web app** (the sync won't touch `apps/`):
   - `apps/web/app/globals.css` — add `apc-theme` to the `@layer` order, immediately after
     `astryx-theme`, and `@import './theme/apc-themes.css';` after the Astryx theme import.
   - `apps/web/app/layout.tsx` — `import { APC_THEME } from './theme/apc-theme';` and render
     `<html lang="en" data-apc-theme={APC_THEME}>`.
   - Copy `apps/web/app/theme/apc-theme.ts` across (it holds _your_ theme choice, so the sync
     reports it as advisory rather than overwriting it).
2. **Pick a theme:** `pnpm set-theme <name>`, or keep the Stockholm default.
3. **Audit hard-coded colours.** Any literal hex in your components will look correct in one
   theme and wrong in the other four. Replace with semantic roles.
4. **Copy the text-wrapping block** into `apps/web/app/globals.css` (bottom of the file, in
   `@layer components`): `text-wrap: pretty` on `:where(body)` and `text-wrap: balance` on the
   heading selector. Set it on `body` so it inherits — a `p, li, …` tag list misses Astryx
   components, which render prose in `<span>`. Note `text-wrap: normal` is **not** a valid
   value and is silently dropped; the opt-out is `text-wrap: wrap`.
5. **Optional — re-pick ports** onto the narrower range with `pnpm set-ports --auto`. Existing
   ports in 40000–44999 still work; nothing forces a change.

**Advisory files touched.** `package.json` — gains two scripts:

```json
"set-theme": "node scripts/set-theme.mjs",
"theme:build": "node scripts/build-apc-theme.mjs"
```

`apps/web/test/ports.spec.ts` — the range comment now reads 45000–49151. New guards you may want to copy: `apps/web/test/apc-theme.spec.ts` and `apps/web/test/typography.spec.ts`.

**Verify.**

```bash
pnpm theme:build --check   # committed CSS matches the tokens
pnpm test:web              # includes the APC contrast + mapping guards
pnpm poc web               # look at it
```

---

## v0.1.0 — Provenance and the upgrade path _(never tagged — shipped inside v0.2.0)_

> **Not a release you can target.** This work landed on `develop` and was published as part
> of **v0.2.0**; there is no `v0.1.0` tag. It is kept as a separate entry because it is a
> distinct mechanism worth reading on its own. Use `--ref=v0.2.0` anywhere a version is asked
> for.

**What changed.** The provenance mechanism, and the point from which upgrades become
possible at all. Adds `precast.manifest.json` (release identity + the managed/advisory file
map), `precast.lock.json` (written by `pnpm bootstrap`, recording the upstream version,
commit, project name, and a hash baseline for every managed file), `scripts/precast-lock.mjs`,
`scripts/precast-update.mjs`, and this ledger.

Everything before this point is untagged history with no provenance record.

**Handled by `pnpm precast:update`.** Nothing yet — this release _is_ the mechanism. From the
next release onward, changes under `scripts/`, `.githooks/`, `docker/`, `templates/`, the root
configs, and `CLAUDE.md` sync automatically.

**Manual steps.** For a project scaffolded **before** this mechanism existed, adopt a baseline
once:

```bash
pnpm precast:update --adopt --ref=v0.2.0
```

Projects scaffolded from v0.2.0 or later get their `precast.lock.json` from `pnpm bootstrap`
and need no manual step.

**Advisory files touched.** `package.json` — gains two scripts:

```json
"precast:version": "node scripts/precast-lock.mjs",
"precast:update": "node scripts/precast-update.mjs"
```

**Verify.**

```bash
pnpm precast:version     # prints the Precast version this project derives from
pnpm precast:update      # check-only plan; should report everything current
```

---

## 5. For Precast maintainers — cutting a release

1. Land the change on `develop`, with the docs the contract requires (CLAUDE.md §4.6).
2. Bump `version` in **`precast.manifest.json`** — that field is the single source of truth
   for the release number, not `package.json` (whose `version` belongs to the derived project).
3. Add an entry at the **top of §4** using the template comment above. Fill in every heading;
   write "None." rather than deleting one.
4. If the change adds or moves a file that projects should receive automatically, add it to
   `managed` in the manifest. If it's a file projects always customize, add it to `advisory`.
   Getting this wrong is the main way an upgrade turns into a wall of false conflicts.
5. Tag and push:

   ```bash
   git tag -a v0.3.0 -m "Precast v0.3.0" && git push origin v0.3.0
   ```

   `precast:update` resolves the newest semver tag by default, so an untagged commit on
   `develop` is invisible to derived projects until you tag it.

   **Keep the current tag moving with `develop`.** While a release is still being finished —
   follow-up docs, a fix to something you just shipped — advance the tag rather than leaving
   it behind, so what derived projects fetch is what you actually mean by that version:

   ```bash
   git tag -f -a v0.3.0 -m "Precast v0.3.0" && git push --force origin v0.3.0
   ```

   Two caveats. Anyone who already fetched that tag needs `git fetch --tags --force` to see
   the move; and a project that ran `precast:update` against the older tag has a baseline
   recorded against content that no longer exists at that ref, which shows up as extra
   `CONFLICT`/`unknown` rows on its next run. Once a release is genuinely out and being
   consumed, stop moving it and cut a patch (`v0.3.1`) instead.

6. Sanity-check the release against a real derived project before announcing it:

   ```bash
   cd <some-derived-project> && pnpm precast:update --from=../precast
   ```
