# Project Status

**Last updated:** 2026-08-08

**Current feature constraint:** The Today’s Focus phase (`AICC-PHA-023`) includes a bounded grounded AI Executive ADHD Coach. The deterministic roadmap derivation remains authoritative; provider recommendations must be validated, explainable, privacy-bounded, and user-approved before mutation. Broader North Star/OR document ingestion, cloud sync, and autonomous behavior remain outside this feature.
**Active project:** `C:/Users/joshr/OneDrive/Desktop/north-star/anthropic-certification-native`
**Branch observed:** `main`
**Current phase:** Release 1 phase `AICC-PHA-023` — Today’s Focus and Dependency-Aware Coaching. Planning is expanded to include the grounded coach implementation, and execution begins at `AICC-TSK-067`; prior Follow-through work remains implemented with automated verification passed and interactive Electron acceptance as a manual handoff.

## Night handoff — 2026-08-06

Phase 2 was implemented and pushed to the active feature branch. The renderer now includes a bounded local-first Projects workspace with project creation/selection/rename/delete, task creation/edit/delete, four fixed Kanban statuses, truthful empty states, isolated local persistence, and confirmation-based cascading project deletion.

Protected boundaries were preserved: the existing Learning & Development localStorage key/schema, Academy IPC/preload contracts, native Academy BrowserView, and resizable three-pane layout were not intentionally changed. No authentication, cloud sync, credentials, provider integration, AI coaching, analytics, fake data, or destructive migration was added.

Verification completed:

- `npm run build` passed.
- `node --check electron/main.cjs` passed.
- `node --check electron/preload.cjs` passed.
- `git diff --check` passed.
- Build emitted only the existing Vite `configLoader: 'native'` CommonJS/ESM warning.

Runtime interaction acceptance was completed by the user. The user confirmed project creation/selection, task creation, visible inline editing and save, movement through all four Kanban columns, reload persistence, task deletion, project deletion, empty state recovery, Learning & Development navigation, Academy pane visibility, splitter resizing, Academy close/open behavior, and board operation after returning from Learning. This historical handoff predates the user-approved `AICC-PHA-023` scope expansion.

## Verified repository baseline

- Git repository exists at the active project root.
- Recent baseline commits include `feat: add learning command center` and `chore: establish North Star project baseline`.
- The project is an Electron + React + Vite desktop app.
- The existing brief records substantial working learning, persistence, native Academy, capture, practice, flashcard, review, and resizable-shell behavior. Future sessions must inspect source and verify behavior rather than treating historical notes as proof of current runtime state.

## Current product state

- Product direction has changed from a certification-first app to an AI Executive Coach Command Center.
- Existing learning/certification functionality remains a protected module.
- Phase 1 now provides the broader product shell and truthful command-center landing state.
- The left navigation is organized into Command Center and Learning & Development sections.
- The landing view explicitly labels future executive workflows as planned rather than simulated.
- Existing learning curriculum, local state, Academy IPC, native BrowserView, and splitter code remain in place.
- The local Projects + Tasks + Kanban workflow is implemented and is the active priority for runtime acceptance and board-focused fixes.
- Follow-through is now a derived review queue over the same SQLite-backed tasks/subtasks. It surfaces blocked, overdue, stale, and neglected work with project/release/phase context, next action, and definition of done.
- Follow-through acknowledgement is explicitly session-only because the existing database has no review-record table. Defer is an explicit user action through the existing `updateTask` API; opening, acknowledging, and updating never marks work done.
- Today’s Focus and Waiting are implemented as a dependency-aware, read-only derivation over the canonical SQLite roadmap. The UI shows up to three Focus items, a collapsed Waiting section, explanations, and a handoff to the complete Kanban inventory.
- The bounded coach context and deterministic local guidance are implemented. Ask AI Coach now requests structured JSON and validates recommendations against the current Focus snapshot, rejecting malformed, unknown, blocked, dependency-locked, completed, and out-of-context work. Provider responses remain display-only and cannot mutate roadmap data.
- The initial Today’s Focus AI happy path is implemented: the user-triggered Ask AI Coach flow sends bounded context through the Electron OpenRouter bridge, validates one structured recommendation against the current Focus list, displays the result, and opens the selected task in Projects. It requires `OPENROUTER_API_KEY` and network access.
- AI recommendations now support an explicit next-action approval flow: Open task, Dismiss, preview current versus proposed next action, and Apply through the existing validated task-update IPC path. Apply rechecks that the task is still in the current Focus list before writing.
- Privacy controls, provider fallback, provenance/freshness, usage ledger, approval preview/mutation audit, broader edge-case tests, and full manual Electron acceptance are explicitly deferred post-MVP rather than current happy-path blockers.
- The long-term vision is documented in `.hermes/PRODUCT_VISION.md`.
- Cross-session decisions are documented in `.hermes/DECISIONS.md`.
- The active implementation boundary is documented in `.hermes/plans/PHASE-02-projects-tasks-kanban.md`.
- Phase 1 remains historical context only; its acceptance note is not the current stop condition.

## Completed in this phase

- Replaced the oversized, learning-centric project brief with a concise project-wide source of truth.
- Added the long-term product vision.
- Added a current-status ledger.
- Added a durable decision log.
- Added a reusable session handoff template.
- Defined the first implementation phase and its stop conditions.
- Reframed the app identity and top-level navigation around Executive Coach Command Center.
- Preserved Learning & Development as a distinct module.
- Added truthful planned-state messaging for future executive workflows.

## Phase 4 — Follow-through and Accountability

- Contract and implementation order: `AICC-SUB-002 → AICC-TSK-004 → AICC-TSK-005 → AICC-TSK-006`.
- `AICC-SUB-002` — Define contract and acceptance cases — **done / contract drafted** in `.hermes/plans/PHASE-04-follow-through-accountability.md`.
- `AICC-TSK-004` — Model commitment lifecycle — **pure derivation complete** in `src/commitmentLifecycle.mjs`; active tasks/subtasks are classified without mutation or invented completion.
- `AICC-TSK-005` — Surface stale and blocked work — **pure queue derivation complete** in `src/followThroughView.mjs`; deterministic ordering and hierarchy context are covered by tests.
- `AICC-TSK-006` — Add follow-up review — **UI/review behavior implemented, manual acceptance pending**. The renderer adds Follow-through navigation, a memoized roadmap-derived queue, session-only acknowledgement, existing task-editor Update flow, and explicit Defer through `updateTask`.

## Verification completed for Phase 4 additions

- `node --test test/commitment-lifecycle.test.cjs test/follow-through-view.test.cjs` passed: **22 tests, 22 passed, 0 failed**.
- `node --test` passed: **36 tests, 36 passed, 0 failed** across the repository.
- `node --check src/commitmentLifecycle.mjs` passed.
- `node --check src/followThroughView.mjs` passed.
- `node --check electron/main.cjs` passed.
- `node --check electron/preload.cjs` passed.
- `node --check electron/database.cjs` passed.
- `npm run build` produced the renderer bundle successfully; Vite emitted only the existing `configLoader: 'native'` warning.
- `git diff --check` passed; only normal LF-to-CRLF working-tree warnings were reported by Git.

Interactive Electron acceptance remains pending. Manually verify Follow-through queue contents, acknowledge/defer/update behavior, persistence of a deferred task after restart, and that Today View, Projects/Kanban, Learning & Development, Academy BrowserView, and three-pane resizing remain intact.

## Historical Release 1 / Today View tasks

The earlier Release 1 → Today View tasks (`AICC-REL-001` / phase `AICC-PHA-001`) remain complete:

- `AICC-TSK-001` — Preserve roadmap foundation — **done** (verified against the live SQLite roadmap; no feature work, the local roadmap contract is retained).
- `AICC-TSK-002` — Define Today view contract — **done** (documented in `.hermes/plans/PHASE-03-release-01-today-view.md` and decision `D013`).
- `AICC-TSK-003` — Assemble grounded next actions — **done** (derived view queries the roadmap and surfaces prioritized actions; see `src/todayView.mjs`).

## Phase 3 — Release 1 Today View verification

The Today View implementation passed:

- `npm run build` passed (renderer compiled with no errors).
- `node --test` passed: 14 tests total, including new Today-view derivation tests (exclusions, blocked-first ordering, priority weighting, overdue flags, stable IDs, subtasks, empty-state).
- `node --check electron/main.cjs` and `node --check electron/preload.cjs` passed.
- `git diff --check` passed.

Interactive Electron acceptance (open Today in the running app, confirm derived list matches the SQLite roadmap, confirm Projects/Learning/Academy remain intact) is a manual handoff.

## Active next phase — Today’s Focus and Dependency-Aware Coaching

- Feature roadmap: `C:/Users/joshr/OneDrive/Desktop/TODAYS-FOCUS-FEATURE-ROADMAP.md`.
- Phase: `AICC-PHA-023` under Release 1.
- Execution begins with `AICC-TSK-067` and proceeds through dependency-aware Focus/Waiting derivation, grounded coach context, structured recommendation validation, deterministic fallback, approval controls, privacy/usage boundaries, tests, and Electron acceptance.
- The coach happy path is now part of the MVP. Do not describe the working AI recommendation flow as future compatibility; deferred hardening remains tracked separately.

## Current Today’s Focus verification

- `node --test` passed on 2026-08-08: **54 tests, 54 passed, 0 failed**.
- `npm run build` passed; Vite emitted only the existing `configLoader: 'native'` CommonJS/ESM warning.
- `node --check electron/main.cjs` passed.
- `node --check electron/preload.cjs` passed.
- `node --check electron/database.cjs` passed.
- `git diff --check` passed.
- Structured provider recommendation validation is covered by coach-provider tests.
- Manual production Electron acceptance is still pending.

## Deferred Today’s Focus hardening

- Provider-unavailable/error states surfaced through the deterministic fallback path.
- Recommendation provenance, roadmap snapshot freshness, and stale invalidation are not yet complete.
- Privacy controls and an attributable app-originated usage ledger are not yet complete.
- Approval preview, explicit Apply/Cancel mutation flow, and mutation audit result are not yet complete.
- Full privacy, freshness, approval-boundary, provider failure, and Electron acceptance tests remain.

## Historical Phase 1 verification

- `npm run build` passed on 2026-08-06; Vite emitted only the pre-existing CommonJS/ESM configuration warning.
- `node --check electron/main.cjs` passed.
- `node --check electron/preload.cjs` passed.
- `git diff --check` passed.
- Production desktop launch was started with `npm run desktop:prod`; Electron processes were observed running.
- Native Academy visual interaction was not independently exercised in that session; preserve the recorded BrowserView behavior as prior evidence, not current Kanban verification.
- Phase 1 acceptance is historical context; the active verification target is Phase 2 Kanban runtime acceptance.

## Historical Phase 2 stop condition

The Phase 2 stop condition prohibited beginning Today/Focus, coach intelligence, integrations, usage tracking, authentication, cloud sync, provider connections, or unrelated redesign until that phase was approved and its manual handoff was complete. That condition is historical and is superseded for current execution by the user-approved `AICC-PHA-023` roadmap. Automated gates, canonical seed import, SQLite CRUD/persistence smoke tests, native module loading, and production launch remain historical verification facts.

## Scope note

The implementation changes only the product shell, navigation labels/grouping, command-center landing copy/cards, truthful planned-state messaging, and related styling. Existing learning state, localStorage schema, Academy IPC, native BrowserView, capture/material/review persistence, and splitter geometry were not intentionally changed.

## Not included in verification

No automated test suite is defined in `package.json`; build and syntax checks are the available project gates.
## Explicitly deferred

- Autonomous agent behavior
- Broad external integrations
- Authentication and cloud sync
- Provider-wide usage retrieval requiring credentials
- Medical or clinical ADHD functionality
- Full replacement of the existing learning experience
- Large-scale database migration

## Verification status

The workspace/project hierarchy correction has passed renderer build, Electron syntax checks, diff checks, and direct SQLite assertions. The canonical seed now imports 1 workspace, 1 real project, 5 releases, 22 phases, 66 top-level tasks, and 36 subtasks. Interactive production-app acceptance remains a manual handoff.

## How to update this file

Replace stale state; do not append a chat transcript. Keep only durable facts, the current bounded objective, meaningful blockers, and verification results. If a decision changes, update `.hermes/DECISIONS.md` and reference the decision here.
