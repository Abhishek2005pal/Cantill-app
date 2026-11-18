# Approach

## Tools and AI

- **Coding agent:** GitHub Copilot in VS Code, used to inspect the kit, reason about policy behavior, implement the app, and write tests.
- **In-app AI:** Gemini free API, used only inside the application for chat intake and policy-document assistance. The deterministic decision engine remains independent of Gemini.

## Architecture direction

- Monorepo with `/server`, `/client`, `/kit`, and `/submission`.
- Express API and engine in `/server`; React + Vite client built and served by Express.
- MongoDB local Docker or Atlas free tier for versioned policy and application data.
- Pure deterministic engine in `/server/src/engine`: no database, HTTP, LLM, or wall-clock access. All dates and policy data are explicit inputs.
- Monetary calculations use INR excluding GST and round to two decimals only at output boundaries.
- Date strings are normalized to UTC. Calendar-day policy windows use UTC calendar dates; the 24-hour PO-consolidation rule uses full UTC timestamps.

The kit directory is treated as read-only input and is not edited.

## Verification record

- Tools used: VS Code/Copilot for repository inspection and implementation, Node 20/npm, Vitest, Supertest, Vite, MongoDB, Docker Compose configuration, curl, and GitHub Actions.
- AI usage: Gemini is isolated behind `server/src/llm/llm.js` for chat field extraction, policy amendment interpretation, and contract PDF extraction. The policy diff, validation, supplier ranking, and decision engine are deterministic and do not call the LLM.
- Manual verification: inspected all governing PDFs and CSV schemas; checked the seed counts and data-quality report; ran the sample batch and reviewed route distribution and suspicious rows; checked active policy resolution, contract source handling, supplier exclusion, CSV headers, UI workflows, and Docker/Render configuration.
- Automated verification: engine boundary tests, policy resolver/diff tests, preferred-ranking determinism/as-of tests, API Supertest tests, CSV parser/export round-trip tests, mocked LLM/document tests, and client production build in CI.
