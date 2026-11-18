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
