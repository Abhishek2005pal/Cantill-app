# Decisions

## Phase 1: input interpretation

## Seed data handling

- The seed command treats the kit as read-only, normalizes whitespace and uppercase business codes, and converts ISO date fields to UTC dates before persistence.
- Every malformed row, missing required value, duplicate key, and unresolved reference is retained in `server/data-quality-report.json`; seed continues where the affected record can be safely skipped.
- Seed replacement is collection-scoped and repeatable, so rerunning it produces the same imported state rather than duplicate records.

## Phase 2: engine interpretation

- The worked-policy emergency symbol is treated as `<= 500000`, as stated in the task clarification.
- The engine rejects non-positive quantities, unknown plants, and duplicate `pr_no + pr_line` keys as `NOT_PROCESSED`; it never invents a price for a new item without an estimate.
- Description matching first uses normalized exact text, then Fuse.js token matching with the policy minimum confidence. `brg`, `bearings`, and common belt/measurement punctuation variants are normalized through a small explicit synonym map.
- Preferred supplier scores use policy-provided weights for purchase frequency, recency, contract history, on-time delivery, and quality. Missing supplier price falls back to the next priced active supplier, then an active category supplier and the item standard price; the fallback is recorded in the reason.
- Contract ceiling consumption is ordered by requirement creation time and starts at zero for PDF contracts when no consumed value is supplied. An applicable contract that is over ceiling still supplies the fallback valuation rate but cannot create a contract PO.

### Missing estimated prices

- **What I noticed:** 60 sample PR lines have no `estimated_unit_price`; the policy requires a requester estimate for unmatched new items but provides fallback valuation for matched items.
- **What I decided:** For matched items, use the policy valuation order (usable contract rate, recent PO price, item standard price). For unmatched items without an estimate, return `NOT_PROCESSED` with an explicit reason rather than inventing a price.
- **Why:** This preserves deterministic policy behavior and avoids fabricating money for a new item.

### Non-positive quantity

- **What I noticed:** `PR-26-00172/1` has quantity zero, and the policy does not define negative or zero-quantity behavior.
- **What I decided:** Reject non-positive quantities as `NOT_PROCESSED` with a validation reason.
- **Why:** A purchase requirement with no positive quantity cannot produce a meaningful value or PO.

### Unknown plant

- **What I noticed:** `PR-26-00173/1` uses `PUN2`, while the plant master and policy list only PUN1 and CHK1.
- **What I decided:** Do not silently map or invent a plant. Return the line as `NOT_PROCESSED` with an unknown-plant reason until the master/policy is updated.
- **Why:** Plant affects clubbing, contracts, PO consolidation, and policy scope; guessing could route a purchase incorrectly.

### Past need-by dates

- **What I noticed:** 15 sample need-by dates are before the 2026-11-18 audit baseline, but the policy does not state that past dates invalidate a PR.
- **What I decided:** Keep them eligible for policy processing and surface the past date as a validation warning. The engine will not use the wall clock; any audit/reference date is an explicit input.
- **Why:** The policy defines how need-by dates affect clubbing but does not authorize rejection solely because a date is past.

### PDF-only contracts

- **What I noticed:** `RC-2026-031` and `RC-2026-033` exist as signed PDFs but not in the 2026-10-31 register. The policy says signed contracts after the register update are binding from their start date.
- **What I decided:** Import/merge PDF-only contracts into the policy data set. `RC-2026-031` can apply from 2026-11-15; `RC-2026-033` cannot apply to requirements before 2026-11-20.
- **Why:** This follows clause 4.4 and is required by the worked example for `RC-2026-031`.

### Preferred supplier ranking

- **What I noticed:** Clause 6.2 leaves exact weighting to system design, while the worked examples describe recency bands and supplier performance.
- **What I decided:** Score every eligible Active supplier from 0 to 100. Frequency is PO count divided by the maximum count for that item in the policy `prefListDays` window. Recency is exponential decay, `2^(-daysSinceLastPO / recencyHalfLifeDays)`, with the half-life stored in policy params. Contract history is `1` for a currently valid item contract, `0.5` for an expired item contract, and `0` otherwise. Delivery is on-time percent divided by 100 and quality is rating divided by 5. Each factor is multiplied by its policy weight and 100. Blocked and Inactive suppliers are excluded before ranking.
- **Why:** v5.0 defaults are frequency `0.35`, recency `0.25`, contract `0.15`, delivery `0.15`, quality `0.10`, with a 180-day recency half-life. The ranking is deterministic: score, then higher frequency, then more recent PO, then supplier ID ascending. Future POs are excluded by the explicit as-of date. The API and UI return raw factors, weighted points, contract IDs, recency days, and a buyer-facing sentence.

## Phase 8: consolidated edge-case decisions

- **Rule 5.3 symbol:** The garbled emergency threshold in the PDF is interpreted as `value <= 500000`, following the task clarification.
- **Missing estimated prices:** Matched items use contract, recent PO, then standard-price valuation. A new item without an estimate is `NOT_PROCESSED`; no money is invented.
- **Zero or invalid quantity:** Null, non-numeric, zero, and negative quantities are `NOT_PROCESSED` with a validation reason.
- **Duplicate lines:** Duplicate `pr_no + pr_line` keys are `NOT_PROCESSED`. The compound key is the stable input identity; distinct lines under one PR number remain valid.
- **Unknown plant:** Plants outside the active policy scope are `NOT_PROCESSED`; aliases are accepted only in chat intake and normalize to PUN1/CHK1.
- **Past need-by:** Past dates are retained with a warning-level explanation because the policy does not authorize rejection solely for lateness.
- **Same timestamp ordering:** Creation timestamp ties are ordered by natural/numeric PR number, then numeric line number. This gives stable clubbing and ceiling consumption.
- **Contract expiring mid-batch:** Applicability is evaluated at each requirement's creation date. A contract valid for an earlier requirement is not applied to a later requirement after its end date; consumed ceiling is carried forward in requirement-date order.
- **PDF-only contracts and zero ceiling:** PDF-only contracts start with consumed value zero when no register consumption exists. A contract with no ceiling remaining cannot route a contract PO, but its lowest applicable rate remains the valuation fallback before PO history and standard price.
- **Empty preferred list on a PO rule:** The engine selects the first priced Active category supplier, then the first Active supplier by ID, and records the fallback. Blocked and Inactive suppliers are never shown or selected.
- **Capex with a usable contract:** Rule order is authoritative: Capex is evaluated before contract availability, so it routes to `CAPEX_SOURCING` and requires approval even when a contract exists.
- **Active-supplier lookback:** `boughtFromActiveSupplierInLookback` means at least one PO for the resolved item, dated on or before the requirement date and no older than the policy's valuation lookback window, whose supplier is Active at evaluation time.
- **Out-of-ceiling contracts:** An applicable contract over ceiling cannot produce `CONTRACT_PO`; its lowest rate is retained for valuation fallback, and the normal generic value rules determine routing.
- **Timezone:** Input dates are parsed as UTC. Calendar windows use UTC calendar days; the 24-hour consolidation window uses full UTC timestamps. The engine receives dates explicitly and never reads the wall clock.
- **Rounding:** Monetary calculations retain source precision internally and round INR values to two decimals only at output, export, and persisted decision boundaries. GST is excluded.
