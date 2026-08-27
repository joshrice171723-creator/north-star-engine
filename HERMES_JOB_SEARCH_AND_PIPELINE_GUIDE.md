# Hermes job search and job pipeline guide

**Repository:** `C:\Users\joshr\OneDrive\Desktop\hermes\anthropic-certification-native`  
**Scope:** job discovery, ranking, saved opportunities, application preparation, browser application execution, and email follow-through  
**Inventory date:** 2026-08-25

## What this subsystem is for

The job subsystem turns a search intent and candidate evidence into an autonomous application pipeline:

`profile + resume → provider search → normalized candidates → deterministic filters → bounded AI assessment → saved opportunity → documents/readiness → durable application queue → browser form completion → submission → Gmail confirmation → applied`

It is not a hiring-probability model. Search ranking is an evidence comparison using the supplied resume, role/duty fit, and remote or location fit. Salary, company prestige, posting date, and other unsupported signals are not allowed to masquerade as fit evidence.

## Two state machines that must not be confused

### Job board pipeline (`src/JobsView.jsx`, `electron/main.cjs`)

These are the user's broad relationship stages:

`target → researching → ready → applied → screen → interviewing → final → offer → accepted`

`rejected` represents rejected, withdrawn, archived, or otherwise removed opportunities. This stage is a board status and does not itself prove that an application was submitted or verified.

### Application workflow queue (`electron/jobs/application-queue-service.cjs`)

This is the durable execution state for a selected application:

`queued → researching → preparing_documents → validating_documents → opening → detecting_flow → waiting_for_login / creating_account → filling_profile → answering_questions → waiting_for_answer → uploading_documents → navigating → ready_for_review → submitting → verifying_browser → verifying_email → applied`

Additional states are `retry_wait`, `blocked`, and `terminal`. The queue reaches `applied` only after browser confirmation evidence **and** matching employer email evidence. A board card can therefore be `ready` while its application queue item is blocked or awaiting email.

## Desired workflow: zero user interaction after Start

This is the real product goal for the next implementation model:

> After the user clicks **Start**, North Star must take each eligible queued opportunity from beginning to end with **zero additional user interaction**. It must research the role, prepare and validate the resume and cover letter, open the provider, create or reuse the account, fill every supported field, answer questions from approved data or saved answers, upload the documents, navigate all pages, submit the application, capture browser evidence, reconcile the employer email, and mark the item `applied` only when the evidence is complete.

The user should not need to click into each job, answer routine questions, upload files, log in repeatedly, advance pages, retry ordinary transient failures, or press Submit. The queue must continue across renderer navigation, process restart, retries, and delayed Gmail delivery. Any item that cannot be completed autonomously must be classified and reported; it must not be silently skipped or falsely marked applied.

This is the desired end state, not a claim about the current build. The current implementation still stops at some login, CAPTCHA, unknown/sensitive/legal-question, provider-drift, and irreversible-submission checkpoints. Those are the remaining gaps between the present implementation and the zero-interaction workflow defined above.

## Search workflow

1. The user edits a local search profile: target roles/intent, locations, industries, interests, must-have and nice-to-have skills, excluded keywords, remote preference, radius, and minimum salary.
2. The user selects a master resume. PDF/DOCX text is extracted in the main process; the source remains read-only and is not exposed as a secret.
3. `electron/job-search-planner.cjs` creates a bounded search brief and provider-specific lanes. It expands known titles, infers seniority/location/remote constraints, preserves exclusions, and validates every provider query.
4. `electron/job-search.cjs`, `adzuna-provider.cjs`, `dice-provider.cjs`, `public-job-providers.cjs`, and `greenhouse-provider.cjs` retrieve provider results. Credentials stay in the main process.
5. Each provider result is normalized into the shared job shape. Duplicates, excluded terms, invalid URLs, unsupported locations, and low deterministic retrieval scores are filtered before AI ranking.
6. `electron/job-matcher.cjs` sends a bounded candidate set to the AI evaluator. It requires one assessment per candidate, separate requirements and candidate scores, exactly one strength/gap, and only supplied IDs. Invalid or unavailable AI responses fall back to deterministic diagnostics rather than fabricating matches.
7. `JobsView.jsx` shows Top job matches plus an expandable Advanced Search Report containing provider requests, raw/unique/displayed counts, failures, ranking batches, and API diagnostics.
8. Saving a match persists a pipeline opportunity. It is excluded from later candidate retrieval by provider/listing identity so the same listing is not repeatedly rediscovered.

## Search source and ranking files

- `src/JobsView.jsx` — search button/profile UI, search report, top matches, pipeline board, profile/resume settings, source credentials, stage changes, preparation launch, and queue shell.
- `src/jobs/jobFitScoring.js` — `scoreImportedJob`, the deterministic imported-listing fit score.
- `src/jobs/usLocations.js` — `searchUsLocations` and the bounded US city/state search dataset.
- `src/jobs/jobDescription.js` — `sanitizeJobDescription` for safe display of external listing HTML.
- `electron/main.cjs` — IPC handlers for search, profile, credentials, opportunity CRUD/stage changes, document preparation, queue start/pause/retry, browser handoff, answers, review, and email evidence.
- `electron/job-search.cjs` — USAJOBS retrieval, `normalizeLocation`, location scopes, provider filters, request construction, deterministic scoring, deduplication, and search diagnostics.
- `electron/job-search-planner.cjs` — `createSearchPlan`, `refineProviderQuery`, `fallbackPlan`, title-family expansion, location/seniority inference, AI JSON parsing/repair, and provider-query validation.
- `electron/adzuna-provider.cjs` — `buildAdzunaParams`, `normalizeAdzunaItem`, `searchAdzuna`, `testAdzuna`.
- `electron/dice-provider.cjs` — `normalizeEmploymentTypes`, `diceParams`, `readMcpJson`, `searchDice`.
- `electron/public-job-providers.cjs` — `searchRemotive`, lane matching, location matching, public-feed normalization, and timeout handling.
- `electron/greenhouse-provider.cjs` — `parseGreenhouseBoardUrl`, `normalizeGreenhouseJob`, `searchGreenhouseBoard`.
- `electron/job-import.cjs` — `parseJobListing` plus HTML, JSON-LD, location, salary, and metadata extraction for manually imported listings.
- `electron/job-matcher.cjs` — bounded ranking prompt construction, profile/resume/job projections, response parsing, selection validation, and deterministic fallback.
- `electron/job-search-integrations.cjs` — optional LangChain/LangGraph/LangSmith/n8n clients and redacted tracing metadata.
- `electron/location-format.cjs` — `parseUsLocation`, `formatLocationForProvider`, and `formatLocationScope`.
- `electron/database.cjs` — SQLite persistence for job opportunities, profiles, search attempts, diagnostics, ranking calls, and pipeline events.

## From saved opportunity to application-ready

An opportunity is not queue-eligible simply because it is in `ready`. The safe handoff requires:

- an eligible saved application/job record;
- a valid HTTPS application destination;
- a selected, validated resume;
- a selected cover letter when required;
- complete required profile facts;
- no unresolved document or readiness blocker; and
- a durable queue claim.

Relevant files:

- `electron/jobs/application-domain.cjs` — application statuses (`drafting`, `documents_ready`, `in_progress`, `needs_user_input`, `ready_for_review`, `ready_to_submit`, `submitted`, `withdrawn`, `blocked`), legal transitions, `computeApplicationReadiness`, and `validateAnswer`.
- `electron/jobs/application-documents.cjs` — evidence catalog, cover-letter claim ledger, generated-document validation, style validation, and generation/revision prompts.
- `electron/jobs/application-export.cjs` — isolated `Job Applications/<company>/<role>/<application-id>` structures, selected documents, and versioned outputs.
- `electron/jobs/application-fill-planner.cjs` — safe fill-plan messages, AI candidate controls, profile projection, answer normalization, and repair prompts.
- `electron/jobs/application-fill-engine.cjs` — fill-plan IDs, current-page fingerprint checks, stale-plan rejection, and protected-field rejection.
- `electron/jobs/application-policy.cjs` — field classification and safe/protected autofill decisions.
- `electron/jobs/application-confirmation.cjs` — browser confirmation-language detection and redacted confirmation URL.
- `electron/jobs/application-confirmation-email.cjs` — employer/role/provider/time/confirmation-number correlation and false-positive rejection.
- `electron/jobs/application-activation.cjs` — saved-account references and host/user-scoped activation matching without retaining raw activation payloads.

## Durable queue execution

`electron/jobs/application-queue-repository.cjs` owns persistence and leases. `electron/jobs/application-queue-service.cjs` is the only lifecycle owner. It:

- creates or resumes a queue run;
- claims one item at a time with a lease;
- updates checkpoints and human-readable progress;
- schedules bounded retry waits (currently short first retry, longer subsequent retry);
- pauses on blockers or uncertain submission outcomes;
- resumes safe queued work after restart;
- supports row-level retry and status DTO generation; and
- prevents a renderer navigation from creating a competing owner.

The privileged worker in `electron/main.cjs` connects research, document preparation, browser opening, provider detection, account/login checkpoints, profile filling, reactive-page rescans, native uploads, review authorization, submission evidence, and Gmail verification to the service.

### Browser and provider execution

- `electron/jobs/application-browser.cjs` — embedded Electron browser, HTTPS/new-host policy, navigation, snapshots, history, context menu, and view lifecycle.
- `electron/jobs/application-inspector.cjs` — bounded DOM/CDP field descriptors, page fingerprints, and unavailable-listing detection.
- `electron/jobs/automation/observation.cjs` — page observation.
- `electron/jobs/automation/planner.cjs` — page classification and safe next-step planning.
- `electron/jobs/automation/executor.cjs` — validated safe actions.
- `electron/jobs/automation/verifier.cjs` — step verification.
- `electron/jobs/automation/orchestrator.cjs` — inspect/plan/execute/verify loop with idempotency.
- `electron/jobs/automation/idempotency.cjs` — stable action keys that prevent repeated irreversible actions.
- `electron/jobs/automation/transition-policy.cjs` — outcome-to-queue transition mapping.
- `electron/jobs/automation/result-contract.cjs` — bounded workflow result contract.
- `electron/jobs/automation/answer-policy.cjs` — salary and answer autofill policy.
- `electron/jobs/automation/repair-loop.cjs` — constrained ambiguous-control/site-repair loop; it cannot authorize final submit.
- `electron/jobs/automation/playbook-registry.cjs` — fingerprinted, bounded provider recipes with drift invalidation.
- `electron/jobs/automation/trace-store.cjs` — redacted traces and fixture replay.
- `electron/jobs/native-file-picker.cjs` — exact-path native upload dialog automation and post-selection checks.
- `electron/jobs/adapters/provider.cjs` — common adapter contract.
- `electron/jobs/adapters/index.cjs` — adapter selection and generic fallback.
- `electron/jobs/adapters/dice.cjs`, `workday.cjs`, `greenhouse.cjs`, `lever.cjs`, `ashby.cjs`, `smartrecruiters.cjs`, `icims-taleo.cjs`, `adzuna.cjs`, `generic.cjs` — provider declarations/rules.

## Queue UI and controls

- `src/jobs/ApplicationQueueDrawer.jsx` — persistent queue shell, Now working section, stage/action labels, retry timing, blocker actions, and browser/email evidence status.
- `src/jobs/ApplicationBrowserPanel.jsx` — browser handoff, workflow dock, account state, document state, blockers, answers, review, and evidence inspection.
- `src/jobs/ApplicationChecklist.jsx` — readiness checklist.
- `src/jobs/ApplicationDocuments.jsx` — selected documents, editor, versions, previews, and validation.
- `src/JobsView.jsx` — pipeline board and row-level archive/stage/preparation controls.
- `electron/preload.cjs` — narrow renderer bridge for queue start, pause, resume/status, retry, blocker resolution, answer submission, review authorization, browser handoff, and evidence inspection.

The queue DTO exposes run state, active item, ordered items, canonical state, progress label, blocker, retry metadata, and browser/email evidence progress. The active item is moved to the top while it is being worked. Raw technical codes remain available in expandable details while the primary text is human-readable.

## Email and follow-through

- `electron/gmail-oauth.cjs` — OAuth/PKCE and refresh.
- `electron/job-email-rag.cjs` — Gmail message decoding, normalized headers/body, job-related classification, confirmation extraction, chunking, and retrieval.
- `electron/main.cjs` — bounded Gmail sync, application-email reconciliation, and startup/scheduled recovery.
- `src/jobs/EmailMonitorPanel.jsx` — connection state, sync, grouping, assignment, exclusions, and review.
- `src/jobs/emailJobFilter.js` — `isAppliedJob` and `appliedJobs` helpers.

Account mail, newsletters, password resets, generic job alerts, duplicate messages, and unrelated applications must not satisfy the employer-confirmation requirement. Delayed confirmation should move an item from `verifying_email` to `applied` during reconciliation without resubmitting.

## Current job-search/pipeline issues

1. **Ten-application goal is not complete.** The repository and UI support the goal, but live evidence must still show ten items with browser and matching Gmail proof.
2. **The autonomous path is incomplete at provider checkpoints.** CAPTCHA, login/activation, unknown questions, sensitive/legal attestations, and final submit still stop for user input in the current implementation. Eliminating those stops requires additional provider-specific handling and an explicit product decision.
3. **Zendesk had a real hang.** The provider-flow detector could wait indefinitely after page load. The bounded timeout/retry fix is committed as `21720e1`; live verification now reaches the filled Zendesk form and stops visibly at the reviewed employer step instead of silently dying.
4. **Document readiness can block items.** At the last observed run one item was blocked because its cover letter was missing. Fix the document or terminalize the target; do not loop retries.
5. **Provider drift remains possible.** Cookies, reactive fields, DOM labels, account flows, and questions can change. Fixtures cover supported patterns, but production providers need continued evidence.
6. **Email evidence is a second asynchronous system.** A browser confirmation alone is intentionally insufficient. Delayed/missing mail must remain visible as verification work.
7. **Queue state and board stage can diverge.** `ready`, `applied`, and `rejected` are board-level labels; the queue's canonical state and evidence are authoritative for application execution.
8. **Search quality depends on current profile/resume evidence.** A broad or stale profile can produce low-quality candidates even when provider calls succeed. Use the Advanced Search Report to distinguish provider failure, poor retrieval, poor ranking, and low displayed count.
9. **Credentials and provider availability are environmental.** USAJOBS/Adzuna credentials, OpenRouter availability, Gmail OAuth, employer accounts, CAPTCHA, and network access can block live acceptance independently of source correctness.

## Verification and next acceptance sequence

Run:

```powershell
npm.cmd test
npm.cmd run build
node --check electron/main.cjs
node --check electron/preload.cjs
```

Then perform controlled live evidence in this order:

1. One end-to-end provider submission with browser confirmation and matching Gmail evidence.
2. One unknown question answered once and reused on a later matching form.
3. One login/CAPTCHA pause and resume.
4. One unavailable listing classified terminally without retry.
5. One restart during active processing with checkpoint recovery.
6. One mixed Dice/Workday/generic/unavailable/blocker batch.
7. Confirm no duplicate submissions and no `applied` item without both evidence types.
8. Repeat until ten targets are autonomously driven to verified `applied`, with any genuinely unsupported provider or external checkpoint reported as an actionable exception.
