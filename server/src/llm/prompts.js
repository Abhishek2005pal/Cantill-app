export const chatSlotSchema = { type: 'object', properties: { itemText: { type: 'string' }, itemCode: { type: 'string' }, quantity: { type: 'number' }, plantText: { type: 'string' }, needByText: { type: 'string' }, urgency: { type: 'string' }, estimatedUnitPrice: { type: 'number' } }, required: [] };
export const policySchemaForLLM = { type: 'object', description: 'Complete policy JSON matching the application policy schema' };
export const contractSchemaForLLM = { type: 'object', properties: { contract_id: { type: 'string' }, supplier_id: { type: 'string' }, supplier_name: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' }, value_cap: { type: 'number' }, lines: { type: 'array', items: { type: 'object' } } }, required: ['contract_id', 'supplier_id', 'start_date', 'end_date', 'value_cap', 'lines'] };

export const chatExtractionSystem = 'Extract only slots explicitly present in the requester message. Never invent item codes, dates, quantities, plants, or prices. Return JSON matching the supplied schema.';
export const policyReaderSystem = 'You are a procurement policy analyst. Produce a complete policy JSON, preserving unchanged fields from the supplied current policy and applying only the amendment. Do not invent policy facts.';
export const contractReaderSystem = 'Extract structured contract fields from this signed contract. Preserve item codes and supplier IDs exactly when present. Return JSON only.';

export const amendmentPromptFixtures = [
  'Amendment: change the spot PO limit from INR 200000 to INR 300000 effective 2026-12-01.',
  'Amendment: for category Fasteners, route values below INR 250000 to SPOT_PO effective 2026-12-01.',
  'Amendment: add rule R-PUN1-1 for plant PUN1 that requires RFQ for values below INR 100000 effective 2026-12-01.'
];