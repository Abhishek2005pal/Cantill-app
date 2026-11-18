import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Item, Supplier, Contract, PoHistory, Decision, Requirement, PrLine, PurchaseOrder, SourcingRequest } from './models/index.js';
import { Policy, PolicyChange, AuditLog } from './models/index.js';
import { activePolicyFor, approvePolicyChange, proposePolicy, rejectPolicyChange } from './policy/store.js';
import { validatePolicy } from './policy/schema.js';
import { audit, decisionsCsv, parseBatchCsv, processBatch } from './api/decision-service.js';
import { preferredSuppliers } from './engine/index.js';
import { handleChat } from './llm/chat-service.js';
import { extractContract, readPolicyAmendment } from './llm/document-service.js';
import multer from 'multer';

const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (!origin || origin === 'https://cantill-app.onrender.com' || origin.endsWith('.vercel.app')) {
    response.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-User,X-Batch-Id');
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  return next();
});
app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'cantill-pr-to-po-api' });
});

const list = (Model, sort) => async (_request, response, next) => {
  try {
    response.json(await Model.find().sort(sort).lean());
  } catch (error) {
    next(error);
  }
};

app.get('/api/items', list(Item, { item_code: 1 }));
app.get('/api/suppliers', list(Supplier, { supplier_id: 1 }));
app.get('/api/contracts', list(Contract, { contract_id: 1 }));
app.get('/api/po-history', list(PoHistory, { po_date: -1, po_number: 1 }));
app.get('/api/audit-log', async (request, response, next) => {
  try { response.json(await AuditLog.find(request.query.batchId ? { 'details.entity_id': request.query.batchId } : {}).sort({ when: -1, createdAt: -1 }).limit(200).lean()); } catch (error) { next(error); }
});

const actor = (request) => request.get('X-User') || request.body?.who || request.body?.name || 'anonymous';

app.post('/api/process-batch', upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ errors: [{ row: 1, message: 'CSV file is required in multipart field `file`' }] });
    const batchId = request.query.batchId || request.body?.batchId || request.get('X-Batch-Id');
    if (!batchId) return response.status(400).json({ errors: [{ row: 1, message: 'batchId is required' }] });
    const result = await processBatch(request.file.buffer, batchId, actor(request));
    if (result.status !== 200) return response.status(result.status).json(result);
    if (request.query.format === 'csv') return response.type('text/csv').send(decisionsCsv(result.decisions));
    return response.json(result);
  } catch (error) { return next(error); }
});

app.get('/api/decisions/export', async (request, response, next) => {
  try {
    const filter = request.query.batchId ? { batchId: request.query.batchId } : {};
    const decisions = await Decision.find(filter).populate('pr_line').populate('requirement').lean();
    const poRows = await PurchaseOrder.find(filter).lean();
    const poByGroup = new Map(poRows.flatMap((po) => (po.requirements || []).map((group) => [group, po.po_id])));
    const rows = decisions.map((decision) => ({ pr_no: decision.pr_line?.pr_no, pr_line: decision.pr_line?.pr_line, resolved_item_code: decision.requirement?.item_code || decision.pr_line?.item_code || 'NEW', group_id: decision.requirement?.group_id || '', po_id: poByGroup.get(decision.requirement?.group_id) || '', decision: decision.decision, route: decision.route, supplier_id: decision.supplier_id, unit_price: decision.unit_price, group_value_inr: decision.group_value_inr, suggested_supplier_ids: decision.suggested_supplier_ids?.join(';'), policy_version: decision.policy_version, reason: decision.reason }));
    return response.type('text/csv').send(decisionsCsv(rows));
  } catch (error) { return next(error); }
});

app.get('/api/requirements', async (request, response, next) => {
  try {
    const filter = {};
    for (const field of ['status', 'route', 'plant', 'batchId']) if (request.query[field]) filter[field] = request.query[field];
    return response.json(await Requirement.find(filter).sort({ requirement_date: 1, group_id: 1 }).lean());
  } catch (error) { return next(error); }
});

app.get('/api/requirements/:id', async (request, response, next) => {
  try {
    const requirement = await Requirement.findById(request.params.id).populate('lines').lean();
    if (!requirement) return response.status(404).json({ error: 'Requirement not found' });
    const decisions = await Decision.find({ requirement: requirement._id }).populate('pr_line').lean();
    return response.json({ ...requirement, decisions });
  } catch (error) { return next(error); }
});

app.post('/api/requirements/:id/approve', async (request, response, next) => {
  try {
    const requirement = await Requirement.findById(request.params.id);
    if (!requirement) return response.status(404).json({ error: 'Requirement not found' });
    if (requirement.status !== 'PENDING') return response.status(409).json({ error: 'Requirement is already decided' });
    const decisions = await Decision.find({ requirement: requirement._id });
    const who = actor(request);
    let created;
    if (requirement.route.endsWith('_PO')) {
      created = await PurchaseOrder.create({ batchId: requirement.batchId, po_id: `${requirement.batchId}-APPROVED-${requirement.group_id}`, supplier_id: requirement.supplier_id, plant: requirement.plant, route: requirement.route, lines: decisions.map((decision) => decision._id), requirements: [requirement.group_id], total_value: requirement.value, status: 'APPROVED' });
    } else {
      created = await SourcingRequest.create({ batchId: requirement.batchId, request_id: `${requirement.batchId}-APPROVED-${requirement.group_id}`, route: requirement.route, lines: decisions.map((decision) => decision._id), suggested_supplier_ids: requirement.suggested_supplier_ids, status: 'APPROVED' });
    }
    const before = requirement.toObject();
    requirement.status = 'APPROVED';
    await requirement.save();
    await audit(who, 'APPROVE_REQUIREMENT', 'Requirement', requirement._id.toString(), before, requirement.toObject(), request.body?.comment);
    return response.json({ requirement, created });
  } catch (error) { return next(error); }
});

app.post('/api/requirements/:id/override', async (request, response, next) => {
  try {
    const comment = String(request.body?.comment || '').trim();
    if (!comment) return response.status(400).json({ error: 'Override comment is required' });
    const requirement = await Requirement.findById(request.params.id);
    if (!requirement) return response.status(404).json({ error: 'Requirement not found' });
    const before = requirement.toObject();
    requirement.status = 'OVERRIDDEN';
    await requirement.save();
    await audit(actor(request), 'OVERRIDE_REQUIREMENT', 'Requirement', requirement._id.toString(), before, requirement.toObject(), comment);
    return response.json({ requirement, originalDecision: before.decision, comment });
  } catch (error) { return next(error); }
});

app.post('/api/contracts', async (request, response, next) => {
  try { const contract = await Contract.create({ ...request.body, source: request.body.source || 'PDF' }); await audit(actor(request), 'CREATE_CONTRACT', 'Contract', contract._id.toString(), null, contract.toObject()); return response.status(201).json(contract); } catch (error) { return next(error); }
});

app.post('/api/contracts/extract-pdf', upload.single('document'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: 'Contract PDF is required in multipart field `document`' });
    const extracted = await extractContract({ pdfBuffer: request.file.buffer });
    const supplier = await Supplier.findOne({ supplier_id: String(extracted.supplier_id || '').toUpperCase() }).lean();
    return response.json({ ...extracted, supplierValid: Boolean(supplier), supplierError: supplier ? null : `Unknown supplier_id ${extracted.supplier_id}` });
  } catch (error) { return next(error); }
});

app.get('/api/suppliers/preferred', async (request, response, next) => {
  try {
    const asOf = request.query.asOf || new Date().toISOString().slice(0, 10);
    const policy = await activePolicyFor(asOf);
    if (!policy) return response.status(404).json({ error: 'No active policy for date' });
    const [items, suppliers, poHistory, contracts] = await Promise.all([Item.find().lean(), Supplier.find().lean(), PoHistory.find().lean(), Contract.find().lean()]);
    const rows = items.flatMap((item) => preferredSuppliers({ item, requirementDate: new Date(asOf) }, { suppliers, poHistory, contracts }, policy).slice(0, 3).map((supplier) => ({ item_code: item.item_code, rank: supplier.rank, supplier_id: supplier.supplier_id, reference_price: supplier.referencePrice, score: supplier.score, score_breakdown: supplier.scoreBreakdown, explanation: supplier.explanation })));
    if (request.query.format === 'csv') return response.type('text/csv').send(`item_code,rank,supplier_id,reference_price\n${rows.map((row) => [row.item_code, row.rank, row.supplier_id, row.reference_price ?? ''].join(',')).join('\n')}\n`);
    return response.json(rows);
  } catch (error) { return next(error); }
});

app.post('/api/chat', async (request, response, next) => {
  try {
    const sessionId = request.body?.sessionId || request.query.sessionId;
    if (!sessionId) return response.status(400).json({ error: 'sessionId is required' });
    if (!request.body?.message && !request.body?.action) return response.status(400).json({ error: 'message or action is required' });
    return response.json(await handleChat({ sessionId, message: request.body.message, action: request.body.action, selectedItemCode: request.body.selectedItemCode, today: request.body.today || new Date(), who: actor(request) }));
  } catch (error) { return next(error); }
});

app.get('/api/policies', async (_request, response, next) => {
  try { response.json(await Policy.find().sort({ effectiveFrom: 1 }).lean()); } catch (error) { next(error); }
});

app.get('/api/policies/active', async (request, response, next) => {
  try {
    const policy = await activePolicyFor(request.query.asOf || new Date());
    if (!policy) return response.status(404).json({ error: 'No active policy for date' });
    return response.json(policy);
  } catch (error) { return next(error); }
});

const proposalBody = (request) => {
  if (request.body?.proposedPolicy) return typeof request.body.proposedPolicy === 'string' ? JSON.parse(request.body.proposedPolicy) : request.body.proposedPolicy;
  if (request.body?.policy) return typeof request.body.policy === 'string' ? JSON.parse(request.body.policy) : request.body.policy;
  if (request.body?.message) return JSON.parse(request.body.message);
  if (request.file?.mimetype === 'application/json' || request.file?.originalname?.endsWith('.json')) return JSON.parse(request.file.buffer.toString('utf8'));
  throw new Error('Provide proposedPolicy JSON, a policy JSON file, or a JSON chat message');
};

app.post('/api/policies/propose', upload.single('document'), async (request, response, next) => {
  try {
    let proposed;
    try { proposed = proposalBody(request); } catch (parseError) {
      if (!request.body?.message && !request.file) throw parseError;
      const current = await activePolicyFor(request.body?.effectiveFrom || new Date());
      if (!current) return response.status(400).json({ error: 'No active policy available as context' });
      const readerResult = await readPolicyAmendment({ text: request.body?.message, pdfBuffer: request.file?.buffer, currentPolicy: current });
      proposed = readerResult.proposedPolicy;
    }
    validatePolicy({ ...proposed, status: 'DRAFT' });
    const change = await proposePolicy(proposed, { submittedBy: actor(request), sourceDocument: request.file?.originalname || request.body?.sourceDocument });
    await audit(actor(request), 'PROPOSE_POLICY', 'PolicyChange', change._id.toString(), null, change.toObject());
    return response.status(201).json(change);
  } catch (error) { return next(error); }
});

app.get('/api/policy-changes', async (_request, response, next) => {
  try { response.json(await PolicyChange.find().sort({ createdAt: -1 }).lean()); } catch (error) { next(error); }
});

app.post('/api/policy-changes/:id/approve', async (request, response, next) => {
  try { const change = await approvePolicyChange(request.params.id, actor(request), request.body?.effectiveFrom); await audit(actor(request), 'APPROVE_POLICY_CHANGE', 'PolicyChange', request.params.id, null, change.toObject(), request.body?.comment); return response.json(change); } catch (error) { return next(error); }
});

app.post('/api/policy-changes/:id/reject', async (request, response, next) => {
  try { const change = await rejectPolicyChange(request.params.id, request.body?.reason, actor(request)); await audit(actor(request), 'REJECT_POLICY_CHANGE', 'PolicyChange', request.params.id, null, change.toObject(), request.body?.reason); return response.json(change); } catch (error) { return next(error); }
});

const clientDist = path.resolve(currentDir, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (request, response, next) => {
  if (request.path.startsWith('/api/')) {
    return response.status(404).json({ error: 'Route not found' });
  }
  return response.sendFile(path.join(clientDist, 'index.html'), (error) => error && next(error));
});

app.use((error, _request, response, _next) => {
  response.status(500).json({ error: error.message || 'Internal server error' });
});

export default app;
