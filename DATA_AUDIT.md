# Phase 1 Data Audit

Audit date: 2026-11-18. Source directory: `../Cantill_FullStack_Task_Kit`. The kit was read-only during this audit.

## Governing PDFs

- `Cantill_FullStack_Task_Brief.pdf`: 4 pages. Defines the app, output schema, policy-as-data requirement, phase expectations, and the 14 worked decisions.
- `Corvo_Procurement_Policy.pdf`: 3 pages. Policy v5.0, effective 2026-04-01, INR excluding GST. It defines item matching, clubbing, valuation, contracts, decision rule order, supplier ranking, suggestions, PO consolidation, and audit records.
- `Worked_Examples.pdf`: 5 pages. Contains 14 worked decisions and 3 preferred-supplier examples. All 14 examples were read and will become fixtures in Phase 3 tests.

## CSV inventory

| File | Columns | Rows |
| --- | --- | ---: |
| `master_data/item_master.csv` | `item_code`, `description`, `uom`, `category`, `item_type`, `standard_price` | 73 |
| `master_data/plants.csv` | `plant`, `name` | 2 |
| `master_data/po_history.csv` | `po_number`, `po_date`, `supplier_id`, `item_code`, `quantity`, `uom`, `unit_price`, `plant`, `delivered_on_time` | 468 |
| `master_data/supplier_master.csv` | `supplier_id`, `name`, `city`, `categories`, `status`, `on_time_pct`, `quality_rating` | 48 |
| `contracts/contract_register.csv` | `contract_id`, `supplier_id`, `supplier_name`, `start_date`, `end_date`, `value_cap`, `consumed_value` | 10 |
| `contracts/contract_lines.csv` | `contract_id`, `item_code`, `description`, `uom`, `rate` | 26 |
| `pr_batches/sample_pr_batch.csv` | `pr_no`, `pr_line`, `created_at`, `requester`, `department`, `plant`, `item_code`, `description`, `quantity`, `uom`, `estimated_unit_price`, `need_by_date`, `urgency` | 186 |

## Contract PDFs

There are 12 signed PDFs: `RC-2025-011`, `RC-2025-014`, `RC-2025-020`, `RC-2026-002`, `RC-2026-005`, `RC-2026-007`, `RC-2026-009`, `RC-2026-012`, `RC-2026-013`, `RC-2026-015`, `RC-2026-031`, and `RC-2026-033`.

The first 10 correspond to the register and contract-lines CSVs. `RC-2026-031` is PDF-only and starts 2026-11-15; it covers `ITM-1036`, `ITM-1037`, and `ITM-1039` with supplier `S021`. `RC-2026-033` is PDF-only, starts 2026-11-20, covers `ITM-1056` and `ITM-1057`, and names supplier `S035`. All signed PDFs state delivery to PUN1 and CHK1, have INR ceilings, and provide rates excluding GST.

## Data-quality findings

- `sample_pr_batch.csv` has 60 blank `estimated_unit_price` values. These are allowed for policy valuation fallback; unmatched new items must use the requester's estimate, so missing estimates need an explicit `NOT_PROCESSED` handling decision.
- 15 sample PR lines have need-by dates before the audit baseline 2026-11-18: `PR-26-00019/1`, `00031/1`, `00035/1`, `00050/1`, `00054/1`, `00067/1`, `00073/1`, `00076/1`, `00079/1`, `00135/1`, `00144/1`, `00150/1`, `00170/1`, `00174/1`, and `00175/1`.
- `PR-26-00172/1` has quantity `0`. The policy does not state how to process non-positive quantities.
- `PR-26-00173/1` uses plant `PUN2`, which is not in `plants.csv`; the master contains only `PUN1` (Bhosari) and `CHK1` (Chakan).
- Supplier statuses are 43 Active, 3 Blocked (`S004`, `S008`, `S011`), and 2 Inactive (`S031`, `S034`). Policy clause 5.7 excludes Blocked and Inactive suppliers from POs and suggestions.
- The six repeated PR numbers are valid multi-line PRs, not duplicate line keys: `PR-26-00164` (4 lines), `00165` (2), `00166` (3), `00167` (2), `00168` (3), and `00169` (3). The compound key `pr_no + pr_line` is unique in the sample.
- No unknown item codes were found in populated PR `item_code` fields. Free-text descriptions still include deliberate unknown/new items.
- No missing `standard_price` values, PO-history `unit_price` values, or contract-line `rate` values were found.
- The visible date formats are consistent by field: PR `created_at` uses ISO date-time text; PR `need_by_date`, PO dates, and contract register dates use ISO `YYYY-MM-DD` dates. The engine will parse all dates as UTC and apply calendar-day comparisons for policy day windows; 24-hour PO consolidation will use full UTC timestamps.

## Cross-file observations

- `contract_register.csv` is as at 2026-10-31 and therefore intentionally omits the two PDF-only signed contracts. The loader must merge PDF-only contracts without mutating kit files.
- The current sample contains future need-by dates through 2027, so the engine must not reject dates merely because they are after the audit date.
- Money is INR excluding GST. Source precision includes decimals; engine calculations will retain exact decimal-safe values and round only output values to two decimals.
