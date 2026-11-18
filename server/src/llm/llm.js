import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function contentsFor({ system, prompt, pdfBuffer }) {
  const parts = [{ text: prompt }];
  if (pdfBuffer) parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } });
  return [{ role: 'user', parts: [{ text: system }, ...parts] }];
}

export async function callLLM({ system, prompt, jsonSchema, pdfBuffer }) {
  if (!process.env.GEMINI_API_KEY) throw new Error('LLM unavailable: GEMINI_API_KEY is not configured');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await ai.models.generateContent({ model, contents: contentsFor({ system, prompt, pdfBuffer }), config: { responseMimeType: 'application/json', responseSchema: jsonSchema, abortSignal: controller.signal } });
      const text = response.text || response.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
      if (!text) throw new Error('LLM returned an empty response');
      try { return JSON.parse(text); } catch { throw new Error('LLM returned invalid JSON'); }
    } catch (error) {
      lastError = error.name === 'AbortError' ? new Error('LLM timed out after 30 seconds') : error;
      if (attempt < 2) await sleep(250 * (2 ** attempt));
    } finally { clearTimeout(timeout); }
  }
  throw new Error(`LLM unavailable after 3 attempts: ${lastError?.message || 'unknown error'}`);
}

export const llmDefaults = { model: process.env.GEMINI_MODEL || DEFAULT_MODEL, timeoutMs: 30000, retries: 2 };