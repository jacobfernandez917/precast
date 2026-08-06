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

| | Mechanism | Covers |
| --- | --- | --- |
| **File sync** | `pnpm precast:update` — 3-way comparison against the hashes in `precast.lock.json` | The framework surface: `scripts/`, `.githooks/`, `docker/`, `templates/`, the lint/TS/Turbo configs, `CLAUDE.md` |
| **This ledger** | Per-release notes with concrete edits | Everything the sync can't touch: `apps/`, `packages/`, `package.json`, `.env.example` — i.e. anywhere your project has real code |

The sync handles the mechanical majority. The ledger handles the rest, and an agent reading
it can adapt an instruction like "add X to the A2A client" onto code you've since restructured.

---

## 2. Upgrading, start to finish

> **Easiest path — ask your coding agent.** The Precast plugin ships an **`upgrade`** skill
> that drives this whole section: say *"upgrade precast"* (or `/precast:upgrade`) and it reads
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
2. **Apply the safe set.** Conflicts are skipped and their baseline is deliberately *not*
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

| Flag | Effect |
| --- | --- |
| `--ref=v0.3.0` | Target a specific tag, branch, or commit (default: the newest semver tag) |
| `--from=../precast` | Compare against a local checkout — no network, useful for testing |
| `--repo=<url>` | Point at a fork |
| `--force` | Overwrite conflicts, writing `<file>.precast-bak` first |

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

## v0.2.0 — APC Design System themes + narrower port range  (2026-08-06)

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
   - Copy `apps/web/app/theme/apc-theme.ts` across (it holds *your* theme choice, so the sync
     reports it as advisory rather than overwriting it).
2. **Pick a theme:** `pnpm set-theme <name>`, or keep the Stockholm default.
3. **Audit hard-coded colours.** Any literal hex in your components will look correct in one
   theme and wrong in the other four. Replace with semantic roles.
4. **Optional — re-pick ports** onto the narrower range with `pnpm set-ports --auto`. Existing
   ports in 40000–44999 still work; nothing forces a change.

**Advisory files touched.** `package.json` — gains two scripts:

```json
"set-theme": "node scripts/set-theme.mjs",
"theme:build": "node scripts/build-apc-theme.mjs"
```

`apps/web/test/ports.spec.ts` — the range comment now reads 45000–49151.

**Verify.**

```bash
pnpm theme:build --check   # committed CSS matches the tokens
pnpm test:web              # includes the APC contrast + mapping guards
pnpm poc web               # look at it
```

---

## v0.1.0 — Provenance and the upgrade path  *(never tagged — shipped inside v0.2.0)*

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

**Handled by `pnpm precast:update`.** Nothing yet — this release *is* the mechanism. From the
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
