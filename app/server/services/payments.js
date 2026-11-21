// Payments: AP prepares, a second person releases (role + limit + SoD), settlement is simulated.
import crypto from 'node:crypto';
import { all, get, insert, update, nextId, run } from '../db.js';
import { nowIso, today } from '../config.js';
import { round2, money, normName } from '../util.js';
import { releaseRolesFor } from './routing.js';
import { bestPayDay } from './insights.js';
import { fxRate } from './checks.js';
import { audit } from './audit.js';
import { releaseDecision, Forbidden } from '../policy.js';

const err = (m, status = 400) => Object.assign(new Error(m), { status });

export function preparePayment(user, invoiceId, { method, scheduled_date, apply_discount = true } = {}) {
  const inv = get('SELECT * FROM invoices WHERE invoice_id = ?', invoiceId);
  if (!inv) throw err('Invoice not found', 404);
  if (inv.status !== 'approved') throw err(`Only approved invoices can be scheduled; this one is ${inv.status.replace('_', ' ')}.`);
  if (inv.doc_type === 'credit_note') throw err('Credit notes are applied against the next payment, not paid out.');
  const blocks = all(`SELECT title FROM flags WHERE invoice_id = ? AND status = 'open' AND severity = 'block'`, invoiceId);
  if (blocks.length) throw err(`Resolve first: ${blocks.map((b) => b.title).join('; ')}`);
  const vendor = get('SELECT * FROM vendors WHERE vendor_id = ?', inv.vendor_id);
  if (!vendor || vendor.status !== 'active') throw err(`Vendor is ${vendor?.status || 'unknown'}; payments are held until it is active.`);
  const pending = get(`SELECT change_id FROM bank_changes WHERE vendor_id = ? AND status = 'pending'`, vendor.vendor_id);
  if (pending) throw err(`Bank change ${pending.change_id} is awaiting approval; payment held.`);
  if (get(`SELECT 1 FROM payments WHERE invoice_id = ? AND status NOT IN ('cancelled','failed')`, invoiceId)) throw err('A payment already exists for this invoice.');
  const best = bestPayDay(inv, vendor, method);
  const m = method || best.method;
  if (m === 'CARD' && !vendor.accepts_card_payment) throw err(`${vendor.legal_name} doesn't accept card payments.`);
  const date = scheduled_date || best.pay_on;
  let amount = inv.total;
  let discount = 0;
  if (apply_discount && best.discount && date <= best.discount.deadline) { discount = round2(inv.total * best.discount.percent / 100); amount = round2(amount - discount); }
  // Apply this vendor's approved, unapplied credit notes.
  const credits = all(`SELECT * FROM invoices WHERE vendor_id = ? AND doc_type = 'credit_note' AND status = 'approved' AND currency = ?`, vendor.vendor_id, inv.currency);
  const applied = [];
  for (const c of credits) {
    if (amount + c.total < 0) continue;
    amount = round2(amount + c.total);
    applied.push(c.invoice_id);
  }
  const fx = fxRate(date, inv.currency);
  const id = nextId('payment', 'PAY-');
  const p = {
    payment_id: id, invoice_id: invoiceId, vendor_id: vendor.vendor_id, method: m, scheduled_date: date, currency: inv.currency, amount,
    fx_rate_to_cad: fx, amount_cad: round2(amount * fx), discount_taken: discount, reference: null, status: 'scheduled', prepared_by: user.user_id, prepared_at: nowIso(),
    bank_snapshot: JSON.stringify({ institution: vendor.bank_institution, transit: vendor.bank_transit, account_last4: String(vendor.bank_account || '').slice(-4), as_of: vendor.bank_details_updated_at || vendor.onboarded_at }),
  };
  insert('payments', p);
  for (const c of applied) {
    update('invoices', 'invoice_id', c, { status: 'applied', updated_at: nowIso() });
    audit({ actor: user, action: 'credit_note.applied', entityType: 'invoice', entityId: c, invoiceId: c, details: { against: invoiceId, payment: id } });
  }
  update('invoices', 'invoice_id', invoiceId, { status: 'scheduled', updated_at: nowIso() });
  audit({ actor: user, action: 'payment.prepared', entityType: 'payment', entityId: id, invoiceId, details: { method: m, scheduled_date: date, amount, currency: inv.currency, discount, credits_applied: applied, why: best.reason } });
  return get('SELECT * FROM payments WHERE payment_id = ?', id);
}

export function releasePayment(user, paymentId) {
  const p = get('SELECT * FROM payments WHERE payment_id = ?', paymentId);
  if (!p) throw err('Payment not found', 404);
  if (p.status !== 'scheduled') throw err(`Payment is ${p.status}; only scheduled payments can be released.`);
  const inv = get('SELECT * FROM invoices WHERE invoice_id = ?', p.invoice_id);
  const rule = releaseRolesFor(p.amount_cad);
  const d = releaseDecision(user, p, inv, rule);
  if (!d.ok) {
    audit({ actor: user, action: 'payment.release_denied', entityType: 'payment', entityId: paymentId, invoiceId: p.invoice_id, details: { reason: d.reason } });
    throw new Forbidden(d.reason, 'sod');
  }
  const vendor = get('SELECT * FROM vendors WHERE vendor_id = ?', p.vendor_id);
  // Bank details must not have changed between preparation and release.
  const snap = JSON.parse(p.bank_snapshot || '{}');
  if (p.method !== 'CARD' && snap.account_last4 && snap.account_last4 !== String(vendor.bank_account || '').slice(-4)) {
    throw err('Vendor bank details changed after this payment was prepared. Cancel and re-prepare it.', 409);
  }
  const rnd = () => String(crypto.randomInt(10_000_000, 99_999_999));
  const patch = { released_by: user.user_id, released_at: nowIso() };
  if (p.method === 'CARD') {
    // Single-use virtual card: issued for the exact amount, charged by the vendor, then closed.
    const last4 = String(crypto.randomInt(1000, 9999));
    const txnId = nextId('cardtxn', 'CT-9', 4);
    insert('card_transactions', {
      txn_id: txnId, card_id: `VC-${p.invoice_id}`, cardholder_user_id: p.prepared_by, posted_date: today(), merchant_descriptor: vendor.legal_name.toUpperCase().slice(0, 22),
      mcc: '5734', amount: p.amount, currency: p.currency, amount_cad: p.amount_cad, source: 'ap_virtual_card', receipt_attached: 'yes', memo: `AP payment ${p.invoice_id}`, vendor_id: vendor.vendor_id, invoice_id: p.invoice_id,
    });
    Object.assign(patch, { status: 'settled', paid_date: today(), reference: `BRIM-VC-${rnd()}`, card_last4: last4 });
    update('invoices', 'invoice_id', p.invoice_id, { status: 'paid', updated_at: nowIso() });
  } else {
    Object.assign(patch, { status: 'released', reference: `BRIM-${p.method === 'CHEQUE' ? 'CHQ' : 'EFT'}-${rnd()}` });
  }
  update('payments', 'payment_id', paymentId, patch);
  audit({ actor: user, action: 'payment.released', entityType: 'payment', entityId: paymentId, invoiceId: p.invoice_id, details: { method: p.method, amount: p.amount, currency: p.currency, amount_cad: p.amount_cad, reference: patch.reference, rule: rule.rule } });
  settleDue();
  return get('SELECT * FROM payments WHERE payment_id = ?', paymentId);
}

export function cancelPayment(user, paymentId, reason) {
  const p = get('SELECT * FROM payments WHERE payment_id = ?', paymentId);
  if (!p) throw err('Payment not found', 404);
  if (!['scheduled'].includes(p.status)) throw err(`A ${p.status} payment can't be cancelled.`);
  update('payments', 'payment_id', paymentId, { status: 'cancelled', failure_reason: reason || 'Cancelled' });
  update('invoices', 'invoice_id', p.invoice_id, { status: 'approved', updated_at: nowIso() });
  audit({ actor: user, action: 'payment.cancelled', entityType: 'payment', entityId: paymentId, invoiceId: p.invoice_id, details: { reason } });
}

// Simulated EFT rail: released payments settle on their scheduled date and post a bank-statement debit.
export function settleDue({ force = false } = {}) {
  const t = today();
  const due = all(`SELECT * FROM payments WHERE status = 'released' AND (scheduled_date <= ? OR ?)`, t, force ? 1 : 0);
  for (const p of due) {
    const vendor = get('SELECT legal_name FROM vendors WHERE vendor_id = ?', p.vendor_id);
    const paid = p.scheduled_date <= t ? p.scheduled_date : t;
    update('payments', 'payment_id', p.payment_id, { status: p.method === 'CHEQUE' ? 'outstanding' : 'settled', paid_date: paid });
    update('invoices', 'invoice_id', p.invoice_id, { status: 'paid', updated_at: nowIso() });
    if (p.method === 'EFT') {
      const bk = nextId('bank', 'BK-9', 4);
      insert('bank_statement', { bank_txn_id: bk, posted_date: paid, description: `EFT PMT ${normName(vendor.legal_name).toUpperCase().slice(0, 22)} ${String(p.reference).slice(-6)}`, debit: p.amount_cad, credit: null });
    }
    audit({ actor: 'system', action: 'payment.settled', entityType: 'payment', entityId: p.payment_id, invoiceId: p.invoice_id, details: { paid_date: paid, simulated: true } });
  }
  return due.length;
}

export function paymentsDashboard() {
  settleDue();
  const t = today();
  const rows = all(`SELECT p.*, v.legal_name vendor_name, i.vendor_invoice_number, i.due_date, i.department_id,
      (SELECT full_name FROM users WHERE user_id = p.prepared_by) prepared_by_name, (SELECT full_name FROM users WHERE user_id = p.released_by) released_by_name
    FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id LEFT JOIN vendors v ON v.vendor_id = p.vendor_id ORDER BY coalesce(p.paid_date, p.scheduled_date) DESC`);
  const ready = all(`SELECT i.*, v.legal_name vendor_name, v.preferred_payment_method, v.accepts_card_payment, v.early_pay_discount, v.payment_terms_days FROM invoices i LEFT JOIN vendors v ON v.vendor_id = i.vendor_id
    WHERE i.status = 'approved' AND i.doc_type = 'invoice' ORDER BY i.due_date`).map((i) => ({ ...i, suggestion: bestPayDay(i, i.vendor_id ? get('SELECT * FROM vendors WHERE vendor_id = ?', i.vendor_id) : null) }));
  const sum = (arr) => round2(arr.reduce((a, r) => a + (r.amount_cad || r.total_cad || 0), 0));
  const awaiting = rows.filter((r) => r.status === 'scheduled');
  const inflight = rows.filter((r) => r.status === 'released');
  const next7 = rows.filter((r) => ['scheduled', 'released'].includes(r.status) && r.scheduled_date <= addDaysIso(t, 7));
  return {
    kpis: {
      ready_to_schedule: { count: ready.length, cad: sum(ready) },
      awaiting_release: { count: awaiting.length, cad: sum(awaiting) },
      in_flight: { count: inflight.length, cad: sum(inflight) },
      next_7_days: { count: next7.length, cad: sum(next7) },
      discounts_available: ready.filter((r) => r.suggestion.discount).map((r) => ({ invoice_id: r.invoice_id, saving: r.suggestion.discount.saving, deadline: r.suggestion.discount.deadline })),
      paid_30d: { count: rows.filter((r) => r.status === 'settled' && r.paid_date >= addDaysIso(t, -30)).length, cad: sum(rows.filter((r) => r.status === 'settled' && r.paid_date >= addDaysIso(t, -30))) },
    },
    ready, payments: rows,
  };
}

function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

// CPA-005-style fixed-width EFT batch (simplified) for released payments.
export function eftFile() {
  const rows = all(`SELECT p.*, v.legal_name, v.bank_institution, v.bank_transit, v.bank_account FROM payments p JOIN vendors v ON v.vendor_id = p.vendor_id WHERE p.method = 'EFT' AND p.status IN ('released','scheduled') ORDER BY p.scheduled_date`);
  const pad = (s, n, c = ' ', left = false) => (left ? String(s ?? '').padStart(n, c) : String(s ?? '').padEnd(n, c)).slice(0, n);
  const lines = [`A${pad(1, 9, '0', true)}HARBORLINE${pad(today().replace(/-/g, ''), 8)}CAD`];
  let total = 0;
  for (const r of rows) {
    total += r.amount;
    lines.push(`C${pad(Math.round(r.amount * 100), 10, '0', true)}${pad(r.scheduled_date.replace(/-/g, ''), 8)}${pad(r.bank_institution, 4, '0', true)}${pad(r.bank_transit, 5, '0', true)}${pad(r.bank_account, 12)}${pad(r.legal_name.toUpperCase(), 30)}${pad(r.payment_id, 19)}`);
  }
  lines.push(`Z${pad(Math.round(total * 100), 14, '0', true)}${pad(rows.length, 8, '0', true)}`);
  return lines.join('\n') + '\n';
}

export { money, run };
