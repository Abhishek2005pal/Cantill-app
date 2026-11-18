import { describe, expect, it } from 'vitest';
import { dateText, parseSlots, resolveItem } from './chat-service.js';

const items = [
  { item_code: 'ITM-1021', description: 'Ball bearing 6205-2RS', uom: 'NOS' },
  { item_code: 'ITM-1022', description: 'Ball bearing 6308-ZZ', uom: 'NOS' }
];

describe('chat fallback intake', () => {
  it('extracts quantity, aliases, urgency, price, and next Friday without an LLM', () => {
    const slots = parseSlots('need 20 brg 6205 2rs for Bhosari by next Friday emergency at INR 200', new Date('2026-11-18T00:00:00Z'));
    expect(slots.quantity).toBe(20);
    expect(slots.plant).toBe('PUN1');
    expect(slots.urgency).toBe('Emergency');
    expect(slots.estimatedUnitPrice).toBe(200);
    expect(dateText('next Friday', new Date('2026-11-18T00:00:00Z'))).toBe('2026-11-20');
  });

  it('uses item-master matching and offers ambiguity instead of inventing codes', () => {
    expect(resolveItem('', 'ITM-1021', items).status).toBe('confirmed');
    expect(resolveItem('ball bearing', null, items).status).toBe('ambiguous');
    expect(resolveItem('unobtainium', null, items).status).toBe('new');
  });
});
