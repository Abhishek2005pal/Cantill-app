import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Contract, Item, PoHistory, Supplier } from '../models/index.js';
import { runDecisionEngine } from './index.js';
import { policyV5 } from './policy.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kitDir = process.env.KIT_DIR || path.resolve(serverDir, '..', 'kit');
const parseNumber = (value) => value === '' || value === undefined ? null : Number(value);
const readPrLines = async () => {
  const content = await fs.readFile(path.join(kitDir, 'pr_batches', 'sample_pr_batch.csv'), 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true }).map((row) => ({
    ...row,
    pr_line: Number(row.pr_line),
    quantity: parseNumber(row.quantity),
    estimated_unit_price: parseNumber(row.estimated_unit_price),
    created_at: row.created_at,
    need_by_date: row.need_by_date
  }));
};

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/cantill';
await mongoose.connect(uri);
try {
  const result = runDecisionEngine({ prLines: await readPrLines(), items: await Item.find().lean(), suppliers: await Supplier.find().lean(), poHistory: await PoHistory.find().lean(), contracts: await Contract.find().lean(), policy: policyV5 });
  const routeDistribution = result.decisions.reduce((counts, decision) => ({ ...counts, [decision.route]: (counts[decision.route] || 0) + 1 }), {});
  const suspicious = result.decisions.filter((decision) => decision.route === 'NOT_PROCESSED' || decision.resolved_item_code === 'NEW').map((decision) => ({ pr_no: decision.pr_no, pr_line: decision.pr_line, route: decision.route, reason: decision.reason }));
  console.log(JSON.stringify({ inputLines: result.decisions.length, routeDistribution, requirements: result.requirements.length, purchaseOrders: result.purchaseOrders.length, sourcingRequests: result.sourcingRequests.length, suspicious }, null, 2));
} finally {
  await mongoose.disconnect();
}
