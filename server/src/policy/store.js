import { Policy, PolicyChange } from '../models/index.js';
import { diffPolicy, policyFor } from './diff.js';
import { validatePolicy } from './schema.js';

export async function activePolicyFor(asOf = new Date()) {
  return policyFor(await Policy.find({ status: 'ACTIVE' }).lean(), asOf);
}

export async function proposePolicy(proposedPolicy, metadata = {}) {
  const validated = validatePolicy({ ...proposedPolicy, status: 'DRAFT', createdBy: metadata.submittedBy, sourceDocument: metadata.sourceDocument });
  const current = await activePolicyFor(validated.effectiveFrom);
  const policyDiff = diffPolicy(current, validated);
  return PolicyChange.create({ proposedPolicy: validated, diff: policyDiff, plainLanguageSummary: policyDiff.summary, status: 'PENDING', effectiveFrom: validated.effectiveFrom, submittedBy: metadata.submittedBy, sourceDocument: metadata.sourceDocument });
}

export async function approvePolicyChange(id, approvedBy, effectiveFrom) {
  const change = await PolicyChange.findById(id);
  if (!change || change.status !== 'PENDING') throw new Error('Pending policy change not found');
  const nextEffectiveFrom = new Date(effectiveFrom || change.effectiveFrom);
  if (Number.isNaN(nextEffectiveFrom.getTime())) throw new Error('Invalid effectiveFrom');
  const proposed = validatePolicy({ ...change.proposedPolicy, status: 'ACTIVE', effectiveFrom: nextEffectiveFrom.toISOString() });
  await Policy.updateMany({ status: 'ACTIVE', effectiveFrom: { $gte: nextEffectiveFrom } }, { $set: { status: 'SUPERSEDED' } });
  await Policy.create({ ...proposed, approvedBy, approvedAt: new Date() });
  change.status = 'APPROVED';
  change.approvedBy = approvedBy;
  change.approvedAt = new Date();
  change.effectiveFrom = nextEffectiveFrom;
  await change.save();
  return change;
}

export async function rejectPolicyChange(id, reason, approvedBy) {
  const change = await PolicyChange.findById(id);
  if (!change || change.status !== 'PENDING') throw new Error('Pending policy change not found');
  change.status = 'REJECTED';
  change.rejectionReason = reason;
  change.approvedBy = approvedBy;
  change.approvedAt = new Date();
  return change.save();
}
