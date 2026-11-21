// Role-based access control. Two layers, both on the server:
//   1. Capability matrix: may this role perform this kind of action at all?
//   2. Row-level scope + separation-of-duties checks: may THIS user act on THIS record?
// The UI reads the same matrix (GET /api/me) only to decide what to show.
import crypto from 'node:crypto';
import { get, all } from './db.js';
import { config, today } from './config.js';

export const ROLES = ['employee', 'ap_clerk', 'approver', 'finance_manager', 'controller_admin', 'auditor'];

const R = {
  employee: ['invoice.submit', 'invoice.view.own'],
  ap_clerk: ['invoice.view.all', 'invoice.submit', 'invoice.ingest', 'invoice.edit', 'invoice.code', 'flag.resolve', 'invoice.route', 'payment.prepare', 'payment.view',
    'vendor.view', 'vendor.create', 'vendor.bank.request', 'vendor.bank.verify', 'inbox.view', 'recon.view', 'spend.view.all', 'journal.export'],
  approver: ['invoice.view.dept', 'invoice.submit', 'invoice.approve', 'delegation.self', 'spend.view.dept', 'vendor.view'],
  finance_manager: ['invoice.view.all', 'invoice.approve', 'payment.view', 'payment.release', 'vendor.view', 'vendor.approve', 'vendor.bank.approve', 'flag.resolve', 'flag.resolve.fraud',
    'delegation.self', 'spend.view.all', 'recon.view', 'journal.export', 'inbox.view', 'audit.view'],
  controller_admin: ['invoice.view.all', 'invoice.approve', 'payment.view', 'payment.release', 'payment.release.any', 'vendor.view', 'vendor.approve', 'vendor.bank.approve',
    'flag.resolve', 'flag.resolve.fraud', 'delegation.self', 'delegation.any', 'spend.view.all', 'recon.view', 'journal.export', 'inbox.view', 'audit.view', 'audit.export',
    'users.manage', 'policies.manage', 'system.reset'],
  auditor: ['invoice.view.all', 'payment.view', 'vendor.view', 'spend.view.all', 'recon.view', 'journal.export', 'inbox.view', 'audit.view', 'audit.export'],
};
export const permissionsFor = (role) => R[role] || [];
export const can = (user, perm) => !!user && permissionsFor(user.role).includes(perm);

export class Forbidden extends Error {
  constructor(message, code = 'forbidden') { super(message); this.status = 403; this.code = code; }
}
export function assert(cond, message, code) {
  if (!cond) throw new Forbidden(message, code);
}
export function requirePerm(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(Object.assign(new Error('Sign in first'), { status: 401 }));
    if (!perms.some((p) => can(req.user, p))) return next(new Forbidden(`Your role (${req.user.role.replace('_', ' ')}) can't do this: needs ${perms.join(' or ')}.`));
    next();
  };
}

// ---------- tokens (stateless, HMAC-signed) ----------
export function signToken(userId, ttlSec = 60 * 60 * 12) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifyToken(tok) {
  const [uid, exp, sig] = String(tok || '').split('.');
  if (!uid || !exp || !sig) return null;
  const want = crypto.createHmac('sha256', config.sessionSecret).update(`${uid}.${exp}`).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return uid;
}
export function authenticate(req, _res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  const uid = verifyToken(tok);
  if (uid) {
    const u = get('SELECT * FROM users WHERE user_id = ?', uid);
    if (u && u.status !== 'terminated') req.user = u;
  }
  next();
}

// ---------- row-level scope ----------
// Users this person may act for today (themselves + anyone who delegated to them).
export function actingFor(user) {
  const t = today();
  const rows = all(`SELECT user_id FROM delegations WHERE delegate_user_id = ? AND active = 1 AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?)`, user.user_id, t, t);
  return [user.user_id, ...rows.map((r) => r.user_id)];
}

// SQL fragment limiting invoices to what this user may see.
export function invoiceScope(user, alias = 'i') {
  if (can(user, 'invoice.view.all')) return { sql: '1=1', params: [] };
  if (can(user, 'invoice.view.dept')) {
    const ids = actingFor(user);
    const depts = all(`SELECT DISTINCT department_id FROM users WHERE user_id IN (${ids.map(() => '?').join(',')})`, ...ids).map((d) => d.department_id);
    const managed = all(`SELECT department_id FROM departments WHERE manager_user_id IN (${ids.map(() => '?').join(',')})`, ...ids).map((d) => d.department_id);
    const all_ = [...new Set([...depts, ...managed])];
    return {
      sql: `(${alias}.department_id IN (${all_.map(() => '?').join(',') || "''"}) OR ${alias}.requester_user_id = ? OR ${alias}.submitted_by = ? OR EXISTS (SELECT 1 FROM approvals a WHERE a.invoice_id = ${alias}.invoice_id AND (a.assigned_user_id IN (${ids.map(() => '?').join(',')}) OR a.approver_user_id = ?)))`,
      params: [...all_, user.user_id, user.user_id, ...ids, user.user_id],
    };
  }
  return { sql: `(${alias}.requester_user_id = ? OR ${alias}.submitted_by = ?)`, params: [user.user_id, user.user_id] };
}

export function canSeeInvoice(user, invoiceId) {
  const s = invoiceScope(user);
  return !!get(`SELECT 1 FROM invoices i WHERE i.invoice_id = ? AND ${s.sql}`, invoiceId, ...s.params);
}
export function assertSeeInvoice(user, invoiceId) {
  const exists = get('SELECT 1 FROM invoices WHERE invoice_id = ?', invoiceId);
  if (!exists) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  // Out-of-scope rows look exactly like missing rows: no information leak.
  if (!canSeeInvoice(user, invoiceId)) throw Object.assign(new Error('Invoice not found'), { status: 404 });
}

// ---------- separation of duties ----------
export function currentStep(invoiceId) {
  return get(`SELECT * FROM approvals WHERE invoice_id = ? AND action = 'pending' ORDER BY step_no LIMIT 1`, invoiceId);
}

// Returns { ok, reason, onBehalfOf } for "may this user approve the invoice's current step now?"
export function approvalDecision(user, inv) {
  if (!can(user, 'invoice.approve')) return { ok: false, reason: `${user.role.replace('_', ' ')}s can't approve invoices.` };
  if (inv.status !== 'pending_approval') return { ok: false, reason: `Invoice is ${inv.status.replace('_', ' ')}, not awaiting approval.` };
  if (inv.requester_user_id === user.user_id || inv.submitted_by === user.user_id) return { ok: false, reason: 'You requested this invoice; nobody approves their own request (P07).' };
  const step = currentStep(inv.invoice_id);
  if (!step) return { ok: false, reason: 'No pending approval step.' };
  const away = get(`SELECT d.delegate_user_id, u.full_name FROM delegations d JOIN users u ON u.user_id = d.delegate_user_id WHERE d.user_id = ? AND d.active = 1 AND d.starts_on <= ? AND (d.ends_on IS NULL OR d.ends_on >= ?)`, user.user_id, today(), today());
  if (away) return { ok: false, reason: `You're marked away; ${away.full_name} is approving for you. End the delegation to approve again.` };
  const prior = get(`SELECT 1 FROM approvals WHERE invoice_id = ? AND approver_user_id = ? AND action = 'approved'`, inv.invoice_id, user.user_id);
  if (prior) return { ok: false, reason: 'You already approved an earlier step of this invoice; a different person must sign this step.' };
  if (step.assigned_user_id === user.user_id) return { ok: true, step, onBehalfOf: step.on_behalf_of_user_id || null };
  // Delegation granted after routing: the assignee delegated to this user.
  const ids = actingFor(user);
  if (ids.includes(step.assigned_user_id)) return { ok: true, step, onBehalfOf: step.assigned_user_id };
  if (step.on_behalf_of_user_id && ids.includes(step.on_behalf_of_user_id)) return { ok: true, step, onBehalfOf: step.on_behalf_of_user_id };
  const who = get('SELECT full_name FROM users WHERE user_id = ?', step.assigned_user_id)?.full_name;
  return { ok: false, reason: `This step is assigned to ${who}.` };
}

// Payment release: role + amount limit (P09/P10) + nobody who requested, prepared or approved it (P11).
export function releaseDecision(user, payment, inv, releaseRule) {
  if (!can(user, 'payment.release')) return { ok: false, reason: `${user.role.replace('_', ' ')}s can't release payments; AP prepares, a finance manager or controller releases.` };
  if (!releaseRule.roles.includes(user.role)) return { ok: false, reason: `Payments of this size need ${releaseRule.roles.join(' or ').replace(/_/g, ' ')} (${releaseRule.rule}).` };
  const approved = all(`SELECT approver_user_id, on_behalf_of_user_id FROM approvals WHERE invoice_id = ? AND action = 'approved'`, inv.invoice_id);
  if (approved.some((a) => a.approver_user_id === user.user_id)) return { ok: false, reason: 'You approved this invoice, so you can\'t release its payment (P11 separation of duties).' };
  if (approved.some((a) => a.on_behalf_of_user_id === user.user_id)) return { ok: false, reason: 'This invoice was approved on your behalf; you can\'t release its payment.' };
  if (payment.prepared_by === user.user_id) return { ok: false, reason: 'You prepared this payment; a second person must release it.' };
  if (inv.requester_user_id === user.user_id) return { ok: false, reason: 'You requested this invoice; you can\'t release its payment.' };
  return { ok: true };
}
