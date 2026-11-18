import { describe, expect, it, vi } from 'vitest';
import { policyV5 } from '../engine/policy.js';
import { amendmentPromptFixtures } from './prompts.js';
import { extractContract, readPolicyAmendment } from './document-service.js';

const validPolicy = () => ({ ...structuredClone(policyV5), status: 'DRAFT' });

describe('LLM-assisted document services', () => {
  it('keeps the three amendment prompts explicit and deterministic diffing local', async () => {
    expect(amendmentPromptFixtures).toHaveLength(3);
    expect(amendmentPromptFixtures.join(' ')).toContain('300000');
    const llm = vi.fn().mockResolvedValue(validPolicy());
    const result = await readPolicyAmendment({ text: amendmentPromptFixtures[0], currentPolicy: { ...policyV5, status: 'ACTIVE' }, llm });
    expect(result.proposedPolicy.status).toBe('DRAFT');
    expect(result.diff).toHaveProperty('summary');
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('retries once with validation feedback when the first policy JSON is invalid', async () => {
    const llm = vi.fn().mockResolvedValueOnce({ bad: true }).mockResolvedValueOnce(validPolicy());
    const result = await readPolicyAmendment({ text: 'change policy', currentPolicy: { ...policyV5, status: 'ACTIVE' }, llm });
    expect(result.proposedPolicy.version).toBe('5.0');
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[1][0].prompt).toContain('failed validation');
  });

  it('returns contract extraction fields from an injected LLM without network access', async () => {
    const result = await extractContract({ text: 'Contract RC-2026-031', llm: vi.fn().mockResolvedValue({ contract_id: 'RC-2026-031', supplier_id: 'S021', start_date: '2026-11-15', end_date: '2027-11-14', value_cap: 100, lines: [] }) });
    expect(result.contract_id).toBe('RC-2026-031');
    expect(result.supplier_id).toBe('S021');
  });
});
