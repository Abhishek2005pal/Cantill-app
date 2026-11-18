# Cantill PR-to-PO

Policy-driven purchase requisition routing for Corvo Engineering.

## Local run

Requirements: Node 20 and Docker Desktop with Compose.

```bash
docker compose up --build
```

Open <http://localhost:3000>. The API health check is at `/api/health`.

To seed local MongoDB from the read-only kit, set `MONGO_URI` if needed and run:

```bash
npm install
npm run seed
```

The seed is idempotent: it replaces the imported kit collections and writes `server/data-quality-report.json`.

For host-only development, start MongoDB separately and use `npm run dev`. The seed loader looks for `KIT_DIR`, then `/kit`, then the supplied sibling kit directory (`../Cantill_FullStack_Task_Kit`).

### Render

Create a Render Web Service from this repository using the Dockerfile. Configure `MONGO_URI` with a free MongoDB Atlas connection string, optionally set `GEMINI_API_KEY` for later AI features, and let Render provide or set `PORT` (the default is `3000`). The Docker Compose MongoDB service is intended for local development.

## Deployment

Create a Render **Web Service** using the repository Dockerfile. Render should build the Docker image and expose port `3000`. Pair it with a free MongoDB Atlas M0 cluster and add these environment variables in the Render dashboard:

- `MONGO_URI`: a free MongoDB Atlas connection string (or another free MongoDB-compatible deployment).
- `GEMINI_API_KEY`: optional Gemini free API key used by the future chat/policy assistant; the deterministic engine does not depend on it.
- `GEMINI_MODEL`: optional Gemini model override; defaults to `gemini-2.5-flash`.
- `PORT`: `3000` unless Render supplies a different port.

The `docker-compose.yml` Mongo service is for local development. Do not commit `.env` or secrets.

Hosted URL: `https://YOUR-RENDER-SERVICE.onrender.com` (replace this placeholder after deployment). The health check is `/api/health`. Render free services can cold-start after inactivity; wait for the first health request to complete before uploading a batch.

## Blind-test flow

Run the script from a machine with MongoDB available and the app running at `BASE_URL`:

```bash
BASE_URL=http://localhost:3000 ./scripts/blind-test.sh \
	../Cantill_FullStack_Task_Kit/pr_batches/sample_pr_batch.csv \
	amendment.json 2026-11-18
```

The script runs the seed, processes Run 1, writes `submission/run1_decisions.csv`, uploads and approves the amendment, processes Run 2, writes `submission/run2_decisions.csv`, and writes `submission/preferred_suppliers.csv` for the supplied as-of date. The amendment file must be a complete policy JSON document accepted by the policy validator.

## API

All mutating routes accept `X-User`; `who`/`name` request fields are fallback actor names.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/process-batch?batchId=run-1[&format=csv]` | Multipart field `file`; validates the sample CSV, replaces that batch, and returns decisions or the exact export columns. |
| `GET` | `/api/decisions/export?batchId=run-1` | Downloads decisions as CSV. |
| `GET` | `/api/requirements?status=PENDING&route=RFQ&plant=PUN1` | Lists filtered requirements. |
| `GET` | `/api/requirements/:id` | Returns requirement, PR lines, decisions, value, supplier/price, suggestions, and explanation. |
| `POST` | `/api/requirements/:id/approve` | Creates the pending PO or RFQ/RFP record. Optional JSON `comment`. |
| `POST` | `/api/requirements/:id/override` | Requires non-empty JSON `comment`; keeps the original decision and records the override. |
| `GET/POST` | `/api/contracts` | Lists or creates contracts; POST accepts contract JSON. |
| `POST` | `/api/contracts/extract-pdf` | Multipart `document`; returns extracted fields and supplier-master validation. |
| `GET` | `/api/suppliers/preferred?asOf=2026-11-18&format=csv` | Top three preferred suppliers per item. |
| `GET` | `/api/audit-log` | Recent mutation audit records. |
| `POST` | `/api/chat` | Session slot filling; accepts `sessionId`, `message`, `action`, and `selectedItemCode`. |
| `POST` | `/api/policies/propose` | Accepts amendment JSON, plain `message`, or multipart PDF and returns an editable proposal plus deterministic diff. |

Examples:

```bash
curl -H "X-User: buyer@example" -F "file=@../Cantill_FullStack_Task_Kit/pr_batches/sample_pr_batch.csv" "http://localhost:3000/api/process-batch?batchId=run-1"
curl -H "X-User: buyer@example" -F "file=@batch.csv" "http://localhost:3000/api/process-batch?batchId=run-1&format=csv"
curl -OJ "http://localhost:3000/api/decisions/export?batchId=run-1"
curl "http://localhost:3000/api/requirements?status=PENDING&route=RFQ"
curl -X POST -H "Content-Type: application/json" -H "X-User: buyer@example" -d '{"comment":"Approved after review"}' http://localhost:3000/api/requirements/REQUIREMENT_ID/approve
curl -X POST -H "Content-Type: application/json" -d '{"comment":"Use alternate sourcing route"}' http://localhost:3000/api/requirements/REQUIREMENT_ID/override
curl "http://localhost:3000/api/suppliers/preferred?asOf=2026-11-18&format=csv"
curl -X POST -H "Content-Type: application/json" -d '{"sessionId":"demo-1","message":"Need 20 bearings for Bhosari by next Friday"}' http://localhost:3000/api/chat
curl -X POST -H "Content-Type: application/json" -d '{"sessionId":"demo-1","action":"confirm"}' http://localhost:3000/api/chat
curl -X POST -H "Content-Type: application/json" -F "document=@amendment.pdf" http://localhost:3000/api/policies/propose
curl -X POST -H "Content-Type: application/json" -F "document=@../Cantill_FullStack_Task_Kit/contracts/pdf/RC-2026-031.pdf" http://localhost:3000/api/contracts/extract-pdf
```

The LLM is used only for field extraction and document assistance. The pure decision engine never calls it. Without `GEMINI_API_KEY`, chat falls back to regex/keyword slot filling and guided prompts; policy and contract document routes return a clear LLM-availability error. Gemini calls use JSON mode, a 30-second timeout, and two retries with backoff.

## Phase status

Phase 1 documented the kit and policy assumptions. Phases 2-5 provide the pure decision engine, versioned policy store, batch/approval API, and explainable supplier ranking. Phase 6 adds isolated Gemini extraction, chat slot filling, policy amendment reading, and contract PDF extraction; the engine remains independent of the LLM.
