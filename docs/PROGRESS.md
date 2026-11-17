# PROGRESS.md — Context Memory

**Last Updated:** 2026-11-17
**Updated By:** Precast template
**Active Branch:** develop

This file is the derived project's progress template. Keep Precast maintainer history and internal execution reports in the separate maintainer workspace. Publication of internal reports requires explicit user approval.

The template now supports a credential-gated development preview inside Raya. Only one exact
approved HTTPS parent origin is emitted into a connected build; the default remains unframeable.

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

## 4. Open Decisions

| ID  | Decision | Date | Rationale |
| --- | -------- | ---- | --------- |

## 5. Known Blockers

Record a concrete blocker and the action needed to resolve it when one is found.

## 6. Test Coverage

Use `TEST_CASES.md` for test contracts. Record the checks run for this project's changes and their actual results.

The scaffold baseline covers default frame denial, one exact approved Raya parent, unsafe-origin
rejection, setup persistence, production-build environment loading, and the existing PoC
verification suite.

## 7. Environment State

Use the assigned app ports and approved remote services. Keep credentials in the private environment; publish no customer endpoints, account identifiers or preview reservations here.

`PRECAST_PREVIEW_FRAME_ANCESTOR` is generated only from the saved setup credential. Do not add it
manually or broaden it to a wildcard; omitting it preserves the strict default response headers.

## 8. Session Log

Add the derived project's own entries as work proceeds. Precast maintainer sessions are recorded outside this template.

## 9. Cross-Tool Handoff Notes

Record what the next contributor needs to continue the project, without copying internal operational evidence into the template.

## 10. Changelog

Record notable project milestones and user-approved releases.
