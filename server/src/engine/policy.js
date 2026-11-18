export const policyV5 = {
  version: '5.0',
  effectiveFrom: '2026-04-01T00:00:00.000Z',
  plants: ['PUN1', 'CHK1'],
  matching: { minimumConfidence: 0.55 },
  params: {
    clubDays: 14,
    needByDays: 7,
    prefListDays: 548,
    recencyHalfLifeDays: 180,
    valuationLookbackDays: 365,
    consolidationHours: 24,
    rankingWeights: {
      frequency: 0.35,
      recency: 0.25,
      contract: 0.15,
      onTime: 0.20,
      quality: 0.20
    }
  },
  rules: [
    { id: '5.7-new-item', order: 0, when: [{ field: 'isNewItem', op: 'eq', value: true }], outcome: { decision: 'NEW_ITEM_SOURCING', route: 'NEW_ITEM_SOURCING', supplierStrategy: 'none', suggestCount: 0, requiresApproval: false } },
    { id: '5.1-capex', order: 1, when: [{ field: 'item.type', op: 'eq', value: 'Capex' }], outcome: { decision: 'CAPEX_SOURCING', route: 'CAPEX_SOURCING', supplierStrategy: 'sourcing', suggestCount: 5, requiresApproval: true } },
    { id: '5.2-contract', order: 2, when: [{ field: 'hasUsableContract', op: 'eq', value: true }], outcome: { decision: 'CONTRACT_PO', route: 'CONTRACT_PO', supplierStrategy: 'contract', suggestCount: 0, requiresApproval: false } },
    { id: '5.3-emergency', order: 3, when: [{ field: 'isEmergency', op: 'eq', value: true }, { field: 'value', op: 'lte', value: 500000 }, { field: 'boughtFromActiveSupplierInLookback', op: 'eq', value: true }], outcome: { decision: 'EMERGENCY_PO', route: 'EMERGENCY_PO', supplierStrategy: 'preferred', suggestCount: 0, requiresApproval: false } },
    { id: '5.4-spot', order: 4, when: [{ field: 'value', op: 'lt', value: 200000 }, { field: 'boughtFromActiveSupplierInLookback', op: 'eq', value: true }], outcome: { decision: 'SPOT_PO', route: 'SPOT_PO', supplierStrategy: 'preferred', suggestCount: 0, requiresApproval: false } },
    { id: '5.5-rfq', order: 5, when: [{ field: 'value', op: 'lt', value: 1000000 }], outcome: { decision: 'RFQ', route: 'RFQ', supplierStrategy: 'sourcing', suggestCount: 3, requiresApproval: false } },
    { id: '5.6-rfp', order: 6, when: [{ field: 'value', op: 'gte', value: 1000000 }], outcome: { decision: 'RFP', route: 'RFP', supplierStrategy: 'sourcing', suggestCount: 5, requiresApproval: true } }
  ]
};

export const policyV5Versions = [policyV5];
