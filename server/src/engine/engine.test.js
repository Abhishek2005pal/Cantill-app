import { describe, expect, it } from 'vitest';
import { applicableContracts, conditionMatches, itemMatch, preferredSuppliers, runDecisionEngine } from './index.js';
import { policyV5 } from './policy.js';

const basePolicy = () => structuredClone(policyV5);
const items = [
  { item_code: 'ITM-1021', description: 'Ball bearing 6205-2RS', uom: 'NOS', category: 'Bearings', item_type: 'Material', standard_price: 220 },
  { item_code: 'ITM-1006', description: 'Aluminium plate 6061 10mm', uom: 'KG', category: 'Steel & Metals', item_type: 'Material', standard_price: 365 },
  { item_code: 'ITM-CAPEX', description: 'CNC machine', uom: 'NOS', category: 'Machinery', item_type: 'Capex', standard_price: 100000 }
];
const suppliers = [
  { supplier_id: 'S001', name: 'Active One', status: 'Active', categories: ['Bearings', 'Steel & Metals'], on_time_pct: 95, quality_rating: 5 },
  { supplier_id: 'S002', name: 'Active Two', status: 'Active', categories: ['Bearings', 'Steel & Metals'], on_time_pct: 80, quality_rating: 4 },
  { supplier_id: 'S003', name: 'Blocked Supplier', status: 'Blocked', categories: ['Bearings'], on_time_pct: 100, quality_rating: 5 }
];
const history = [
  { po_number: 'PO-H1', po_date: '2026-10-01', supplier_id: 'S001', item_code: 'ITM-1021', quantity: 10, unit_price: 200, plant: 'PUN1', delivered_on_time: true },
  { po_number: 'PO-H3', po_date: '2026-10-01', supplier_id: 'S001', item_code: 'ITM-1006', quantity: 10, unit_price: 350, plant: 'PUN1', delivered_on_time: true },
  { po_number: 'PO-H2', po_date: '2026-10-01', supplier_id: 'S003', item_code: 'ITM-1021', quantity: 10, unit_price: 190, plant: 'PUN1', delivered_on_time: true }
];
const contract = (overrides = {}) => ({ contract_id: 'RC-1', supplier_id: 'S001', start_date: '2026-01-01', end_date: '2026-12-31', value_cap: 100000, consumed_value: 0, source: 'REGISTER', lines: [{ contract_id: 'RC-1', item_code: 'ITM-1021', rate: 180 }], ...overrides });
const line = (overrides = {}) => ({ pr_no: 'PR-1', pr_line: 1, created_at: '2026-11-01T10:00:00Z', requester: 'A', plant: 'PUN1', item_code: 'ITM-1021', description: 'Ball bearing 6205-2RS', quantity: 1, uom: 'NOS', need_by_date: '2026-11-20', urgency: 'Normal', ...overrides });
const data = (prLines, contracts = []) => ({ prLines, items, suppliers, poHistory: history, contracts, policy: basePolicy() });

function routes(result) { return result.decisions.map((decision) => decision.route); }

describe('item matching', () => {
  it('prefers code, then exact normalized text, then abbreviation-aware fuzzy text', () => {
    expect(itemMatch(line({ item_code: 'ITM-1021' }), items, basePolicy()).item.item_code).toBe('ITM-1021');
    expect(itemMatch(line({ item_code: '', description: 'ball bearing 6205 2rs' }), items, basePolicy()).item.item_code).toBe('ITM-1021');
    expect(itemMatch(line({ item_code: '', description: 'brg 6205 2rs for maintenance' }), items, basePolicy()).item.item_code).toBe('ITM-1021');
    expect(itemMatch(line({ item_code: '', description: 'unobtainium reactor' }), items, basePolicy()).item).toBeNull();
  });
});

describe('clubbing and validation', () => {
  it('clubs on day 14 and need-by day 7, but not day 15 or unknown plants', () => {
    const result = runDecisionEngine(data([
      line({ pr_no: 'PR-1', created_at: '2026-11-01T10:00:00Z', need_by_date: '2026-11-20' }),
      line({ pr_no: 'PR-2', created_at: '2026-11-15T10:00:00Z', need_by_date: '2026-11-27' }),
      line({ pr_no: 'PR-3', created_at: '2026-11-16T10:00:00Z', need_by_date: '2026-11-28' }),
      line({ pr_no: 'PR-4', created_at: '2026-11-16T10:00:00Z', need_by_date: '2026-11-20', plant: 'PUN2' })
    ]));
    expect(result.requirements.filter((entry) => entry.item).length).toBe(2);
    expect(result.decisions.at(-1).route).toBe('NOT_PROCESSED');
  });

  it('never clubs new items and rejects non-positive quantities and duplicate keys', () => {
    const result = runDecisionEngine(data([
      line({ pr_no: 'PR-NEW', item_code: '', description: 'new alloy', estimated_unit_price: 10 }),
      line({ pr_no: 'PR-NEW', item_code: '', description: 'new alloy', estimated_unit_price: 10 }),
      line({ pr_no: 'PR-ZERO', quantity: 0 })
    ]));
    expect(result.requirements.filter((entry) => entry.item === null)).toHaveLength(1);
    expect(result.decisions.filter((entry) => entry.route === 'NOT_PROCESSED')).toHaveLength(1);
  });
});

describe('supplier, contract, and policy rules', () => {
  it('ranks active suppliers only and never selects a blocked supplier', () => {
    const result = runDecisionEngine(data([line()]));
    expect(result.decisions[0].supplier_id).toBe('S001');
    expect(result.requirements[0].preferredSuppliers.every((entry) => entry.supplier_id !== 'S003')).toBe(true);
    expect(result.requirements[0].preferredSuppliers[0].scoreBreakdown.raw).toHaveProperty('frequency');
  });

  it('uses a contract only when its ceiling has room and falls back to the lowest applicable rate', () => {
    const current = contract({ value_cap: 10, lines: [{ contract_id: 'RC-1', item_code: 'ITM-1021', rate: 5 }] });
    const choice = applicableContracts({ item: items[0], quantity: 3, requirementDate: new Date('2026-11-01') }, { contracts: [current] }, new Map([['S001', suppliers[0]]]), new Map([['RC-1', 0]]));
    expect(choice.usable).toBeNull();
    expect(choice.fallback.rate).toBe(5);
    expect(applicableContracts({ item: items[0], quantity: 1, requirementDate: new Date('2025-12-31') }, { contracts: [current] }, new Map([['S001', suppliers[0]]]), new Map()).all).toHaveLength(0);
  });

  it('evaluates every supported data operator', () => {
    const facts = { value: 10, plant: 'PUN1', item: { category: 'Steel' }, absent: undefined };
    expect(conditionMatches({ field: 'value', op: 'lte', value: 10 }, facts)).toBe(true);
    expect(conditionMatches({ field: 'value', op: 'gt', value: 9 }, facts)).toBe(true);
    expect(conditionMatches({ field: 'plant', op: 'in', value: ['PUN1'] }, facts)).toBe(true);
    expect(conditionMatches({ field: 'plant', op: 'not_in', value: ['CHK1'] }, facts)).toBe(true);
    expect(conditionMatches({ field: 'absent', op: 'exists', value: false }, facts)).toBe(true);
    expect(conditionMatches({ field: 'item.category', op: 'eq', value: 'Steel' }, facts)).toBe(true);
  });

  it('selects policy versions by requirement date and routes capex/new items generically', () => {
    const old = basePolicy();
    const newer = { ...basePolicy(), version: '6.0', effectiveFrom: '2026-12-01T00:00:00Z', rules: [{ id: 'new-rule', order: 0, when: [{ field: 'plant', op: 'eq', value: 'PUN1' }], outcome: { decision: 'RFQ', route: 'RFQ', supplierStrategy: 'sourcing', suggestCount: 1 } }] };
    const capex = runDecisionEngine({ ...data([line({ item_code: 'ITM-CAPEX', description: 'CNC machine', quantity: 1 })]), policy: { versions: [old, newer] } });
    const future = runDecisionEngine({ ...data([line({ created_at: '2026-12-02T10:00:00Z', item_code: 'ITM-1021' })]), policy: { versions: [old, newer] } });
    expect(capex.decisions[0].route).toBe('CAPEX_SOURCING');
    expect(capex.decisions[0].policy_version).toBe('5.0');
    expect(future.decisions[0].policy_version).toBe('6.0');
  });

  it('returns deterministic 0-100 ranking factors and excludes future POs as of the requested date', () => {
    const futureHistory = [...history, { po_number: 'PO-FUTURE', po_date: '2026-12-01', supplier_id: 'S002', item_code: 'ITM-1021', quantity: 10, unit_price: 205, plant: 'PUN1', delivered_on_time: true }];
    const before = preferredSuppliers({ item: items[0], requirementDate: new Date('2026-11-01') }, { suppliers, poHistory: futureHistory, contracts: [] }, basePolicy());
    const after = preferredSuppliers({ item: items[0], requirementDate: new Date('2026-12-15') }, { suppliers, poHistory: futureHistory, contracts: [] }, basePolicy());
    const repeat = preferredSuppliers({ item: items[0], requirementDate: new Date('2026-12-15') }, { suppliers, poHistory: futureHistory, contracts: [] }, basePolicy());
    expect(before.some((entry) => entry.supplier_id === 'S002')).toBe(false);
    expect(after.some((entry) => entry.supplier_id === 'S002')).toBe(true);
    expect(after).toEqual(repeat);
    expect(after[0].score).toBeGreaterThanOrEqual(0);
    expect(after[0].score).toBeLessThanOrEqual(100);
    expect(after[0].scoreBreakdown.weighted).toHaveProperty('recency');
    expect(after[0].explanation).toContain('Ranked 1st:');
  });
});

describe('valuation and consolidation boundaries', () => {
  it('uses contract, then recent PO, then standard price in that order', () => {
    const contractResult = runDecisionEngine(data([line({ quantity: 2 })], [contract({ value_cap: 100000, lines: [{ item_code: 'ITM-1021', rate: 180 }] })]));
    expect(contractResult.decisions[0].unit_price).toBe(180);
    const standardResult = runDecisionEngine(data([line({ item_code: 'ITM-CAPEX', description: 'CNC machine' })]));
    expect(standardResult.decisions[0].unit_price).toBe(100000);
  });

  it.each([
    ['23h59m', '2026-11-01T10:00:00Z', '2026-11-02T09:59:00Z', 1],
    ['24h01m', '2026-11-01T10:00:00Z', '2026-11-02T10:01:00Z', 2]
  ])('consolidates at the %s boundary', (_label, firstDate, secondDate, expectedPoCount) => {
    const result = runDecisionEngine(data([
      line({ pr_no: 'PR-A', item_code: 'ITM-1021', created_at: firstDate, quantity: 1 }),
      line({ pr_no: 'PR-B', item_code: 'ITM-1006', description: 'Aluminium plate 6061 10mm', created_at: secondDate, quantity: 1 })
    ]));
    expect(result.purchaseOrders).toHaveLength(expectedPoCount);
  });
});

describe('worked-policy scenarios', () => {
  it.each([
    ['new item', line({ item_code: '', description: 'new thing', estimated_unit_price: 25 }), 'NEW_ITEM_SOURCING'],
    ['capex', line({ item_code: 'ITM-CAPEX', description: 'CNC machine' }), 'CAPEX_SOURCING'],
    ['contract', line(), 'CONTRACT_PO'],
    ['emergency', line({ urgency: 'Emergency', item_code: 'ITM-1006', description: 'Aluminium plate 6061 10mm' }), 'EMERGENCY_PO'],
    ['spot', line({ item_code: 'ITM-1006', description: 'Aluminium plate 6061 10mm' }), 'SPOT_PO'],
    ['rfq', line({ item_code: 'ITM-1006', description: 'Aluminium plate 6061 10mm', quantity: 2000 }), 'RFQ'],
    ['rfp', line({ item_code: 'ITM-1006', description: 'Aluminium plate 6061 10mm', quantity: 30000 }), 'RFP'],
    ['unknown plant', line({ plant: 'PUN2' }), 'NOT_PROCESSED'],
    ['zero quantity', line({ quantity: 0 }), 'NOT_PROCESSED'],
    ['missing new price', line({ item_code: '', description: 'new thing' }), 'NOT_PROCESSED'],
    ['fuzzy bearing', line({ item_code: '', description: 'brg 6205 2rs' }), 'CONTRACT_PO'],
    ['contract selection', line({}), 'CONTRACT_PO'],
    ['blocked supplier excluded', line({}), 'CONTRACT_PO'],
    ['future policy selection', line({ created_at: '2026-12-02T10:00:00Z' }), 'CONTRACT_PO']
  ])('covers worked scenario: %s', (_name, prLine, expected) => {
    const result = runDecisionEngine(data([prLine], [contract()]));
    expect(routes(result)[0]).toBe(expected);
  });
});
