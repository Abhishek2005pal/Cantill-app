import Fuse from 'fuse.js';
import { ChatSession, Item } from '../models/index.js';
import { processBatch } from '../api/decision-service.js';
import { normalizeDescription } from '../engine/index.js';
import { callLLM } from './llm.js';
import { chatExtractionSystem, chatSlotSchema } from './prompts.js';

const PLANTS = { pun1: 'PUN1', bhosari: 'PUN1', pune: 'PUN1', chk1: 'CHK1', chakan: 'CHK1' };
const upper = (value) => String(value || '').trim().toUpperCase();
const number = (value) => value === undefined || value === null || value === '' ? null : Number(value);
const dateText = (value, today = new Date()) => {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(String(value))) return direct.toISOString().slice(0, 10);
  const match = String(value).toLowerCase().match(/next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (!match) return null;
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const target = names.indexOf(match[1]);
  const current = new Date(today);
  const distance = ((target - current.getUTCDay() + 7) % 7) || 7;
  current.setUTCDate(current.getUTCDate() + distance);
  return current.toISOString().slice(0, 10);
};

export function parseSlots(message, today = new Date()) {
  const text = String(message || '');
  const lower = text.toLowerCase();
  const quantity = lower.match(/\b(?:need|buy|order|require|for)\s+(\d+(?:\.\d+)?)\b/) || lower.match(/\b(\d+(?:\.\d+)?)\s+(?:nos|pcs|kg|pair|pairs|units|items)\b/) || lower.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  const code = text.match(/\bITM[- ]?\d{4}\b/i)?.[0]?.replace(' ', '-')?.toUpperCase();
  const plantText = Object.keys(PLANTS).find((key) => lower.includes(key));
  const urgency = /\bemergency\b|urgent/i.test(text) ? 'Emergency' : /\bnormal\b/i.test(text) ? 'Normal' : null;
  const estimated = lower.match(/(?:estimate|estimated|price|at)\s*(?:is|of|:)?\s*(?:inr|rs|₹)?\s*([\d,]+(?:\.\d+)?)/i);
  return { itemText: code ? code : text.replace(/\b(?:need|buy|order|require)\b/gi, '').replace(/\b(?:at|by|for|in)\s+(?:PUN1|PUN2|CHK1|Bhosari|Chakan|Pune|next\s+\w+|\d{4}-\d{2}-\d{2})/gi, '').trim(), itemCode: code, quantity: quantity ? Number(quantity[1]) : null, plant: plantText ? PLANTS[plantText] : null, needByDate: dateText(text, today), urgency, estimatedUnitPrice: estimated ? Number(estimated[1].replaceAll(',', '')) : null };
}

async function llmSlots(message) {
  if (!process.env.GEMINI_API_KEY) return {};
  try { return await callLLM({ system: chatExtractionSystem, prompt: message, jsonSchema: chatSlotSchema }); } catch { return {}; }
}

function resolveItem(itemText, itemCode, items, minimumConfidence = 0.65) {
  const normalizedItems = items.map((item) => ({ ...item, normalized: normalizeDescription(item.description) }));
  if (itemCode) {
    const exact = normalizedItems.find((item) => upper(item.item_code) === upper(itemCode));
    if (exact) return { status: 'confirmed', item: exact, confidence: 1, candidates: [exact] };
  }
  if (!itemText) return { status: 'missing', candidates: [] };
  const fuse = new Fuse(normalizedItems, { keys: ['normalized', 'description'], includeScore: true, threshold: 1 - minimumConfidence, ignoreLocation: true });
  const matches = fuse.search(itemText).map((result) => ({ ...result.item, confidence: 1 - (result.score || 0) })).sort((left, right) => right.confidence - left.confidence || upper(left.item_code).localeCompare(upper(right.item_code)));
  if (!matches.length) return { status: 'new', candidates: [] };
  if (matches[0].confidence >= 0.85 && (matches.length === 1 || matches[0].confidence - matches[1].confidence >= 0.1)) return { status: 'confirmed', item: matches[0], confidence: matches[0].confidence, candidates: matches.slice(0, 3) };
  return { status: 'ambiguous', candidates: matches.slice(0, 3) };
}

function missingSlots(slots, itemResult) {
  const missing = [];
  if (itemResult.status === 'missing' || itemResult.status === 'new') missing.push('item');
  if (!slots.quantity) missing.push('quantity');
  if (!slots.plant) missing.push('plant');
  if (!slots.needByDate) missing.push('need-by date');
  if (!slots.urgency) missing.push('urgency');
  if (itemResult.status === 'new' && !slots.estimatedUnitPrice) missing.push('estimated unit price');
  return missing;
}

const questionFor = (missing) => missing.slice(0, 2).map((slot) => ({ item: slot, question: `What is the ${slot}?` }));
const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export async function handleChat({ sessionId, message, action, selectedItemCode, today = new Date(), who = 'anonymous' }) {
  const session = await ChatSession.findOneAndUpdate({ session_id: sessionId }, { $setOnInsert: { session_id: sessionId, status: 'OPEN' }, $push: { messages: { role: 'user', content: message || action || '', created_at: new Date() } } }, { upsert: true, new: true });
  const items = await Item.find().lean();
  const extracted = parseSlots(message, today);
  const llmExtracted = await llmSlots(message || '');
  for (const [key, value] of Object.entries(llmExtracted)) {
    if (value !== null && value !== undefined && value !== '') extracted[key] = value;
  }
  const previousSlots = session.slots || {};
  const freshSlots = Object.fromEntries(Object.entries(extracted).filter(([, value]) => value !== null && value !== undefined && value !== ''));
  const slots = { ...previousSlots, ...freshSlots, plant: extracted.plant || PLANTS[String(extracted.plantText || '').toLowerCase()] || previousSlots.plant || null, needByDate: dateText(extracted.needByDate, today) || previousSlots.needByDate || null, quantity: number(extracted.quantity) ?? previousSlots.quantity ?? null, estimatedUnitPrice: number(extracted.estimatedUnitPrice) ?? previousSlots.estimatedUnitPrice ?? null, itemCode: selectedItemCode || extracted.itemCode || previousSlots.itemCode || null };
  const itemResult = resolveItem(slots.itemText, slots.itemCode, items);
  if (action === 'new-item') itemResult.status = 'new';
  if (action === 'select-item' && selectedItemCode) { slots.itemCode = selectedItemCode; itemResult.status = 'confirmed'; itemResult.item = items.find((item) => upper(item.item_code) === upper(selectedItemCode)); }
  if (itemResult.status === 'ambiguous') { await ChatSession.updateOne({ session_id: sessionId }, { $set: { slots } }); return { sessionId, state: 'SELECT_ITEM', message: 'I found several possible items. Choose one:', candidates: itemResult.candidates.map((item) => ({ itemCode: item.item_code, description: item.description })) }; }
  if (itemResult.status === 'new' && !slots.estimatedUnitPrice) { await ChatSession.updateOne({ session_id: sessionId }, { $set: { slots } }); return { sessionId, state: 'NEW_ITEM', message: 'I could not confidently match that item. Is this a new item? Please provide a description and estimated unit price.' }; }
  const missing = missingSlots(slots, itemResult);
  if (missing.length) { await ChatSession.updateOne({ session_id: sessionId }, { $set: { slots } }); return { sessionId, state: 'COLLECTING', slots, questions: questionFor(missing), message: `I still need ${missing.slice(0, 2).join(' and ')}.` }; }
  const summary = { itemCode: itemResult.item?.item_code || 'NEW', description: itemResult.item?.description || slots.itemText, quantity: slots.quantity, plant: slots.plant, needByDate: slots.needByDate, urgency: slots.urgency, estimatedUnitPrice: slots.estimatedUnitPrice };
  if (action !== 'confirm') { await ChatSession.updateOne({ session_id: sessionId }, { $set: { slots } }); return { sessionId, state: 'CONFIRM', summary, message: 'Please confirm this purchase request.' }; }
  const prNo = `CHAT-${sessionId}-${session.messages.length}`;
  const headers = 'pr_no,pr_line,created_at,requester,department,plant,item_code,description,quantity,uom,estimated_unit_price,need_by_date,urgency';
  const row = [prNo, 1, new Date(today).toISOString(), who, 'Chat', slots.plant, itemResult.item?.item_code || '', summary.description, slots.quantity, itemResult.item?.uom || 'NOS', slots.estimatedUnitPrice ?? '', slots.needByDate, slots.urgency].map(csvEscape).join(',');
  const result = await processBatch(Buffer.from(`${headers}\n${row}\n`), `chat-${sessionId}`, who);
  const decision = result.decisions?.[0];
  await ChatSession.updateOne({ session_id: sessionId }, { $push: { messages: { role: 'assistant', content: JSON.stringify(decision || result), created_at: new Date() } }, $set: { status: 'COMPLETED' } });
  return { sessionId, state: 'DECIDED', summary, decision, nextAction: decision?.route?.endsWith('_PO') ? 'Buyer approval creates the PO.' : 'Buyer should review the sourcing request.' };
}

export { resolveItem, dateText };
