# New Session Handoff Template

> **Loading rule:** This template is a prompt, not a command to read the entire documentation tree. Load `PROJECT_BRIEF.md`, `.hermes/DOCUMENT_INDEX.md`, git status, and one relevant task document only.

Copy this prompt into a new session after replacing the bracketed objective.

```text
You are continuing work on the AI Executive Coach Command Center.

Work only in:
C:\Users\joshr\OneDrive\Desktop\north-star\anthropic-certification-native

Do not modify or use:
C:\Users\joshr\OneDrive\Desktop\north-star\anthropic-certification

Before making changes:

1. Read PROJECT_BRIEF.md and .hermes/DOCUMENT_INDEX.md.
2. Inspect git status and recent commits.
3. Select and read only the one task document relevant to this objective.
4. Inspect the actual source and tests relevant to this objective.
5. Read PRODUCT_VISION.md or DECISIONS.md only when the task requires product direction or a durable architecture decision.

Current objective:

Rules:

- Do not start another major feature phase.
- Preserve existing learning data and behavior.
- Preserve the native Anthropic Academy pane and resizable desktop shell.
- Never expose credentials, cookies, passwords, authorization headers, or secrets in renderer state, logs, documents, commits, or tool output. Use approved OS-encrypted main-process storage only when required.
- Do not add authentication, cloud sync, scraping, crawling, or new network behavior without an explicit approved decision.
- Do not invent data, usage, costs, coach insights, integrations, or official content.
- Prefer additive, local-first, reversible changes.
- Keep coach behavior explainable, reviewable, and user-approved before mutations.
- Use the smallest safe change and touch only intentional files.

Before finishing:

1. During exploration, batch related changes and use only the narrowest useful checks.
2. Do not automatically create tests or run the full suite after every act.
3. Before commit, add/update regression tests for completed behavior and run focused validation.
4. Before merge, run the full applicable verification and inspect the final diff.
5. If UI or Electron behavior changes, run the production desktop app when final validation requires it.
6. Update .hermes/PROJECT_STATUS.md only when durable verified state changes.
7. Add a decision to .hermes/DECISIONS.md only for a durable choice.
8. Report changes, preserved boundaries, verification, risks, and next step. Stop when complete.
```

## Good objective examples

- Define the additive project/task persistence schema without changing the learning schema.
- Add a minimal Projects view using real local data, without implementing the coach.
- Add the first Kanban interaction for existing project tasks, with persistence and tests.
- Add an app-originated usage-event ledger using real response metadata only.

## Bad objective examples

- Build the whole command center.
- Add projects, Kanban, AI coaching, analytics, integrations, and sync together.
- Make the app intelligent.
