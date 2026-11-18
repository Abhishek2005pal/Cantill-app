import { describe, expect, it } from 'vitest';
import { diffPolicy, policyFor } from './diff.js';
import { policyV5 } from '../engine/policy.js';
import { policySchema, validatePolicy } from './schema.js';
import { runDecisionEngine } from '../engine/index.js';

const clone = () => structuredClone(policyV5);
const item = { item_code: 'ITM-1', description: 'Test material', uom: 'NOS', category: 'Test', item_type: 'Material', standard_price: 10 };
const supplier = { supplier_id: 'S1', name: 'Active supplier', status: 'Active', categories: ['Test'], on_time_pct: 90, quality_rating: 4 };
const line = (plant = 'PUN1') => ({ pr_no: `PR-${plant}`, pr_line: 1, created_at: '2026-11-01T10:00:00Z', plant, item_code: 'ITM-1', description: 'Test material', quantity: 1, need_by_date: '2026-11-20', urgency: 'Normal' });
const data = (prLines, policy) => ({ prLines, items: [item], suppliers: [supplier], poHistory: [], contracts: [], policy });

 describe('policy schema and resolver', () => {
  it('rejects unknown fields, operators, and duplicate rule order', () => {
    expect(() => validatePolicy({ ...clone(), unknown: true })).toThrow();
    expect(() => validatePolicy({ ...clone(), rules: [{ ...clone().rules[0], order: 0, when: [{ field: 'plant', op: 'contains', value: 'PUN1' }] }, ...clone().rules.slice(1)] })).toThrow();
    expect(() => validatePolicy({ ...clone(), rules: clone().rules.map((rule) => ({ ...rule, order: 1 })) })).toThrow();
  });

  it('returns the latest active version at or before the requested date', () => {
    const v5 = { ...clone(), status: 'ACTIVE' };
    const v6 = { ...clone(), version: '6.0', effectiveFrom: '2026-12-01T00:00:00.000Z', status: 'ACTIVE' };
    const future = { ...clone(), version: '7.0', effectiveFrom: '2027-01-01T00:00:00.000Z', status: 'ACTIVE' };
    expect(policyFor([v5, v6, future], '2026-12-15T00:00:00Z').version).toBe('6.0');
    expect(policyFor([v5, v6], '2026-03-31T00:00:00Z')).toBeNull();
  });
});

describe('policy diff', () => {
  it('reports param and rule changes in plain language', () => {
    const proposed = clone();
    proposed.params.rankingWeights.frequency = 0.4;
    proposed.params.clubDays = 21;
    proposed.rules = [...proposed.rules, { id: 'R-PUN1-1', order: 20, when: [{ field: 'plant', op: 'eq', value: 'PUN1' }], outcome: { decision: 'RFQ', route: 'RFQ', supplierStrategy: 'sourcing', suggestCount: 3 } }];
    const result = diffPolicy(clone(), proposed);
    expect(result.changedParams.map((change) => change.key)).toContain('clubDays');
    expect(result.addedRules[0].id).toBe('R-PUN1-1');
    expect(result.summary.join(' ')).toContain('New rule R-PUN1-1 applies only to plant PUN1');
  });
});

describe('new policy behavior without engine changes', () => {
  it('applies a plant-only rule from policy JSON', () => {
    const policy = clone();
    policy.rules = [{ id: 'R-PUN1-1', order: -1, when: [{ field: 'plant', op: 'eq', value: 'PUN1' }], outcome: { decision: 'PLANT_RFQ', route: 'RFQ', supplierStrategy: 'sourcing', suggestCount: 1 } }, ...policy.rules];
    const result = runDecisionEngine(data([line('PUN1')], policy));
    expect(result.decisions[0].route).toBe('RFQ');
    expect(result.decisions[0].decision).toBe('PLANT_RFQ');
  });

  it('applies a category-specific limit from policy JSON', () => {
    const policy = clone();
    policy.rules = [{ id: 'R-TEST-LIMIT', order: 2, when: [{ field: 'item.category', op: 'eq', value: 'Test' }, { field: 'value', op: 'lt', value: 20 }], outcome: { decision: 'CATEGORY_RFQ', route: 'RFQ', supplierStrategy: 'sourcing', suggestCount: 3 } }, ...policy.rules];
    const result = runDecisionEngine(data([line()], policy));
    expect(result.decisions[0].decision).toBe('CATEGORY_RFQ');
  });

  it('applies a changed limit from policy JSON', () => {
    const policy = clone();
    policy.rules = policy.rules.map((rule) => rule.id === '5.5-rfq' ? { ...rule, when: [{ field: 'value', op: 'lt', value: 5 }] } : rule.id === '5.6-rfp' ? { ...rule, when: [{ field: 'value', op: 'gte', value: 5 }] } : rule);
    const result = runDecisionEngine(data([line()], policy));
    expect(result.decisions[0].route).toBe('RFP');
  });
});
