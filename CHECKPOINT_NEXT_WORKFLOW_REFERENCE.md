# Checkpoint Next Workflow Reference

This document is the working reference for North Star's autonomous application queue. It exists to keep implementation, live testing, and product decisions aligned when a workflow stalls.

## North star

Checkpoint Next processes exactly one eligible application at a time, keeps that application's state visible, and advances only after the current checkpoint is observed and verified. A failure belongs to the same application and checkpoint; it must not silently move the queue to a different job.

The system may automate safe, reversible navigation and approved field filling. It must pause for login, Google account selection, MFA, CAPTCHA, protected disclosures, ambiguous personal judgments, and final submission approval. A successful browser step is not the same as a submitted application, and submission is not the same as Applied until matching employer confirmation is verified.

## Current live test evidence (2026-08-24)

1. The queue opened in North Star with `Needs your answer`, `10 eligible`, `0 active`, `0 need answers`, `0 failed`, `0 blocked`, and `10 ready jobs` visible after the previous cleanup.
2. Clicking `Checkpoint next` selected `Tiger Analytics Inc. — Forward Deployed Engineer (Generative AI)` and opened its role workspace.
3. The role workspace showed the `APPLICATION ASSISTANT` on the right, confirming the intended assistant-first layout is still active.
4. Opening the assistant loaded the Adzuna listing in the isolated browser view. The visible `Apply for this job` control was underneath a `Receive similar jobs by email` overlay.
5. The overlay's safe dismissal text was `No thanks, take me to the job`. The current matcher only recognizes the exact `No thanks` label, so this is a reproducible safe-recovery gap. Testing stopped before any external application handoff or submission.

6. After the matcher fix and app restart, a fresh `Checkpoint next` run selected `Glean — Founding Forward Deployed Engineer` and opened the Application Assistant on the right. The employer page loaded with a visible `Apply` handoff and no popup overlay.
7. The assistant then exposed the expected `New employer account required` checkpoint with empty username/password fields and `Check Gmail activation`. This was handled as a user checkpoint; no credentials were entered and no external application was submitted.

## Required checkpoint contract

Every checkpoint should have these boundaries:

1. **Observe:** capture the current URL host, page fingerprint, visible controls, required/optional fields, page signals, and current application checkpoint.
2. **Plan:** use the persisted site playbook first; use deterministic matching for known safe controls; use AI only for bounded discovery or repair when the recipe does not match.
3. **Execute:** perform at most one safe action, scoped to the observed page and exact semantic target.
4. **Verify:** rescan the page and record whether the expected transition happened.
5. **Persist:** update the same logical workflow step idempotently. Learning-storage failure must not turn a verified browser success into an application failure.
6. **Transition:** update the current application only through the central queue transition policy.

## Safe action boundaries

Safe automatic actions include dismissing an obvious popup (`No thanks`, `Close`, `Dismiss`, and clearly labeled variants), advancing with a non-submit control, routing an obvious `Apply` handoff into the isolated browser, filling approved recurring profile fields, and uploading approved documents when the visible control matches the document type.

The following remain user checkpoints: authentication and account choice, Google selection, MFA/OTP, CAPTCHA, protected demographic or authorization disclosures, ambiguous salary/relocation/judgment questions, and final `Submit application` or equivalent. AI may classify and explain these states, but it must not invent an answer or cross the irreversible boundary.

## Failure handling rules

- Pause on a genuine application blocker and keep the failed application active for review or Retry.
- Retry the same application and logical checkpoint; never advance the queue merely because the current job failed.
- Classify unavailable listings as terminal and move them to rejected/withdrawn/archived history according to the product policy.
- Treat optional cover-letter absence as a warning when the page proves the control is optional; required resume or document failures remain blockers.
- Clear stale failure metadata after a fresh verified page observation while retaining it as audit history.
- If AI repair fails, show the exact observed blocker, the candidate safe actions, the repair attempt count, and the next allowed action.
- Do not mark Applied from a browser click. Require confirmation evidence, ideally a matching employer email, before the terminal pipeline transition.

## Live test protocol

For each test cycle:

1. Record queue counts and the selected application ID.
2. Click `Checkpoint next` once and confirm the role did not change unexpectedly.
3. Confirm the Application Assistant is open on the right and the isolated browser view is attached.
4. Observe the page before any action. Capture the visible blocker and the exact control label.
5. Let the deterministic recipe or bounded AI repair perform one safe action.
6. Reobserve and verify the expected page transition.
7. If a file upload or final submission is reached, stop for the required user confirmation.
8. If the step fails, use Retry on that same job, verify the same application ID, and inspect the trace before trying again.
9. Only after the same path passes should the queue be allowed to select another application.

## Concerns to keep visible

### AI usage

AI should be used for first-contact page interpretation, ambiguous but safe control discovery, repair proposals after recipe drift, and explanation of user checkpoints. It should not be called for every known step: persisted playbooks should make repeat runs deterministic, cheap, and easier to audit. Every AI action must be constrained by the safe-action policy and verified after execution.

### Overlay and popup drift

Provider overlays frequently append explanatory text to a known dismissal label. Matching must allow a safe, explicit prefix or semantic variant without allowing arbitrary substring clicks. The matcher should remain visible-only, unique, and exact enough to avoid related-job links.

### Queue ownership

There must be one queue owner and one active application. A browser failure, learning persistence failure, or renderer navigation must not create a second active workflow or silently skip the failed job.

### Data provenance

Reusable answers need the original question label, normalized field identity, source/provenance, scope, approval time, and intended site/ATS scope. A saved answer must not be reused merely because two questions look vaguely similar.

### External side effects

Opening a listing and navigating to an application are not submission. Uploading a resume or cover letter transmits personal files and requires the Computer Use confirmation boundary unless the user has explicitly pre-approved that specific destination and data. Final submission always remains an explicit approval checkpoint.

### Current product decision

The Application Assistant remains the intended right-side control surface. `Checkpoint next` selects the job and opens the role workspace; the assistant owns the browser handoff, account checkpoint, document controls, safe-pass actions, and final approval controls. The queue should not auto-skip a job merely because the assistant is waiting for an account or activation decision.

## Ideas for the next hardening pass

- Add a `recovery candidate` trace containing the observed label, action class, confidence, and verification result.
- Add replay fixtures for overlays with labels such as `No thanks, take me to the job`, `Close this alert`, and equivalent accessible names.
- Show a prominent `Current application / Current checkpoint / Retry same job` block in the queue drawer.
- Add a “why paused” panel that distinguishes user input, external authentication, unavailable listing, site drift, and internal persistence warnings.
- Measure first-run completion, repeat-run completion, AI calls per application, repair success, false unavailable detection, and human interventions.
- Keep a durable playbook history and promote a repaired recipe only after a verified replay succeeds.

## Definition of done for a checkpoint

A checkpoint passes only when the same application remains selected, the intended safe action is recorded, the post-action page fingerprint or terminal signal is verified, the queue state is correct, and no unapproved external side effect occurred. A build passing is necessary but not sufficient; the live UI and the persisted trace must agree.

## Related implementation files

- `electron/jobs/application-browser.cjs` — isolated browser, inspection, safe controls, upload and submission boundaries.
- `electron/jobs/application-inspector.cjs` — page snapshots, field categories, fingerprints, and page signals.
- `electron/jobs/application-recovery-planner.cjs` — bounded AI recovery actions.
- `electron/jobs/automation/orchestrator.cjs` — observe/plan/execute/verify orchestration and non-fatal learning.
- `electron/jobs/automation/transition-policy.cjs` — centralized application and queue transitions.
- `electron/database.cjs` — queue state, unknown questions, playbooks, and durable retries.
- `electron/migrations/0035_harden_playbook_learning.sql` — logical playbook-step identity and learning retry storage.
- `src/jobs/ApplicationBrowserPanel.jsx` — Application Assistant UI and user checkpoints.
- `src/jobs/AutonomousApplicationQueue.jsx` — queue status, Checkpoint next, pause, retry, and review surfaces.
