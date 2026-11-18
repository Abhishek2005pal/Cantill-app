import { parse } from 'csv-parse/sync';
import { AuditLog, Contract, Decision, Item, PoHistory, Policy, PrLine, PurchaseOrder, Requirement, SourcingRequest, Supplier } from '../models/index.js';
import { runDecisionEngine } from '../engine/index.js';
import { activePolicyFor } from '../policy/store.js';

export const EXPORT_COLUMNS = ['pr_no', 'pr_line', 'resolved_item_code', 'group_id', 'po_id', 'decision', 'route', 'supplier_id', 'unit_price', 'group_value_inr', 'suggested_supplier_ids', 'policy_version', 'reason'];
export const REQUIRED_HEADERS = ['pr_no', 'pr_line', 'created_at', 'requester', 'department', 'plant', 'item_code', 'description', 'quantity', 'uom', 'estimated_unit_price', 'need_by_date', 'urgency'];

const asNumber = (value) => value === '' || value === undefined ? null : Number(value);
const asDate = (value) => value ? new Date(value) : null;
const toCsvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
export const decisionsCsv = (decisions) => `${EXPORT_COLUMNS.join(',')}\n${decisions.map((decision) => EXPORT_COLUMNS.map((column) => toCsvCell(decision[column])).join(',')).join('\n')}\n`;

export function parseBatchCsv(buffer) {
  const rows = parse(buffer.toString('utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true, bom: true, info: true });
  const headers = rows.length ? Object.keys(rows[0].record) : [];
  const errors = [];
  if (headers.length !== REQUIRED_HEADERS.length || headers.some((header, index) => header !== REQUIRED_HEADERS[index])) errors.push({ row: 1, message: `Headers must exactly be: ${REQUIRED_HEADERS.join(',')}` });
  const lines = rows.map(({ record, info }) => {
    const row = info.lines;
    for (const header of REQUIRED_HEADERS) if (!(header in record)) errors.push({ row, field: header, message: 'missing column' });
    const quantity = asNumber(record.quantity);
    if (!record.pr_no || !record.pr_line) errors.push({ row, message: 'pr_no and pr_line are required' });
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) errors.push({ row, field: 'quantity', message: 'quantity must be a number' });
    if (record.created_at && !Number.isFinite(new Date(record.created_at).getTime())) errors.push({ row, field: 'created_at', message: 'invalid date' });
    if (record.need_by_date && !Number.isFinite(new Date(record.need_by_date).getTime())) errors.push({ row, field: 'need_by_date', message: 'invalid date' });
    return { ...record, pr_line: Number(record.pr_line), quantity, estimated_unit_price: asNumber(record.estimated_unit_price), created_at: asDate(record.created_at), need_by_date: asDate(record.need_by_date) };
  });
  return { lines, errors };
}

const audit = (who, action, entity, entityId, before, after, comment) => AuditLog.create({ who, when: new Date(), action, entity, entity_id: entityId, before, after, comment, actor: who, entity_type: entity, details: { who, when: new Date().toISOString(), action, entity, before, after, comment } });
const modelData = async () => ({ items: await Item.find().lean(), suppliers: await Supplier.find().lean(), poHistory: await PoHistory.find().lean(), contracts: await Contract.find().lean() });

export async function processBatch(buffer, batchId, who) {
  const parsed = parseBatchCsv(buffer);
  if (parsed.errors.length) return { status: 400, errors: parsed.errors };
  const policy = await activePolicyFor(parsed.lines.map((line) => line.created_at).sort((a, b) => a - b)[0] || new Date());
  if (!policy) return { status: 400, errors: [{ row: 1, message: 'No active policy for batch' }] };
  const result = runDecisionEngine({ prLines: parsed.lines, ...(await modelData()), policy });
  await Promise.all([PrLine.deleteMany({ batchId }), Requirement.deleteMany({ batchId }), Decision.deleteMany({ batchId }), PurchaseOrder.deleteMany({ batchId }), SourcingRequest.deleteMany({ batchId })]);
  const savedLines = await PrLine.insertMany(parsed.lines.map((line) => ({ ...line, batchId })));
  const lineIds = new Map(savedLines.map((line) => [`${line.pr_no}|${line.pr_line}`, line._id]));
  const requirementDocs = result.requirements.map((requirement) => ({ batchId, requirement_id: `${batchId}-${requirement.group_id}`, group_id: requirement.group_id, lines: requirement.lines.map((line) => lineIds.get(`${line.pr_no}|${line.pr_line}`)).filter(Boolean), plant: requirement.plant, item_code: requirement.item?.item_code, requirement_date: requirement.requirementDate, value: requirement.value, unit_price: requirement.unit_price, emergency: requirement.emergency, route: requirement.outcome.route, decision: requirement.outcome.decision, supplier_id: requirement.selectedSupplier?.supplier_id, suggested_supplier_ids: requirement.suggestedSupplierIds, policy_version: requirement.policyVersion, reason: requirement.reason, status: 'PENDING' }));
  const savedRequirements = await Requirement.insertMany(requirementDocs);
  const requirementIds = new Map(savedRequirements.map((requirement) => [requirement.group_id, requirement._id]));
  const decisionDocs = result.decisions.map((decision) => ({ ...decision, batchId, pr_line: lineIds.get(`${decision.pr_no}|${decision.pr_line}`), requirement: requirementIds.get(decision.group_id) }));
  const savedDecisions = await Decision.insertMany(decisionDocs);
  const decisionIds = new Map(savedDecisions.map((decision) => [`${decision.pr_no}|${decision.pr_line}`, decision._id]));
  const poDocs = result.purchaseOrders.map((po) => ({ ...po, batchId, po_id: `${batchId}-${po.po_id}`, lines: po.requirements.flatMap((groupId) => result.requirements.find((requirement) => requirement.group_id === groupId)?.lines || []).map((line) => decisionIds.get(`${line.pr_no}|${line.pr_line}`)).filter(Boolean), status: 'PENDING' }));
  const sourcingDocs = result.sourcingRequests.map((request) => ({ ...request, batchId, request_id: `${batchId}-${request.request_id}`, lines: result.requirements.find((requirement) => requirement.group_id === request.group_id)?.lines.map((line) => decisionIds.get(`${line.pr_no}|${line.pr_line}`)).filter(Boolean), status: 'PENDING' }));
  if (poDocs.length) await PurchaseOrder.insertMany(poDocs);
  if (sourcingDocs.length) await SourcingRequest.insertMany(sourcingDocs);
  await audit(who, 'PROCESS_BATCH', 'Batch', batchId, null, { decisions: result.decisions.length, requirements: result.requirements.length }, 'Batch processed and replaced idempotently');
  return { status: 200, batchId, ...result };
}

export async function requirementDetails(id) {
  return Requirement.findById(id).populate('lines').lean();
}

export { audit };
