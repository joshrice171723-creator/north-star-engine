# Hermes / North Star application map

**Repository:** `C:\Users\joshr\OneDrive\Desktop\hermes\anthropic-certification-native`  
**Product:** North Star, a local-first Electron command center  
**Inventory date:** 2026-08-25  
**How this was produced:** this document is based on the checked-in source tree, `package.json`, the project brief, and a live Electron verification of the application queue. It intentionally excludes generated/dependency directories (`node_modules`, `dist`, `release`, `release-next`, `tmp`, and `test-results`).

## Executive summary

North Star is a desktop workspace that combines:

- an executive command center for Today, Focus, projects, tasks, commitments, and follow-through;
- a preserved Learning & Development / Academy surface;
- multi-provider job search, ranking, matching, profile preferences, and email intelligence;
- truthful resume and cover-letter preparation with versioned local documents;
- browser-assisted job applications with provider adapters, reusable answers, checkpoints, blockers, review authorization, and evidence;
- interview preparation, voice conversation, and role-grounded coaching; and
- recruiter-contact discovery and approval-gated outreach.

The architecture is deliberately local-first. React renders the UI. Electron's main process owns SQLite, filesystem access, credentials, browser views, AI/network calls, Gmail, and durable workflow execution. `electron/preload.cjs` exposes a narrow IPC bridge. Secrets must never enter renderer state, logs, commits, or generated evidence.

## Product goals

1. Reduce overwhelm by showing a small, explainable next action.
2. Preserve durable user data locally and make state recoverable after restart.
3. Search for relevant work using deterministic provider normalization and bounded AI ranking.
4. Prepare truthful, evidence-backed application documents without inventing experience.
5. Automate safe application steps using approved profile data and documents.
6. Keep login, CAPTCHA, unknown/sensitive/legal answers, and irreversible submission human-reviewed.
7. Mark an application `applied` only after both browser submission evidence and matching employer email evidence exist.
8. Make blockers, retries, AI-credit implications, and active work visible.
9. Support interview practice and recruiter follow-through without fabricating contacts or claims.

## Current application-pipeline behavior

The canonical queue is owned by `electron/jobs/application-queue-service.cjs` and persisted by `electron/jobs/application-queue-repository.cjs` using migration `0036_durable_application_queue.sql`. Its normal sequence is:

`queued → researching → preparing_documents → validating_documents → opening → detecting_flow → waiting_for_login/creating_account → filling_profile → answering_questions → waiting_for_answer → uploading_documents → navigating → ready_for_review → submitting → verifying_browser → verifying_email → applied`

It also supports `retry_wait`, `blocked`, and terminal/unavailable outcomes. A lease and checkpoint prevent two workers from owning an item. Startup recovery pauses uncertain work instead of repeating an irreversible action. The old preparation/autonomous entry points remain compatibility wrappers but route to the durable owner.

Provider dispatch is adapter-based. Dice and Workday are validated production-enabled adapters; Greenhouse, Lever, Ashby, SmartRecruiters, iCIMS/Taleo, Adzuna, and a deterministic generic adapter are available for supported patterns. The browser runtime is Electron `WebContentsView`/CDP; Playwright is used for fixtures and tests.

The safe pass fills approved profile values, approved answers, and selected documents. Protected categories include authentication/CAPTCHA, legal signatures, sensitive voluntary disclosure, file uploads, navigation, and final submit. An answer can be saved once and reused only when its normalized question identity and applicability match. Submission authorization is snapshot-bound to the displayed job, destination, documents, answers, required fields, and page fingerprint.

After a submission, browser evidence records bounded URL/text/screenshot metadata, provider, timestamp, and confirmation signals. Gmail matching correlates employer, role, host/provider, sender/recipient, subject/body signals, timestamp, and confirmation number. Missing or delayed email is a visible verification state; it must not cause blind resubmission.

## Current verified state and issues

### Verified now

- The last live Zendesk failure was traced to an unbounded provider-flow checkpoint after the page opened.
- A bounded timeout and retry classification are implemented in `electron/main.cjs`; the change is committed as `21720e1`.
- After restart, Start successfully moved the queue into `running`; the Zendesk form displayed filled profile data, `Resume.pdf`, and `Cover Letter.pdf` instead of silently hanging.
- The current visible employer step contains CAPTCHA/terms/final-application controls. Those remain intentionally reviewed actions.
- Automated verification currently reports **312 tests passed, 0 failed**; `npm.cmd run build` succeeds with only the existing Vite config-loader and chunk-size warnings.

### Active issues / acceptance gaps

- The goal of 10 verified applications has **not** been reached. The queue contains actionable work, but no claim is made here that ten items are `applied`.
- CAPTCHA, login/activation, unknown questions, sensitive/legal attestations, and final submission still require the user. This is a safety boundary, not an automatic success.
- At the last live recovery there was one blocked item with a missing cover letter. It must be repaired or deliberately terminalized; it should not be retried indefinitely.
- A browser page can be ready while Gmail evidence is delayed or absent. Such an item must remain awaiting verification rather than being marked Applied.
- Real providers can change their DOM, cookies, account flow, or questions. Adapter fixtures and bounded repair logic reduce risk but cannot guarantee provider-wide compatibility.
- The queue processes serially and may spend AI/browser resources while the renderer is on another page. Start/Pause controls and the persistent Now working panel are therefore important operational controls.
- The project has broad automated coverage, but the complete live acceptance matrix still requires controlled evidence: successful dual-evidence submission, reusable unknown answer, login/CAPTCHA pause/resume, unavailable listing, restart recovery, mixed-provider batch, and zero duplicate submissions.

## How the app works end to end

1. `src/main.jsx` mounts the renderer, navigation, command-center views, learning surface, jobs surface, and IPC-backed state.
2. A search request crosses the preload bridge to `electron/main.cjs`, which uses the planner and provider modules to retrieve, normalize, filter, rank, and persist opportunities.
3. `src/JobsView.jsx` renders pipeline stages and opens job/application workspaces.
4. Document selection and generation use `application-documents.cjs`, `application-export.cjs`, the database document tables, and validation ledgers.
5. A queue start claims eligible targets in SQLite. The queue service updates canonical state and checkpoint metadata while the main process opens the employer page.
6. The browser inspector creates a bounded DOM snapshot. Policy and answer modules decide what may be filled. Deterministic CDP actions run first; AI is limited to ambiguous mapping or bounded repair.
7. The worker rescans reactive pages, handles uploads with exact paths and DOM verification, and pauses on reviewed blockers.
8. Review authorization is checked immediately before any final submission. Submission evidence is persisted at once.
9. Gmail sync and startup recovery reconcile delayed confirmation mail. Only browser-plus-email evidence can reach `applied`.
10. The queue drawer shows stage, current action, retry timing, evidence progress, and row-level Retry/Answer/Login/Review/Resume actions.

## Privileged/main-process file map

### Entry points, persistence, integrations

- `electron/main.cjs` — Electron lifecycle, IPC registration, BrowserView/CDP orchestration, job search and application workflow coordination, document generation, Gmail/Voice integrations, durable queue worker, evidence and review commands. Important helpers include credential read/write/status, timeout-bounded application checkpoints, `startAutonomousApplicationQueue`, safe form passes, durable queue processing, and IPC handlers.
- `electron/preload.cjs` — the renderer capability boundary. Exposes allow-listed methods for settings, roadmap/tasks, jobs, documents, browser controls, Gmail, Voice, coaching, recruiter outreach, and unified application-queue operations. No raw secrets or submission primitive is exposed.
- `electron/database.cjs` — opens/configures SQLite, applies ordered migrations, defines table adapters, seeds or repairs local data, parses CSV imports, and exposes domain persistence handles.
- `electron/api-audit.cjs` — redacts headers/URLs/bodies and instruments app-originated network calls for bounded diagnostics.
- `electron/location-format.cjs` — parses US locations and formats provider-specific location scopes.
- `electron/gmail-oauth.cjs` — PKCE URL generation, token exchange, refresh, scopes, and token usability checks.
- `electron/google-voice.cjs` — phone normalization, activity extraction, and stable deduplication fingerprints.
- `electron/voice-conversation.cjs` — OpenRouter Whisper transcription, chat response, and Kokoro speech synthesis with bounded audio/text sizes.

### Job retrieval, normalization, ranking, and email

- `electron/job-search.cjs` — USAJOBS retrieval, ZIP/location normalization, lane/filter construction, request budgeting, deterministic qualification, and provider diagnostics.
- `electron/job-search-planner.cjs` — turns profile intent into bounded provider-compatible search lanes; includes title expansion, seniority/remote/location inference, and fallback planning.
- `electron/public-job-providers.cjs` — Remotive/public-feed search, lane matching, location filtering, normalization, and safe timeout handling.
- `electron/adzuna-provider.cjs` — Adzuna request construction, response normalization, credential test, and bounded errors.
- `electron/dice-provider.cjs` — Dice MCP request construction, employment-type normalization, response parsing, and job normalization.
- `electron/greenhouse-provider.cjs` — Greenhouse board URL parsing, public-board retrieval, HTML stripping, and normalization.
- `electron/job-import.cjs` — parses imported HTML job listings, metadata, JSON-LD, location, and salary.
- `electron/job-matcher.cjs` — bounds ranking prompts, projects profile/resume/job evidence, validates AI selections, and preserves deterministic fallback scores.
- `electron/job-email-rag.cjs` — Gmail decoding/normalization, job-email classification, application-confirmation extraction, chunking, retrieval, and stable message IDs.
- `electron/job-email-links.cjs` behavior is integrated through `main.cjs`/database tables; email-to-job assignment and sender controls are persisted there.
- `electron/job-search-integrations.cjs` — optional LangChain/LangGraph/LangSmith and n8n clients, safe error/config projection, and job-search graph creation.
- `electron/outreach-discovery.cjs` — bounded public company/GitHub/web discovery; extracts role/contact candidates without claiming verification that was not observed.

### Application domain, documents, browser, and reliability

- `electron/jobs/application-domain.cjs` — application statuses/transitions, readiness checks, answer validation, and transition guards.
- `electron/jobs/application-documents.cjs` — evidence catalog, cover-letter claim ledger, generated-document validation, style checks, and generation/revision prompts.
- `electron/jobs/application-export.cjs` — safe per-job directories, filenames, selected files, and version folders.
- `electron/jobs/application-browser.cjs` — embedded browser creation, HTTPS/new-host policy, context menu, history buttons, snapshots, navigation, and view attach/detach.
- `electron/jobs/application-inspector.cjs` — bounded DOM inspection scripts, field descriptor normalization, page fingerprinting, unavailable-listing detection, and page status extraction.
- `electron/jobs/application-policy.cjs` — field classification, verified-profile source selection, reusable-answer lookup, and protected-field decisions.
- `electron/jobs/application-fill-planner.cjs` — bounded AI fill-plan messages, response parsing, candidate filtering, profile projection, scalar normalization, and repair prompts.
- `electron/jobs/application-fill-engine.cjs` — fill-plan construction and stale/protected-field validation.
- `electron/jobs/native-file-picker.cjs` — exact-path Windows native file-dialog automation with existence checks and bounded timeout.
- `electron/jobs/application-confirmation.cjs` — final readiness and bounded browser confirmation-language detection with URL redaction.
- `electron/jobs/application-confirmation-email.cjs` — employer confirmation matching and rejection of account/newsletter false positives.
- `electron/jobs/application-activation.cjs` — host/user-scoped activation-link/code extraction and safe credential references without storing raw activation payloads.
- `electron/jobs/application-reliability.cjs` — failure classes, workflow failure normalization, safe-pass classification, exponential bounded retry, and retry exhaustion.
- `electron/jobs/application-recovery-planner.cjs` — bounded AI recovery suggestions limited to safe actions (`dismiss`, `handoff`, `advance`, `ask`, `stop`).
- `electron/jobs/application-automation.cjs` — canonical autonomous application state constants and assertions.
- `electron/jobs/application-queue-repository.cjs` — durable queue-run/item CRUD, claim/lease, checkpoints, retry metadata, blockers, evidence references, and restart recovery.
- `electron/jobs/application-queue-service.cjs` — the sole queue owner: ordering, active-item exclusivity, start/pause/resume, retry scheduling, blocker resolution, review authorization, worker callbacks, and human-readable DTOs.

### Automation framework and adapters

- `electron/jobs/automation/observation.cjs` — bounded page observation for the workflow orchestrator.
- `electron/jobs/automation/planner.cjs` — classifies page type and plans the next safe handoff/login/action.
- `electron/jobs/automation/executor.cjs` — executes only validated safe plans.
- `electron/jobs/automation/verifier.cjs` — verifies a completed workflow step.
- `electron/jobs/automation/orchestrator.cjs` — idempotent inspect/plan/execute/verify loop and normalized results.
- `electron/jobs/automation/idempotency.cjs` — stable action keys to prevent duplicate irreversible work.
- `electron/jobs/automation/result-contract.cjs` — workflow outcomes, step statuses, source values, bounds, and result validation.
- `electron/jobs/automation/transition-policy.cjs` — maps workflow outcomes to canonical application transitions.
- `electron/jobs/automation/answer-policy.cjs` — salary fallback and safe/protected answer categories.
- `electron/jobs/automation/repair-loop.cjs` — bounded provider-repair plans and validation; never authorizes submit.
- `electron/jobs/automation/playbook-registry.cjs` — persisted site recipes, fingerprints, verification thresholds, and drift invalidation.
- `electron/jobs/automation/trace-store.cjs` — credential-redacted trace storage and local fixture replay.
- `electron/jobs/adapters/provider.cjs` — common provider adapter contract, safe navigation, page classification, and normalized checkpoints.
- `electron/jobs/adapters/index.cjs` — adapter registry and provider selection with generic fallback.
- `electron/jobs/adapters/dice.cjs` — Dice provider rules.
- `electron/jobs/adapters/workday.cjs` — Workday provider rules.
- `electron/jobs/adapters/greenhouse.cjs`, `lever.cjs`, `ashby.cjs`, `smartrecruiters.cjs`, `icims-taleo.cjs`, `adzuna.cjs`, `generic.cjs` — provider-specific or generic adapter declarations built on the common contract.

## Renderer file map

- `src/main.jsx` — top-level React shell, navigation, command-center state, learning curriculum/progress, roadmap/task state, IPC subscriptions, and page composition.
- `src/JobsView.jsx` — job search/profile controls, pipeline cards, application queue shell, stage movement, document readiness, and row actions.
- `src/jobs/JobDetailsWorkspace.jsx` — listing details, role facts/skills, stage controls, events, voice activity, and application launch.
- `src/jobs/ApplicationBrowserPanel.jsx` — embedded application browser, workflow dock, document dock, account state, blocker/review controls, and browser handoff.
- `src/jobs/ApplicationQueueDrawer.jsx` — persistent Now working/queue drawer, canonical stages, retry timing, blocker labels, and browser/email evidence indicators.
- `src/jobs/ApplicationDocuments.jsx` — resume/cover-letter editors, validation, previews, versions, and selected-document claims.
- `src/jobs/ApplicationChecklist.jsx` — readiness checklist for profile, documents, fields, and review gates.
- `src/jobs/applicationLayout.mjs` — responsive sidebar/workspace/browser width calculations.
- `src/jobs/jobDescription.js` — safe HTML sanitization for job descriptions.
- `src/jobs/jobFitScoring.js` — imported-job deterministic fit score.
- `src/jobs/usLocations.js` — searchable US state/city dataset and location suggestions.
- `src/jobs/InterviewQuestions.jsx` — job-scoped question library and saved answers.
- `src/jobs/InterviewSimulation.jsx` — microphone/audio/transcription interview simulation UI.
- `src/jobs/EmailMonitorPanel.jsx` — Gmail sync status, grouped messages, assignment/exclusion controls, and review states.
- `src/jobs/emailJobFilter.js` — applied-stage filtering helpers for email views.
- `src/RecruiterOutreachView.jsx` — recruiter candidate list, verification badges, discovery forms, drafts, and approval-gated outreach.
- `src/recruiterOutreach.css` — outreach layout and status styling.
- `src/InterviewPrepView.jsx` — flashcards, quiz, fundamentals, timed mock, question library, communication insights, and AI-simulation launcher.
- `src/interviewPrep.css`, `src/interviewCards.css`, `src/interviewFeedback.css`, `src/interviewResearch.css` — interview UI styling.
- `src/coachContext.mjs` — bounded Focus/Waiting/follow-through context and deterministic coach guidance.
- `src/coachProvider.mjs` — structured OpenRouter coach request/response validation and recommendation bounds.
- `src/coachPresentation.mjs` — coach-card view model.
- `src/followThroughView.mjs` — derived blocked/overdue/stale/neglected review queue.
- `src/commitmentLifecycle.mjs` — task commitment lifecycle derivation and explanations.
- `src/todayFocus.mjs` — dependency-aware Focus/Waiting ordering, dependency chains, and explanations.
- `src/todayView.mjs` — Today view composition.
- `src/roadmapHierarchy.mjs` — workspace/project/release/phase hierarchy and scoped Kanban selection.
- `src/WorkspaceSettingsModal.jsx` — theme and integration settings editor.
- `src/voiceConversation.css`, `src/styles.css`, `src/theme.css`, `src/applicationAssistant.css`, `src/roleDetailsApplication.css`, `src/emailMonitor.css` — global, theme, voice, application, role-detail, and email styles.

## Function and component index

The following is the named-function surface. Small JSX event callbacks and constants are intentionally grouped under their owning component because they are not reusable module APIs.

- `src/todayFocus.mjs`: `parseDependencies`, `buildTodayFocus`; internal helpers normalize IDs, flatten roadmap tasks, classify exclusions, order priorities, build dependency chains, and explain blocked/waiting items.
- `src/todayView.mjs`: `buildTodayView`.
- `src/followThroughView.mjs`: `buildFollowThroughView`; internal helpers derive reason kinds, context, and stable ordering.
- `src/commitmentLifecycle.mjs`: `commitmentForTask`, `buildCommitmentLifecycle`; internal helpers explain stale, neglected, blocked, and overdue work.
- `src/roadmapHierarchy.mjs`: `buildRoadmapHierarchy`, `workspaceProjects`, `topLevelTaskIdForSubtask`, `kanbanTasksForScope`.
- `src/coachContext.mjs`: `buildCoachContext`, `buildDeterministicCoachGuidance`; bounded text/context helpers.
- `src/coachProvider.mjs`: `buildCoachProviderMessages`, `validateCoachRecommendation`, `normalizeCoachProviderResponse`.
- `src/coachPresentation.mjs`: `buildCoachCardModel`.
- `src/outreachScoring.mjs`: `scoreOutreach`, `contactQuality`, `emailConfidence`, `jobFreshness`, `chooseResume`, `buildEmail`.
- `src/jobs/applicationLayout.mjs`: `getApplicationLayout`.
- `src/jobs/jobDescription.js`: `sanitizeJobDescription`.
- `src/jobs/jobFitScoring.js`: `scoreImportedJob`.
- `src/jobs/emailJobFilter.js`: `isAppliedJob`, `appliedJobs`.
- `src/jobs/usLocations.js`: `searchUsLocations`.
- `electron/database.cjs`: `createDatabase`, `parseCsv`; table adapters cover projects, tasks, goals, settings, notes, briefings, integrations, calendar, opportunities, applications, answers, events, documents, accounts, and unknown questions.
- `electron/job-search.cjs`: location normalization, location scopes, provider request/filter construction, USAJOBS search, and retrieval normalization helpers.
- `electron/job-search-planner.cjs`: location/seniority inference, title expansion, fallback search brief, and bounded AI plan parsing.
- `electron/job-matcher.cjs`: profile/resume/job projections, prompt sizing, selection messages/payload parsing, deterministic ranking and AI selection validation.
- `electron/adzuna-provider.cjs`: `buildAdzunaParams`, `normalizeAdzunaItem`, `searchAdzuna`, `testAdzuna`.
- `electron/dice-provider.cjs`: `normalizeEmploymentTypes`, `diceParams`, `readMcpJson`, `searchDice`.
- `electron/greenhouse-provider.cjs`: `parseGreenhouseBoardUrl`, `normalizeGreenhouseJob`, `searchGreenhouseBoard`.
- `electron/public-job-providers.cjs`: lane matching, location matching, normalization, and `searchRemotive`.
- `electron/job-import.cjs`: `parseJobListing` plus metadata/JSON-LD/location/salary helpers.
- `electron/job-email-rag.cjs`: text/HTML normalization, confirmation extraction, email classification/chunk/search, Gmail decoding, and message normalization.
- `electron/gmail-oauth.cjs`: `tokenIsUsable`, `refreshGmailAccessToken`, `createPkcePair`, `buildGmailAuthorizationUrl`, `exchangeGmailAuthorizationCode`.
- `electron/google-voice.cjs`: phone extraction/normalization and activity fingerprinting.
- `electron/voice-conversation.cjs`: `transcribeAudio`, `transcribeAudioLong`, `generateAiResponse`, `synthesizeSpeech`.
- `electron/outreach-discovery.cjs`: URL/HTML/link/email parsing, GitHub discovery, public-page fetching, and contact discovery.
- `electron/jobs/application-domain.cjs`: `assertStatus`, `assertTransition`, `computeApplicationReadiness`, `validateAnswer`.
- `electron/jobs/application-documents.cjs`: claim-ledger/evidence-catalog builders, document claim/style/generated-document validators, and generation/revision prompt builders.
- `electron/jobs/application-export.cjs`: `safeSegment`, `applicationExportDirectory`, `applicationFilePaths`, `ensureApplicationFileStructure`, `applicationExportFilename`.
- `electron/jobs/application-browser.cjs`: `redactUrl`, `isHttps`, `isDismissLabel`, `decideNavigation`, `buildContextMenuTemplate`, `handleMouseNavigationInput`, `createApplicationBrowser`.
- `electron/jobs/application-inspector.cjs`: `normalizeDescriptor`, `normalizeSnapshot`, `INSPECTION_SCRIPT`, `PAGE_STATUS_SCRIPT`.
- `electron/jobs/application-policy.cjs`: `fieldText`, `profileSource`, `reusableAnswerFor`, `classifyField`, `decideField`.
- `electron/jobs/application-fill-planner.cjs`: fill-response parsing, AI-candidate filtering, profile projection, fill-plan message construction, decision normalization, and repair messages.
- `electron/jobs/application-fill-engine.cjs`: `buildFillPlan`, `validatePlanForFill`.
- `electron/jobs/application-confirmation.cjs`: `redactConfirmationUrl`, `finalReadiness`, `detectConfirmation`.
- `electron/jobs/application-confirmation-email.cjs`: `matchSubmissionConfirmation`.
- `electron/jobs/application-activation.cjs`: host/email normalization, activation URL extraction, activation candidate matching, and credential reference creation.
- `electron/jobs/application-reliability.cjs`: `classifyApplicationFailure`, `classifyWorkflowFailure`, `classifySafePassFailure`, `boundedRetry`.
- `electron/jobs/application-recovery-planner.cjs`: `recoveryFields`, `buildRecoveryMessages`, `parseRecoveryResponse`.
- `electron/jobs/application-queue-repository.cjs`: `createApplicationQueueRepository` and its claim/recovery/checkpoint/blocker/evidence persistence methods.
- `electron/jobs/application-queue-service.cjs`: `assertCanonicalApplicationState`, `createApplicationQueueService` and its start/pause/resume/retry/claim/process/blocker/review/status methods.
- `electron/jobs/application-automation.cjs`: `assertAutonomousApplicationState`.
- `electron/jobs/native-file-picker.cjs`: `chooseNativeFile`.
- `electron/jobs/automation/observation.cjs`: `observePage`.
- `electron/jobs/automation/planner.cjs`: `classifyPageType`, `planNextStep`.
- `electron/jobs/automation/executor.cjs`: `createSafeExecutor`.
- `electron/jobs/automation/verifier.cjs`: `createStepVerifier`.
- `electron/jobs/automation/orchestrator.cjs`: `safePlan`, `resultFromVerification`, `createApplicationOrchestrator`.
- `electron/jobs/automation/idempotency.cjs`: `bounded`, `makeIdempotencyKey`.
- `electron/jobs/automation/result-contract.cjs`: `assertEnum`, `validateWorkflowResult`, `makeWorkflowResult`.
- `electron/jobs/automation/transition-policy.cjs`: `policyFor`, `transitionPlan`, `applyTransition`.
- `electron/jobs/automation/answer-policy.cjs`: `salaryExpectation`, `normalizeAnswerCategory`, `policyFor`, `answerPolicyForField`.
- `electron/jobs/automation/repair-loop.cjs`: `validateRepairPlan`, `createRepairLoop`.
- `electron/jobs/automation/playbook-registry.cjs`: `createPlaybookRegistry` and bounded recipe persistence/matching methods.
- `electron/jobs/automation/trace-store.cjs`: `sanitizeTraceValue`, `sanitizeObservation`, `createTraceStore`, `replayWorkflowTrace`.
- `electron/jobs/adapters/provider.cjs`: `createProviderAdapter`.
- `electron/jobs/adapters/index.cjs`: `selectAdapter` and bounded adapter diagnostics.
- `electron/jobs/adapters/*.cjs`: declarative adapter configurations for Dice, Workday, Greenhouse, Lever, Ashby, SmartRecruiters, iCIMS/Taleo, Adzuna, and generic compatible sites.
- React components: `WorkspaceSettingsModal`, `RecruiterOutreachView`, `InterviewPrepView`, `JobsView`, `JobDetailsWorkspace`, `ApplicationBrowserPanel`, `ApplicationDocuments`, `ApplicationChecklist`, `ApplicationQueueDrawer`, `InterviewQuestions`, `InterviewSimulation`, and `EmailMonitorPanel` own their view state, event handlers, and IPC calls as described in the renderer map above.

## Database migrations

`electron/migrations/0001_initial.sql` through `0036_durable_application_queue.sql` are applied in filename order. The history covers the roadmap foundation; job opportunities/search diagnostics/profile preferences; applications, documents, browser sessions, answers, email RAG/links/sender controls, job detail/activity, external accounts/destinations/file manifests; recruiter outreach; autonomous application foundation and activation; submission evidence; unavailable/archive behavior; site playbooks; answer policies; workflow steps/traces; hardened playbook learning; and the durable queue runs/items, leases, retries, checkpoints, blockers, authorization snapshots, and evidence references.

## Test and fixture map

All tests run through `npm.cmd test` (`node --test test/*.test.cjs`). Application coverage includes:

- `test/application-queue-service.test.cjs`, `application-queue-ui.test.cjs`, `application-workflow-queue-contract.test.cjs`, `autonomous-application-queue.test.cjs`, `autonomous-application-foundation.test.cjs` — durable ownership, ordering, pause/resume, recovery, UI contract, and compatibility.
- `test/application-stage2-contract.test.cjs`, `application-stage3-contract.test.cjs`, `application-adapters.test.cjs`, `application-provider-fixtures.test.cjs`, `application-supported-replay.test.cjs`, `application-workflow-replay.test.cjs` — provider handoff, adapter fixtures, account flow, and replay.
- `test/application-autopilot-contract.test.cjs`, `application-automation-contracts.test.cjs`, `application-automation-result-contract.test.cjs`, `application-automation-transition-policy.test.cjs`, `application-automation-orchestrator.test.cjs`, `application-repair-loop.test.cjs`, `application-recovery-planner.test.cjs`, `application-playbook-registry.test.cjs`, `application-playbook-persistence.test.cjs`, `application-inspector.test.cjs`, `application-fill-planner.test.cjs`, `application-fill-plan.test.cjs`, `application-fill-browser-contract.test.cjs`, `application-answer-policy.test.cjs`, `application-reliability.test.cjs` — safe field decisions, idempotency, repair, traces, and failure policy.
- `test/application-domain.test.cjs`, `application-preparation.test.cjs`, `application-preparation-queue.test.cjs`, `application-documents.test.cjs`, `application-document-persistence.test.cjs`, `application-document-rendering.test.cjs`, `application-export.test.cjs`, `application-file-isolation.test.cjs`, `application-review-authorization.test.cjs`, `application-confirmation.test.cjs`, `application-activation.test.cjs`, `application-browser-policy.test.cjs`, `application-browser-view.test.cjs`, `application-layout.test.cjs`, `application-persistence.test.cjs` — readiness, documents, browser policy, review, evidence, and persistence.
- `test/fixtures/generic-application-form.json` and `test/fixtures/provider-adapters/{adzuna,ashby,dice,greenhouse,icims-taleo,lever,smartrecruiters,workday}.json` — deterministic provider/form fixtures; `test/fixtures/application-replays/dice-recovery.json` — replay/recovery fixture.

Other regression files cover `adzuna-provider`, `dice-provider`, `greenhouse-provider`, `public-job-providers`, `job-search`, `job-search-planner`, `job-search-integrations`, `job-matcher`, `job-import`, `job-email-rag`, `job-email-links`, `jobs-profile-persistence`, `jobs-report-progress`, `jobs-view-error`, `gmail-oauth`, `google-voice-job-matching`, `outreach-discovery`, `recruiter-outreach`, `ranking-fallback`, `job-pipeline-stage-transitions`, `job-pipeline-archive`, `job-application-domain`, `job-application-persistence`, `job-application-view`, `today-view`, `today-focus`, `follow-through-view`, `commitment-lifecycle`, `workspace-hierarchy`, `coach-context`, `coach-provider`, `coach-presentation`, `voice-conversation`, and `workspace` behavior.

Complete checked-in test path list: `test/adzuna-provider.test.cjs`, `test/application-activation.test.cjs`, `test/application-adapters.test.cjs`, `test/application-answer-policy.test.cjs`, `test/application-automation-contracts.test.cjs`, `test/application-automation-orchestrator.test.cjs`, `test/application-automation-result-contract.test.cjs`, `test/application-automation-transition-policy.test.cjs`, `test/application-autopilot-contract.test.cjs`, `test/application-browser-policy.test.cjs`, `test/application-browser-view.test.cjs`, `test/application-confirmation.test.cjs`, `test/application-document-persistence.test.cjs`, `test/application-document-rendering.test.cjs`, `test/application-documents.test.cjs`, `test/application-domain.test.cjs`, `test/application-export.test.cjs`, `test/application-file-isolation.test.cjs`, `test/application-fill-browser-contract.test.cjs`, `test/application-fill-plan.test.cjs`, `test/application-fill-planner.test.cjs`, `test/application-inspector.test.cjs`, `test/application-layout.test.cjs`, `test/application-playbook-persistence.test.cjs`, `test/application-playbook-registry.test.cjs`, `test/application-preparation-queue.test.cjs`, `test/application-preparation.test.cjs`, `test/application-queue-service.test.cjs`, `test/application-queue-ui.test.cjs`, `test/application-recovery-planner.test.cjs`, `test/application-reliability.test.cjs`, `test/application-repair-loop.test.cjs`, `test/application-review-authorization.test.cjs`, `test/application-stage2-contract.test.cjs`, `test/application-stage3-contract.test.cjs`, `test/application-supported-replay.test.cjs`, `test/application-workflow-queue-contract.test.cjs`, `test/application-workflow-replay.test.cjs`, `test/application-workspace.test.cjs`, `test/autonomous-application-foundation.test.cjs`, `test/autonomous-application-queue.test.cjs`, `test/coach-context.test.cjs`, `test/coach-presentation.test.cjs`, `test/coach-provider.test.cjs`, `test/commitment-lifecycle.test.cjs`, `test/dice-provider.test.cjs`, `test/follow-through-view.test.cjs`, `test/gmail-oauth.test.cjs`, `test/google-voice-job-matching.test.cjs`, `test/greenhouse-provider.test.cjs`, `test/interview-prep.test.cjs`, `test/job-application-domain.test.cjs`, `test/job-application-persistence.test.cjs`, `test/job-application-view.test.cjs`, `test/job-email-links.test.cjs`, `test/job-email-rag.test.cjs`, `test/job-import.test.cjs`, `test/job-matcher.test.cjs`, `test/job-pipeline-archive.test.cjs`, `test/job-pipeline-stage-transitions.test.cjs`, `test/job-search-integrations.test.cjs`, `test/job-search-planner.test.cjs`, `test/job-search.test.cjs`, `test/jobs-profile-persistence.test.cjs`, `test/jobs-report-progress.test.cjs`, `test/jobs-view-error.test.cjs`, `test/outreach-discovery.test.cjs`, `test/public-job-providers.test.cjs`, `test/ranking-fallback.test.cjs`, `test/recruiter-outreach.test.cjs`, `test/today-view.test.cjs`, `test/voice-conversation.test.cjs`, `test/workspace-hierarchy.test.cjs`.

## Repository/document/assets paths

- `README.md` — public project overview, architecture, run commands, and safety posture.
- `PROJECT_BRIEF.md` — project-wide source of truth and authority order.
- `AGENTS.md` — repository working rules.
- `AUTONOMOUS_APPLICATION_AUTOMATION_PLAN.md`, `CHECKPOINT_NEXT_WORKFLOW_REFERENCE.md`, `BUG_REPORT.md` — application automation plans, handoff details, and historical issue reports.
- `HANDOFF_VIDEO_FACTORY_COMMAND_CENTER.md` — Video Factory command-center handoff.
- `HERMES_HANDOFF_*.md` — historical job-search handoffs and provider/search diagnostics.
- `.hermes/DOCUMENT_INDEX.md`, `.hermes/PRODUCT_VISION.md`, `.hermes/PROJECT_STATUS.md`, `.hermes/DECISIONS.md` — durable project context, vision, status, and decisions.
- `plans/` — active and historical plans.
- `public/` — renderer-served static assets.
- `Job Applications/`, `Selected/`, `Versions/`, `output/` — local documents/generated outputs; they may contain user materials and are not the application source.
- `norht_Star_icon.png`, `north_Star_logo.png`, `index.html`, `vite.config.js`, `package.json`, `package-lock.json` — branding, HTML shell, Vite configuration, and dependency/build configuration.
- `.env.example` — names/documentation for local configuration. `.env` is ignored and must never be copied into reports.
- `.gitignore`, `.hermes/`, `.verify-user-data`, `desktop-launch.log` — repository hygiene, durable project notes, local verification marker, and launch diagnostics.

## Operational commands

```powershell
npm.cmd install
npm.cmd run build
npm.cmd test
npm.cmd run desktop
npm.cmd run desktop:prod
npm.cmd run package:win
```

For the current queue goal, use Start only after confirming selected documents and target eligibility. Expect reviewed blockers. Resolve CAPTCHA/login/unknown answers/final submission in the displayed row, then let Gmail sync reconcile confirmation. A queue item is not an applied application until both evidence types are present.

## Recommended next work

1. Complete one controlled Zendesk review/submission and capture browser plus matching Gmail evidence.
2. Repair the blocked missing-cover-letter item and confirm its document invariants.
3. Exercise delayed Gmail reconciliation and restart recovery against the live queue.
4. Run a mixed Dice/Workday/generic/unavailable/blocker batch and verify no cross-item ownership or duplicate submission.
5. Drain ten explicitly reviewed targets to `applied`, recording the evidence IDs and remaining terminal/blocker states.
