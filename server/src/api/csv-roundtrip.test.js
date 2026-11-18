import { describe, expect, it } from 'vitest';
import { decisionsCsv, parseBatchCsv, REQUIRED_HEADERS } from './decision-service.js';

describe('CSV round trip', () => {
  it('preserves required batch fields and quoted commas', () => {
    const source = `${REQUIRED_HEADERS.join(',')}\nPR-1,1,2026-11-01T10:00:00Z,Requester,IT,PUN1,ITM-1001,"MS sheet, 2mm",3,NOS,100,2026-11-20,Normal\n`;
    const parsed = parseBatchCsv(Buffer.from(source));
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines[0].description).toBe('MS sheet, 2mm');
    const output = decisionsCsv([{ pr_no: parsed.lines[0].pr_no, pr_line: parsed.lines[0].pr_line, resolved_item_code: 'ITM-1001', group_id: 'REQ-000001', po_id: '', decision: 'RFQ', route: 'RFQ', supplier_id: '', unit_price: 100, group_value_inr: 300, suggested_supplier_ids: 'S001;S002', policy_version: '5.0', reason: 'clause 5.5, quoted, value' }]);
    expect(output.split('\n')[0]).toBe('pr_no,pr_line,resolved_item_code,group_id,po_id,decision,route,supplier_id,unit_price,group_value_inr,suggested_supplier_ids,policy_version,reason');
    expect(output).toContain('"clause 5.5, quoted, value"');
  });
});
