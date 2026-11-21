// REST API. Every route declares the capability it needs (requirePerm) and, for record-level
// actions, re-checks scope and separation of duties against the database before acting.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, update, insert, nextId, tx } from './db.js';
import { config, nowIso, today } from './config.js';
import {
  requirePerm, can, permissionsFor, signToken, invoiceScope, assertSeeInvoice, approvalDecision, currentStep, Forbidden, assert, actingFor,
} from './policy.js';
import { audit, verifyChain } from './services/audit.js';
import { ingestFile, processInbox, recompute, classifyEmail, paymentInquiryAnswer } from './services/ingest.js';
import { suggestLine, invalidateCodingIndex, evaluateCoding } from './services/coding.js';
import { lookalikes, masterHealth, vendorStats } from './services/vendors.js';
import { buildRoute, describeRoute, roleLabel, releaseRolesFor, activeDelegation } from './services/routing.js';
import { bestPayDay, recommend } from './services/insights.js';
import { preparePayment, releasePayment, cancelPayment, paymentsDashboard, settleDue, eftFile } from './services/payments.js';
import { reconcile } from './services/recon.js';
import { journalCsv, journal, analytics, ask } from './services/reports.js';
import { llmStats } from './services/extract.js';
import { fxRate } from './services/checks.js';
import { toCsv, round2, normInvoiceNumber, money } from './util.js';
import { seedHistory } from './seed.js';

export const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 100 } });
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const userName = (id) => (id ? get('SELECT full_name FROM users WHERE user_id = ?', id)?.full_name || id : null);

// ---------- auth ----------
api.get('/auth/users', (_req, res) => {
  res.json(all(`SELECT u.user_id, u.full_name, u.title, u.role, u.department_id, d.name department, u.status, u.approval_limit_cad FROM users u LEFT JOIN departments d ON d.department_id = u.department_id WHERE u.status != 'terminated' ORDER BY u.user_id`));
});
api.post('/auth/login', (req, res) => {
  const u = get('SELECT * FROM users WHERE user_id = ?', req.body?.user_id);
  if (!u || u.status === 'terminated') throw bad('Unknown or inactive user', 401);
  audit({ actor: u, action: 'auth.login', entityType: 'user', entityId: u.user_id, details: {} });
  res.json({ token: signToken(u.user_id), user: me(u) });
});
api.use((req, _res, next) => (req.user ? next() : next(bad('Sign in first', 401))));

function me(u) {
  const del = activeDelegation(u.user_id);
  const actingForIds = actingFor(u).filter((x) => x !== u.user_id);
  return {
    ...u, department: get('SELECT name FROM departments WHERE department_id = ?', u.department_id)?.name, permissions: permissionsFor(u.role),
    away: del ? { delegate: userName(del.delegate_user_id), delegate_user_id: del.delegate_user_id, since: del.starts_on, until: del.ends_on } : null,
    acting_for: actingForIds.map((id) => ({ user_id: id, name: userName(id) })),
  };
}
api.get('/me', (req, res) => res.json(me(req.user)));

api.get('/meta', (_req, res) => {
  res.json({
    gl_accounts: all('SELECT * FROM gl_accounts ORDER BY account_number'),
    departments: all('SELECT * FROM departments ORDER BY department_id'),
    tax_codes: all('SELECT * FROM tax_codes'),
    users: all('SELECT user_id, full_name, role, department_id, status, title FROM users ORDER BY full_name'),
    vendors: all('SELECT vendor_id, legal_name, status, category FROM vendors ORDER BY legal_name'),
    llm: llmStats(), today: today(),
  });
});

// ---------- dashboard (role-tailored) ----------
api.get('/dashboard', (req, res) => {
  const u = req.user;
  const s = invoiceScope(u);
  const count = (where, ...p) => get(`SELECT count(*) c, round(coalesce(sum(total_cad),0),2) cad FROM invoices i WHERE ${s.sql} AND ${where}`, ...s.params, ...p);
  const ids = actingFor(u);
  const myQueue = can(u, 'invoice.approve') ? get(`SELECT count(*) c, round(coalesce(sum(i.total_cad),0),2) cad FROM invoices i JOIN approvals a ON a.invoice_id = i.invoice_id
    WHERE i.status = 'pending_approval' AND a.action = 'pending' AND a.step_no = (SELECT min(step_no) FROM approvals x WHERE x.invoice_id = i.invoice_id AND x.action = 'pending')
    AND (a.assigned_user_id IN (${ids.map(() => '?').join(',')}) OR a.on_behalf_of_user_id IN (${ids.map(() => '?').join(',')}))`, ...ids, ...ids) : null;
  const out = {
    drafts: count(`i.status IN ('draft','needs_review')`),
    pending: count(`i.status = 'pending_approval'`),
    approved: count(`i.status = 'approved'`),
    scheduled: count(`i.status = 'scheduled'`),
    paid30: count(`i.status = 'paid' AND i.updated_at >= ?`, addIso(today(), -30)),
    flagged: get(`SELECT count(DISTINCT f.invoice_id) c FROM flags f JOIN invoices i ON i.invoice_id = f.invoice_id WHERE ${s.sql} AND f.status = 'open' AND f.severity = 'block' AND i.status NOT IN ('rejected','paid')`, ...s.params),
    my_queue: myQueue,
    inbox: can(u, 'inbox.view') ? get(`SELECT count(*) c FROM emails WHERE status = 'new'`) : null,
    bank_changes: can(u, 'vendor.bank.approve') ? get(`SELECT count(*) c FROM bank_changes WHERE status = 'pending'`) : null,
    vendors_pending: can(u, 'vendor.approve') ? get(`SELECT count(*) c FROM vendors WHERE status = 'pending_review'`) : null,
    payments_to_release: can(u, 'payment.release') ? get(`SELECT count(*) c, round(coalesce(sum(amount_cad),0),2) cad FROM payments WHERE status = 'scheduled'`) : null,
    recent: all(`SELECT i.invoice_id, i.vendor_invoice_number, i.total, i.currency, i.status, i.updated_at, coalesce(v.legal_name, i.extracted_vendor_name) vendor_name FROM invoices i LEFT JOIN vendors v ON v.vendor_id = i.vendor_id WHERE ${s.sql} AND i.source != 'history' ORDER BY i.updated_at DESC LIMIT 6`, ...s.params),
  };
  if (u.role === 'approver' || u.role === 'employee') {
    const dept = u.department_id;
    const b = get('SELECT * FROM departments WHERE department_id = ?', dept);
    const ytd = get(`SELECT round(coalesce(sum(l.amount * coalesce(i.fx_rate_to_cad,1)),0),2) s FROM invoice_lines l JOIN invoices i ON i.invoice_id = l.invoice_id WHERE coalesce(l.department_id, i.department_id) = ? AND i.status NOT IN ('rejected','draft') AND i.invoice_date >= '2026-01-01'`, dept).s;
    out.department = { ...b, ytd, pct: b?.annual_budget_cad ? round2(ytd / b.annual_budget_cad) : null };
  }
  res.json(out);
});
const addIso = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------- invoices ----------
const LIST_SQL = (s) => `SELECT i.invoice_id, i.vendor_id, coalesce(v.legal_name, i.extracted_vendor_name) vendor_name, i.vendor_invoice_number, i.doc_type, i.invoice_date, i.due_date, i.received_date,
  i.currency, i.total, i.total_cad, i.status, i.source, i.department_id, d.name department, i.requester_user_id, u.full_name requester, i.risk_score, i.updated_at, i.recommendation,
  (SELECT count(*) FROM flags f WHERE f.invoice_id = i.invoice_id AND f.status = 'open' AND f.severity = 'block') blocks,
  (SELECT count(*) FROM flags f WHERE f.invoice_id = i.invoice_id AND f.status = 'open' AND f.severity = 'warn') warns,
  (SELECT group_concat(title, ' · ') FROM (SELECT title FROM flags f WHERE f.invoice_id = i.invoice_id AND f.status = 'open' AND f.severity != 'info' ORDER BY CASE severity WHEN 'block' THEN 0 ELSE 1 END LIMIT 3)) flag_titles,
  (SELECT group_concat(code || ':' || severity, ',') FROM (SELECT code, severity FROM flags f WHERE f.invoice_id = i.invoice_id AND f.status = 'open' AND f.severity != 'info' ORDER BY CASE severity WHEN 'block' THEN 0 ELSE 1 END, id)) flag_codes,
  (SELECT assigned_user_id FROM approvals a WHERE a.invoice_id = i.invoice_id AND a.action = 'pending' ORDER BY step_no LIMIT 1) next_approver_id,
  (SELECT approver_role FROM approvals a WHERE a.invoice_id = i.invoice_id AND a.action = 'pending' ORDER BY step_no LIMIT 1) next_role,
  (SELECT on_behalf_of_user_id FROM approvals a WHERE a.invoice_id = i.invoice_id AND a.action = 'pending' ORDER BY step_no LIMIT 1) next_on_behalf_id,
  (SELECT p.total_cad FROM invoices p WHERE p.vendor_id = i.vendor_id AND p.invoice_id != i.invoice_id AND p.doc_type = 'invoice' AND p.status IN ('paid','approved','scheduled') AND p.invoice_date <= i.invoice_date ORDER BY p.invoice_date DESC LIMIT 1) prev_total_cad,
  (SELECT count(*) FROM invoices p WHERE p.vendor_id = i.vendor_id AND p.source = 'history' AND p.status != 'rejected') vendor_bill_count
  FROM invoices i LEFT JOIN vendors v ON v.vendor_id = i.vendor_id LEFT JOIN departments d ON d.department_id = i.department_id LEFT JOIN users u ON u.user_id = i.requester_user_id
  WHERE ${s.sql}`;

api.get('/invoices', (req, res) => {
  const s = invoiceScope(req.user);
  const where = [];
  const p = [];
  const { status, q, source, view, vendor_id } = req.query;
  if (status) { where.push(`i.status IN (${String(status).split(',').map(() => '?').join(',')})`); p.push(...String(status).split(',')); }
  if (source === 'new') where.push(`i.source != 'history'`);
  if (source === 'history') where.push(`i.source = 'history'`);
  if (vendor_id) { where.push('i.vendor_id = ?'); p.push(vendor_id); }
  if (q) { where.push(`(i.invoice_id LIKE ? OR i.vendor_invoice_number LIKE ? OR v.legal_name LIKE ? OR i.extracted_vendor_name LIKE ?)`); p.push(...Array(4).fill(`%${q}%`)); }
  if (view === 'mine_to_approve') {
    const ids = actingFor(req.user);
    where.push(`i.status = 'pending_approval' AND EXISTS (SELECT 1 FROM approvals a WHERE a.invoice_id = i.invoice_id AND a.action = 'pending' AND a.step_no = (SELECT min(step_no) FROM approvals x WHERE x.invoice_id = i.invoice_id AND x.action = 'pending') AND (a.assigned_user_id IN (${ids.map(() => '?').join(',')}) OR a.on_behalf_of_user_id IN (${ids.map(() => '?').join(',')})))`);
    p.push(...ids, ...ids);
  }
  if (view === 'mine') { where.push('(i.requester_user_id = ? OR i.submitted_by = ?)'); p.push(req.user.user_id, req.user.user_id); }
  const limit = Math.min(Number(req.query.limit) || 500, 1000);
  const rows = all(`${LIST_SQL(s)} ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY CASE WHEN i.source='history' THEN 1 ELSE 0 END, i.invoice_id DESC LIMIT ${limit}`, ...s.params, ...p)
    .map((r) => ({ ...r, recommendation: r.recommendation ? JSON.parse(r.recommendation) : null, next_approver: userName(r.next_approver_id), next_on_behalf: userName(r.next_on_behalf_id) }));
  res.json(rows);
});

function invoiceDetail(user, id) {
  const inv = get(`SELECT i.*, d.name department, u.full_name requester FROM invoices i LEFT JOIN departments d ON d.department_id = i.department_id LEFT JOIN users u ON u.user_id = i.requester_user_id WHERE i.invoice_id = ?`, id);
  const vendor = inv.vendor_id ? get('SELECT * FROM vendors WHERE vendor_id = ?', inv.vendor_id) : null;
  const lines = all(`SELECT l.*, g.name gl_name, sg.name suggested_gl_name FROM invoice_lines l LEFT JOIN gl_accounts g ON g.account_number = l.gl_account LEFT JOIN gl_accounts sg ON sg.account_number = l.suggested_gl WHERE invoice_id = ? ORDER BY line_no`, id);
  const approvals = all('SELECT * FROM approvals WHERE invoice_id = ? ORDER BY step_no, approval_id', id).map((a) => ({
    ...a, assigned_name: userName(a.assigned_user_id), approver_name: userName(a.approver_user_id), on_behalf_of_name: userName(a.on_behalf_of_user_id), role_label: roleLabel(a.approver_role),
  }));
  const decision = approvalDecision(user, inv);
  const payments = all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_id', id).map((p) => ({ ...p, prepared_by_name: userName(p.prepared_by), released_by_name: userName(p.released_by), release_rule: releaseRolesFor(p.amount_cad) }));
  const doc = inv.doc_id ? get('SELECT doc_id, filename, mime, sha256, size, source, uploaded_at, uploaded_by, extraction_method, extraction_confidence, extraction_notes FROM documents WHERE doc_id = ?', inv.doc_id) : null;
  const email = inv.email_id ? get('SELECT email_id, from_name, from_address, subject, received_at, body FROM emails WHERE email_id = ?', inv.email_id) : null;
  const auditRows = can(user, 'audit.view') || can(user, 'invoice.view.all') || true
    ? all(`SELECT a.*, u.full_name actor_name FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_user_id WHERE a.invoice_id = ? OR (a.entity_type = 'payment' AND a.entity_id IN (SELECT payment_id FROM payments WHERE invoice_id = ?)) ORDER BY seq`, id, id).map((a) => ({ ...a, details: JSON.parse(a.details || '{}'), on_behalf_of_name: userName(a.on_behalf_of_user_id) }))
    : [];
  return {
    invoice: { ...inv, extracted_bank: inv.extracted_bank ? JSON.parse(inv.extracted_bank) : null, recommendation: inv.recommendation ? JSON.parse(inv.recommendation) : recommend(id) },
    vendor: vendor && { ...vendor, bank_account: vendor.bank_account ? `••••${String(vendor.bank_account).slice(-4)}` : null, stats: vendorStats(vendor.vendor_id), lookalikes: lookalikes(vendor) },
    lines, taxes: all('SELECT * FROM invoice_taxes WHERE invoice_id = ?', id),
    flags: all(`SELECT f.*, u.full_name resolved_by_name FROM flags f LEFT JOIN users u ON u.user_id = f.resolved_by WHERE invoice_id = ? ORDER BY CASE severity WHEN 'block' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, id`, id),
    approvals, can_approve: decision, payments, document: doc && { ...doc, extraction_notes: JSON.parse(doc.extraction_notes || '[]') }, email, audit: auditRows,
    po: inv.po_id ? get('SELECT * FROM purchase_orders WHERE po_id = ?', inv.po_id) : null,
    contract: inv.contract_id ? get('SELECT * FROM contracts WHERE contract_id = ?', inv.contract_id) : null,
    pay_suggestion: inv.doc_type === 'invoice' && ['approved', 'pending_approval', 'draft', 'needs_review'].includes(inv.status) ? bestPayDay(inv, vendor) : null,
    release_rule: releaseRolesFor(Math.abs(inv.total_cad || 0)),
    actions: {
      edit: can(user, 'invoice.edit') && ['draft', 'needs_review', 'pending_approval'].includes(inv.status),
      submit: can(user, 'invoice.route') && ['draft', 'needs_review'].includes(inv.status),
      approve: decision.ok,
      resolve: can(user, 'flag.resolve'),
      schedule: can(user, 'payment.prepare') && inv.status === 'approved' && inv.doc_type === 'invoice',
      release: can(user, 'payment.release'),
      reject: can(user, 'invoice.route') && ['draft', 'needs_review'].includes(inv.status),
    },
  };
}

api.get('/invoices/:id', (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  res.json(invoiceDetail(req.user, req.params.id));
});

api.get('/invoices/:id/document', (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  const inv = get('SELECT doc_id FROM invoices WHERE invoice_id = ?', req.params.id);
  const doc = inv?.doc_id && get('SELECT * FROM documents WHERE doc_id = ?', inv.doc_id);
  if (!doc) throw bad('No document', 404);
  res.type(doc.mime).sendFile(path.join(config.dataDir, doc.storage_path));
});

api.post('/invoices/upload', requirePerm('invoice.submit', 'invoice.ingest'), upload.array('files'), wrap(async (req, res) => {
  if (!req.files?.length) throw bad('Attach at least one PDF or image');
  // Extraction runs 4 files at a time (scans wait on the LLM); DB writes stay serialised by the event loop.
  const out = await pool(req.files, 4, async (f) => {
    if (!/\.(pdf|png|jpe?g|webp|tiff?)$/i.test(f.originalname)) return { filename: f.originalname, error: 'Unsupported file type' };
    try {
      const inv = await ingestFile({ buffer: f.buffer, filename: f.originalname, source: 'upload', actor: req.user, submitter: req.user, note: req.body?.note || null });
      return { filename: f.originalname, invoice_id: inv.invoice_id, status: inv.status };
    } catch (e) { return { filename: f.originalname, error: e.message }; }
  });
  res.json(out);
}));

const EDITABLE = ['vendor_id', 'vendor_invoice_number', 'invoice_date', 'due_date', 'currency', 'subtotal', 'total', 'ship_to_province', 'po_id', 'department_id', 'requester_user_id', 'doc_type', 'credit_note_ref', 'terms_text'];
api.patch('/invoices/:id', requirePerm('invoice.edit'), (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  const inv = get('SELECT * FROM invoices WHERE invoice_id = ?', req.params.id);
  if (!['draft', 'needs_review', 'pending_approval'].includes(inv.status)) throw bad(`Can't edit a ${inv.status} invoice`);
  const patch = {};
  const diff = {};
  for (const k of EDITABLE) if (k in (req.body || {}) && req.body[k] !== inv[k]) { patch[k] = req.body[k] === '' ? null : req.body[k]; diff[k] = [inv[k], patch[k]]; }
  if (!Object.keys(patch).length) return res.json(invoiceDetail(req.user, inv.invoice_id));
  if ('vendor_invoice_number' in patch) patch.invoice_number_norm = normInvoiceNumber(patch.vendor_invoice_number);
  const next = { ...inv, ...patch };
  if ('total' in patch || 'currency' in patch || 'invoice_date' in patch) { patch.fx_rate_to_cad = fxRate(next.invoice_date, next.currency); patch.total_cad = round2(next.total * patch.fx_rate_to_cad); }
  if ('vendor_id' in patch) patch.vendor_match_method = 'set by AP';
  tx(() => {
    // Editing an invoice under approval sends it back to the start of the chain.
    if (inv.status === 'pending_approval') { patch.status = 'draft'; run(`DELETE FROM approvals WHERE invoice_id = ? AND action = 'pending'`, inv.invoice_id); }
    update('invoices', 'invoice_id', inv.invoice_id, { ...patch, updated_at: nowIso() });
    audit({ actor: req.user, action: 'invoice.edited', entityType: 'invoice', entityId: inv.invoice_id, invoiceId: inv.invoice_id, details: { changes: diff } });
    recompute(inv.invoice_id, { actor: req.user });
  });
  res.json(invoiceDetail(req.user, inv.invoice_id));
});

api.put('/invoices/:id/lines/:lineId', requirePerm('invoice.code'), (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  const line = get('SELECT * FROM invoice_lines WHERE id = ? AND invoice_id = ?', req.params.lineId, req.params.id);
  if (!line) throw bad('Line not found', 404);
  const inv = get('SELECT status FROM invoices WHERE invoice_id = ?', req.params.id);
  if (!['draft', 'needs_review', 'pending_approval'].includes(inv.status)) throw bad(`Coding is locked once an invoice is ${inv.status}`);
  const { gl_account, department_id, line_type, description, quantity, unit_price, amount } = req.body || {};
  if (gl_account && !get('SELECT 1 FROM gl_accounts WHERE account_number = ?', gl_account)) throw bad('Unknown GL account');
  const patch = {};
  if (gl_account !== undefined) patch.gl_account = gl_account;
  if (department_id !== undefined) patch.department_id = department_id;
  if (line_type !== undefined) patch.line_type = line_type;
  for (const [k, v] of Object.entries({ description, quantity, unit_price, amount })) if (v !== undefined) patch[k] = v;
  const changedCoding = (patch.gl_account && patch.gl_account !== line.suggested_gl) || (patch.department_id && patch.department_id !== line.suggested_department);
  patch.coding_source = changedCoding ? 'human' : 'accepted';
  update('invoice_lines', 'id', line.id, patch);
  invalidateCodingIndex();
  audit({ actor: req.user, action: changedCoding ? 'coding.changed' : 'coding.accepted', entityType: 'invoice_line', entityId: String(line.id), invoiceId: req.params.id, details: { line: line.line_no, from: { gl: line.gl_account, dept: line.department_id }, to: patch, suggested: line.suggested_gl } });
  recompute(req.params.id, { actor: req.user });
  res.json(invoiceDetail(req.user, req.params.id));
});

api.post('/invoices/:id/accept-coding', requirePerm('invoice.code'), (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  const n = run(`UPDATE invoice_lines SET coding_source = 'accepted' WHERE invoice_id = ? AND coding_source = 'suggested'`, req.params.id).changes;
  invalidateCodingIndex();
  audit({ actor: req.user, action: 'coding.accepted', entityType: 'invoice', entityId: req.params.id, invoiceId: req.params.id, details: { lines: n } });
  res.json(invoiceDetail(req.user, req.params.id));
});

api.post('/invoices/:id/flags/:flagId/resolve', requirePerm('flag.resolve'), (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  const fl = get('SELECT * FROM flags WHERE id = ? AND invoice_id = ?', req.params.flagId, req.params.id);
  if (!fl) throw bad('Flag not found', 404);
  const note = String(req.body?.note || '').trim();
  if (note.length < 5) throw bad('Say how it was resolved (at least a few words)');
  if (fl.category === 'fraud') assert(can(req.user, 'flag.resolve.fraud'), 'Fraud-risk flags need a finance manager or controller to clear.', 'fraud_flag');
  const inv = get('SELECT requester_user_id FROM invoices WHERE invoice_id = ?', req.params.id);
  assert(inv.requester_user_id !== req.user.user_id, 'You requested this invoice; someone else must clear its flags.');
  const reopen = req.body?.reopen === true;
  update('flags', 'id', fl.id, reopen ? { status: 'open', resolved_by: null, resolved_at: null, resolution_note: null } : { status: 'resolved', resolved_by: req.user.user_id, resolved_at: nowIso(), resolution_note: note });
  audit({ actor: req.user, action: reopen ? 'flag.reopened' : 'flag.resolved', entityType: 'flag', entityId: String(fl.id), invoiceId: req.params.id, details: { code: fl.code, title: fl.title, note } });
  recompute(req.params.id, { actor: req.user });
  res.json(invoiceDetail(req.user, req.params.id));
});

api.post('/invoices/:id/submit', requirePerm('invoice.route'), (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  const out = submitInvoice(req.user, req.params.id);
  res.json(out);
});
function submitInvoice(user, id) {
  const inv = get('SELECT * FROM invoices WHERE invoice_id = ?', id);
  if (!['draft', 'needs_review'].includes(inv.status)) throw bad(`Invoice is already ${inv.status.replace('_', ' ')}`);
  if (!inv.vendor_id) throw bad('Assign or onboard the vendor first');
  const blocks = all(`SELECT title FROM flags WHERE invoice_id = ? AND status = 'open' AND severity = 'block'`, id);
  if (blocks.length) throw bad(`Resolve the blocking flags first: ${blocks.map((b) => b.title).join('; ')}`);
  tx(() => {
    run(`UPDATE invoice_lines SET coding_source = 'accepted' WHERE invoice_id = ? AND coding_source = 'suggested'`, id);
    update('invoices', 'invoice_id', id, { status: 'pending_approval', updated_at: nowIso() });
    recompute(id, { actor: user });
    const steps = all(`SELECT * FROM approvals WHERE invoice_id = ? AND action = 'pending' ORDER BY step_no`, id);
    audit({ actor: user, action: 'invoice.submitted', entityType: 'invoice', entityId: id, invoiceId: id, details: { route: describeRoute(steps) } });
  });
  invalidateCodingIndex();
  return invoiceDetail(user, id);
}
api.post('/invoices/bulk-submit', requirePerm('invoice.route'), (req, res) => {
  const ids = (req.body?.ids || []).slice(0, 200);
  const results = ids.map((id) => { try { assertSeeInvoice(req.user, id); submitInvoice(req.user, id); return { id, ok: true }; } catch (e) { return { id, ok: false, error: e.message }; } });
  res.json(results);
});

api.post('/invoices/:id/reject', (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  const inv = get('SELECT * FROM invoices WHERE invoice_id = ?', req.params.id);
  const reason = String(req.body?.comment || '').trim();
  if (reason.length < 3) throw bad('Give a reason for rejecting');
  if (inv.status === 'pending_approval') {
    const d = approvalDecision(req.user, inv);
    assert(d.ok, d.reason, 'approval');
    tx(() => {
      update('approvals', 'approval_id', d.step.approval_id, { action: 'rejected', approver_user_id: req.user.user_id, acted_at: nowIso(), comment: reason, on_behalf_of_user_id: d.onBehalfOf });
      run(`UPDATE approvals SET action = 'skipped' WHERE invoice_id = ? AND action = 'pending'`, inv.invoice_id);
      update('invoices', 'invoice_id', inv.invoice_id, { status: 'rejected', updated_at: nowIso() });
      audit({ actor: req.user, action: 'invoice.rejected', entityType: 'invoice', entityId: inv.invoice_id, invoiceId: inv.invoice_id, onBehalfOf: d.onBehalfOf, details: { step: d.step.step_no, comment: reason } });
    });
  } else {
    assert(can(req.user, 'invoice.route') && ['draft', 'needs_review'].includes(inv.status), 'Only AP can reject a draft; approvers reject during approval.');
    update('invoices', 'invoice_id', inv.invoice_id, { status: 'rejected', updated_at: nowIso() });
    audit({ actor: req.user, action: 'invoice.rejected', entityType: 'invoice', entityId: inv.invoice_id, invoiceId: inv.invoice_id, details: { stage: 'AP review', comment: reason } });
  }
  res.json(invoiceDetail(req.user, inv.invoice_id));
});

api.post('/invoices/:id/approve', requirePerm('invoice.approve'), (req, res) => {
  assertSeeInvoice(req.user, req.params.id);
  const inv = get('SELECT * FROM invoices WHERE invoice_id = ?', req.params.id);
  const d = approvalDecision(req.user, inv);
  if (!d.ok) {
    audit({ actor: req.user, action: 'invoice.approve_denied', entityType: 'invoice', entityId: inv.invoice_id, invoiceId: inv.invoice_id, details: { reason: d.reason } });
    throw new Forbidden(d.reason, 'approval');
  }
  const blocks = all(`SELECT title FROM flags WHERE invoice_id = ? AND status = 'open' AND severity = 'block'`, inv.invoice_id);
  if (blocks.length) throw bad(`Blocked: ${blocks.map((b) => b.title).join('; ')}. AP must resolve these first.`);
  const warns = all(`SELECT title FROM flags WHERE invoice_id = ? AND status = 'open' AND severity = 'warn'`, inv.invoice_id);
  if (warns.length && !req.body?.acknowledge) throw bad(`Confirm you've reviewed: ${warns.map((w) => w.title).join('; ')}`, 409);
  tx(() => {
    update('approvals', 'approval_id', d.step.approval_id, { action: 'approved', approver_user_id: req.user.user_id, acted_at: nowIso(), comment: req.body?.comment || null, on_behalf_of_user_id: d.onBehalfOf });
    audit({ actor: req.user, action: 'invoice.approved', entityType: 'invoice', entityId: inv.invoice_id, invoiceId: inv.invoice_id, onBehalfOf: d.onBehalfOf,
      details: { step: d.step.step_no, role: d.step.approver_role, rule: d.step.rule_id, comment: req.body?.comment || null, acknowledged: warns.map((w) => w.title), as_delegate: !!d.onBehalfOf } });
    const remaining = get(`SELECT count(*) c FROM approvals WHERE invoice_id = ? AND action = 'pending'`, inv.invoice_id).c;
    if (!remaining) {
      update('invoices', 'invoice_id', inv.invoice_id, { status: 'approved', updated_at: nowIso() });
      audit({ actor: 'system', action: 'invoice.fully_approved', entityType: 'invoice', entityId: inv.invoice_id, invoiceId: inv.invoice_id, details: {} });
    } else update('invoices', 'invoice_id', inv.invoice_id, { updated_at: nowIso() });
  });
  res.json(invoiceDetail(req.user, inv.invoice_id));
});

// ---------- payments ----------
api.get('/payments', requirePerm('payment.view', 'payment.prepare'), (_req, res) => res.json(paymentsDashboard()));
api.post('/payments', requirePerm('payment.prepare'), (req, res) => {
  const p = preparePayment(req.user, req.body?.invoice_id, req.body || {});
  res.json(p);
});
api.post('/payments/:id/release', requirePerm('payment.release'), (req, res) => res.json(releasePayment(req.user, req.params.id)));
api.post('/payments/release-batch', requirePerm('payment.release'), (req, res) => {
  res.json((req.body?.ids || []).map((id) => { try { releasePayment(req.user, id); return { id, ok: true }; } catch (e) { return { id, ok: false, error: e.message }; } }));
});
api.post('/payments/:id/cancel', requirePerm('payment.prepare', 'payment.release'), (req, res) => { cancelPayment(req.user, req.params.id, req.body?.reason); res.json({ ok: true }); });
api.post('/payments/settle', requirePerm('payment.release'), (req, res) => res.json({ settled: settleDue({ force: true }) }));
api.get('/payments/eft-file', requirePerm('payment.view'), (_req, res) => res.type('text/plain').attachment(`eft-batch-${today()}.txt`).send(eftFile()));

// ---------- approvals & delegation ----------
api.get('/delegations', (req, res) => {
  const rows = can(req.user, 'delegation.any') ? all('SELECT * FROM delegations ORDER BY id DESC') : all('SELECT * FROM delegations WHERE user_id = ? OR delegate_user_id = ? ORDER BY id DESC', req.user.user_id, req.user.user_id);
  res.json(rows.map((d) => ({ ...d, user_name: userName(d.user_id), delegate_name: userName(d.delegate_user_id) })));
});
api.post('/delegations', requirePerm('delegation.self', 'delegation.any'), (req, res) => {
  const { delegate_user_id, starts_on = today(), ends_on = null, reason = null } = req.body || {};
  const userId = can(req.user, 'delegation.any') && req.body?.user_id ? req.body.user_id : req.user.user_id;
  const del = get('SELECT * FROM users WHERE user_id = ?', delegate_user_id);
  if (!del || del.status !== 'active') throw bad('Pick an active colleague as delegate');
  if (delegate_user_id === userId) throw bad('You can\'t delegate to yourself');
  if (!['approver', 'finance_manager', 'controller_admin'].includes(del.role)) throw bad('A delegate must be someone who can approve invoices');
  run('UPDATE delegations SET active = 0 WHERE user_id = ? AND active = 1', userId);
  insert('delegations', { user_id: userId, delegate_user_id, starts_on, ends_on, reason, created_by: req.user.user_id, created_at: nowIso(), active: 1 });
  audit({ actor: req.user, action: 'delegation.created', entityType: 'user', entityId: userId, details: { delegate: delegate_user_id, starts_on, ends_on, reason } });
  rerouteOpen();
  res.json({ ok: true });
});
api.delete('/delegations/:id', (req, res) => {
  const d = get('SELECT * FROM delegations WHERE id = ?', req.params.id);
  if (!d) throw bad('Not found', 404);
  assert(d.user_id === req.user.user_id || can(req.user, 'delegation.any'), 'You can only end your own delegation');
  update('delegations', 'id', d.id, { active: 0, ends_on: today() });
  audit({ actor: req.user, action: 'delegation.ended', entityType: 'user', entityId: d.user_id, details: { delegate: d.delegate_user_id } });
  rerouteOpen();
  res.json({ ok: true });
});
function rerouteOpen() {
  for (const r of all(`SELECT invoice_id FROM invoices WHERE status IN ('draft','pending_approval','needs_review')`)) recompute(r.invoice_id);
}

// ---------- vendors ----------
api.get('/vendors', requirePerm('vendor.view'), (_req, res) => {
  res.json(all(`SELECT v.*, (SELECT count(*) FROM invoices i WHERE i.vendor_id = v.vendor_id) invoices, (SELECT round(sum(total_cad),2) FROM invoices i WHERE i.vendor_id = v.vendor_id AND i.status != 'rejected') spend_cad,
    (SELECT count(*) FROM bank_changes b WHERE b.vendor_id = v.vendor_id AND b.status = 'pending') pending_bank_changes FROM vendors v ORDER BY v.legal_name`).map(maskVendor));
});
const maskVendor = (v) => ({ ...v, bank_account_masked: v.bank_account ? `••••${String(v.bank_account).slice(-4)}` : null, bank_account: undefined });
api.get('/vendors/health', requirePerm('vendor.view'), (_req, res) => res.json(masterHealth()));
api.get('/vendors/:id', requirePerm('vendor.view'), (req, res) => {
  const v = get('SELECT * FROM vendors WHERE vendor_id = ?', req.params.id);
  if (!v) throw bad('Vendor not found', 404);
  res.json({
    vendor: can(req.user, 'vendor.bank.approve') || can(req.user, 'audit.view') ? { ...v, bank_account_masked: `••••${String(v.bank_account || '').slice(-4)}` } : maskVendor(v),
    stats: vendorStats(v.vendor_id), lookalikes: lookalikes(v),
    bank_changes: all('SELECT * FROM bank_changes WHERE vendor_id = ? ORDER BY changed_at DESC', v.vendor_id).map((b) => ({ ...b, changed_by_name: userName(b.changed_by_user_id), approved_by_name: userName(b.approved_by), risk_reasons: b.risk_reasons ? JSON.parse(b.risk_reasons) : [] })),
    contracts: all('SELECT * FROM contracts WHERE vendor_id = ?', v.vendor_id),
    pos: all('SELECT * FROM purchase_orders WHERE vendor_id = ?', v.vendor_id),
    invoices: all(`SELECT invoice_id, vendor_invoice_number, invoice_date, total, currency, status, source FROM invoices WHERE vendor_id = ? ORDER BY invoice_date DESC LIMIT 50`, v.vendor_id),
    audit: all(`SELECT a.*, u.full_name actor_name FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_user_id WHERE (a.entity_type = 'vendor' AND a.entity_id = ?) OR (a.entity_type = 'bank_change' AND a.entity_id IN (SELECT change_id FROM bank_changes WHERE vendor_id = ?)) ORDER BY seq DESC`, v.vendor_id, v.vendor_id).map((a) => ({ ...a, details: JSON.parse(a.details || '{}') })),
  });
});
api.post('/vendors', requirePerm('vendor.create'), (req, res) => {
  const b = req.body || {};
  if (!b.legal_name) throw bad('Legal name is required');
  const dupe = all('SELECT vendor_id, legal_name, gst_hst_number FROM vendors').find((v) => (b.gst_hst_number && v.gst_hst_number === b.gst_hst_number));
  if (dupe) throw bad(`GST number already belongs to ${dupe.legal_name} (${dupe.vendor_id})`);
  const id = nextVendorId();
  insert('vendors', {
    vendor_id: id, legal_name: b.legal_name, category: b.category || null, default_gl_account: b.default_gl_account || null, address: b.address || null, province_or_state: b.province_or_state || null,
    country: b.country || 'CA', gst_hst_number: b.gst_hst_number || null, qst_number: b.qst_number || null, payment_terms_days: Number(b.payment_terms_days) || 30, early_pay_discount: b.early_pay_discount || null,
    preferred_payment_method: b.preferred_payment_method || 'EFT', accepts_card_payment: b.accepts_card_payment ? 1 : 0, bank_institution: b.bank_institution || null, bank_transit: b.bank_transit || null,
    bank_account: b.bank_account || null, ap_contact_email: b.ap_contact_email || null, requires_po: b.requires_po ? 1 : 0, status: 'pending_review', onboarded_at: today(), currency: b.country && b.country !== 'CA' ? 'USD' : 'CAD', created_by: req.user.user_id,
  });
  audit({ actor: req.user, action: 'vendor.created', entityType: 'vendor', entityId: id, details: { legal_name: b.legal_name, from_invoice: b.from_invoice || null, status: 'pending_review' } });
  if (b.from_invoice) {
    assertSeeInvoice(req.user, b.from_invoice);
    update('invoices', 'invoice_id', b.from_invoice, { vendor_id: id, vendor_match_method: 'onboarded from this invoice' });
    recompute(b.from_invoice, { actor: req.user });
  }
  res.json(get('SELECT * FROM vendors WHERE vendor_id = ?', id));
});
function nextVendorId() {
  const max = get(`SELECT max(cast(substr(vendor_id,2) AS INTEGER)) m FROM vendors`).m || 0;
  return `V${String(max + 1).padStart(3, '0')}`;
}
api.post('/vendors/:id/approve', requirePerm('vendor.approve'), (req, res) => {
  const v = get('SELECT * FROM vendors WHERE vendor_id = ?', req.params.id);
  if (!v) throw bad('Vendor not found', 404);
  assert(v.created_by !== req.user.user_id, 'You onboarded this vendor; a different person must approve it.');
  if (v.status === 'active') throw bad('Vendor is already active');
  update('vendors', 'vendor_id', v.vendor_id, { status: 'active' });
  audit({ actor: req.user, action: 'vendor.approved', entityType: 'vendor', entityId: v.vendor_id, details: { from: v.status, note: req.body?.note || null } });
  for (const r of all(`SELECT invoice_id FROM invoices WHERE vendor_id = ? AND status IN ('draft','pending_approval','needs_review')`, v.vendor_id)) recompute(r.invoice_id, { actor: req.user });
  res.json({ ok: true });
});
api.post('/vendors/:id/status', requirePerm('vendor.approve'), (req, res) => {
  const v = get('SELECT * FROM vendors WHERE vendor_id = ?', req.params.id);
  const status = req.body?.status;
  if (!['active', 'on_hold', 'inactive'].includes(status)) throw bad('Status must be active, on_hold or inactive');
  update('vendors', 'vendor_id', v.vendor_id, { status });
  audit({ actor: req.user, action: 'vendor.status_changed', entityType: 'vendor', entityId: v.vendor_id, details: { from: v.status, to: status, reason: req.body?.reason || null } });
  for (const r of all(`SELECT invoice_id FROM invoices WHERE vendor_id = ? AND status IN ('draft','pending_approval','needs_review')`, v.vendor_id)) recompute(r.invoice_id, { actor: req.user });
  res.json({ ok: true });
});

// Bank-detail changes: request (AP) -> callback verification (AP, number on file) -> approval (FM/controller, not the requester).
api.post('/vendors/:id/bank-changes', requirePerm('vendor.bank.request'), (req, res) => {
  const v = get('SELECT * FROM vendors WHERE vendor_id = ?', req.params.id);
  if (!v) throw bad('Vendor not found', 404);
  const { institution, transit, account, request_channel = 'email_request', note } = req.body || {};
  if (!/^\d{3}$/.test(institution || '') || !/^\d{5}$/.test(transit || '') || !/^\d{5,12}$/.test(account || '')) throw bad('Institution is 3 digits, transit 5 digits, account 5 to 12 digits');
  if (get(`SELECT 1 FROM bank_changes WHERE vendor_id = ? AND status = 'pending'`, v.vendor_id)) throw bad('A bank change is already pending for this vendor');
  const reasons = [];
  let score = 20;
  if (request_channel === 'email_request') { score += 30; reasons.push('Requested by email, the most common fraud channel'); }
  const openPays = get(`SELECT count(*) c, round(coalesce(sum(total_cad),0),2) s FROM invoices WHERE vendor_id = ? AND status IN ('pending_approval','approved','scheduled')`, v.vendor_id);
  if (openPays.c) { score += 20; reasons.push(`${openPays.c} unpaid invoice(s) worth ${money(openPays.s)} would go to the new account`); }
  const prior = get(`SELECT count(*) c FROM bank_changes WHERE vendor_id = ? AND changed_at >= ?`, v.vendor_id, addIso(today(), -180)).c;
  if (prior) { score += 15; reasons.push(`${prior} other bank change(s) in the last 6 months`); }
  if (institution !== v.bank_institution) { score += 10; reasons.push(`Moves to a different bank (${v.bank_institution} → ${institution})`); }
  const shared = get('SELECT vendor_id, legal_name FROM vendors WHERE bank_account = ? AND vendor_id != ?', account, v.vendor_id);
  if (shared) { score += 30; reasons.push(`New account already belongs to ${shared.legal_name} (${shared.vendor_id})`); }
  const id = `BC-${String(get('SELECT count(*) c FROM bank_changes').c + 1).padStart(3, '0')}`;
  insert('bank_changes', {
    change_id: id, vendor_id: v.vendor_id, changed_at: nowIso(), changed_by_user_id: req.user.user_id, request_channel, verified_by_callback: 'no',
    old_account_last4: String(v.bank_account || '').slice(-4), new_account_last4: account.slice(-4), new_institution: institution, new_transit: transit, new_account: account,
    status: 'pending', risk_score: Math.min(100, score), risk_reasons: JSON.stringify(reasons), callback_note: note || null,
  });
  audit({ actor: req.user, action: 'bank_change.requested', entityType: 'bank_change', entityId: id, details: { vendor: v.vendor_id, channel: request_channel, new_last4: account.slice(-4), risk: score, reasons } });
  for (const r of all(`SELECT invoice_id FROM invoices WHERE vendor_id = ? AND status IN ('draft','pending_approval','needs_review')`, v.vendor_id)) recompute(r.invoice_id, { actor: req.user });
  res.json(get('SELECT * FROM bank_changes WHERE change_id = ?', id));
});
api.post('/bank-changes/:id/verify', requirePerm('vendor.bank.verify', 'vendor.bank.approve'), (req, res) => {
  const c = get('SELECT * FROM bank_changes WHERE change_id = ?', req.params.id);
  if (!c || c.status !== 'pending') throw bad('No pending change');
  const note = String(req.body?.note || '').trim();
  if (note.length < 8) throw bad('Record who you called and on which number from the vendor file');
  update('bank_changes', 'change_id', c.change_id, { verified_by_callback: 'yes', callback_note: note });
  audit({ actor: req.user, action: 'bank_change.callback_verified', entityType: 'bank_change', entityId: c.change_id, details: { note } });
  res.json({ ok: true });
});
api.post('/bank-changes/:id/approve', requirePerm('vendor.bank.approve'), (req, res) => {
  const c = get('SELECT * FROM bank_changes WHERE change_id = ?', req.params.id);
  if (!c || c.status !== 'pending') throw bad('No pending change');
  assert(c.changed_by_user_id !== req.user.user_id, 'You requested this change; a different person must approve it.');
  if (c.verified_by_callback !== 'yes') throw bad('Verify the change by calling the vendor on the number on file before approving');
  tx(() => {
    update('vendors', 'vendor_id', c.vendor_id, { bank_institution: c.new_institution, bank_transit: c.new_transit, bank_account: c.new_account, bank_details_updated_at: today() });
    update('bank_changes', 'change_id', c.change_id, { status: 'applied', approved_by: req.user.user_id, approved_at: nowIso() });
    audit({ actor: req.user, action: 'bank_change.approved', entityType: 'bank_change', entityId: c.change_id, details: { vendor: c.vendor_id, new_last4: c.new_account_last4 } });
  });
  for (const r of all(`SELECT invoice_id FROM invoices WHERE vendor_id = ? AND status IN ('draft','pending_approval','needs_review')`, c.vendor_id)) recompute(r.invoice_id, { actor: req.user });
  res.json({ ok: true });
});
api.post('/bank-changes/:id/reject', requirePerm('vendor.bank.approve'), (req, res) => {
  const c = get('SELECT * FROM bank_changes WHERE change_id = ?', req.params.id);
  if (!c || c.status !== 'pending') throw bad('No pending change');
  update('bank_changes', 'change_id', c.change_id, { status: 'rejected', approved_by: req.user.user_id, approved_at: nowIso(), callback_note: req.body?.note || c.callback_note });
  audit({ actor: req.user, action: 'bank_change.rejected', entityType: 'bank_change', entityId: c.change_id, details: { note: req.body?.note || null } });
  for (const r of all(`SELECT invoice_id FROM invoices WHERE vendor_id = ? AND status IN ('draft','pending_approval','needs_review')`, c.vendor_id)) recompute(r.invoice_id, { actor: req.user });
  res.json({ ok: true });
});
api.get('/bank-changes', requirePerm('vendor.view'), (_req, res) => {
  res.json(all(`SELECT b.*, v.legal_name FROM bank_changes b JOIN vendors v ON v.vendor_id = b.vendor_id ORDER BY b.changed_at DESC`).map((b) => ({ ...b, new_account: undefined, changed_by_name: userName(b.changed_by_user_id), approved_by_name: userName(b.approved_by), risk_reasons: b.risk_reasons ? JSON.parse(b.risk_reasons) : [] })));
});

// ---------- inbox ----------
api.get('/inbox', requirePerm('inbox.view'), (_req, res) => {
  res.json(all('SELECT * FROM emails ORDER BY received_at DESC').map((e) => {
    const invs = all(`SELECT i.invoice_id, i.status, i.vendor_invoice_number, i.total, i.currency, d.filename FROM invoices i LEFT JOIN documents d ON d.doc_id = i.doc_id WHERE i.email_id = ?`, e.email_id);
    const answer = e.classification === 'payment_inquiry' && e.matched_vendor_id ? paymentInquiryAnswer(e.matched_vendor_id, classifyEmail(e).ref) : null;
    return { ...e, attachments: JSON.parse(e.attachments || '[]'), invoices: invs, answer };
  }));
});
api.post('/inbox/process', requirePerm('invoice.ingest'), wrap(async (req, res) => res.json(await processInbox({ actor: req.user }))));
// Import a new mailbox export: emails.json plus its attachments (how a hidden batch can be loaded).
api.post('/inbox/import', requirePerm('invoice.ingest'), upload.array('files'), wrap(async (req, res) => {
  const files = req.files || [];
  const json = files.find((f) => /\.json$/i.test(f.originalname));
  const byName = new Map(files.filter((f) => f !== json).map((f) => [f.originalname, f]));
  let emails = [];
  if (json) emails = JSON.parse(json.buffer.toString('utf8'));
  const results = { emails: 0, bills: 0, skipped: 0, loose_files: 0 };
  const created = [];
  for (const e of emails) {
    if (get('SELECT 1 FROM emails WHERE email_id = ?', e.email_id)) { results.skipped++; continue; }
    insert('emails', { ...e, attachments: JSON.stringify(e.attachments || []), status: 'new' });
    results.emails++;
    const em = get('SELECT * FROM emails WHERE email_id = ?', e.email_id);
    const c = classifyEmail(em);
    update('emails', 'email_id', e.email_id, { classification: c.classification, classification_reason: c.reason, matched_vendor_id: c.vendor?.vendor_id || null, status: 'processed', processed_at: nowIso() });
    audit({ actor: req.user, action: 'email.classified', entityType: 'email', entityId: e.email_id, details: { classification: c.classification } });
    if (c.classification !== 'invoice') continue;
    for (const name of e.attachments || []) {
      const f = byName.get(name);
      if (!f) continue;
      byName.delete(name);
      const inv = await ingestFile({ buffer: f.buffer, filename: name, source: 'email', email: em, actor: req.user });
      created.push(inv.invoice_id); results.bills++;
    }
  }
  for (const [name, f] of byName) {
    const inv = await ingestFile({ buffer: f.buffer, filename: name, source: 'upload', actor: req.user, submitter: req.user });
    created.push(inv.invoice_id); results.loose_files++;
  }
  res.json({ results, created });
}));

// ---------- policies & users (admin) ----------
api.get('/policies', (_req, res) => res.json(all('SELECT * FROM policies ORDER BY sort').map((p) => ({ ...p, chain: JSON.parse(p.chain || '[]'), updated_by_name: userName(p.updated_by) }))));
api.put('/policies/:id', requirePerm('policies.manage'), (req, res) => {
  const p = get('SELECT * FROM policies WHERE rule_id = ?', req.params.id);
  if (!p) throw bad('Rule not found', 404);
  const b = req.body || {};
  const patch = {};
  for (const k of ['min_amount_cad', 'max_amount_cad']) if (k in b) patch[k] = b[k] === '' || b[k] === null ? null : Number(b[k]);
  if ('active' in b) patch.active = b.active ? 1 : 0;
  if ('param' in b) patch.param = b.param;
  if ('notes' in b) patch.notes = b.notes;
  if ('condition_text' in b) patch.condition_text = b.condition_text;
  if ('chain' in b) {
    const ok = ['dept_manager', 'finance_manager', 'controller_admin', 'cfo', 'manager', 'delegate'];
    if (!Array.isArray(b.chain) || b.chain.some((r) => !ok.includes(r))) throw bad('Invalid approver chain');
    patch.chain = JSON.stringify(b.chain);
  }
  if (patch.min_amount_cad !== undefined && patch.max_amount_cad !== undefined && patch.max_amount_cad !== null && patch.max_amount_cad <= patch.min_amount_cad) throw bad('Upper bound must be above lower bound');
  update('policies', 'rule_id', p.rule_id, { ...patch, updated_by: req.user.user_id, updated_at: nowIso() });
  audit({ actor: req.user, action: 'policy.updated', entityType: 'policy', entityId: p.rule_id, details: { before: Object.fromEntries(Object.keys(patch).map((k) => [k, p[k]])), after: patch } });
  rerouteOpen();
  res.json(get('SELECT * FROM policies WHERE rule_id = ?', p.rule_id));
});
api.post('/policies/preview', (req, res) => {
  // "Who would approve this?" simulator for the policy editor.
  const { amount_cad = 1000, department_id = 'D01', vendor_id = null, requester_user_id = null } = req.body || {};
  const vendor = vendor_id ? get('SELECT * FROM vendors WHERE vendor_id = ?', vendor_id) : get(`SELECT * FROM vendors WHERE status = 'active' LIMIT 1`);
  const steps = buildRoute({ inv: { total_cad: Number(amount_cad), department_id, requester_user_id, doc_type: 'invoice' }, vendor, flags: [], amountCad: Number(amount_cad) });
  res.json({ steps: steps.map((s) => ({ ...s, assigned_name: userName(s.assigned_user_id), on_behalf_of_name: userName(s.on_behalf_of_user_id), role_label: roleLabel(s.approver_role) })), release: releaseRolesFor(Number(amount_cad)) });
});
api.get('/users', requirePerm('users.manage', 'audit.view'), (_req, res) => res.json(all(`SELECT u.*, d.name department, m.full_name manager_name, dl.full_name delegate_name FROM users u LEFT JOIN departments d ON d.department_id = u.department_id LEFT JOIN users m ON m.user_id = u.manager_id LEFT JOIN users dl ON dl.user_id = u.delegate_user_id ORDER BY u.user_id`)));
api.patch('/users/:id', requirePerm('users.manage'), (req, res) => {
  const u = get('SELECT * FROM users WHERE user_id = ?', req.params.id);
  if (!u) throw bad('User not found', 404);
  const b = req.body || {};
  const patch = {};
  if ('role' in b) { if (!['employee', 'ap_clerk', 'approver', 'finance_manager', 'controller_admin', 'auditor'].includes(b.role)) throw bad('Unknown role'); patch.role = b.role; }
  if ('approval_limit_cad' in b) patch.approval_limit_cad = Number(b.approval_limit_cad) || 0;
  if ('status' in b) { if (!['active', 'on_leave', 'terminated'].includes(b.status)) throw bad('Unknown status'); patch.status = b.status; patch.status_since = today(); }
  if ('manager_id' in b) patch.manager_id = b.manager_id || null;
  if ('delegate_user_id' in b) patch.delegate_user_id = b.delegate_user_id || null;
  if ('department_id' in b) patch.department_id = b.department_id;
  assert(!(u.user_id === req.user.user_id && patch.role && patch.role !== u.role), 'You can\'t change your own role.');
  update('users', 'user_id', u.user_id, patch);
  if (patch.status === 'on_leave' && (patch.delegate_user_id || u.delegate_user_id)) {
    run('UPDATE delegations SET active = 0 WHERE user_id = ? AND active = 1', u.user_id);
    insert('delegations', { user_id: u.user_id, delegate_user_id: patch.delegate_user_id || u.delegate_user_id, starts_on: today(), reason: 'On leave (set by admin)', created_by: req.user.user_id, created_at: nowIso(), active: 1 });
  }
  if (patch.status === 'active') run('UPDATE delegations SET active = 0, ends_on = ? WHERE user_id = ? AND active = 1', today(), u.user_id);
  audit({ actor: req.user, action: 'user.updated', entityType: 'user', entityId: u.user_id, details: { before: Object.fromEntries(Object.keys(patch).map((k) => [k, u[k]])), after: patch } });
  rerouteOpen();
  res.json(get('SELECT * FROM users WHERE user_id = ?', u.user_id));
});

// ---------- audit ----------
api.get('/audit', requirePerm('audit.view'), (req, res) => {
  const { q, action, entity, limit = 300 } = req.query;
  const where = [];
  const p = [];
  if (q) { where.push('(a.entity_id LIKE ? OR a.invoice_id LIKE ? OR a.details LIKE ? OR u.full_name LIKE ?)'); p.push(...Array(4).fill(`%${q}%`)); }
  if (action) { where.push('a.action LIKE ?'); p.push(`${action}%`); }
  if (entity) { where.push('a.entity_type = ?'); p.push(entity); }
  res.json({
    chain: verifyChain(),
    rows: all(`SELECT a.*, u.full_name actor_name, b.full_name on_behalf_of_name FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_user_id LEFT JOIN users b ON b.user_id = a.on_behalf_of_user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ${Math.min(Number(limit) || 300, 2000)}`, ...p).map((a) => ({ ...a, details: JSON.parse(a.details || '{}') })),
  });
});
api.get('/audit/export.csv', requirePerm('audit.export'), (req, res) => {
  audit({ actor: req.user, action: 'audit.exported', entityType: 'audit', entityId: 'csv', details: {} });
  const rows = all(`SELECT a.seq, a.ts, a.actor_user_id, u.full_name actor_name, a.actor_role, a.on_behalf_of_user_id, a.action, a.entity_type, a.entity_id, a.invoice_id, a.details, a.prev_hash, a.hash FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_user_id ORDER BY seq`);
  res.type('text/csv').attachment(`audit-log-${today()}.csv`).send(toCsv(rows));
});
// Payment-to-invoice trace: everything an auditor needs for one payment on one page.
api.get('/audit/trace', requirePerm('audit.view', 'payment.view'), (_req, res) => {
  const rows = all(`SELECT p.payment_id, p.method, p.amount, p.currency, p.amount_cad, p.status, p.paid_date, p.reference, p.prepared_by, p.released_by, i.invoice_id, i.vendor_invoice_number, i.invoice_date, i.total, v.legal_name vendor,
      (SELECT group_concat(coalesce(a.approver_user_id, a.assigned_user_id) || ':' || a.action || coalesce(':for ' || a.on_behalf_of_user_id, ''), ' > ') FROM approvals a WHERE a.invoice_id = i.invoice_id ORDER BY a.step_no) approval_chain,
      (SELECT group_concat(DISTINCT l.gl_account || '/' || l.department_id) FROM invoice_lines l WHERE l.invoice_id = i.invoice_id) coding
    FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id LEFT JOIN vendors v ON v.vendor_id = p.vendor_id ORDER BY p.payment_id DESC LIMIT 600`);
  res.json(rows.map((r) => ({ ...r, prepared_by_name: userName(r.prepared_by), released_by_name: userName(r.released_by) })));
});
api.get('/audit/trace.csv', requirePerm('audit.export'), (req, res) => {
  const rows = all(`SELECT p.payment_id, p.reference, p.method, p.status, p.paid_date, p.amount, p.currency, p.amount_cad, i.invoice_id, i.vendor_invoice_number, v.legal_name vendor, i.invoice_date, i.total invoice_total,
      p.prepared_by, p.released_by,
      (SELECT group_concat(coalesce(a.approver_user_id, a.assigned_user_id) || ':' || a.approver_role || ':' || a.action || coalesce(':' || a.acted_at,'') || coalesce(':on behalf of ' || a.on_behalf_of_user_id, ''), ' > ') FROM approvals a WHERE a.invoice_id = i.invoice_id ORDER BY a.step_no) approval_chain,
      (SELECT group_concat(l.gl_account || '/' || l.department_id || '/' || l.amount, ' | ') FROM invoice_lines l WHERE l.invoice_id = i.invoice_id) coding
    FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id LEFT JOIN vendors v ON v.vendor_id = p.vendor_id ORDER BY p.payment_id`);
  audit({ actor: req.user, action: 'audit.exported', entityType: 'audit', entityId: 'trace.csv', details: {} });
  res.type('text/csv').attachment(`payment-trace-${today()}.csv`).send(toCsv(rows));
});

// ---------- insights & reports ----------
api.get('/recon', requirePerm('recon.view'), (_req, res) => res.json(reconcile()));
api.get('/journal', requirePerm('journal.export'), (req, res) => {
  const rows = journal({ from: req.query.from, to: req.query.to });
  const dr = round2(rows.reduce((a, r) => a + (Number(r.debit) || 0), 0));
  const cr = round2(rows.reduce((a, r) => a + (Number(r.credit) || 0), 0));
  res.json({ rows: rows.slice(-400), count: rows.length, debits: dr, credits: cr, balanced: Math.abs(dr - cr) < 0.05 });
});
api.get('/journal.csv', requirePerm('journal.export'), (req, res) => {
  audit({ actor: req.user, action: 'journal.exported', entityType: 'journal', entityId: `${req.query.from || ''}..${req.query.to || ''}`, details: {} });
  res.type('text/csv').attachment(`ap-journal-${today()}.csv`).send(journalCsv({ from: req.query.from, to: req.query.to }));
});
api.get('/analytics', requirePerm('spend.view.all', 'spend.view.dept'), (req, res) => {
  res.json(analytics({ department_id: can(req.user, 'spend.view.all') ? req.query.department_id || null : req.user.department_id }));
});
api.post('/ask', requirePerm('spend.view.all', 'spend.view.dept'), wrap(async (req, res) => {
  const q = String(req.body?.question || '').slice(0, 300);
  if (q.length < 4) throw bad('Ask a question about spend');
  res.json(await ask(q, { department_id: can(req.user, 'spend.view.all') ? null : req.user.department_id }));
}));
api.get('/coding/eval', requirePerm('invoice.code', 'audit.view'), (_req, res) => res.json(evaluateCoding(150)));
api.get('/coding/suggest', requirePerm('invoice.code'), (req, res) => {
  const vendor = req.query.vendor_id ? get('SELECT * FROM vendors WHERE vendor_id = ?', req.query.vendor_id) : null;
  res.json(suggestLine({ vendor, description: String(req.query.description || '') }));
});
api.get('/history-audit', requirePerm('audit.view', 'invoice.view.all'), (_req, res) => {
  // Duplicate payments already made in the 10-month history: recovery opportunities.
  const rows = all(`SELECT a.invoice_id a_id, b.invoice_id b_id, a.vendor_id a_vendor, b.vendor_id b_vendor, va.legal_name a_name, vb.legal_name b_name, a.vendor_invoice_number a_num, b.vendor_invoice_number b_num, a.invoice_date a_date, b.invoice_date b_date, a.total, a.status a_status, b.status b_status
    FROM invoices a JOIN invoices b ON a.invoice_id < b.invoice_id AND abs(a.total - b.total) < 0.01 AND a.total > 0
      AND (a.vendor_id = b.vendor_id OR EXISTS (SELECT 1 FROM vendors x, vendors y WHERE x.vendor_id = a.vendor_id AND y.vendor_id = b.vendor_id AND x.bank_account = y.bank_account))
      AND (a.invoice_number_norm = b.invoice_number_norm OR abs(julianday(a.invoice_date) - julianday(b.invoice_date)) <= 7)
    JOIN vendors va ON va.vendor_id = a.vendor_id JOIN vendors vb ON vb.vendor_id = b.vendor_id
    WHERE a.source = 'history' AND b.source = 'history' AND a.status = 'paid' AND b.status = 'paid'`);
  // Bills paid through AP that an employee had already put on their Brim card.
  const card = all(`SELECT c.txn_id, c.posted_date, c.amount_cad, c.merchant_descriptor, u.full_name holder, i.invoice_id, i.vendor_invoice_number, i.invoice_date, i.total_cad, v.legal_name
    FROM card_transactions c JOIN invoices i ON i.vendor_id = c.vendor_id AND abs(i.total_cad - c.amount_cad) < 0.01 AND i.status = 'paid'
      AND julianday(c.posted_date) - julianday(i.invoice_date) BETWEEN -10 AND 45
    JOIN vendors v ON v.vendor_id = i.vendor_id LEFT JOIN users u ON u.user_id = c.cardholder_user_id
    WHERE c.source = 'employee_card'`);
  res.json({ pairs: rows, card, recoverable_cad: round2(rows.reduce((x, r) => x + r.total, 0) + card.reduce((x, r) => x + r.amount_cad, 0)) });
});

// ---------- system ----------
api.post('/admin/reset', requirePerm('system.reset'), wrap(async (req, res) => {
  seedHistory({ reset: true });
  const r = await processInbox({ actor: 'system' });
  invalidateCodingIndex();
  res.json(r.summary);
}));

// ---------- errors ----------
api.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  if (status === 403 && req.user && !/denied/.test(err.code || '')) {
    try { audit({ actor: req.user, action: 'access.denied', entityType: 'route', entityId: `${req.method} ${req.path}`, details: { reason: err.message } }); } catch { /* ignore */ }
  }
  res.status(status).json({ error: err.message, code: err.code || null });
});
