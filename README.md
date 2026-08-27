# North Star

North Star is a standalone native Electron career workspace for local-first job discovery, application preparation, guarded browser assistance, evidence-backed pipeline tracking, and interview coaching.

This repository is presented as a portfolio project. The product is intentionally opinionated: it keeps durable user data local, protects credentials in the Electron main process, and separates generated practice from official learning content.

## What it demonstrates

- React and Electron architecture with a narrow preload bridge
- Local SQLite persistence with versioned migrations
- Multi-provider job search, ranking, filtering, and diagnostics
- AI-assisted interview coaching and document generation with explicit audit boundaries
- Controlled application workflows with confirmation gates and file isolation
- An independent career-only desktop workspace with no command-center navigation
- Automated coverage across core domain logic and critical user flows

## Product areas

| Area | Purpose |
| --- | --- |
| Jobs | Search, normalize, rank, and inspect opportunities across providers |
| Applications | Organize documents and plan browser-assisted application steps |
| Interview coach | Prepare for roles, simulate interviews, and retain career activity evidence |

## Architecture

```text
Career React renderer (src/north-star.jsx)
        │ narrow IPC bridge
Electron preload (electron/preload.cjs)
        │
Electron main process (electron/main.cjs)
        ├── SQLite database + migrations
        ├── provider integrations and job ranking
        ├── document and application workflows
        └── credential storage through OS-backed safe storage
```

The renderer owns presentation and interaction state. Provider credentials, filesystem access, database writes, external navigation, and AI calls remain in the main process. Local runtime data is stored outside the repository.

## Run locally

Requirements: Node.js and npm.

```bash
npm install
Copy-Item .env.example .env
npm run build
npm run desktop
```

For a production-style local launch:

```bash
npm run desktop:prod
```

Gmail is optional power-user functionality; the default workflow does not require it. Add provider values only to the gitignored `.env` file before starting the app.

## Verification

```bash
npm run build
npm test
```

The test suite covers the application domain, provider adapters, ranking fallbacks, persistence contracts, document handling, and key presentation behavior.

## Repository conventions

- `src/` contains the React renderer and UI/domain helpers.
- `electron/` contains the privileged desktop process, integrations, persistence, and migrations.
- `test/` contains automated regression coverage.
- `.hermes/` contains durable project decisions and product context.
- Local resumes, generated PDFs, application exports, temporary files, and secrets are intentionally excluded from version control.

## License

Private portfolio project. All rights reserved unless changed by the repository owner.
