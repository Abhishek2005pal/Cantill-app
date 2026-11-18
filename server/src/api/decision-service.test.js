import { describe, expect, it } from 'vitest';
import { decisionsCsv, parseBatchCsv, REQUIRED_HEADERS } from './decision-service.js';

const valid = `${REQUIRED_HEADERS.join(',')}\nPR-1,1,2026-11-01 10:00,A,IT,PUN1,ITM-1,Test material,2,NOS,10,2026-11-20,Normal\n`;

describe('batch API helpers', () => {
  it('validates the sample headers and normalizes numeric/date fields', () => {
    const result = parseBatchCsv(Buffer.from(valid));
    expect(result.errors).toHaveLength(0);
    expect(result.lines[0].quantity).toBe(2);
    expect(result.lines[0].created_at).toBeInstanceOf(Date);
  });

  it('reports header and row-level errors', () => {
    const result = parseBatchCsv(Buffer.from('pr_no,quantity\nPR-1,nope\n'));
    expect(result.errors.some((error) => error.row === 1)).toBe(true);
    expect(result.errors.some((error) => error.field === 'quantity')).toBe(true);
  });

  it('emits the exact required decision columns', () => {
    const csv = decisionsCsv([{ pr_no: 'PR-1', pr_line: 1, suggested_supplier_ids: 'S1', reason: 'quoted, reason' }]);
    expect(csv.split('\n')[0]).toBe('pr_no,pr_line,resolved_item_code,group_id,po_id,decision,route,supplier_id,unit_price,group_value_inr,suggested_supplier_ids,policy_version,reason');
    expect(csv).toContain('"quoted, reason"');
  });
});