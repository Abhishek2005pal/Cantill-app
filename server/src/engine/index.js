import Fuse from 'fuse.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE = 'ACTIVE';
const CODE_SYNONYMS = new Map([
  ['brg', 'bearing'], ['bearings', 'bearing'], ['bear', 'bearing'], ['qty', 'quantity'],
  ['nos', 'nos'], ['no', 'nos'], ['pcs', 'pcs'], ['pc', 'pcs'], ['mts', 'mtr'], ['metre', 'mtr'], ['meter', 'mtr']
]);

const plain = (value) => value && typeof value.toObject === 'function' ? value.toObject() : value;
const upper = (value) => String(value ?? '').trim().toUpperCase();
const text = (value) => String(value ?? '').trim();
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const dateValue = (value) => value instanceof Date ? value : new Date(value);
const validDate = (value) => { const result = dateValue(value); return !Number.isNaN(result.getTime()); };
const isoDate = (value) => { const result = dateValue(value); return validDate(result) ? result.toISOString().slice(0, 10) : ''; };
const utcDayNumber = (value) => { const result = dateValue(value); return Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), result.getUTCDate()) / DAY_MS; };
const calendarDaysBetween = (left, right) => Math.abs(utcDayNumber(left) - utcDayNumber(right));
const round = (value) => value === null || value === undefined ? null : Math.round((value + Number.EPSILON) * 100) / 100;
const byId = (left, right, field) => text(left[field]).localeCompare(text(right[field]));
const sortLines = (left, right) => dateValue(left.created_at) - dateValue(right.created_at) || text(left.pr_no).localeCompare(text(right.pr_no), undefined, { numeric: true }) || Number(left.pr_line || 0) - Number(right.pr_line || 0);
const sortRequirements = (left, right) => dateValue(left.firstLine.created_at) - dateValue(right.firstLine.created_at) || left.group_id.localeCompare(right.group_id);

export function normalizeDescription(value) {
  return text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean).map((token) => CODE_SYNONYMS.get(token) || token).join(' ').replace(/(\d+)\s+([a-z]+)/g, '$1$2');
}

function itemMatch(line, items, policy) {
  const normalizedItems = items.map((item) => ({ ...plain(item), item_code: upper(item.item_code), _normalizedDescription: normalizeDescription(item.description) })).sort((left, right) => byId(left, right, 'item_code'));
  const requestedCode = upper(line.item_code);
  if (requestedCode) {
    const exactCode = normalizedItems.find((item) => item.item_code === requestedCode);
    if (exactCode) return { item: exactCode, method: 'item code', confidence: 1 };
  }
  const requestedDescription = normalizeDescription(line.description);
  if (!requestedDescription) return { item: null, method: 'no description', confidence: 0 };
  const exactDescription = normalizedItems.find((item) => item._normalizedDescription === requestedDescription);
  if (exactDescription) return { item: exactDescription, method: 'normalized description', confidence: 1 };
  const requestedTokens = new Set(requestedDescription.split(' '));
  const tokenMatch = normalizedItems.find((item) => requestedTokens.size > 0 && [...requestedTokens].every((token) => item._normalizedDescription.split(' ').includes(token)));
  if (tokenMatch) return { item: tokenMatch, method: 'normalized token match', confidence: 1 };
  const minimumConfidence = Number(policy.matching?.minimumConfidence ?? 0);
  const overlapMatch = normalizedItems.map((item) => {
    const itemTokens = new Set(item._normalizedDescription.split(' '));
    const overlap = [...requestedTokens].filter((token) => itemTokens.has(token)).length;
    return { item, confidence: overlap / Math.max(1, requestedTokens.size) };
  }).sort((left, right) => right.confidence - left.confidence || byId(left.item, right.item, 'item_code'))[0];
  if (overlapMatch?.confidence >= minimumConfidence) return { item: overlapMatch.item, method: 'token overlap', confidence: overlapMatch.confidence };
  const fuse = new Fuse(normalizedItems, { keys: ['_normalizedDescription'], includeScore: true, threshold: 1 - minimumConfidence, ignoreLocation: true, minMatchCharLength: 2 });
  const result = fuse.search(requestedDescription)[0];
  const confidence = result?.score === undefined ? 0 : 1 - result.score;
  return result && confidence >= minimumConfidence ? { item: result.item, method: 'fuzzy description', confidence } : { item: null, method: 'no confident match', confidence };
}

function activeSupplier(supplier) { return upper(supplier?.status) === ACTIVE; }
function suppliersById(suppliers) { return new Map(suppliers.map((supplier) => [upper(supplier.supplier_id), plain(supplier)])); }
function contractLines(contract) { return (contract.lines || []).map((line) => ({ ...plain(line), item_code: upper(line.item_code) })); }
function policyVersions(policy) { return (policy?.versions || [policy]).filter(Boolean).map(plain).sort((left, right) => dateValue(left.effectiveFrom || left.effective_date) - dateValue(right.effectiveFrom || right.effective_date)); }

export function selectPolicy(policy, requirementDate) {
  const candidates = policyVersions(policy).filter((candidate) => validDate(candidate.effectiveFrom || candidate.effective_date) && dateValue(candidate.effectiveFrom || candidate.effective_date) <= dateValue(requirementDate));
  return candidates[candidates.length - 1] || policyVersions(policy)[0] || policy;
}

function lineValidation(line, item, policy) {
  const quantity = finite(line.quantity);
  if (quantity === null || quantity <= 0) return 'quantity must be greater than zero';
  const plants = (policy.plants || []).map(upper);
  if (plants.length && !plants.includes(upper(line.plant))) return `unknown plant ${upper(line.plant)}`;
  if (!item && (finite(line.estimated_unit_price) === null || finite(line.estimated_unit_price) < 0)) return 'new item requires an estimated unit price';
  return null;
}

function canClub(line, requirement, policy) {
  if (!line.item || !requirement.item) return false;
  const params = policy.params;
  return line.item.item_code === requirement.item.item_code && upper(line.plant) === requirement.plant && calendarDaysBetween(line.created_at, requirement.firstLine.created_at) <= params.clubDays && calendarDaysBetween(line.need_by_date, requirement.firstLine.need_by_date) <= params.needByDays;
}

function makeRequirements(lines, policy) {
  const requirements = [];
  for (const line of lines) {
    if (line.invalidReason) continue;
    if (!line.item) {
      requirements.push({ group_id: `REQ-${String(requirements.length + 1).padStart(6, '0')}`, lines: [line], firstLine: line, item: null, plant: upper(line.plant), quantity: finite(line.quantity), requirementDate: dateValue(line.created_at), emergency: upper(line.urgency) === 'EMERGENCY' });
      continue;
    }
    const candidate = requirements.find((requirement) => canClub(line, requirement, policy));
    if (candidate) {
      candidate.lines.push(line);
      candidate.quantity += finite(line.quantity);
      candidate.emergency ||= upper(line.urgency) === 'EMERGENCY';
    } else {
      requirements.push({ group_id: `REQ-${String(requirements.length + 1).padStart(6, '0')}`, lines: [line], firstLine: line, item: line.item, plant: upper(line.plant), quantity: finite(line.quantity), requirementDate: dateValue(line.created_at), emergency: upper(line.urgency) === 'EMERGENCY' });
    }
  }
  return requirements;
}

function inLookback(date, candidateDate, days) {
  const age = utcDayNumber(date) - utcDayNumber(candidateDate);
  return age >= 0 && age <= days;
}

function latestByDate(rows, field) { return [...rows].sort((left, right) => dateValue(right[field]) - dateValue(left[field]) || text(right.po_number).localeCompare(text(left.po_number))).at(0); }

function preferredSuppliers(requirement, data, policy) {
  if (!requirement.item) return [];
  const suppliers = data.suppliers.map(plain);
  const history = data.poHistory.map(plain).filter((row) => upper(row.item_code) === requirement.item.item_code && inLookback(requirement.requirementDate, row.po_date, policy.params.prefListDays));
  const contracts = data.contracts.map(plain).filter((contract) => dateValue(contract.start_date) <= requirement.requirementDate && contractLines(contract).some((line) => line.item_code === requirement.item.item_code));
  const supplierMap = suppliersById(suppliers);
  const ids = new Set(history.map((row) => upper(row.supplier_id)));
  contracts.forEach((contract) => ids.add(upper(contract.supplier_id)));
  const weights = policy.params.rankingWeights;
  const maxFrequency = Math.max(1, ...[...ids].map((id) => history.filter((row) => upper(row.supplier_id) === id).length));
  const ranked = [...ids].map((supplierId) => {
    const supplier = supplierMap.get(supplierId);
    if (!supplier || !activeSupplier(supplier)) return null;
    const supplierHistory = history.filter((row) => upper(row.supplier_id) === supplierId);
    const latestPo = latestByDate(supplierHistory, 'po_date');
    const heldContracts = contracts.filter((contract) => upper(contract.supplier_id) === supplierId && contractLines(contract).some((line) => line.item_code === requirement.item.item_code));
    const currentContract = heldContracts.find((contract) => dateValue(contract.start_date) <= requirement.requirementDate && dateValue(contract.end_date) >= requirement.requirementDate);
    const recencyDays = latestPo ? Math.max(0, utcDayNumber(requirement.requirementDate) - utcDayNumber(latestPo.po_date)) : null;
    const halfLife = Number(policy.params.recencyHalfLifeDays);
    const raw = {
      frequency: supplierHistory.length / maxFrequency,
      recency: recencyDays === null ? 0 : Math.exp(-Math.log(2) * recencyDays / halfLife),
      contract: currentContract ? 1 : (heldContracts.length ? 0.5 : 0),
      onTime: Math.max(0, Math.min(1, Number(supplier.on_time_pct || 0) / 100)),
      quality: Math.max(0, Math.min(1, Number(supplier.quality_rating || 0) / 5))
    };
    const weighted = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value * Number(weights[key] || 0) * 100]));
    const score = Object.values(weighted).reduce((total, value) => total + value, 0);
    const contractRate = [...heldContracts].sort((left, right) => dateValue(right.start_date) - dateValue(left.start_date)).flatMap((contract) => contractLines(contract).filter((line) => line.item_code === requirement.item.item_code).map((line) => ({ rate: Number(line.rate), start_date: contract.start_date }))).at(0)?.rate;
    const contractIds = heldContracts.map((contract) => upper(contract.contract_id)).sort();
    const explanation = `Ranked supplier: ${supplierHistory.length} POs in ${policy.params.prefListDays} days, ${recencyDays === null ? 'no recent PO' : `last bought ${recencyDays} days ago`}${contractIds.length ? `, held contract ${contractIds.join(', ')}` : ''}, ${Number(supplier.on_time_pct || 0)}% on-time`;
    return { supplier_id: supplierId, name: supplier.name, score: Math.round(score * 100) / 100, scoreBreakdown: { raw, weighted, frequencyCount: supplierHistory.length, recencyDays, contractIds, currentContract: Boolean(currentContract) }, latestPoPrice: latestPo ? finite(latestPo.unit_price) : null, referencePrice: latestPo ? finite(latestPo.unit_price) : (contractRate ?? null), explanation };
  }).filter(Boolean).sort((left, right) => right.score - left.score || right.scoreBreakdown.raw.frequency - left.scoreBreakdown.raw.frequency || (left.scoreBreakdown.raw.recencyDays ?? Infinity) - (right.scoreBreakdown.raw.recencyDays ?? Infinity) || left.supplier_id.localeCompare(right.supplier_id));
  return ranked.map((supplier, index) => ({ ...supplier, rank: index + 1, explanation: supplier.explanation.replace('Ranked supplier:', `Ranked ${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'}:`) }));
}

function applicableContracts(requirement, data, supplierMap, consumed) {
  if (!requirement.item) return { usable: null, fallback: null, all: [] };
  const candidates = data.contracts.map(plain).flatMap((contract) => {
    const supplier = supplierMap.get(upper(contract.supplier_id));
    if (!supplier || !activeSupplier(supplier) || dateValue(contract.start_date) > requirement.requirementDate || dateValue(contract.end_date) < requirement.requirementDate) return [];
    return contractLines(contract).filter((line) => line.item_code === requirement.item.item_code).map((line) => ({ contract, supplier, line, rate: finite(line.rate) }));
  }).filter((candidate) => candidate.rate !== null);
  const usable = candidates.filter((candidate) => (Number(consumed.get(candidate.contract.contract_id) ?? candidate.contract.consumed_value ?? 0) + requirement.quantity * candidate.rate) <= Number(candidate.contract.value_cap));
  const byRate = (left, right) => left.rate - right.rate || upper(left.contract.contract_id).localeCompare(upper(right.contract.contract_id));
  return { usable: usable.sort(byRate)[0] || null, fallback: candidates.sort(byRate)[0] || null, all: candidates };
}

function valuation(requirement, data, policy, contractChoice) {
  if (!requirement.item) {
    const unitPrice = finite(requirement.lines[0].estimated_unit_price);
    return { unitPrice, value: unitPrice === null ? null : requirement.quantity * unitPrice, source: 'requester estimate' };
  }
  if (contractChoice.usable) return { unitPrice: contractChoice.usable.rate, value: requirement.quantity * contractChoice.usable.rate, source: `contract ${contractChoice.usable.contract.contract_id}` };
  if (contractChoice.fallback) return { unitPrice: contractChoice.fallback.rate, value: requirement.quantity * contractChoice.fallback.rate, source: `lowest applicable contract rate ${contractChoice.fallback.contract.contract_id}` };
  const latestPo = data.poHistory.map(plain).filter((row) => upper(row.item_code) === requirement.item.item_code && inLookback(requirement.requirementDate, row.po_date, policy.params.valuationLookbackDays)).sort((left, right) => dateValue(right.po_date) - dateValue(left.po_date)).at(0);
  if (latestPo) return { unitPrice: finite(latestPo.unit_price), value: requirement.quantity * finite(latestPo.unit_price), source: `latest PO ${latestPo.po_number}` };
  const unitPrice = finite(requirement.item.standard_price);
  return { unitPrice, value: unitPrice === null ? null : requirement.quantity * unitPrice, source: 'item standard price' };
}

function getField(object, field) { return field.split('.').reduce((value, key) => value === null || value === undefined ? undefined : value[key], object); }
function conditionMatches(condition, facts) {
  const actual = getField(facts, condition.field);
  const expected = condition.value;
  switch (condition.op) {
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'lt': return actual < expected;
    case 'lte': return actual <= expected;
    case 'gt': return actual > expected;
    case 'gte': return actual >= expected;
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'not_in': return Array.isArray(expected) && !expected.includes(actual);
    case 'exists': return (actual !== undefined && actual !== null) === Boolean(expected);
    default: return false;
  }
}

export function evaluateRules(facts, policy, requirementDate) {
  return [...(policy.rules || [])].filter((rule) => (!rule.effectiveFrom || dateValue(rule.effectiveFrom) <= requirementDate) && (!rule.effectiveTo || dateValue(rule.effectiveTo) >= requirementDate)).sort((left, right) => Number(left.order) - Number(right.order) || text(left.id).localeCompare(text(right.id))).find((rule) => (rule.when || []).every((condition) => conditionMatches(condition, facts)));
}

function categorySuppliers(requirement, data, preferred) {
  const category = text(requirement.item?.category).toLowerCase();
  return data.suppliers.map(plain).filter((supplier) => activeSupplier(supplier) && (Array.isArray(supplier.categories) ? supplier.categories : [supplier.categories]).some((value) => text(value).toLowerCase() === category)).sort((left, right) => Number(right.on_time_pct || 0) + Number(right.quality_rating || 0) * 20 - Number(left.on_time_pct || 0) - Number(left.quality_rating || 0) * 20 || upper(left.supplier_id).localeCompare(upper(right.supplier_id))).filter((supplier) => !preferred.some((entry) => entry.supplier_id === upper(supplier.supplier_id)));
}

function chooseSupplier(requirement, outcome, preferred, data, valuationResult) {
  if (outcome.supplierStrategy === 'contract') return { supplier: requirement.contractChoice.usable.supplier, price: valuationResult.unitPrice, fallback: false };
  if (outcome.supplierStrategy === 'none') return { supplier: null, price: null, fallback: false };
  const pricedPreferred = preferred.find((supplier) => supplier.referencePrice !== null);
  if (pricedPreferred) return { supplier: data.suppliers.map(plain).find((supplier) => upper(supplier.supplier_id) === pricedPreferred.supplier_id), price: pricedPreferred.referencePrice, fallback: false };
  const categorySupplier = categorySuppliers(requirement, data, preferred)[0];
  if (categorySupplier) return { supplier: categorySupplier, price: finite(requirement.item?.standard_price) ?? valuationResult.unitPrice, fallback: true };
  const anyActive = data.suppliers.map(plain).filter(activeSupplier).sort((left, right) => upper(left.supplier_id).localeCompare(upper(right.supplier_id)))[0];
  return { supplier: anyActive || null, price: finite(requirement.item?.standard_price) ?? valuationResult.unitPrice, fallback: true };
}

function suggestions(outcome, preferred, requirement, data) {
  if (!outcome.suggestCount || !requirement.item) return [];
  const ids = preferred.map((supplier) => supplier.supplier_id);
  for (const supplier of categorySuppliers(requirement, data, preferred)) {
    if (ids.length >= outcome.suggestCount) break;
    ids.push(upper(supplier.supplier_id));
  }
  return ids.slice(0, outcome.suggestCount);
}

function consolidate(requirements) {
  const purchaseOrders = [];
  for (const requirement of requirements.filter((entry) => entry.outcome?.route?.endsWith('_PO'))) {
    const supplierId = upper(requirement.selectedSupplier?.supplier_id);
    const open = purchaseOrders.find((po) => po.supplier_id === supplierId && po.plant === requirement.plant && po.route === requirement.outcome.route && (dateValue(requirement.firstLine.created_at) - dateValue(po.firstRequirementCreatedAt)) <= requirement.policy.params.consolidationHours * 60 * 60 * 1000);
    if (open) {
      open.requirements.push(requirement.group_id);
      open.total_value += requirement.valuation.value;
      requirement.po_id = open.po_id;
    } else {
      const po = { po_id: `PO-${String(purchaseOrders.length + 1).padStart(6, '0')}`, supplier_id: supplierId || null, plant: requirement.plant, route: requirement.outcome.route, requirements: [requirement.group_id], total_value: requirement.valuation.value, firstRequirementCreatedAt: requirement.firstLine.created_at };
      purchaseOrders.push(po);
      requirement.po_id = po.po_id;
    }
  }
  return purchaseOrders.map((po) => ({ ...po, total_value: round(po.total_value) }));
}

function outputLine(line, requirement) {
  return { pr_no: line.pr_no, pr_line: line.pr_line, resolved_item_code: line.item?.item_code || 'NEW', group_id: requirement?.group_id || null, po_id: requirement?.po_id || null, decision: requirement?.outcome?.decision || 'NOT_PROCESSED', route: requirement?.outcome?.route || 'NOT_PROCESSED', supplier_id: requirement?.selectedSupplier ? upper(requirement.selectedSupplier.supplier_id) : null, unit_price: round(requirement?.selectedPrice ?? requirement?.valuation?.unitPrice), group_value_inr: round(requirement?.valuation?.value), suggested_supplier_ids: requirement?.suggestedSupplierIds?.join(';') || '', policy_version: requirement?.policy.version || null, reason: requirement?.reason || line.invalidReason };
}

export function runDecisionEngine(input) {
  const data = { prLines: (input.prLines || []).map(plain), items: (input.items || []).map(plain), suppliers: (input.suppliers || []).map(plain), poHistory: (input.poHistory || []).map(plain), contracts: (input.contracts || []).map(plain) };
  const initialPolicy = selectPolicy(input.policy, data.prLines.map((line) => dateValue(line.created_at)).sort((left, right) => left - right)[0] || input.policy.effectiveFrom);
  const validPlants = initialPolicy.plants || [];
  const seen = new Set();
  const lines = data.prLines.map((line) => {
    const match = itemMatch(line, data.items, initialPolicy);
    const normalized = { ...line, pr_no: text(line.pr_no), pr_line: Number(line.pr_line), plant: upper(line.plant), item: match.item, match, created_at: dateValue(line.created_at), need_by_date: validDate(line.need_by_date) ? dateValue(line.need_by_date) : null, quantity: finite(line.quantity), estimated_unit_price: finite(line.estimated_unit_price) };
    const key = `${normalized.pr_no}|${normalized.pr_line}`;
    normalized.invalidReason = seen.has(key) ? `duplicate PR line key ${key}` : null;
    seen.add(key);
    if (!normalized.invalidReason && validPlants.length && !validPlants.map(upper).includes(normalized.plant)) normalized.invalidReason = `unknown plant ${normalized.plant}`;
    if (!normalized.invalidReason && (normalized.quantity === null || normalized.quantity <= 0)) normalized.invalidReason = 'quantity must be greater than zero';
    if (!normalized.invalidReason && !normalized.item && (normalized.estimated_unit_price === null || normalized.estimated_unit_price < 0)) normalized.invalidReason = 'new item requires an estimated unit price';
    return normalized;
  }).sort(sortLines);
  const requirements = makeRequirements(lines, initialPolicy);
  const supplierMap = suppliersById(data.suppliers);
  const consumed = new Map(data.contracts.map((contract) => [upper(contract.contract_id), finite(contract.consumed_value) ?? 0]));
  for (const requirement of requirements.sort(sortRequirements)) {
    requirement.policy = selectPolicy(input.policy, requirement.requirementDate);
    requirement.policyVersion = requirement.policy.version;
    requirement.contractChoice = applicableContracts(requirement, data, supplierMap, consumed);
    requirement.valuation = valuation(requirement, data, requirement.policy, requirement.contractChoice);
    if (requirement.contractChoice.usable) consumed.set(upper(requirement.contractChoice.usable.contract.contract_id), (consumed.get(upper(requirement.contractChoice.usable.contract.contract_id)) || 0) + requirement.valuation.value);
    requirement.preferredSuppliers = preferredSuppliers(requirement, data, requirement.policy);
    const boughtFromActiveSupplierInLookback = requirement.item ? data.poHistory.some((row) => inLookback(requirement.requirementDate, row.po_date, requirement.policy.params.valuationLookbackDays) && upper(row.item_code) === requirement.item.item_code && activeSupplier(supplierMap.get(upper(row.supplier_id)))) : false;
    const facts = { item: { type: requirement.item?.item_type, category: requirement.item?.category }, plant: requirement.plant, value: requirement.valuation.value, isEmergency: requirement.emergency, hasUsableContract: Boolean(requirement.contractChoice.usable), boughtFromActiveSupplierInLookback, isNewItem: !requirement.item };
    requirement.facts = facts;
    requirement.rule = evaluateRules(facts, requirement.policy, requirement.requirementDate) || { id: 'NO_RULE', outcome: { decision: 'NOT_PROCESSED', route: 'NOT_PROCESSED', supplierStrategy: 'none', suggestCount: 0 } };
    requirement.outcome = requirement.rule.outcome;
    requirement.suggestedSupplierIds = suggestions(requirement.outcome, requirement.preferredSuppliers, requirement, data);
    const selection = chooseSupplier(requirement, requirement.outcome, requirement.preferredSuppliers, data, requirement.valuation);
    requirement.selectedSupplier = selection.supplier;
    requirement.selectedPrice = selection.price;
    const supplierClause = requirement.selectedSupplier ? ` supplier ${upper(requirement.selectedSupplier.supplier_id)}` : '';
    const fallbackClause = selection.fallback ? ' fallback supplier/price used' : '';
    const suggestionClause = requirement.suggestedSupplierIds.length ? ` suggestions ${requirement.suggestedSupplierIds.join(',')}` : '';
    requirement.reason = `${requirement.rule.id}: ${requirement.valuation.source};${supplierClause}${fallbackClause}${suggestionClause}`.trim();
  }
  const purchaseOrders = consolidate(requirements);
  const sourcingRequests = requirements.filter((requirement) => requirement.outcome?.route && !requirement.outcome.route.endsWith('_PO')).map((requirement, index) => ({ request_id: `SR-${String(index + 1).padStart(6, '0')}`, group_id: requirement.group_id, route: requirement.outcome.route, suggested_supplier_ids: requirement.suggestedSupplierIds }));
  purchaseOrders.forEach((po) => po.requirements.forEach((groupId) => { const requirement = requirements.find((entry) => entry.group_id === groupId); if (requirement) requirement.reason += `; PO relied on ${po.po_id}`; }));
  const requirementByLine = new Map(requirements.flatMap((requirement) => requirement.lines.map((line) => [`${line.pr_no}|${line.pr_line}`, requirement])));
  const decisions = lines.map((line) => outputLine(line, requirementByLine.get(`${line.pr_no}|${line.pr_line}`)));
  return { decisions, requirements: requirements.map((requirement) => ({ ...requirement, value: round(requirement.valuation.value), unit_price: round(requirement.valuation.unitPrice), preferredSuppliers: requirement.preferredSuppliers })), purchaseOrders, sourcingRequests };
}

export { itemMatch, makeRequirements, preferredSuppliers, applicableContracts, valuation, conditionMatches, consolidate };
