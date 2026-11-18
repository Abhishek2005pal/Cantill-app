# Decisions

## Phase 1: input interpretation

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
- **What I decided:** Use an explainable deterministic score based on purchase frequency, recency, contract history, on-time percentage, and quality rating, excluding non-Active suppliers. Store the score components in the decision explanation.
- **Why:** It honors the policy inputs, produces stable rankings, and gives buyers a reason for each supplier position. Exact weights will be documented beside the engine implementation and tested against the three examples.
