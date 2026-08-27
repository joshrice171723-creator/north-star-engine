# Project working rules

- Treat the user's request as a hard rule: after every code change, stage and commit that change immediately.
- Include clear explanatory comments in code when a change introduces non-obvious behavior, important constraints, or integration details.
- Use an informative commit message that explains the completed change.
- Do not include unrelated pre-existing worktree changes in a commit.
- After each task-related commit, restart the Electron desktop app so both frontend and main-process changes are loaded before handoff.
