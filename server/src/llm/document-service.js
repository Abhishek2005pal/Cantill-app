import pdfParse from 'pdf-parse';
import { diffPolicy } from '../policy/diff.js';
import { validatePolicy } from '../policy/schema.js';
import { callLLM } from './llm.js';
import { contractReaderSystem, contractSchemaForLLM, policyReaderSystem, policySchemaForLLM } from './prompts.js';

const asIso = (value) => value instanceof Date ? value.toISOString() : value;
const policyForPrompt = (policy) => ({ ...policy, effectiveFrom: asIso(policy.effectiveFrom), createdAt: asIso(policy.createdAt), status: 'DRAFT' });

export async function pdfText(pdfBuffer) {
  if (!pdfBuffer) return '';
  const parsed = await pdfParse(pdfBuffer);
  return String(parsed.text || '').trim();
}

async function amendmentJson({ text, pdfBuffer, currentPolicy, llm = callLLM, validationError }) {
  const prompt = `${validationError ? `The previous JSON failed validation: ${validationError}. Correct it.\n` : ''}Current policy JSON:\n${JSON.stringify(policyForPrompt(currentPolicy), null, 2)}\nAmendment text:\n${text || '(read the attached PDF)'}`;
  return llm({ system: policyReaderSystem, prompt, jsonSchema: policySchemaForLLM, pdfBuffer: text ? undefined : pdfBuffer });
}

export async function readPolicyAmendment({ text, pdfBuffer, currentPolicy, llm = callLLM }) {
  let extractedText = text || '';
  if (pdfBuffer) {
    try { extractedText ||= await pdfText(pdfBuffer); } catch { extractedText = ''; }
  }
  let proposed = await amendmentJson({ text: extractedText, pdfBuffer, currentPolicy, llm });
  try { proposed = validatePolicy({ ...proposed, status: 'DRAFT' }); } catch (firstError) {
    proposed = await amendmentJson({ text: extractedText, pdfBuffer, currentPolicy, llm, validationError: firstError.message });
    proposed = validatePolicy({ ...proposed, status: 'DRAFT' });
  }
  const change = diffPolicy(currentPolicy, proposed);
  return { proposedPolicy: proposed, diff: change, plainLanguageSummary: change.summary, extractedText };
}

export async function extractContract({ pdfBuffer, text, llm = callLLM }) {
  let extractedText = text || '';
  if (pdfBuffer) {
    try { extractedText ||= await pdfText(pdfBuffer); } catch { extractedText = ''; }
  }
  const result = await llm({ system: contractReaderSystem, prompt: extractedText || 'Extract the contract fields from the attached PDF.', jsonSchema: contractSchemaForLLM, pdfBuffer: extractedText ? undefined : pdfBuffer });
  return { ...result, extractedText };
}
