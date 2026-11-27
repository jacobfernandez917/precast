# PROGRESS.md — Context Memory

**Last Updated:** 2026-11-27
**Updated By:** Precast template
**Active Branch:** develop

This file is the derived project's progress template. Keep Precast maintainer history and internal execution reports in the separate maintainer workspace. Publication of internal reports requires explicit user approval.

The template now supports a credential-gated development preview inside Raya. Only one exact
approved HTTPS parent origin is emitted into a connected build; the default remains unframeable.
Connected scaffolds also preflight the approved setup descriptor before creating project files.

## 0. How to Use This File

Record the project's current decisions, blockers, coverage and next work. Never store credentials or personal data here. Read `HANDOFF.md` and any local maintainer instructions before editing.

## 1. Project Snapshot

Define the project name, mission, users and acceptance criteria before implementation.

## 2. Phase Plan

| Phase | Goal                                              | Status      |
| ----- | ------------------------------------------------- | ----------- |
| 1     | Define and verify the first working product slice | Not started |

## 3. Task Tracker (live)

- [ ] Define the product brief and acceptance criteria.
- [ ] Configure the approved model and Postgres connections.
- [ ] Build and verify the first usable slice.
- [x] Add a read-only pre-clone setup binding check and typed access blocker.
- [x] Verify focused preflight/recovery suites, typecheck and lint with locked dependencies.
- [x] Preserve failed attempts with typed recovery instead of unproven rollback.
- [ ] Verify actual public platform policy and run full gates with subprocess/listener support.

## 4. Open Decisions

| ID  | Decision | Date | Rationale |
| --- | -------- | ---- | --------- |

## 5. Known Blockers

Record a concrete blocker and the action needed to resolve it when one is found.

Exact `node -e` policy acceptance is unverified: the public AgentBase source lookup redirects
beyond the connector's supported endpoint, and the Raya location is unavailable. The current
client exposes no conditional rollback contract. Do not claim live proof, successful rollback,
or general policy permission. Full gates encounter sandbox subprocess/listener restrictions;
platform configuration, atomic credential binding and conditional Trash remain documented handoffs.

## 6. Test Coverage

Use `TEST_CASES.md` for test contracts. Record the checks run for this project's changes and their actual results.

The scaffold baseline covers default frame denial, one exact approved Raya parent, unsafe-origin
rejection, setup persistence, production-build environment loading, and the existing PoC
verification suite.

Preflight/recovery focused coverage: 69 agent tests passed (including AGT-048–051), and 112
setup/hygiene web tests passed with one pre-existing skip. Typecheck and lint passed. The normal
`pnpm verify` gate was attempted: web tests reported six failures from subprocess/listener
restrictions; separate full agent tests reported four listener-related failures, 272 passing,
and 16 skipped. Shared/a2ui suites passed (38/34). No live credential, provider, database or
platform acceptance test was run. Synthetic VM/program success does not prove policy acceptance.

## 7. Environment State

Use the assigned app ports and approved remote services. Keep credentials in the private environment; publish no customer endpoints, account identifiers or preview reservations here.

`PRECAST_PREVIEW_FRAME_ANCESTOR` is generated only from the saved setup credential. Do not add it
manually or broaden it to a wildcard; omitting it preserves the strict default response headers.

## 8. Session Log

Add the derived project's own entries as work proceeds. Precast maintainer sessions are recorded outside this template.

Template capability: connected setup now checks exact project access before clone; failures
preserve the PRD draft and return Configure project access. Later failures now return a typed
preservation/review result. Focused suites/typecheck/lint pass; full-gate and source-policy
blockers are recorded above without claiming platform acceptance.

## 9. Cross-Tool Handoff Notes

Record what the next contributor needs to continue the project, without copying internal operational evidence into the template.

Obtain the actual public command policy and conditional Trash contract before claiming platform
support. Re-run the full `pnpm verify` gate where its synthetic subprocess/listener tests can run.
Preservation is implemented; rollback is deliberately unavailable without atomic ownership and
unchanged-generation proof.

## 10. Changelog

Record notable project milestones and user-approved releases.
