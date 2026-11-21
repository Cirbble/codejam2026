// SQLite access layer. Uses Node's built-in node:sqlite (no native build step),
// WAL mode, foreign keys on. All money is stored as REAL rounded to cents at write time.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = undefined; }
}

// Tiny helpers so call sites stay readable.
export const all = (sql, ...p) => getDb().prepare(sql).all(...p);
export const get = (sql, ...p) => getDb().prepare(sql).get(...p);
export const run = (sql, ...p) => getDb().prepare(sql).run(...p);

export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function insert(table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return getDb().prepare(sql).run(...keys.map((k) => norm(row[k])));
}

export function update(table, idCol, id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${idCol} = ?`;
  return getDb().prepare(sql).run(...keys.map((k) => norm(patch[k])), id);
}

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  department_id TEXT PRIMARY KEY, name TEXT NOT NULL, cost_centre TEXT,
  annual_budget_cad REAL, manager_user_id TEXT
);
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT, title TEXT,
  department_id TEXT REFERENCES departments(department_id), manager_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('employee','ap_clerk','approver','finance_manager','controller_admin','auditor')),
  approval_limit_cad REAL DEFAULT 0, work_province TEXT,
  status TEXT NOT NULL DEFAULT 'active', status_since TEXT, delegate_user_id TEXT, hire_date TEXT
);
-- Explicit, dated delegations. Seeded from users.on_leave + delegate_user_id; approvers add their own.
CREATE TABLE IF NOT EXISTS delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, delegate_user_id TEXT NOT NULL,
  starts_on TEXT NOT NULL, ends_on TEXT, reason TEXT, created_by TEXT, created_at TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS gl_accounts (
  account_number TEXT PRIMARY KEY, name TEXT, account_type TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS tax_codes (
  code TEXT PRIMARY KEY, description TEXT, rate REAL, applies_to TEXT, recoverable TEXT, gl_account TEXT
);
CREATE TABLE IF NOT EXISTS vendors (
  vendor_id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, category TEXT, default_gl_account TEXT,
  address TEXT, province_or_state TEXT, country TEXT, gst_hst_number TEXT, qst_number TEXT,
  payment_terms_days INTEGER, early_pay_discount TEXT, preferred_payment_method TEXT,
  accepts_card_payment INTEGER, bank_institution TEXT, bank_transit TEXT, bank_account TEXT,
  bank_details_updated_at TEXT, ap_contact_email TEXT, requires_po INTEGER,
  status TEXT NOT NULL DEFAULT 'active', onboarded_at TEXT, currency TEXT DEFAULT 'CAD',
  created_by TEXT, notes TEXT
);
-- Every bank-detail change is a controlled, two-person action: requested -> verified -> approved.
CREATE TABLE IF NOT EXISTS bank_changes (
  change_id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id),
  changed_at TEXT, changed_by_user_id TEXT, request_channel TEXT, verified_by_callback TEXT,
  old_account_last4 TEXT, new_account_last4 TEXT,
  new_institution TEXT, new_transit TEXT, new_account TEXT,
  status TEXT NOT NULL DEFAULT 'applied', approved_by TEXT, approved_at TEXT, callback_note TEXT,
  risk_score INTEGER, risk_reasons TEXT
);
CREATE TABLE IF NOT EXISTS contracts (
  contract_id TEXT PRIMARY KEY, vendor_id TEXT, description TEXT, billing_type TEXT, monthly_fee REAL,
  currency TEXT, hourly_rate_cap REAL, fuel_surcharge_cap_pct REAL, not_to_exceed_monthly REAL,
  start_date TEXT, end_date TEXT, auto_renew TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  po_id TEXT PRIMARY KEY, vendor_id TEXT, department_id TEXT, requester_user_id TEXT, issue_date TEXT,
  description TEXT, total_amount REAL, currency TEXT, status TEXT, approved_by TEXT
);
CREATE TABLE IF NOT EXISTS fx_rates (date TEXT PRIMARY KEY, usd_to_cad REAL);
CREATE TABLE IF NOT EXISTS emails (
  email_id TEXT PRIMARY KEY, from_name TEXT, from_address TEXT, to_address TEXT, subject TEXT,
  received_at TEXT, body TEXT, attachments TEXT,
  classification TEXT, classification_reason TEXT, matched_vendor_id TEXT,
  status TEXT DEFAULT 'new', processed_at TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  doc_id TEXT PRIMARY KEY, filename TEXT, mime TEXT, sha256 TEXT, size INTEGER, storage_path TEXT,
  source TEXT, email_id TEXT, uploaded_by TEXT, uploaded_at TEXT,
  extraction_method TEXT, extraction_confidence REAL, raw_text TEXT, extraction TEXT, extraction_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);
CREATE TABLE IF NOT EXISTS invoices (
  invoice_id TEXT PRIMARY KEY, vendor_id TEXT, vendor_invoice_number TEXT, invoice_number_norm TEXT,
  doc_type TEXT NOT NULL DEFAULT 'invoice', credit_note_ref TEXT,
  invoice_date TEXT, received_date TEXT, due_date TEXT, terms_text TEXT,
  currency TEXT DEFAULT 'CAD', subtotal REAL, gst_hst_amount REAL DEFAULT 0, pst_qst_amount REAL DEFAULT 0,
  total REAL, fx_rate_to_cad REAL DEFAULT 1, total_cad REAL,
  department_id TEXT, requester_user_id TEXT, po_id TEXT, contract_id TEXT, ship_to_province TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'history', doc_id TEXT, email_id TEXT,
  extracted_vendor_name TEXT, extracted_vendor_tax_id TEXT, extracted_qst_number TEXT,
  extracted_bank TEXT, bill_to_address TEXT, payment_instructions TEXT,
  vendor_match_method TEXT, vendor_match_score REAL,
  recommendation TEXT, risk_score INTEGER,
  created_at TEXT, updated_at TEXT, submitted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_vendor ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_inv_norm ON invoices(invoice_number_norm);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
  line_no INTEGER, description TEXT, quantity REAL, unit_price REAL, amount REAL,
  gl_account TEXT, department_id TEXT, gst_hst_code TEXT, pst_qst_code TEXT, line_type TEXT,
  suggested_gl TEXT, suggested_department TEXT, coding_confidence REAL, coding_reason TEXT, coding_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_lines_inv ON invoice_lines(invoice_id);
-- Tax amounts as captured, mapped to a tax code.
CREATE TABLE IF NOT EXISTS invoice_taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
  code TEXT, label TEXT, rate REAL, amount REAL
);
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
  code TEXT NOT NULL, category TEXT, severity TEXT NOT NULL CHECK (severity IN ('block','warn','info')),
  title TEXT NOT NULL, detail TEXT, evidence TEXT, related_id TEXT,
  status TEXT NOT NULL DEFAULT 'open', resolved_by TEXT, resolved_at TEXT, resolution_note TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_flags_inv ON flags(invoice_id);
-- Structured, editable approval & payment rules (seeded from approval_policies.csv).
CREATE TABLE IF NOT EXISTS policies (
  rule_id TEXT PRIMARY KEY, rule_type TEXT, kind TEXT, min_amount_cad REAL, max_amount_cad REAL,
  chain TEXT, param TEXT, condition_text TEXT, required_text TEXT, notes TEXT, active INTEGER DEFAULT 1,
  sort INTEGER, updated_by TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
  step_no INTEGER, approver_user_id TEXT, approver_role TEXT, rule_id TEXT, reason TEXT,
  assigned_user_id TEXT, on_behalf_of_user_id TEXT,
  action TEXT NOT NULL DEFAULT 'pending', acted_at TEXT, comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_appr_inv ON approvals(invoice_id);
CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY, invoice_id TEXT REFERENCES invoices(invoice_id), vendor_id TEXT,
  method TEXT, scheduled_date TEXT, paid_date TEXT, currency TEXT, amount REAL, fx_rate_to_cad REAL,
  amount_cad REAL, discount_taken REAL DEFAULT 0, reference TEXT, status TEXT,
  prepared_by TEXT, released_by TEXT, released_at TEXT, prepared_at TEXT,
  bank_snapshot TEXT, card_last4 TEXT, failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_inv ON payments(invoice_id);
CREATE TABLE IF NOT EXISTS bank_statement (
  bank_txn_id TEXT PRIMARY KEY, posted_date TEXT, description TEXT, debit REAL, credit REAL,
  match_payment_id TEXT, match_method TEXT, match_note TEXT
);
CREATE TABLE IF NOT EXISTS card_transactions (
  txn_id TEXT PRIMARY KEY, card_id TEXT, cardholder_user_id TEXT, posted_date TEXT,
  merchant_descriptor TEXT, mcc TEXT, amount REAL, currency TEXT, amount_cad REAL,
  source TEXT, receipt_attached TEXT, memo TEXT, vendor_id TEXT, invoice_id TEXT
);
-- Append-only, hash-chained audit log. Each row's hash covers the previous row's hash.
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor_user_id TEXT, actor_role TEXT,
  on_behalf_of_user_id TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  invoice_id TEXT, details TEXT, prev_hash TEXT, hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_inv ON audit_log(invoice_id);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sequences (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
`;

export function nextId(name, prefix, width = 5) {
  const d = getDb();
  const row = d.prepare('SELECT value FROM sequences WHERE name = ?').get(name);
  const v = (row ? row.value : 0) + 1;
  d.prepare('INSERT INTO sequences(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, v);
  return `${prefix}${String(v).padStart(width, '0')}`;
}

export function setSequenceAtLeast(name, v) {
  const d = getDb();
  const row = d.prepare('SELECT value FROM sequences WHERE name = ?').get(name);
  if (!row || row.value < v) d.prepare('INSERT INTO sequences(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, v);
}
