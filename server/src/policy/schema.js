import { z } from 'zod';

const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'not_in', 'exists']),
  value: z.unknown()
}).strict();

const outcomeSchema = z.object({
  decision: z.string().min(1), route: z.string().min(1), supplierStrategy: z.string().min(1),
  suggestCount: z.number().int().min(0), requiresApproval: z.boolean().optional()
}).strict();

export const ruleSchema = z.object({
  id: z.string().min(1), order: z.number().int(), when: z.array(conditionSchema), outcome: outcomeSchema,
  effectiveFrom: z.string().datetime({ offset: true }).optional(), effectiveTo: z.string().datetime({ offset: true }).optional()
}).strict();

export const policySchema = z.object({
  version: z.string().min(1), effectiveFrom: z.string().datetime({ offset: true }), status: z.enum(['DRAFT', 'ACTIVE', 'SUPERSEDED']),
  plants: z.array(z.string().min(1)).optional(), matching: z.object({ minimumConfidence: z.number().min(0).max(1) }).strict().optional(),
  params: z.object({
    clubDays: z.number().nonnegative(), needByDays: z.number().nonnegative(), prefListDays: z.number().nonnegative(), recencyHalfLifeDays: z.number().positive(),
    valuationLookbackDays: z.number().nonnegative(), consolidationHours: z.number().nonnegative(),
    rankingWeights: z.object({ frequency: z.number().nonnegative(), recency: z.number().nonnegative(), contract: z.number().nonnegative(), onTime: z.number().nonnegative(), quality: z.number().nonnegative() }).strict()
  }).strict(),
  rules: z.array(ruleSchema), createdBy: z.string().optional(), createdAt: z.string().datetime({ offset: true }).optional(), sourceDocument: z.string().optional()
}).strict().superRefine((policy, context) => {
  const orders = policy.rules.map((rule) => rule.order);
  if (new Set(orders).size !== orders.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rules'], message: 'rule order must not contain duplicates' });
});

export function validatePolicy(input) {
  return policySchema.parse(input);
}
