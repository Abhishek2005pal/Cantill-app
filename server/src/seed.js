import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import mongoose from 'mongoose';
import { Contract, Item, Plant, PoHistory, Policy, Supplier } from './models/index.js';
import { policyV5 } from './engine/policy.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const report = { generated_at: new Date().toISOString(), source_directory: null, counts: {}, problems: [] };
const required = {
  item_master: ['item_code', 'description', 'uom', 'category', 'item_type', 'standard_price'],
  supplier_master: ['supplier_id', 'name', 'status'],
  plants: ['plant', 'name'],
  po_history: ['po_number', 'po_date', 'supplier_id', 'item_code', 'quantity', 'uom', 'unit_price', 'plant'],
  contract_register: ['contract_id', 'supplier_id', 'start_date', 'end_date', 'value_cap', 'consumed_value'],
  contract_lines: ['contract_id', 'item_code', 'description', 'uom', 'rate']
};

const addProblem = (file, row, message) => report.problems.push({ file, row, message });
const clean = (value) => typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim() : value;
const code = (value) => clean(value)?.toUpperCase() || '';
const number = (value, file, row, field) => {
  if (clean(value) === '' || clean(value) === undefined) return null;
  const parsed = Number(clean(value));
  if (!Number.isFinite(parsed)) {
    addProblem(file, row, `Invalid number in ${field}: ${value}`);
    return null;
  }
  return parsed;
};
const date = (value, file, row, field) => {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(parsed.getTime())) {
    addProblem(file, row, `Invalid date in ${field}: ${value}`);
    return null;
  }
  return parsed;
};

async function findKit() {
  const candidates = [process.env.KIT_DIR, '/kit', '/app/kit', path.resolve(rootDir, 'kit'), path.resolve(rootDir, '..', 'Cantill_FullStack_Task_Kit')].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, 'master_data'));
      return path.resolve(candidate);
    } catch { /* try next candidate */ }
  }
  throw new Error(`Kit not found. Checked: ${candidates.join(', ')}`);
}

async function readCsv(filePath, kind) {
  const file = path.basename(filePath);
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    addProblem(file, 0, `Could not read file: ${error.message}`);
    return [];
  }
  try {
    const rows = parse(content, { columns: (headers) => headers.map((header) => clean(header)), skip_empty_lines: true, trim: true, relax_column_count: true });
    const expected = required[kind] || [];
    rows.forEach((row, index) => expected.filter((field) => clean(row[field]) === '').forEach((field) => addProblem(file, index + 2, `Missing value in ${field}`)));
    return rows;
  } catch (error) {
    addProblem(file, 0, `CSV parse error: ${error.message}`);
    return [];
  }
}

const unique = (rows, key, file) => {
  const seen = new Set();
  return rows.filter((row, index) => {
    const value = row[key];
    if (seen.has(value)) {
      addProblem(file, index + 2, `Duplicate ${key}: ${value}`);
      return false;
    }
    seen.add(value);
    return true;
  });
};

export async function seed() {
  const kitDir = await findKit();
  report.source_directory = kitDir;
  const [itemRows, supplierRows, plantRows, poRows, registerRows, lineRows] = await Promise.all([
    readCsv(path.join(kitDir, 'master_data', 'item_master.csv'), 'item_master'),
    readCsv(path.join(kitDir, 'master_data', 'supplier_master.csv'), 'supplier_master'),
    readCsv(path.join(kitDir, 'master_data', 'plants.csv'), 'plants'),
    readCsv(path.join(kitDir, 'master_data', 'po_history.csv'), 'po_history'),
    readCsv(path.join(kitDir, 'contracts', 'contract_register.csv'), 'contract_register'),
    readCsv(path.join(kitDir, 'contracts', 'contract_lines.csv'), 'contract_lines')
  ]);
  const items = unique(itemRows.map((row) => ({ item_code: code(row.item_code), description: clean(row.description), uom: code(row.uom), category: clean(row.category), item_type: clean(row.item_type), standard_price: number(row.standard_price, 'item_master.csv', 0, 'standard_price') })), 'item_code', 'item_master.csv');
  const suppliers = unique(supplierRows.map((row) => ({ supplier_id: code(row.supplier_id), name: clean(row.name), city: clean(row.city), categories: clean(row.categories)?.split(/[;|]/).map((value) => value.trim()).filter(Boolean) || [], status: clean(row.status), on_time_pct: number(row.on_time_pct, 'supplier_master.csv', 0, 'on_time_pct'), quality_rating: number(row.quality_rating, 'supplier_master.csv', 0, 'quality_rating') })), 'supplier_id', 'supplier_master.csv');
  const plants = unique(plantRows.map((row) => ({ plant: code(row.plant), name: clean(row.name) })), 'plant', 'plants.csv');
  const poHistory = poRows.map((row, index) => ({ po_number: clean(row.po_number), po_date: date(row.po_date, 'po_history.csv', index + 2, 'po_date'), supplier_id: code(row.supplier_id), item_code: code(row.item_code), quantity: number(row.quantity, 'po_history.csv', index + 2, 'quantity'), uom: code(row.uom), unit_price: number(row.unit_price, 'po_history.csv', index + 2, 'unit_price'), plant: code(row.plant), delivered_on_time: ['true', '1', 'yes'].includes(String(row.delivered_on_time).toLowerCase()) }));
  const linesByContract = new Map();
  lineRows.forEach((row, index) => {
    const line = { contract_id: code(row.contract_id), item_code: code(row.item_code), description: clean(row.description), uom: code(row.uom), rate: number(row.rate, 'contract_lines.csv', index + 2, 'rate') };
    const lines = linesByContract.get(line.contract_id) || [];
    lines.push(line);
    linesByContract.set(line.contract_id, lines);
  });
  const contracts = unique(registerRows.map((row, index) => ({ contract_id: code(row.contract_id), supplier_id: code(row.supplier_id), supplier_name: clean(row.supplier_name), start_date: date(row.start_date, 'contract_register.csv', index + 2, 'start_date'), end_date: date(row.end_date, 'contract_register.csv', index + 2, 'end_date'), value_cap: number(row.value_cap, 'contract_register.csv', index + 2, 'value_cap'), consumed_value: number(row.consumed_value, 'contract_register.csv', index + 2, 'consumed_value'), source: 'REGISTER', status: 'IMPORTED', lines: linesByContract.get(code(row.contract_id)) || [] })), 'contract_id', 'contract_register.csv');
  await Promise.all([Item.deleteMany({}), Supplier.deleteMany({}), Plant.deleteMany({}), PoHistory.deleteMany({}), Contract.deleteMany({}), Policy.deleteMany({})]);
  await Promise.all([Item.insertMany(items), Supplier.insertMany(suppliers), Plant.insertMany(plants), PoHistory.insertMany(poHistory), Contract.insertMany(contracts), Policy.create({ ...policyV5, status: 'ACTIVE', createdBy: 'seed', sourceDocument: 'Corvo_Procurement_Policy.pdf' })]);
  report.counts = { items: items.length, suppliers: suppliers.length, plants: plants.length, po_history: poHistory.length, contracts: contracts.length, contract_lines: lineRows.length };
  await fs.writeFile(path.join(rootDir, 'data-quality-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/cantill';
  mongoose.connect(uri).then(async () => {
    const result = await seed();
    console.log(`Seeded ${JSON.stringify(result.counts)} with ${result.problems.length} data problems.`);
    await mongoose.disconnect();
  }).catch(async (error) => {
    console.error('Seed failed:', error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
