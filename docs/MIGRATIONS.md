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

## v0.12.4: the chat log scrolls and the message box stays on screen (2026-10-30)

The home page grew with every turn, so a long conversation pushed the message box below the fold.

**What changed.** The page fills the screen, the signed-in chat takes the remaining height, the
turns scroll inside the chat card, and the message box stays at its bottom. A new turn brings the
log to its end. A card that loads after its turn landed is followed too, unless the reader has
scrolled up to read.

**Handled by `pnpm precast:update`.** Nothing: the change is under `apps/`.

**Manual steps.**

1. `apps/web/app/page.tsx`: on `<main>`, replace `min-h-screen` with `h-dvh`.
2. `apps/web/app/HomeChat.tsx`: wrap the signed-in `<AccountBar />` and `<AgentChat />` in
   `<div className="flex min-h-0 flex-1 flex-col gap-6">`.
3. `apps/web/app/AgentChat.tsx`: give the `Card` `className="flex min-h-0 flex-1 flex-col"` and
   the form `min-h-0 flex-1`. Put the turns in an always-rendered
   `<div ref={logRef} role="log" aria-label="Conversation" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto">`
   whose single child is the `flex flex-col gap-3` list, and copy the `logRef` and `followEnd`
   refs and the two effects from upstream.
4. Copy `apps/web/e2e/chat-scroll.spec.ts` (E2E-011). If your chat box has its own placeholder,
   use it in the spec.

**Advisory files touched.** None.

**Verify.**

```bash
pnpm verify:poc && pnpm test:e2e
```

## v0.12.3: a new project typechecks, tests and builds its images again (2026-10-30)

Two faults in every project scaffolded from v0.12.2, and one in every project's Dockerfiles since
`node:lts-alpine` became Node 26 on 2026-10-28.

**What changed.**

- Neither image built, in CI or in an AgentBase import. Node 25 and newer ship without corepack,
  so the build stage's `RUN corepack enable` failed with exit 127. Both Dockerfiles now run
  `npm install -g corepack@latest && corepack enable`; corepack then provides the pnpm that
  `packageManager` pins.

- The agents app failed to typecheck. Bootstrap runs `pnpm deps:update`, which updated
  `@ai-sdk/openai-compatible` (3.0.81, built on `@ai-sdk/provider` 4.0.34) past the provider
  `@mastra/core` 1.80.0 pins (4.0.29). Two copies of the provider types met in
  `agentbase-model.ts`. `pnpm deps:update` now finishes by pinning `@ai-sdk/openai-compatible` and
  `@ai-sdk/provider` exactly, to the release built on the provider the installed `@mastra/core`
  ships, and stops with one line naming the version when no release matches. Precast itself is
  pinned the same way: 3.0.63 and 4.0.22 for Mastra 1.78.0 (it had 3.0.14 on 4.0.3 beside 4.0.22,
  and typechecked by luck).
- `pnpm test` failed: `connect-agentbase.spec.ts` wrote the Studio tab's name out, the rename
  rewrote it in the spec but not in the script's message, and the case failed (SMOKE-019 flagged
  it too). The spec now assembles the name at runtime.

**Handled by `pnpm precast:update`.** `scripts/update-deps.mjs`.

**Manual steps.**

1. After taking the new `scripts/update-deps.mjs`, run `pnpm deps:update` once; it pins the two AI
   SDK packages in `apps/agents/package.json` for the Mastra you have. To pin by hand instead, set `@ai-sdk/provider` to the version your
   `@mastra/core` lists as `npm:@ai-sdk/provider@4.x` in its `package.json`, and
   `@ai-sdk/openai-compatible` to the release whose `@ai-sdk/provider` dependency is that version
   (`npm view @ai-sdk/openai-compatible@3 version dependencies --json`). No `^`: an exact pin is
   what keeps a later update from separating them.
2. Copy `apps/agents/src/mastra/lib/ai-sdk-alignment.spec.ts` and `apps/web/test/update-deps.spec.ts`
   (AGT-027, APP-034).
3. In `apps/web/test/connect-agentbase.spec.ts`, if the case about the rejected id or secret expects
   your project's name followed by "tab", make it expect the Studio tab's name assembled at runtime,
   as upstream does.
4. In `apps/agents/Dockerfile` and `apps/web/Dockerfile`, replace `RUN corepack enable` with
   `RUN npm install -g corepack@latest && corepack enable`, and copy the new case in
   `apps/web/test/docker-build.spec.ts` (APP-012). Do this before the next AgentBase import or
   redeploy: until then the agents image does not build.

**Advisory files touched.** None.

**Verify.**

```bash
pnpm verify
```

## v0.12.2: `pnpm connect` points at the Precast tab (2026-10-30)

When AgentBase rejects the client id or secret, or the token URL is wrong, `pnpm connect` now
sends the person to the Application's **Precast** tab in AgentBase Studio, which shows the
Client ID, the client secret with its own copy button, the Token URL and the AgentBase API base
URL. It used to name the Credentials tab and its Copy secret and Copy snippet buttons. The
`.env.example` comment above the AgentBase lines and the README's setup paragraph say the same.

**Handled by `pnpm precast:update`.** `scripts/connect-agentbase.mjs`.

**Manual steps.** `.env.example` is advisory: copy the new comment above `AGENTBASE_CLIENT_ID` if
the project keeps Precast's wording. The README is the project's own: update its setup paragraph
if it still has Precast's. `apps/web/test/connect-agentbase.spec.ts` now expects the
Precast tab in the hint; port that line if the project keeps the spec.

## v0.12.1: the client secret can be pasted into `.env` by hand (2026-10-29)

`pnpm bootstrap … --agentbase-client-secret=later` sets up the project without the Application's
client secret. The `AGENTBASE_CLIENT_SECRET=` line in `.env` stays empty for the person to fill in
their editor, the database step is skipped (it needs the secret), and the closing output says what
to do next: paste the secret, then `pnpm db:provision` and `pnpm poc`. The secret therefore never
passes through a chat, a command line or a log. The two earlier ways still work: the
`AGENTBASE_CLIENT_SECRET` environment variable, and the hidden prompt in a terminal.

**Handled by `pnpm precast:update`.** `scripts/bootstrap.mjs`, `docs/SCRIPTS.md` and this file.

**Manual steps.** None. `apps/web/test/bootstrap-llm.spec.ts` gained a case for the flag; port it
if the project keeps that spec.

## v0.12.0: Lapland, Cappadocia and Arctic Night 2.0 (2026-10-29)

Two new APC themes and a revised Arctic, from a re-import of the design system's tokens.
Precast's own `app/` code did not change; the web app renders exactly as before on the five
earlier ids unless a project is on `arctic`.

**What changed.**

- `apps/web/app/theme/apc.tokens.json` is the design project's current file (93,839 bytes,
  nine palette collections). `pnpm theme:build` now emits seven themes, 367 declarations.
- **Lapland** (`lapland`): indigo actions over cool greys, pale-blue accent, its own status
  ramps; families Clarity City and Quicksand. **Cappadocia** (`cappadocia`): deep teal actions,
  warm yellow accent, earthy secondaries; families Epilogue and Fraunces.
- **Arctic is Arctic Night 2.0.** The id `arctic` stays, so `pnpm set-theme arctic` and existing
  projects keep working, but its tokens are the revised palette (Fjord brand, four new
  secondaries). A project on `arctic` changes colour on this release; the first Arctic's
  collection is still in the file and can be pinned back by pointing the `arctic` entry in
  `scripts/build-apc-theme.mjs` at `tokens: 'arctic'`, `prefix: 'ar'`.
- `scripts/build-apc-theme.mjs`: each theme names its palette collection (`tokens`), the
  typography group it reads families from (`typography`) and any family override (`fonts`),
  because the new themes' typography groups only say which theme they reuse.
- The token file also carries `kowloon` (AgentBase Studio's theme); it is not built. The
  theme-source guard is now a subset check for that reason.
- Lapland's light-mode button measures 4.49:1 (white on Electra 200, `#6962F6`), 0.01 short of
  the 4.5:1 guard. Shipped by decision, with the pair recorded in `apc-theme.spec.ts`
  (`DESIGN_SHORTFALLS`) at its measured value; the fix belongs in the design project.

**Handled by `pnpm precast:update`.** `scripts/build-apc-theme.mjs`, `scripts/set-theme.mjs`,
`CLAUDE.md`, `README.md` and the docs.

**Manual steps.**

1. Copy `apps/web/app/theme/apc.tokens.json` and `apps/web/app/theme/apc-theme.ts` from this
   release (both under `apps/`, which the sync never writes), then run `pnpm theme:build` to
   regenerate `apc-themes.css`.
2. `apps/web/test/apc-theme.spec.ts` is advisory: port the subset check in `APC token source`
   or the first test fails on the extra collections.
3. If the project is on `arctic` and wants the first Arctic back, pin it as described above
   before regenerating.

## v0.11.1: Astryx 0.7.4, and the JSX shim is gone (2026-10-28)

A dependency bump in the web app and one build workaround removed. Precast's own `app/` code
did not change.

**What changed.**

- `@astryxdesign/core`, `@astryxdesign/theme-neutral` and `@astryxdesign/cli` move from
  `^0.1.5` to `^0.7.4`. A caret range on 0.1.5 never reaches 0.2, so every project was 33
  Astryx releases behind. Astryx's own codemods (`astryx upgrade --from 0.1.5`) ran 31
  migrations over Precast's `apps/web/app` and changed nothing: Precast uses none of the props
  or theme targets that were renamed or removed.
- APC theming is unaffected: all 53 Astryx variables APC overrides are still read by 0.7.4.
  0.7.4 adds chart colours (`--color-data-*`) and diff colours that APC does not map yet.
- One visible change: since Astryx 0.2.0 a bordered `Card` draws its frame with
  `--color-border` instead of `--color-border-emphasized`, so the chat card's outer edge is
  lighter in light mode and a little darker in dark mode. Both are APC colours.
- Astryx ships React's production JSX runtime since 0.1.6, so `apps/web/jsx-dev-runtime.shim.ts`
  and its webpack alias in `next.config.ts` are deleted. The production build stays on webpack
  (`next build --webpack`): Turbopack's standalone output leaves `@swc/helpers` out of the
  traced pnpm packages, and its server fails at startup with "Cannot find module".

**Handled by `pnpm precast:update`.** `templates/DESIGN_SYSTEM.md` and a comment in
`scripts/build-apc-theme.mjs`.

**Manual steps.**

1. In `apps/web/package.json`, set `@astryxdesign/core`, `@astryxdesign/theme-neutral` and
   `@astryxdesign/cli` to `^0.7.4`, then run `pnpm install`.
2. From `apps/web`, run Astryx's codemods: `pnpm exec astryx upgrade --from 0.1.5 --path app --apply`.
   They cover what a project may have built on top of Precast: root `className` / `style` /
   `xstyle` on inputs and selectors (now `control*` or `container*`), Avatar sizes, Banner's
   `defaultIsExpanded`, and Astryx class selectors in CSS such as `.astryx-button.primary`,
   which become `[data-*]` selectors. Styling passed through a spread or a wrapper's own props
   is not rewritten and shows up as a type error; fix those by hand. Banners no longer set
   `role="alert"` on their own: add `role` where an error banner must be announced.
3. Delete `apps/web/jsx-dev-runtime.shim.ts`. In `apps/web/next.config.ts`, delete the `isProd`
   and `jsxDevShim` constants and the `webpack` function. Keep `--webpack` in the `build` script.
4. Look at your screens in light and dark. Cards are the change to expect.

**Advisory files touched.** None.

**Verify.**

```bash
pnpm verify
pnpm test:e2e
pnpm poc web        # then sign in and send one chat turn
```

## v0.11.0: sign-in required, no Docker locally, Hannibal databases, project schemas, Node LTS (2026-10-27)

A release with real manual work: read it whole before applying. It also carries v0.10.3 (the
entry below), which was never tagged on its own. Version 0.11.0 rather than 1.0.0 because the
1.x line is held back on purpose.

**What changed.**

- Sign-in with Better Auth inside the web app replaces the local Keycloak. Users, sessions and
  accounts live in the project's Postgres (schema `<project>_auth`, created at startup by
  `apps/web/instrumentation.ts`); email and password work out of the box, and any OIDC issuer can
  be added with `OIDC_ISSUER_URI`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. Chatting requires a
  signed-in account: the chat route answers 401 without one, agent memory is scoped to
  `account-<user id>` (the anonymous cookie scope is gone), and the person is sent to the agent
  as `X-AgentBase-On-Behalf-Of`. `/api/health` reports `signIn`, and `pnpm poc` waits for it.
- Security: the agents' bearer now protects every `/api` path except the agent card (tool
  execution, memory, workflows and traces were open), compared in constant time; every web
  response carries framing, sniffing, referrer and permissions headers and no `X-Powered-By`;
  each person gets 20 chat turns a minute and 500 a day (`CHAT_TURNS_PER_MINUTE`,
  `CHAT_TURNS_PER_DAY`), and sign-in and sign-up have their own limits; the home page no longer
  fetches its own health through the request's Host header; every script that writes `.env`
  makes it owner-only; bootstrap and `pnpm poc` fill in `AGENT_API_TOKEN` and
  `BETTER_AUTH_SECRET` when they are empty.
- `pnpm poc` no longer uses Docker. It builds the same production bundles the Dockerfiles build
  (the Mastra output, Next's standalone server) and runs them as two Node processes bound to
  `127.0.0.1`, with process ids and logs in `.precast/run/` (git-ignored). Nothing to install
  beyond Node and pnpm. `pnpm stop` and `pnpm logs` replace `pnpm docker:down` and
  `pnpm docker:logs`; `pnpm poc web` rebuilds and replaces one app. Docker Compose, the local
  Keycloak, the prebuilt dependency image and its workflow, and the Docker preflight are gone.
  The Dockerfiles stay: AgentBase builds the agents image from one, and a new CI job builds
  both on every push.
- Which apps run follows `PRECAST_LOCAL_AGENTS` (`1` both, `0` only the web app);
  `COMPOSE_PROFILES` is gone. A project has two ports (agents, web) instead of three, written
  to `MASTRA_PORT` / `WEB_PORT`; the `*_HOST_PORT` variables and every `KEYCLOAK_*` setting are
  gone. `MASTRA_HOST` and `WEB_HOST` default to `127.0.0.1`.
- `pnpm db:provision` (and `pnpm bootstrap --db=provision`) asks Hannibal, the database agent on
  AgentBase, for the database through the project's AgentBase Application. Nobody needs the
  server's admin credential any more. With `PRECAST_RDS_SUPERUSER_URL` in the shell it still
  goes to the server directly. The new credentials must connect before `DATABASE_URL` is written.
- Mastra's tables go in a schema named after the project (`<project>_agents`) instead of
  `mastra`, and sign-in's in `<project>_auth`. Two projects pointed at one database no longer
  share agent memory or accounts. `MASTRA_DB_SCHEMA` still overrides.
- Precast follows the current Node LTS instead of pinning Node 24: `.nvmrc` says `lts/*`, both
  image stages are `node:lts-alpine`, CI installs the latest LTS, and `pnpm poc` refuses a Node
  older than 24. `engines` stays `>=24` as the floor.
- The AgentBase client secret may be pasted into the Claude Code chat. Bootstrap and
  `pnpm connect` read it from `AGENTBASE_CLIENT_SECRET` in the environment (a flag would be
  printed with the command line), and `pnpm forget-secret` then overwrites every other copy on
  this computer: Claude Code's transcripts, prompt history and task output, and the project's
  files. `.env` keeps it. At a terminal, the secret prompt is hidden and asked also when the
  project name is passed; both bootstrap's and `pnpm connect`'s old "hidden" prompts echoed it
  on Node 25.

**Handled by `pnpm precast:update`.** `scripts/poc.mjs`, `scripts/set-ports.mjs`,
`scripts/bootstrap.mjs`, `scripts/provision-db.mjs`, `scripts/connect-agentbase.mjs`,
`scripts/forget-secret.mjs`, `scripts/local-secrets.mjs`, `scripts/rename-project.mjs`,
`scripts/precast-update.mjs`, `.nvmrc`, `.gitignore`, `eslint.config.js`, `CLAUDE.md`. The files upstream deleted are listed under "Removed
upstream" and never deleted for you (step 2).

**Manual steps.**

1. **Stop the containers first**, while the old script still exists: `pnpm docker:down`.
2. **Delete what upstream removed:** `docker/` (including your own
   `docker-compose.override.yml`, if you made one), `scripts/docker-compose.mjs`,
   `scripts/check-docker.mjs`, `scripts/deps-image.mjs`, `.github/workflows/deps-image.yml`,
   and `apps/web/test/{compose-runtime,compose-wrapper,deps-image,docker-compose-profiles}.spec.ts`.
3. **`.env` and `.env.example`:** delete `AGENTS_HOST_PORT`, `WEB_HOST_PORT`, `COMPOSE_PROFILES`
   and every `KEYCLOAK_*` line; set `MASTRA_HOST=127.0.0.1` and `WEB_HOST=127.0.0.1`; make
   `MASTRA_INTERNAL_URL` `http://localhost:<MASTRA_PORT>`. In `.env.example` also replace
   `MASTRA_DB_SCHEMA=mastra` with the commented line, so new clones get the derived name.
4. **Keep `MASTRA_DB_SCHEMA=mastra` in your `.env`.** Every project scaffolded before this
   release has that line, and it keeps your agent memory where it is. Removing it would start
   an empty memory in `<project>_agents`. To use the new name, rename the schema first
   (`ALTER SCHEMA mastra RENAME TO <project>_agents;`, with `-` in the project name written as
   `_`), then delete the line. Do that only if no other project uses that database's `mastra`
   schema.
5. **Shared package (advisory):** in `packages/shared/src/database.ts` add `PROJECT_NAME` (set to
   your project's name) and `projectSchema()`. In `packages/shared/src/env.ts` make
   `MASTRA_DB_SCHEMA` default to `projectSchema('agents')` with blank counting as unset, default
   `MASTRA_HOST`/`WEB_HOST` to `127.0.0.1`, and delete the `KEYCLOAK_*` keys.
6. **App Dockerfiles:** in `apps/agents/Dockerfile` and `apps/web/Dockerfile`, replace the
   `ARG BASE_IMAGE=…` line and `FROM ${BASE_IMAGE} AS build` with `FROM node:lts-alpine AS build`,
   drop `--store-dir …` from `pnpm install`, and make the runtime stage `FROM node:lts-alpine`.
7. **`package.json` (advisory):** remove the `docker:*` scripts and `deps:image`; add
   `"stop": "node scripts/poc.mjs --stop"`, `"logs": "node scripts/poc.mjs --logs"` and
   `"forget-secret": "node scripts/forget-secret.mjs"`. Keep `engines.node` at `>=24`.
8. **CI (advisory):** add the `images` job from `.github/workflows/ci.yml`, so a broken
   Dockerfile fails a push instead of an AgentBase import.
9. **Sign-in (web app):** add `better-auth`, `kysely` and `pg` (and `@types/pg`) to
   `apps/web/package.json`. Copy `apps/web/app/lib/{auth,auth-client,rate-limit}.ts`,
   `app/api/auth/[...all]/route.ts`, `instrumentation.ts`, `app/sign-in/`, `app/HomeChat.tsx`,
   `app/AccountBar.tsx`, and the changed `app/page.tsx`, `app/AgentChat.tsx`,
   `app/api/a2a/[agentId]/route.ts`, `app/api/health/route.ts`, `app/lib/agent-context.ts`,
   `app/lib/a2a-client.ts` and `next.config.ts` (security headers). Add `signIn` to
   `HealthStatus` in `packages/shared/src/types.ts`. Chat memory kept under the old anonymous
   cookie ids is not carried over: people start fresh under their account.
10. **Agents:** copy `apps/agents/src/mastra/middleware/auth.ts` and its spec. A caller that
    reached `/api/tools/*`, `/api/memory/*` or `/api/workflows` without the bearer now gets 401.
11. **`.env`:** run `pnpm poc` once, which adds `BETTER_AUTH_SECRET`; set
    `BETTER_AUTH_URL=http://localhost:<WEB_PORT>`. `OIDC_*` and the two `CHAT_TURNS_*` limits
    are optional.
12. **Specs:** copy `apps/web/test/poc.spec.ts`, `test/rename-project.spec.ts`,
    `test/ports.spec.ts`, `test/security-config.spec.ts`, `test/docker-build.spec.ts`,
    `test/provision-db.spec.ts`, `test/connect-prompt.spec.ts`, `test/forget-secret.spec.ts` and
    the schema case in `test/health.spec.ts`, and for sign-in and security
    `test/{auth,rate-limit,local-secrets,a2a-route,a2a-client,agent-context}.spec.ts`,
    `e2e/session.ts` and the changed `e2e/{home,a2a-route,agent-cards,chat-reset}.spec.ts`
    (AGT-026, APP-011, APP-012, APP-017, APP-028 to APP-033, TOOL-009, WEB-014, WEB-022 to
    WEB-028, E2E-009, E2E-010, SHR-005).

Docker Desktop can be uninstalled afterwards if nothing else on the computer needs it.

**Advisory files touched.** `.env.example`, `package.json`, `.github/workflows/ci.yml`,
`packages/shared/src/database.ts`, `packages/shared/src/env.ts`, and the fitness specs listed in
step 12.

**Verify.**

```bash
pnpm verify
pnpm test:e2e
pnpm poc            # then sign up on the web app and send one chat turn
pnpm db:provision --label "a check that Hannibal answers"   # creates a database
```

## v0.10.3 — MCP tools per caller, A2A error handling, chat reset race (shipped in v0.11.0)

**What changed.** Three fixes found in review.

- **MCP tools after "Connect account".** Tools were resolved once at boot, as the container's
  own identity, so a server skipped for "no connected account" stayed missing until a restart,
  and an on-behalf-of user whose account was connected never got its tools at all.
  `createAgentMcpToolset()` resolves per caller identity with one bound client per identity,
  re-checks pending servers every 15 s and keeps the boot preflight that fails a broken deploy.
  The example agent's `tools` is now a function. Details: INTEGRATION_AGENTBASE §7.10.
- **A2A errors.** A non-2xx or non-JSON answer threw out of the route or came back as an empty
  "success"; failed, canceled and rejected Tasks were shown as answers; the route always said
  200 and sent upstream error text and the raw reply to the browser. Now every failure is a
  reply with a preserved or fitting status (upstream status, 502, 504), the envelope is
  validated, waiting Task states are answers, errors are written here, and the raw reply (which
  echoes the httpOnly resourceId inside the A2A `contextId`) stays on the server.
- **"Start over" race.** A turn in flight when the conversation was cleared could put its old
  conversation id back, add its answer or error to the new conversation, or leave it loading.
  Turns now take a token that a reset invalidates.

**Handled by `pnpm precast:update`.** None. Everything is under `apps/`.

**Manual steps.**

1. **Agents:** copy `apps/agents/src/mastra/lib/agentbase-mcp.ts` and
   `lib/request-context.ts` (`attachOnBehalfOf` takes an optional subject). In each agent that
   used `...(await resolveAgentMcpTools(ID))`: create `const mcpTools = createAgentMcpToolset(ID);`
   and `await mcpTools.preflight();` at module level, and make `tools` a function:
   `tools: async () => ({ ...yourTools, ...(await mcpTools.current()) })`.
2. **Web:** copy `apps/web/app/lib/a2a-client.ts`, `app/api/a2a/[agentId]/route.ts`,
   `app/lib/chat-turns.ts` and `app/AgentChat.tsx` (or port the gate and
   `interpretRouteReply` into your own chat). Code that read `raw` from the route's response must
   read it server-side instead; `AgentReply` has a required `status`.
3. **Specs:** copy `apps/agents/src/mastra/lib/agentbase-mcp.spec.ts`,
   `src/mastra/mcp-per-caller.integration.spec.ts`, `apps/web/test/a2a-client.spec.ts`,
   `test/a2a-route.spec.ts`, `test/chat-turns.spec.ts` and `e2e/chat-reset.spec.ts`
   (AGT-024, AGT-025, WEB-018 to WEB-021, E2E-007).

**Advisory files touched.** None.

**Verify.**

```bash
pnpm verify
pnpm test:e2e
```

## v0.10.2 — telemetry to AgentBase: traces, metrics and logs (2026-10-23)

**What changed.** The agents container reports traces, metrics and logs to AgentBase's governed
endpoint, `{AGENTBASE_API}/telemetry/otlp`, configured only by the standard `OTEL_*` variables.
A project AgentBase hosts needs nothing: AgentBase injects the endpoint and a managed key at
deploy. A project you host sets `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`
with a key issued in Studio. Exported span attributes pass an allowlist, so prompts,
completions, tool arguments and credentials never leave the container (Mastra's bundled AI SDK
records them on its spans when a caller turns its telemetry on). Health checks are not traced;
SIGTERM flushes within 5 s; an export failure is one `[otel]` line, and a 401 says to issue a new key.

Mastra's own usage analytics are now off. Mastra core and its CLI send anonymous usage data (OS,
Node version, a hashed hostname, agent counts, storage type) to a third-party analytics service
from every server and CLI run unless `MASTRA_TELEMETRY_DISABLED` is set; a governed AgentBase
deployment should send nothing it does not govern. The runtime image and the agents scripts now
set it. Details: `docs/INTEGRATION_AGENTBASE.md` §7.13.

It also fixes a silent gap in every earlier release: `mastra/index.ts` started telemetry with a
bare `import './telemetry/otel'`, and Mastra's production bundler (`treeshake: "smallest"`)
drops side-effect imports, so a built container never started OpenTelemetry at all, not even
trace propagation. The Dockerfile comment that said the image preloaded it was wrong.

**Upside:** a hosted agent shows up on its Telemetry page with no setup, and trace continuity
across crew hops now works in built containers. **Downside:** six more OpenTelemetry packages and
esbuild in `apps/agents`, a second build step, and a preload in the container's start command.

**Handled by `pnpm precast:update`.** None. Everything is under `apps/agents`.

**Manual steps.**

1. **`apps/agents/package.json`:** add `@opentelemetry/exporter-{trace,metrics,logs}-otlp-proto`,
   `@opentelemetry/exporter-{metrics,logs}-otlp-http` and `@opentelemetry/api-logs` (all
   `^0.221.0`) and `esbuild` (`^0.28.1`, dev); set `"build": "mastra build && pnpm run build:telemetry"`
   and copy the `build:telemetry` script. Then `pnpm install`.
2. **Copy** `apps/agents/src/mastra/telemetry/otel.ts` (replacing yours), `telemetry/preload.ts` and
   `middleware/telemetry.ts`. If your `otel.ts` had changes of its own, port them onto the new one.
3. **`apps/agents/src/mastra/index.ts`:** replace `import './telemetry/otel';` with
   `import { startAgentTelemetry } from './telemetry/otel';` and call `startAgentTelemetry();` as the
   first statement; import `telemetryMiddleware` and put it first in `server.middleware`.
4. **`apps/agents/Dockerfile`:** add `&& test -f apps/agents/.mastra/output/telemetry.mjs` to the
   build `RUN`, and make the CMD `["node", "--dns-result-order=ipv4first", "--import", "./telemetry.mjs", "index.mjs"]`.
5. **Specs:** copy `apps/agents/src/mastra/telemetry/telemetry.spec.ts`, `telemetry-on.spec.ts` and
   `telemetry-off.spec.ts` (AGT-017 to AGT-023, APP-026, APP-027).
6. **Mastra usage analytics off:** in `apps/agents/Dockerfile` add `ENV MASTRA_TELEMETRY_DISABLED=1`
   to the runtime stage, and in `apps/agents/package.json` put `-v MASTRA_TELEMETRY_DISABLED=1` on the
   `dotenv` call of `dev`, `dev:verbose` and `start`, and prefix `build` with
   `dotenv -v MASTRA_TELEMETRY_DISABLED=1 --` (APP-027).
7. **A project you host yourself:** issue a key in Studio (the agent's page, Telemetry) and set
   `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` where the agents run.

**Advisory files touched.** `.env.example` gains a commented Telemetry block with the two
variables; copy it if you want them documented in your own.

**Verify.**

```bash
pnpm --filter ./apps/agents build && test -f apps/agents/.mastra/output/telemetry.mjs
pnpm test
pnpm poc agents   # the agents log says "[otel] exporting …" when OTEL_* is set
```

## v0.10.1 — the plain-language surface: `pnpm connect`, five phrases, one-line failures (2026-10-22)

**What changed.** Phase 3 of the AgentBase SDK plan. Everything a person does with a project
maps to five phrases, each a Claude Code skill in the Precast plugin backed by one script:
"start a project", "show it to me", "connect my AgentBase", "put it on AgentBase", "update it".

- **`pnpm connect`** (`scripts/connect-agentbase.mjs`) connects an existing project to an
  AgentBase Application and proves it before writing anything: it mints a token with the id
  and secret, lists the models published to the Application, checks the chosen one is among
  them, then writes the five values to `.env`. `--check` verifies only. The secret is typed
  hidden or passed as a flag and never printed. Every failure is a sentence naming where in
  Studio to look (APP-025, 12 cases).
- **One-line failures everywhere.** Every operator script now ends a failure with one line
  after `❌` (or `✖`) and what to do; the stack trace appears only with `PRECAST_DEBUG=1`
  (SMOKE-022). `pnpm poc` names the usual causes when a service is not healthy, the compose
  wrapper's missing-`.env` message says what to run next, `pnpm smoke:chat` explains a 500.
- **README** rewritten in the order a person meets the kit; **AGENTS.md** carries the same
  five phrases with their plain commands for other harnesses.
- **Plugin:** new `show`, `connect` and `deploy` skills; `scaffold` and `upgrade` answer to
  the phrases. `deploy` is a Studio walkthrough until AgentBase exposes import and variables
  as MCP tools.

**Upside:** a person never types a command, and a failure is always an instruction. **Downside:**
the phrases exist only inside Claude Code or a harness that reads `AGENTS.md`; without one there
are the scripts and the README, which decision 3 of the plan accepts.

**Handled by `pnpm precast:update`.** `scripts/*.mjs` (the new script and the entry catches).

**Manual steps.**

1. **`package.json`:** add `"connect": "node scripts/connect-agentbase.mjs"` next to
   `db:provision`.
2. **Specs:** copy `apps/web/test/connect-agentbase.spec.ts` (APP-025) and the SMOKE-022
   block at the end of `apps/web/test/repo-hygiene.spec.ts`.
3. **Your own scripts:** give each a top-level `.catch(exitWithReason)` in the same shape, or
   SMOKE-022 fails on them.

**Advisory files touched.** `package.json`, the specs above.

**Verify.**

```bash
pnpm verify
pnpm connect --check
```

## v0.10.0 — AgentBase only: Standalone removed, vendor keys gone (2026-10-22)

**What changed.** Phase 2 of the AgentBase SDK plan. A Precast project now runs on AgentBase or
not at all: the **Standalone** mode is gone, and so are the vendor LLM keys.

- The web app's transport switch is a development setting, `PRECAST_LOCAL_AGENTS` (`1` calls the
  local agents app directly, before the project is imported; unset or `0` goes through the
  AgentBase proxy). `ENABLE_AGENTBASE=0`, the old spelling, is still read for one release and
  then removed. Compose sets `PRECAST_LOCAL_AGENTS` to `1` by default for the local stack, so
  `pnpm poc` answers chat on a fresh project; set it to `0` (and `COMPOSE_PROFILES=web,keycloak`)
  once AgentBase hosts the agents.
- Models come only from the organisation's AgentBase gateway. `default-model.ts` and its
  provider table are deleted; `resolveAgentModel(agentId)` takes no fallback and returns a
  call-time-failing model, naming what to set, when nothing is configured. The twelve
  `*_API_KEY` settings and `DEFAULT_LLM_MODEL` are gone from the env schema and `.env.example`.
- `.env.example` is rewritten around what a person acts on: 25 settings and 48 comment lines,
  down from 31 and 174.
- `pnpm bootstrap --llm-provider` accepts `agentbase` or `skip`.
- `pnpm smoke:chat` now reads a Task reply's `artifacts` and `history` as well as its message
  parts (Mastra 1.78 answers with a `response.txt` artifact), so the round trip reports the
  text instead of "no text part". First time the round trip ran green (SMOKE-016): a fresh
  scaffold on 2026-10-22 answered through the organisation's gateway.

**Upside:** one deploy story, one model source, a readable `.env`, and a fresh project whose chat
works locally before import. **Downside:** a project cannot run without an AgentBase org, and a
project that used its own vendor key loses that option; the gateway is the only path.

**Handled by `pnpm precast:update`.** `docker/docker-compose.yml`, `scripts/bootstrap.mjs`,
`scripts/smoke-chat.mjs`, `CLAUDE.md`.

**Manual steps.**

1. **A Standalone project:** there is no upgrade path for that mode. Either stay on v0.9.x or
   move to External: create an Application in AgentBase Studio, put its credentials and
   `AGENTBASE_URL` in `.env`, register the agents' address (§4C), and remove any vendor key.
2. **`.env`:** replace `ENABLE_AGENTBASE=0` with `PRECAST_LOCAL_AGENTS=1` (and `=1` with
   `PRECAST_LOCAL_AGENTS=0`, or delete it). Remove `*_API_KEY` and `DEFAULT_LLM_MODEL`; set
   `AGENTBASE_LLM_MODEL` to a model the Application is subscribed to.
3. **Port `packages/shared/src/env.ts`:** drop the vendor keys and `DEFAULT_LLM_MODEL`, add
   `PRECAST_LOCAL_AGENTS` (default `'0'`) and keep `ENABLE_AGENTBASE` optional.
4. **`apps/agents`:** delete `lib/default-model.ts` and its spec; change every
   `resolveAgentModel(ID, resolveDefaultModel())` to `resolveAgentModel(ID)`; port the
   resolver's `unconfiguredLocalModel` and the boot warning from `index.ts`.
5. **`apps/web`:** port `isLocalAgents()` in `app/lib/a2a-client.ts` and the two error
   messages in `agentbase-auth.ts` / `agentbase-discovery.ts`; copy the spec changes
   (`a2a-client.spec.ts` WEB-017, `compose-runtime.spec.ts` WEB-012).

**Advisory files touched.** `.env.example`, `packages/shared/src/env.ts`, the specs above.

**Verify.**

```bash
pnpm verify
pnpm poc && pnpm smoke:chat   # a chat turn through the gateway, locally
```

---

## v0.9.15 — Postgres by default: `pnpm db:provision` and `pnpm bootstrap --db=` (2026-10-22)

**What changed.** The first step of the plan that makes Precast the AgentBase SDK
(`precast-ground-zero/plans/agentbase-sdk.md`, Phase 1). A project no longer has to find a
Postgres database: `scripts/provision-db.mjs` (`pnpm db:provision`) creates one on the
organisation's shared database server, Hannibal's provisioner ported into Precast as a core
capability. It makes a database with its own scoped role and base64url password (CREATE ROLE,
CREATE DATABASE … OWNER, REVOKE ALL … FROM PUBLIC, no drop path, no enumeration), verifies the
new credentials connect, and writes `DATABASE_URL` into `.env`. The admin credential comes from
the shell of the machine running the scaffold (`PRECAST_RDS_SUPERUSER_URL`, or Hannibal's
`RDS_SUPERUSER_URL`), is never read from or written into the project, and is never part of
anything returned. The RDS CA bundle is vendored at `scripts/certs/` because node-postgres
verifies certificates and Node's trust store has no Amazon roots; `PRECAST_RDS_CA_BUNDLE_PATH`
overrides it. `pnpm bootstrap` gained `--db=provision|<url>|later` and, interactively, a
three-way question; `--db=provision` passes the admin URL to the script through its
environment, not its command line, and runs it last, so a failure leaves a complete project
behind with a clear instruction rather than aborting bootstrap.

The scaffold skill in the Precast plugin was rewritten at the same time: eight questions in
three waves replace the six, Standalone is no longer offered (Imported and External remain),
the LLM question becomes a model choice from the org's gateway, and the database question
defaults to provisioning. The skill tells the person where in Studio each Application
credential is.

**Found by the gate.** Scaffolding `precast-poc` failed at bootstrap's first commit: `pnpm rename`
turned the identifier `getPrecastStore` into `getPrecast-pocStore` (every case form of the
placeholder is rewritten, which is right for prose and names and wrong inside code), and the
hyphen is a parse error. Any project name with a hyphen hit this since v0.9.0-era storage.ts
(2026-08-07). The identifier is `getMastraStore` now; the renamer leaves `PRECAST_*` environment names alone
(`process.env.PRECAST_ENFORCE_DOC_FRESHNESS` in a spec had become a subtraction); and SMOKE-019
refuses any identifier under `apps/` or `packages/` that the renamer would change.
A fresh clone could not run `pnpm poc` at all: `scripts/poc.mjs` and `pnpm docker:up` pass
`-f docker/docker-compose.override.yml` unconditionally, the file is git-ignored (only its
`.example` is committed), Compose errors on an explicit `-f` it cannot open, and it auto-merges
the override only when no `-f` is given. Every maintainer checkout had the file, so nobody
hit it; the gate's clean copy did, and Hannibal's checkout has no override either.
`scripts/docker-compose.mjs` now drops that `-f` when the file is absent (APP-024).
A fourth victim surfaced in the web image build: `apps/web/test/precast-sync.spec.ts` imports
`scripts/precast-lock.mjs` and `precast-update.mjs` by path, the renamer rewrote the strings to
`precast-poc-…`, the scripts keep their names, and `next build` (which typechecks the specs)
failed. The renamer now protects the boilerplate's own file and script names
(`precast-lock.mjs`, `precast-update.mjs`, `precast.lock.json`, `precast.manifest.json`,
`precast:update`, `precast:version`), and SMOKE-020 proves no referenced path changes under a
rename.
No dependency image had been published since v0.9.5: the deps-image workflow's `tag` job ran
`actions/setup-node` with `cache: pnpm` before any step installed pnpm, and failed on every push
from 2026-08-20. Every `pnpm poc` in that window installed from source inside Docker (3 minutes
on the gate's machine). The step is added and SMOKE-021 guards the order in every workflow. The
image for this lockfile publishes on the first push after v0.9.15.
SMOKE-015 was a third victim: its `/^@precast\//` regex was renamed while the scope was not, so it
failed in every derived project; it now reads the scope from a workspace package. Bootstrap's AgentBase Models fields also changed:
`AGENTBASE_URL` (the API base) is collected and `AGENTBASE_LLM_BASE_URL` is an optional
override, since v0.9.10 derives the gateway route from the API base and the model.

**Handled by `pnpm precast:update`.** `scripts/provision-db.mjs`, `scripts/bootstrap.mjs`.

**Manual steps.**

1. Add `"db:provision": "node scripts/provision-db.mjs"` to the root `package.json` scripts, and
   `pg@^8.23.0` to its devDependencies (the script imports it).
2. Optional: the `.env.example` comment above `DATABASE_URL` that names the script.
3. Copy `apps/web/test/provision-db.spec.ts` (TOOL-008), the SMOKE-019 block of
   `apps/web/test/repo-hygiene.spec.ts`, and the `AGENTBASE_URL` change in
   `apps/web/test/bootstrap-llm.spec.ts`.
4. If your project was scaffolded with a hyphenated name and `apps/agents/src/mastra/lib/storage.ts`
   still compiles, you were scaffolded before 2026-08-07 and nothing to do; otherwise rename
   `getPrecastStore` (however the renamer spelled it) to `getMastraStore` in `storage.ts`,
   `memory.ts` and `index.ts`.

**Advisory files touched.** `package.json`, `.env.example`.

**Verify.**

```bash
pnpm verify
PRECAST_RDS_SUPERUSER_URL=postgresql://… pnpm db:provision --label "a test"   # creates a database, writes DATABASE_URL
```

---

## v0.9.14 — interactive cards (A2UI), and Mastra 1.78 (2026-10-21)

Shipped in the same commit as v0.9.15; there is no `v0.9.14` tag. Upgrade straight to v0.9.15 and
work both entries.

**What changed.** Three things.

**1. Agents can attach an interactive card to a reply.** A new workspace package,
`packages/a2ui`, holds A2UI v0.9.1 support: the `raya.blocks.v1` catalog pinned by sha256, the
`show_card` card format, and helpers for A2A parts on both wire versions. In `apps/agents`, a
`show_card` tool holds a card for the current turn, and a middleware appends it to the A2A reply
as an `application/a2ui+json` data part and lists the extension on the agent card. The same
middleware turns an A2UI button press into text, because Mastra fails a whole turn on any data
part. See `docs/INTEGRATION_AGENTBASE.md` §7.12.

**2. Mastra moved to the latest release.** `@mastra/core` 1.57 → 1.78, `@mastra/memory` 1.26 →
1.38, `@mastra/pg` 1.19 → 1.31, `@mastra/loggers` 1.2 → 1.3, the `mastra` CLI 1.23 → 1.34, and
`@mastra/mcp` 1.16 → 2.4, a major version. Precast's own MCP use (`MCPClient`,
`listToolsWithErrors`) is unchanged by 2.0. What 2.0 removed is server-side and elicitation API:
`startSSE`, `startHonoSSE`, `mcp.elicitation.onRequest()` (now a per-server `inputRequests`
option) and `context.mcp.elicitation.sendRequest()` (now `context.suspend()`). pnpm warns that
`@modelcontextprotocol/ext-apps` wants zod 4; it only imports `zod/v4`, which zod 3.25 ships, so
the warning is harmless. Mastra 1.78 also answers in A2A 1.0 when a caller sends
`A2A-Version: 1.0`.

**3. The deps image finds workspace packages by glob.** `deps.Dockerfile` copied each manifest by
name, and `scripts/deps-image.mjs` hashed a fixed list, so a new package had to be added in two
places or the image's frozen install failed. Both now glob `apps/*` and `packages/*`, which also
means syncing these files into a project that lacks `packages/a2ui` cannot break its build.

**4. Workspace packages resolve through their built `exports`.** `tsconfig.base.json` mapped
`@precast/shared` to `packages/shared/src/index.ts`. That only ever built because the web app's
two imports of it are `import type`, which the bundler erases: the first runtime import of a
workspace package (`@precast/a2ui`) failed `next build` with `Can't resolve './protocol.js'`,
since Next's webpack cannot follow the `./x.js` specifiers an ESM source uses. The `paths` block
is gone; apps now resolve both packages the way Node, Mastra and Docker already did, through
`package.json` `exports` into `dist/`. Typecheck and `dev` keep working because every path
there builds the packages first (`turbo` `^build`, the `dev` scripts, the Dockerfiles), and
Vitest aliases `src` in each app's `vitest.config.ts`.

**Handled by `pnpm precast:update`.** `docker/deps.Dockerfile`, `scripts/deps-image.mjs`,
`tsconfig.base.json` (the `paths` block removed) and `.prettierignore` (the pinned catalog must
never be reformatted).

**Manual steps.**

1. **Upgrade Mastra** in `apps/agents/package.json` to the versions above, then run
   `pnpm install`. If your project calls the `@mastra/mcp` APIs listed under point 2, port them.
2. **Copy `packages/a2ui/` whole.** Copy the catalog file byte for byte; SHR-002 checks its digest.
3. **Copy into `apps/agents/src/mastra/`:** `middleware/a2ui.ts`, `tools/show-card.ts`, and the
   `pendingCard` field plus `setPendingCard()` / `takePendingCard()` in `lib/request-context.ts`.
4. **Register the middleware after auth** in `index.ts`:
   `middleware: [agentAuthMiddleware, a2uiMiddleware]`. The order matters: auth opens the
   per-request store the card is held in.
5. **Wire the package into `apps/agents`.** Add `"@precast/a2ui": "workspace:*"`, and the dev
   dependencies `hono@4.13.3` and `@mastra/deployer@^1.78.0`. Add `--filter @precast/a2ui` to the
   `dev` and `dev:verbose` build step, and `--filter "./packages/a2ui"` to the build line in
   `apps/agents/Dockerfile`.
6. **Turn cards on where you want them:** `tools: { ...cardTools }` plus `SHOW_CARD_INSTRUCTIONS`
   appended to the agent's instructions. Nothing changes for an agent without `show_card`.
7. **Copy the tests:** `apps/agents/src/mastra/middleware/a2ui.spec.ts` and
   `apps/agents/src/mastra/a2ui.integration.spec.ts`.
8. **Web app, to render cards.** Add `@a2ui/react@0.14.0`, `@a2ui/web_core@0.14.0`, `zod@^3.24.0`
   and `"@precast/a2ui": "workspace:*"` to `apps/web/package.json`; add `--filter @precast/a2ui`
   to its `dev` scripts and `--filter "./packages/a2ui"` to `apps/web/Dockerfile`; add the
   `@precast/a2ui` alias to `apps/web/vitest.config.ts`.
9. **Copy `apps/web/app/a2ui/`** (`catalog.tsx`, `AgentCards.tsx`), then port the diffs to
   `app/lib/a2a-client.ts` (extension header, `a2uiClientCapabilities`, `AgentReply.a2ui`),
   `app/api/a2a/[agentId]/route.ts` (the `{ action }` body) and `app/AgentChat.tsx` (cards under
   each reply, presses sent back). If you replaced `AgentChat`, the three pieces are: keep
   `reply.a2ui` per turn, render `<AgentCards messages onPress>` through `next/dynamic` with
   `ssr: false`, and post `{ action, conversationId }` from `onPress`.
10. **Copy the web tests:** `apps/web/test/a2a-route.spec.ts`, the A2UI block in
    `apps/web/test/a2a-client.spec.ts`, `apps/web/e2e/agent-cards.spec.ts`, and the press case in
    `apps/web/e2e/a2a-route.spec.ts`.

**Advisory files touched.** `apps/web/test/deps-image.spec.ts` (APP-023 and the `--parents`
flag), `apps/web/test/repo-hygiene.spec.ts` (`packages/a2ui` in SMOKE-015).

**Verify.**

```bash
pnpm install
pnpm verify
pnpm -F @precast/agents test   # AGT-014 to AGT-016 cover the cards
```

The lockfile hash changes with the Mastra upgrade, so the first `pnpm poc` builds from
`node:24-alpine` until CI publishes the matching deps image.

---

## v0.9.13 — three runtime bugs that all pointed somewhere else (2026-09-23)

**What changed.** Three faults found while debugging a derived project, all of them upstream.
Each produced a symptom that implicated the wrong thing, which is why they survived.

**1. `ENABLE_AGENTBASE` in `.env` did nothing.** `docker-compose.yml` hard-coded
`ENABLE_AGENTBASE: '0'` under `environment:`, and a literal there **overrides `env_file`**. So
the comment beside it (_"Set to '1' … to proxy through AgentBase"_), the `ENABLE_AGENTBASE=1`
that `.env.example` ships, and the schema's `.default('1')` were all inert — the app answered
`via: "direct"` whatever you set. Now `${ENABLE_AGENTBASE:-0}`: the self-contained stack still
defaults to direct, and `.env` can win.

**The generalised guard found a second instance immediately:** `LOG_LEVEL: info` shadowed
`.env` the same way, so `LOG_LEVEL=debug` silently stayed `info`. Also fixed.

**2. The agents container reported unhealthy while working perfectly.** Both the compose
healthcheck and `pnpm poc` probe `/api/agents` **with no bearer**, and Mastra protects that path
once `AGENT_API_TOKEN` is set. `r.ok` is false for 401, so the container was marked sick and
`pnpm poc` failed — for four days, in the project where this was found.

**This became universal in v0.9.8**, which started minting an `AGENT_API_TOKEN` into every fresh
`.env`. Before that, a fresh scaffold had an empty token and the probe passed. So v0.9.8 fixed
one `pnpm poc` failure and introduced another. A 401 now counts as healthy — it proves the
server is up _and_ enforcing; only a connect error or a 5xx is unwell.

**3. Intermittent `fetch failed` that looked like bad credentials.** AgentBase is
Cloudflare-fronted and publishes AAAA records; Docker's default bridge has IPv6 disabled. A
container that picks the AAAA gets `ENETUNREACH`. Plain `node` often survives this via Happy
Eyeballs; Next's fetch runtime does not — hence "works when I test it by hand, fails in the
app". Both images now start with `--dns-result-order=ipv4first`.

Set on **`CMD`, not `ENV NODE_OPTIONS`** — deliberately. A `NODE_OPTIONS` supplied through
compose or `.env` would _replace_ the image's value and silently drop the flag, which is
bug 1's shadowing all over again.

**Handled by `pnpm precast:update`.** `docker/`, `scripts/` and the Dockerfiles are managed, so
all three fixes come across on sync.

**Manual steps.**

1. **Check your own `environment:` blocks** for literals that also appear in `.env.example`.
   WEB-012 does this for you after you copy the spec.
2. **If you deploy with a health probe of your own**, apply the same rule: a 401 from an
   authenticated endpoint means up, not down.
3. **Copy `apps/web/test/compose-runtime.spec.ts`.**

**Advisory files touched.** `apps/web/test/compose-runtime.spec.ts`.

**Verify.**

```bash
pnpm verify
pnpm poc        # should now reach healthy with AGENT_API_TOKEN set
```

---

## v0.9.12 — end-user delegation, and addressing a subscribed MCP server (2026-08-21)

**What changed.** Two capabilities AgentBase already provided and the boilerplate dropped on the
floor.

**1. The end-user subject is carried end to end.** AgentBase supports OBO: a caller sends
`X-AgentBase-On-Behalf-Of` and the platform resolves _that person's_ connected account for a
user-mode MCP server. Precast never forwarded it, so every MCP call ran as the container's own
identity — and a user-mode server answers `401 mcp_server_authorization_required`, which reaches
the operator as _"connect your account"_ for an account that **is** connected. A derived project
had to build its own bespoke OBO path for exactly this reason.

`middleware/auth.ts` now reads the header into an `AsyncLocalStorage` request context;
`lib/agentbase-mcp.ts` attaches it to every discovered MCP tool call; and
`currentOnBehalfOf()` / `resolveOnBehalfOf()` (`lib/request-context.ts`) expose it so a project's
own MCP or HTTP calls use the same subject instead of a parallel mechanism.

**2. `resolveSubscribedServer()`** returns a subscribed server's absolute URL by slug or title,
from the subscriptions list the agent already fetches — so a **deterministic** call (invoking a
specific tool yourself rather than letting the model choose) needs no env var and does not go
stale when a server is renamed.

**Three security properties, each pinned by a test:**

- **Header only, never a request body.** The header is trustworthy because AgentBase's proxy
  sets it, and only for an OBO-enabled Application against an agent it hosts. A body field is
  attacker-controlled.
- **Sent only back to AgentBase.** The guard compares **origins**, not string prefixes — a
  prefix check accepts `https://api.agentbase.example.com.evil.com`.
- **Absent means absent.** No header ⇒ nothing attached ⇒ behaviour exactly as before.

**One implementation detail that is easy to get wrong.** The header is decided **per request**
via the MCP server config's `fetch` hook, not a static `requestInit`. `resolveAgentMcpTools()`
runs once at agent construction, so a header fixed there would freeze what was true at boot — an
empty subject for every real turn. The same change fixes a latent bug: the access token was also
baked at construction and would expire under a long-running container.

**Handled by `pnpm precast:update`.** Nothing — `apps/` code.

**Manual steps.**

1. **Copy `apps/agents/src/mastra/lib/request-context.ts`.**
2. **Capture in your auth middleware:** wrap `next()` in
   `runWithRequestContext({ onBehalfOf: c.req.header('x-agentbase-on-behalf-of')?.trim() }, …)`.
3. **Forward it:** in `agentbase-mcp.ts`, replace the static `requestInit` with the per-request
   `fetch` that mints the token and calls `attachOnBehalfOf`.
4. **If you built a bespoke OBO path already** (as `slack-daily-digest` did), point it at
   `resolveOnBehalfOf()` so there is one source of the subject rather than two that can disagree.
5. **Copy `resolveSubscribedServer()`** and delete any env var holding an MCP server URL.

**Advisory files touched.** `apps/agents/src/mastra/lib/request-context.spec.ts`,
`apps/agents/src/mastra/lib/agentbase-mcp.spec.ts`.

**Verify.**

```bash
pnpm verify
```

---

## v0.9.11 — `AGENTS.md`, so non-Claude harnesses aren't blind (2026-08-20)

**What changed.** The repo gains an `AGENTS.md`. Most coding harnesses that are not Claude
Code — OpenCode, Cursor, Aider and others — look for that filename; only Claude Code reads
`CLAUDE.md`. Until now a different agent opened this project with **no instructions at all**.

It would still have been stopped by the real gates — `.githooks/pre-commit` enforces the
documentation contract for every agent and every human, and `a2a-only.spec.ts` fails a build
that reaches for Mastra's REST — but it would have learned the rules by tripping over them.

`AGENTS.md` is a **pointer**, not a fork: it names the handful of invariants that bite
(A2A-only, Postgres-only, no `console.log`, tests ship with the change, the commit-time doc
contract), lists the commands, explains what the Claude-only hooks do and what happens without
them, and sends the reader to `CLAUDE.md` for the rest. One source of truth.

**The guard is the interesting half.** A pointer file rots, so `SMOKE-018` asserts the file's
_claims_ rather than its existence: every doc it links to must resolve, every `pnpm` command it
names must be a real script, and every invariant it states must still be stated in `CLAUDE.md`.
Drop a rule from `CLAUDE.md` and the test fails until `AGENTS.md` catches up.

It also forbids port numbers in `AGENTS.md` — `set-ports.mjs` rewrites `CLAUDE.md`, `SPEC.md`
and `INTEGRATION_AGENTBASE.md`, but **not** this file, so a port printed here would be wrong
from the first scaffold and nothing else would notice.

**Handled by `pnpm precast:update`.** `AGENTS.md` is a managed file — it comes across on sync.

**Manual steps.**

1. **Nothing required.** If you have customized `CLAUDE.md` heavily, re-read `AGENTS.md`
   afterwards: SMOKE-018 will tell you if the two have diverged, but only about the anchors it
   knows.

**Advisory files touched.** `apps/web/test/repo-hygiene.spec.ts`.

**Verify.**

```bash
pnpm verify
```

---

## v0.9.10 — the LLM gateway base is derived (2026-08-20)

**What changed.** `AGENTBASE_LLM_BASE_URL` no longer has to be copied out of Studio. Name the
model in `AGENTBASE_LLM_MODEL` and the base URL is looked up.

v0.9.9 recorded that it _couldn't_ be derived from `AGENTBASE_URL`, because the route is
per-model — `{AGENTBASE_URL}/proxy/llm/<org>/<model-slug>/v1`. That is still true as
concatenation. But `agentbase.list_models` returns `orgSlug` **and** `slug`, so both missing
pieces are recoverable from the model you already named: AGENTDISC-1 applied to models.

**The injected path is untouched, and that ordering is load-bearing.** An injected
`AGENTBASE_LLM_BASE_URL` always wins and the registry is never consulted — a hosted container
authenticates with an org-owned service application, which the native MCP tools reject with
`developer_app_required`. If a lookup ever preempted the injected value, every hosted import
would break at its first LLM call. Pinned by AGT-011.

**Resolved lazily, on the first real call.** `resolveAgentModel()` runs during
`new Agent({...})` construction and stays synchronous; the provider is built against an
unroutable sentinel base that the custom `fetch` rewrites once the real one is known. So boot
neither slows down nor gains a new way to fail, and a bad rewrite dies locally rather than
leaving the machine.

**`AGENTBASE_LLM_MODEL` accepts three forms** — the model slug, `<provider>/<model-id>`, or a
bare model id — rather than making you learn which one the field wants.

**Handled by `pnpm precast:update`.** Nothing — `apps/` code.

**Manual steps.**

1. **Copy `resolveLlmBaseUrl` and the `SENTINEL_BASE` rewrite** from
   `apps/agents/src/mastra/lib/agentbase-model.ts`, plus the AGT-011 block.
2. **You may clear `AGENTBASE_LLM_BASE_URL` from `.env`** once `AGENTBASE_URL` is set. Keeping
   it is fine and still overrides — nothing forces the change.

**Advisory files touched.** `.env.example`, `apps/agents/src/mastra/lib/agentbase-model.spec.ts`.

**Verify.**

```bash
pnpm verify
```

---

## v0.9.9 — a shorter LLM section in `.env.example` (2026-08-20)

**What changed.** `.env.example` went from 38 keys to 32. The LLM section now leads with the
AgentBase Models option, then lists **five** direct vendor keys — Anthropic, OpenAI, Google,
xAI, OpenRouter — instead of eleven.

`DEFAULT_LLM_MODEL` is no longer pre-printed either, for the same reason — a comment explains
what it does and when you would want it. It remains fully supported, and is still the only way
to pin one _specific_ model (a bare `ANTHROPIC_API_KEY` gets that provider's default) or to
reach the ~100 community providers Mastra resolves but does not auto-detect.

**Nothing lost.** Mistral, DeepSeek, Groq, Cerebras, Perplexity and AI Gateway are still
auto-detected by `default-model.ts` and still declared in the env schema; they are simply not
pre-printed. A comment names them and points at the file that owns the canonical list, so
adding one is a single line.

**`AGENTBASE_LLM_BASE_URL` cannot be derived from `AGENTBASE_URL`**, and the file now says why.
The gateway route is per-MODEL:

```
{AGENTBASE_URL}/proxy/llm/<org>/<model-slug>/v1/chat/completions
```

so the base carries a publisher org and a model slug — it is not a fixed prefix. Deriving it
would mean a registry lookup (`agentbase.list_models` returns `slug` + `orgSlug`), which is the
AGENTDISC-1 pattern applied to models rather than a string concatenation. Not done here.

**Handled by `pnpm precast:update`.** Nothing — `.env.example` is advisory.

**Manual steps.**

1. **Optional.** Your `.env` is unaffected: no key was removed from the schema or the detector,
   so anything already set keeps working. Take this only if you want the shorter file.
2. If you diff `.env.example` against your own, expect the six vendor keys to appear as
   removals. They are still supported — do not read that as dropped provider support.

**Advisory files touched.** `.env.example`.

**Verify.**

```bash
pnpm verify    # SMOKE-008 and SMOKE-017 both read .env.example directly
```

---

## v0.9.8 — a fresh scaffold boots again (2026-08-20)

**What changed.** Two bugs that only appear on a _brand-new_ project, found by asking a
question no test asked: what is actually in `.env` after `pnpm bootstrap`?

**1. `pnpm poc` failed on a fresh scaffold.** `.env.example` ships `AGENT_API_TOKEN=` — empty,
which is correct for a committed file — the runtime images bake `NODE_ENV=production`, and the
v0.9.5 boot guard refuses to start an unauthenticated agent API. So the first command anyone
runs on a new project failed. Each piece was individually right; the contract only broke when
all three met. **Bootstrap now mints a 32-byte CSPRNG token** into `.env`.

Generated unconditionally rather than gated on deployment mode. There is no mode where a local
token does harm: an AgentBase-hosted import has the platform mint its own inbound bearer and
inject it, overriding `.env` entirely, and Standalone/External is exactly the case that needs
one. Gating would mean teaching bootstrap a deployment-mode concept it does not have.

**2. Discovery did not recognise the placeholder it ships.** `runDiscovery()` checked
`if (!base)`, but `AGENTBASE_URL=https://api.agentbase.example.com` is **truthy** — so a fresh
project attempted DNS against a domain that does not exist and got a network error instead of
the actionable "not configured" message. Now `!base || base.includes('example.com')`.

**Also: the v0.9.5 boot guard had no unit test.** It shipped verified only by running a
container afterwards. `AGT-010` covers it properly, including that an empty string counts as
absent and that only exactly `1` enables the opt-out — a loose check would let
`ALLOW_UNAUTHENTICATED_AGENT_API=false` disable the guard.

**Handled by `pnpm precast:update`.** `scripts/bootstrap.mjs` is managed, so the token
generation comes across. The discovery fix is `apps/` code — yours to port.

**Manual steps.**

1. **Add the `example.com` guard** to your `agentbase-discovery.ts` (or whatever resolves your
   proxy URL). Any committed placeholder that looks routable will otherwise pass a truthiness
   check and fail later at the network.
2. **Set `AGENT_API_TOKEN` in an existing project's `.env`** if it is still blank and you deploy
   with `NODE_ENV=production` — this affects you today, independently of upgrading.
3. **Copy `apps/agents/src/mastra/middleware/auth.spec.ts`** and the SMOKE-017 block.

**Advisory files touched.** `apps/agents/src/mastra/middleware/auth.spec.ts`,
`apps/web/test/repo-hygiene.spec.ts`, `apps/web/test/agentbase-discovery.spec.ts`.

**Verify.**

```bash
pnpm verify
grep '^AGENT_API_TOKEN=' .env    # non-empty after a fresh bootstrap
```

---

## v0.9.7 — containers drop root (2026-08-20)

**What changed.** Both runtime images ran as **root** — not by decision, but because that is
what happens when no `USER` is set. Every Precast deployment ran its application as uid 0,
which turns any container escape or arbitrary-write bug into a considerably worse incident.
Nothing surfaced it: the container is healthy and the app works either way, which is exactly
why it survived this long.

`apps/agents/Dockerfile` and `apps/web/Dockerfile` now `COPY --chown=node:node` and declare
`USER node` — the unprivileged user (uid 1000) that `node:24-alpine` already ships. Both
published ports are above 1024, so nothing needed elevation.

**Verified by running the images, not by reading them.** Both report `uid=1000(node)`; the
agents card answers 200 against a live Postgres and the web app renders 200 with its ports
matched as Compose runs them. A root-forced control reproduced the one failure seen during
testing — a self-fetch `ECONNREFUSED` caused by remapping the published port — confirming it
was a testing artifact rather than the `USER` change.

**Two ordering details that are easy to get wrong**, both pinned by APP-022:

- **`USER` must come after the final `COPY`.** Switching earlier copies into a root-owned
  `WORKDIR`, which fails or silently drops permissions.
- **`--chown=node:node` is not optional.** Without it the bundle stays root-owned. It is still
  _readable_, so the app boots normally and the gap only appears the first time something needs
  to write — long after the change looks proven.

**Handled by `pnpm precast:update`.** Nothing — the Dockerfiles live under `apps/`.

**Manual steps.**

1. **Add `USER node` after the last `COPY`** in each runtime stage, and `--chown=node:node` to
   every `COPY --from=build`.
2. **Check anything your app writes at runtime.** A path outside the copied tree (a cache dir,
   an upload target, a socket) needs `RUN mkdir -p <path> && chown node:node <path>` before the
   `USER` line, or the first write fails in production rather than in your build.
3. **If you publish on a port below 1024, remap it.** An unprivileged user cannot bind those,
   and the container will fail to start.
4. **Copy the APP-022 block** from `apps/web/test/docker-build.spec.ts`.

**Advisory files touched.** `apps/web/test/docker-build.spec.ts`.

**Verify.**

```bash
docker build -f apps/agents/Dockerfile -t check . && docker run --rm check id   # uid=1000(node)
pnpm verify
```

---

## v0.9.6 — security patches and error boundaries (2026-08-20)

**What changed.** A `pnpm audit` — which the v0.9.5 audit never ran — found **40 vulnerabilities,
including four high-severity Next.js advisories** that were live in every deployed Precast web
app: Middleware/Proxy bypass in App Router, SSRF in Server Actions, SSRF in rewrites, and a DoS.

|                     | Before                   | After  |
| ------------------- | ------------------------ | ------ |
| Total               | 40 (1 critical, 21 high) | **15** |
| **Production deps** | 13 (6 high)              | **2**  |

**Next.js `16.2.10` → `16.3.1`.** The pin was already `^16` so the range permitted the fix, but
the lockfile held the vulnerable build — meaning every install and every scaffolded project got
it. Verified: full suite plus e2e green on the new version.

**Transitive production advisories are pinned by floor**, in `pnpm.overrides`: `hono`,
`@hono/node-server`, `fast-uri`, `ip-address`. Each is a patch bump inside the same minor.
Remove an entry once the upstream range clears it on its own.

**One override is deliberately scoped, and this is the trap to avoid.** A blanket
`js-yaml: >=3.15.1` looks right and is wrong: it crosses the 3→4 major, where `safeLoad` and
`safeDump` were **removed**. `gray-matter` binds them at import time, so every agents spec that
transitively imported it failed to load with `Cannot read properties of undefined (reading
'bind')`. The entry is `gray-matter>js-yaml: ^3.15.1` — scoped to the one vulnerable path, and
inside the 3.x line.

**`image-size` is knowingly left unpatched.** Its advisory reports `Patched versions: <0.0.0` —
there is no fixed release to float to. Pinning it would misrepresent the risk as handled.

**Error boundaries.** `apps/web/app/` gains `error.tsx`, `not-found.tsx` and `global-error.tsx`.
Without them Next serves its own pages: unstyled, off-theme, and in production reduced to
"Application error: a client-side exception has occurred". `error.tsx` surfaces only Next's
`digest` — the hash that ties the screen to the server log — because Next replaces the real
message server-side precisely so internals don't reach the browser. `global-error.tsx` uses
plain elements and inline styles on purpose: it catches failures in the root layout, so the
design system and theme provider it would otherwise use are exactly what just threw.

**Handled by `pnpm precast:update`.** Nothing — `package.json` and `apps/` are yours.

**Manual steps.**

1. **`pnpm update next`** (or bump your pin) and re-run your suite. Confirm with `pnpm audit`.
2. **Copy the `pnpm.overrides` block** from `package.json`, then `pnpm install`. Check your own
   tree first — a floor that is right here can cross a breaking major in a different dependency
   graph, which is exactly what the `js-yaml` entry documents.
3. **Copy the three error boundary files.** They use Astryx components (`Button` takes a
   `label` prop, not children) — swap in your own design system if you have replaced it.

**Advisory files touched.** `package.json`, `apps/web/app/{error,not-found,global-error}.tsx`,
`apps/web/e2e/home.spec.ts`.

**Verify.**

```bash
pnpm audit --prod    # expect only the unfixable image-size advisories
pnpm verify && pnpm test:e2e
```

---

## v0.9.5 — the pre-1.0 hardening pass (2026-08-20)

**What changed.** A gap audit of the repo turned up fifteen items; this release closes fourteen
of them. Most were things the boilerplate _promised_ and did not do.

**The three that matter most:**

1. **CI now exists.** `.github/workflows/ci.yml` runs typecheck, lint, test, build and the
   framework-scripts lint on every push and PR, with e2e in a parallel job. Before this,
   nothing ran automatically — a scaffolded project's only gate was the pre-commit doc hook,
   which `SKIP_DOC_CHECK=1` bypasses.
2. **A production deploy with no `AGENT_API_TOKEN` now refuses to boot.** Unset means
   `/api/a2a/*` and `/api/agents/*` are fully open, and nothing said so — the container is
   healthy, the agents answer, and anyone who can reach the port can invoke them. AgentBase
   injects the token on a hosted import, so those are unaffected. A genuinely private
   deployment opts out explicitly with `ALLOW_UNAUTHENTICATED_AGENT_API=1`.
3. **The 22 unimplemented fitness tests are implemented.** Every `SMOKE-*` and `DOC-*` row was
   `Not Started` — a quarter of the catalogue, in a document that reads as a record of
   coverage. They are now `apps/web/test/repo-hygiene.spec.ts` (61 assertions).

**Also in this release.**

|                      |                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keycloak healthcheck | `pnpm poc` no longer reports the stack healthy while Keycloak is still booting. Uses bash `/dev/tcp` against the management port (the image has no curl), verified live against a running container |
| Secret guard         | `.env.example` is checked for non-placeholder credentials, high-entropy tokens, and the APP-019 inline-comment bug that once shipped a comment as a 48-char "API key"                               |
| `engines`            | `package.json` now pins Node, so a wrong runtime fails at install rather than confusingly later. Asserted to agree with `.nvmrc`                                                                    |
| `pnpm verify`        | One command for typecheck + lint + test (what CI runs). `pnpm verify:all` adds build + e2e                                                                                                          |
| Dependabot           | Weekly, grouped by what moves together — fifteen separate patch PRs a week is how teams learn to ignore it                                                                                          |
| E2E coverage         | 3 specs → 8, covering the A2A route's validation, error shape, and that it never leaks a stack trace or env value                                                                                   |
| Deprecated actions   | `checkout`/`setup-node`/`artifact` bumped v4 → v5 (Node 20 shim)                                                                                                                                    |
| GHCR grant           | The `permission_denied: write_package` first-run failure is documented in the workflow header — **including that the role defaults to Read, which still cannot push**                               |

**Handled by `pnpm precast:update`.** The workflows, `dependabot.yml`, `docker-compose.yml`
and `eslint.config.js` are managed and come across. `package.json`, `.env.example`,
`packages/shared/src/env.ts` and the spec files are advisory — port them.

**Manual steps.**

1. **Copy `.github/workflows/ci.yml`** and adjust the branch names if yours differ. It assumes
   `develop`; there is nothing else project-specific in it.
2. **Copy the production auth guard** — `assertAgentApiAuthConfigured()` in
   `apps/agents/src/mastra/middleware/auth.ts`, called from `index.ts` right after
   `parseApiEnv()`. **Check your production env before deploying this**: if you are running
   without `AGENT_API_TOKEN` today, this will refuse to start. That is the point, but it
   should not be a surprise at deploy time.
3. **Copy `apps/web/test/repo-hygiene.spec.ts`.** It asserts things about _your_ repo, so
   expect a few honest failures on first run — that is it working.
4. **Add `engines` to `package.json`** and a Keycloak healthcheck if you run one.
5. **`pnpm smoke:chat`** is new and needs a running stack plus a provider key. It is the
   end-to-end round trip nothing else covers.

**Advisory files touched.** `package.json`, `.env.example`, `docs/SCRIPTS.md`,
`apps/web/test/repo-hygiene.spec.ts`, `.github/workflows/ci.yml`, `.github/dependabot.yml`.

**Known gap, stated plainly.** `SMOKE-016` (the chat round trip) ships as a script whose
failure paths are verified, but the round trip **has never actually been run** — no provider
key was available. It stays `Not Started` in the catalogue rather than being quietly marked
covered. The LICENSE gap from the same audit is also deliberately still open.

**Verify.**

```bash
pnpm verify        # typecheck + lint + test
pnpm test:e2e      # 8 specs
```

---

## v0.9.0 — agent proxy URLs are discovered, not configured (2026-08-19)

**What changed.** The web app no longer needs one `AGENTBASE_AGENT_URL_<AGENT_ID>` per agent.
It asks AgentBase which agents this Application is subscribed to and works out which slug
belongs to which Mastra agent id, at runtime.

The configured mapping was always going stale. AgentBase mints an agent's slug **at import**
(`advisor-agent` → `founder-advisor-479c1de1`); the slug is not derivable from the Mastra id,
and it **changes on re-import**. So the var was correct only until the next import, and its
failure mode is a 404 from a URL that looks perfectly well-formed.

**How the mapping is recovered.** Mastra names an agent's A2A card after the agent id:

```
GET /api/.well-known/<agentId>/agent-card.json   ->   { "name": "<agentId>", … }
```

and AgentBase's `AgentCardSynthesizer` spreads the stored card, overriding only `url`,
`capabilities.streaming`, `supportedInterfaces[0].url`, `securitySchemes` and `provider` — it
never touches `name`. So the card served at `{base}/proxy/a2a/{org}/{slug}/.well-known/agent.json`
states the Mastra id at a path containing the slug. That response is one row of the map.

**Do not map on the listing name instead.** `agentbase.list_subscriptions` and `list_agents`
both return a `name`, and using it would skip the card fetch — but that is AgentBase's own
display name, editable at import, and it routinely differs from the Mastra id. It appears to
work until somebody renames an agent in Studio.

**New env var:** `AGENTBASE_URL` — the AgentBase API base. One var, however many agents.

**Handled by `pnpm precast:update`.** Nothing — this is `apps/` and `packages/` code.

**Manual steps.**

1. **Copy `apps/web/app/lib/agentbase-discovery.ts`.** It exports `resolveAgentUrl()`,
   `discoverAgentRoutes()` and `resetDiscoveryCacheForTests()`, and reuses
   `getAgentBaseAccessToken()` — no new credential.
2. **Point `callViaAgentBase()` at it** in `apps/web/app/lib/a2a-client.ts`: replace the
   `process.env[envVar]` read with `await resolveAgentUrl(agentId)`, and delete the local
   `envVarNameForAgent` helper. `callAgent()` is already async, so nothing else changes.
3. **Add `AGENTBASE_URL`** to your env schema as an optional URL, and set it in `.env`.
4. **Leave your `AGENTBASE_AGENT_URL_*` vars in place** if you like — they are now an
   override that still wins. Removing them is the point, but it is safe to do it later.
5. **If you kept a slug MAP instead** (`AGENTBASE_AGENT_SLUGS=id=slug,…`, as some derived
   projects grew independently), delete it and its parser. Discovery replaces it wholesale,
   and `AGENTBASE_ORG` becomes redundant too — the org arrives with every discovery row.
6. **Copy `apps/web/test/agentbase-discovery.spec.ts`.**

**Advisory files touched.** `packages/shared/src/env.ts`, `.env.example`,
`apps/web/test/a2a-client.spec.ts` (one contract test changed — an unset per-agent var is no
longer an error, it is the normal case), and the new `apps/web/test/agentbase-discovery.spec.ts`.

**Behaviour worth knowing.**

- **Failure never degrades to a guess.** If discovery fails, the call returns an error. It
  never falls back to `/proxy/a2a/<org>/<id>` — that is the well-formed 404 this replaces.
- **An unknown id forces exactly one refresh**, so a re-import resolves without a redeploy,
  while an id that genuinely does not exist cannot re-run discovery on every request.
- **Only successful discovery is cached** (10 min). Caching a failure would keep the app
  broken for a full TTL after a transient blip.
- **Concurrent callers share one in-flight discovery** — no stampede on cold start.
- **Two agents claiming one Mastra id resolve to neither**, with a warning. Silently picking
  one would route traffic to an arbitrary agent; pin the intended one with the override.

**Verify.**

```bash
pnpm test   # WEB-011, 10 cases
```

---

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
fail-loud design against _silent tool loss_ is intact; only the OAuth-pending case is
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
   _boundary_ rather than the bug: auth-pending is skipped, non-auth still throws, and a
   healthy server's tools survive next to a skipped one. Widen the predicate and case 2 fails —
   which is the point, because a too-generous `isMcpAuthError` silently restores the
   silent-tool-loss failure mode this path exists to prevent.
3. **Update any comment at your `...(await resolveAgentMcpTools(...))` call sites** that says a
   hosted connect failure fails the boot. It is now true of every failure _except_ one.
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

| Concern            | Write this                                         | Was                           |
| ------------------ | -------------------------------------------------- | ----------------------------- |
| Client id          | `AGENTBASE_CLIENT_ID`                              | `AGENTBASE_LLM_CLIENT_ID`     |
| Client secret      | `AGENTBASE_CLIENT_SECRET`                          | `AGENTBASE_LLM_CLIENT_SECRET` |
| Token endpoint     | `AGENTBASE_TOKEN_URL`                              | `AGENTBASE_LLM_TOKEN_URL`     |
| Per-agent override | `AGENTBASE_CLIENT_ID_<AGENT_ID>`                   | `AGENTBASE_LLM_CLIENT_ID_<…>` |
| LLM gateway URL    | `AGENTBASE_LLM_BASE_URL` — **unchanged**           | —                             |
| Model              | `AGENTBASE_LLM_MODEL[_<AGENT_ID>]` — **unchanged** | —                             |
| MCP proxy root     | `AGENTBASE_MCP_BASE_URL` — **unchanged**           | —                             |

The rule: **identity is unprefixed; capability endpoints and settings keep their infix.** The
web app's `AGENTBASE_CLIENT_ID` was already the unprefixed form, so this consolidates two
parallel credential sets into one rather than inventing a name.

**Nothing breaks if you do nothing.** The old names are still read, and deliberately so:
AgentBase _injects_ `AGENTBASE_LLM_CLIENT_ID_<AGENT_ID>` into a hosted container, and this repo
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

**Late addition — check which deps package you publish to.** Before this release `pnpm rename`
also rewrote the GHCR reference, so a project scaffolded earlier publishes to its OWN package
(`ghcr.io/<owner>/<project>-deps`) rather than the shared `precast-deps`. It works, but it gets
no cache sharing and no benefit from upstream's published layers. Check with:

```bash
grep IMAGE .github/workflows/deps-image.yml
```

If it names `<project>-deps`, point it back at `precast-deps` and grant this repo **Write**
access on that package (see the header of that workflow — the role defaults to Read, which
cannot push). Leaving it alone is a valid choice; it just costs you the shared cache.

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
