import mongoose from 'mongoose';

const { Schema } = mongoose;
const code = { type: String, trim: true, uppercase: true };
const date = { type: Date };

const itemSchema = new Schema({ item_code: { ...code, required: true, unique: true }, description: { type: String, required: true, trim: true }, uom: { ...code, required: true }, category: { type: String, required: true, trim: true }, item_type: { type: String, required: true, trim: true }, standard_price: { type: Number, required: true, min: 0 } }, { timestamps: true });
const supplierSchema = new Schema({ supplier_id: { ...code, required: true, unique: true }, name: { type: String, required: true, trim: true }, city: String, categories: [String], status: { type: String, required: true, trim: true }, on_time_pct: Number, quality_rating: Number }, { timestamps: true });
const plantSchema = new Schema({ plant: { ...code, required: true, unique: true }, name: { type: String, required: true, trim: true } }, { timestamps: true });
const poHistorySchema = new Schema({ po_number: { type: String, required: true, trim: true }, po_date: date, supplier_id: code, item_code: code, quantity: Number, uom: code, unit_price: Number, plant: code, delivered_on_time: Boolean }, { timestamps: true });
const contractLineSchema = new Schema({ contract_id: code, item_code: code, description: String, uom: code, rate: Number }, { _id: false });
const contractSchema = new Schema({ contract_id: { ...code, required: true, unique: true }, supplier_id: code, supplier_name: String, start_date: date, end_date: date, value_cap: Number, consumed_value: Number, source: { type: String, enum: ['REGISTER', 'PDF'], required: true }, status: String, lines: [contractLineSchema] }, { timestamps: true });
const prLineSchema = new Schema({ batchId: { type: String, index: true }, pr_no: code, pr_line: Number, created_at: date, requester: String, department: String, plant: code, item_code: code, description: String, quantity: Number, uom: code, estimated_unit_price: Number, need_by_date: date, urgency: String }, { timestamps: true });
const requirementSchema = new Schema({ batchId: { type: String, index: true }, requirement_id: { type: String, unique: true }, group_id: String, lines: [{ type: Schema.Types.ObjectId, ref: 'PrLine' }], plant: code, item_code: code, requirement_date: date, value: Number, unit_price: Number, emergency: Boolean, route: String, decision: String, supplier_id: code, suggested_supplier_ids: [String], policy_version: String, reason: String, status: { type: String, default: 'PENDING' } }, { timestamps: true });
const decisionSchema = new Schema({ batchId: { type: String, index: true }, pr_line: { type: Schema.Types.ObjectId, ref: 'PrLine' }, requirement: { type: Schema.Types.ObjectId, ref: 'Requirement' }, route: String, decision: String, supplier_id: code, unit_price: Number, group_value_inr: Number, suggested_supplier_ids: [String], policy_version: String, reason: String }, { timestamps: true });
const purchaseOrderSchema = new Schema({ batchId: { type: String, index: true }, po_id: { type: String, unique: true }, supplier_id: code, plant: code, route: String, lines: [{ type: Schema.Types.ObjectId, ref: 'Decision' }], requirements: [String], total_value: Number, status: String }, { timestamps: true });
const sourcingRequestSchema = new Schema({ batchId: { type: String, index: true }, request_id: { type: String, unique: true }, route: String, lines: [{ type: Schema.Types.ObjectId, ref: 'Decision' }], suggested_supplier_ids: [String], status: String }, { timestamps: true });
const policySchema = new Schema({ version: { type: String, required: true, unique: true }, effectiveFrom: { type: Date, required: true }, status: { type: String, enum: ['DRAFT', 'ACTIVE', 'SUPERSEDED'], required: true }, params: { type: Schema.Types.Mixed, required: true }, rules: { type: [Schema.Types.Mixed], required: true }, plants: [String], matching: Schema.Types.Mixed, createdBy: String, sourceDocument: String, approvedBy: String, approvedAt: date }, { timestamps: true, strict: true });
const policyChangeSchema = new Schema({ proposedPolicy: { type: Schema.Types.Mixed, required: true }, diff: { type: Schema.Types.Mixed, required: true }, plainLanguageSummary: { type: [String], default: [] }, status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], required: true }, effectiveFrom: { type: Date, required: true }, approvedBy: String, approvedAt: date, submittedBy: String, sourceDocument: String, rejectionReason: String }, { timestamps: true, strict: true });
const auditLogSchema = new Schema({ who: String, when: date, action: String, entity: String, entity_id: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed, comment: String, actor: String, entity_type: String, details: Schema.Types.Mixed }, { timestamps: true });
const chatSessionSchema = new Schema({ session_id: { type: String, unique: true }, requester: String, slots: Schema.Types.Mixed, messages: [{ role: String, content: String, created_at: date }], status: String }, { timestamps: true });

export const Item = mongoose.models.Item || mongoose.model('Item', itemSchema);
export const Supplier = mongoose.models.Supplier || mongoose.model('Supplier', supplierSchema);
export const Plant = mongoose.models.Plant || mongoose.model('Plant', plantSchema);
export const PoHistory = mongoose.models.PoHistory || mongoose.model('PoHistory', poHistorySchema);
export const Contract = mongoose.models.Contract || mongoose.model('Contract', contractSchema);
export const PrLine = mongoose.models.PrLine || mongoose.model('PrLine', prLineSchema);
export const Requirement = mongoose.models.Requirement || mongoose.model('Requirement', requirementSchema);
export const Decision = mongoose.models.Decision || mongoose.model('Decision', decisionSchema);
export const PurchaseOrder = mongoose.models.PurchaseOrder || mongoose.model('PurchaseOrder', purchaseOrderSchema);
export const SourcingRequest = mongoose.models.SourcingRequest || mongoose.model('SourcingRequest', sourcingRequestSchema);
export const Policy = mongoose.models.Policy || mongoose.model('Policy', policySchema);
export const PolicyChange = mongoose.models.PolicyChange || mongoose.model('PolicyChange', policyChangeSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export const ChatSession = mongoose.models.ChatSession || mongoose.model('ChatSession', chatSessionSchema);