// Builds the database from the dataset CSVs (history), then optionally processes the AP inbox.
// Run directly: `node server/seed.js --reset` ; also called on boot when the DB is empty.
import fs from 'node:fs';
import path from 'node:path';
import { getDb, insert, tx, setSequenceAtLeast, closeDb, get } from './db.js';
import { config } from './config.js';
import { parseCsv, num, normInvoiceNumber, normName } from './util.js';
import { audit } from './services/audit.js';

const csv = (name) => parseCsv(fs.readFileSync(path.join(config.datasetDir, 'data', name), 'utf8'));
const yes = (v) => (v === 'yes' ? 1 : v === 'no' ? 0 : null);

// approval_policies.csv is prose; we translate it once into structured, editable rules.
const POLICY_STRUCTURE = {
  P01: { kind: 'amount_chain', min: 0, max: 10000, chain: ['dept_manager'] },
  P02: { kind: 'amount_chain', min: 10000, max: 50000, chain: ['dept_manager', 'finance_manager'] },
  P03: { kind: 'amount_chain', min: 50000, max: 250000, chain: ['dept_manager', 'finance_manager', 'controller_admin'] },
  P04: { kind: 'amount_chain', min: 250000, max: null, chain: ['dept_manager', 'finance_manager', 'controller_admin', 'cfo'] },
  P05: { kind: 'vendor_new', chain: ['finance_manager'] },
  P06: { kind: 'vendor_category', param: 'Legal', chain: ['finance_manager'] },
  P07: { kind: 'self_approval', chain: ['manager'] },
  P08: { kind: 'on_leave', chain: ['delegate'] },
  P09: { kind: 'release_limit', min: 0, max: 100000, chain: ['finance_manager', 'controller_admin'] },
  P10: { kind: 'release_limit', min: 100000, max: null, chain: ['controller_admin'] },
  P11: { kind: 'release_sod', chain: [] },
  P12: { kind: 'po_balance', chain: ['finance_manager'] },
  P13: { kind: 'po_required', chain: [] },
};

export function seedHistory({ reset = false } = {}) {
  if (reset) {
    closeDb();
    for (const f of [config.dbPath, config.dbPath + '-wal', config.dbPath + '-shm']) fs.rmSync(f, { force: true });
    fs.rmSync(config.uploadsDir, { recursive: true, force: true });
  }
  const db = getDb();
  if (get('SELECT count(*) c FROM invoices').c > 0) return false;

  tx(() => {
    for (const r of csv('departments.csv')) insert('departments', { ...r, annual_budget_cad: num(r.annual_budget_cad) });
    for (const r of csv('users.csv')) {
      insert('users', { ...r, approval_limit_cad: num(r.approval_limit_cad) || 0, manager_id: r.manager_id || null, delegate_user_id: r.delegate_user_id || null });
      if (r.status === 'on_leave' && r.delegate_user_id) {
        insert('delegations', { user_id: r.user_id, delegate_user_id: r.delegate_user_id, starts_on: r.status_since, ends_on: null, reason: 'On leave (HR record)', created_by: 'system', created_at: r.status_since });
      }
    }
    for (const r of csv('gl_accounts.csv')) insert('gl_accounts', r);
    for (const r of csv('tax_codes.csv')) insert('tax_codes', { ...r, rate: num(r.rate) });
    for (const r of csv('vendors.csv')) {
      insert('vendors', {
        ...r, payment_terms_days: num(r.payment_terms_days), accepts_card_payment: yes(r.accepts_card_payment), requires_po: yes(r.requires_po),
        currency: ['US'].includes(r.country) ? 'USD' : 'CAD', bank_details_updated_at: r.bank_details_updated_at || null,
      });
    }
    for (const r of csv('bank_change_history.csv')) insert('bank_changes', { ...r, status: 'applied' });
    for (const r of csv('contracts.csv')) {
      insert('contracts', { ...r, monthly_fee: num(r.monthly_fee), hourly_rate_cap: num(r.hourly_rate_cap), fuel_surcharge_cap_pct: num(r.fuel_surcharge_cap_pct), not_to_exceed_monthly: num(r.not_to_exceed_monthly) });
    }
    for (const r of csv('purchase_orders.csv')) insert('purchase_orders', { ...r, total_amount: num(r.total_amount) });
    for (const r of csv('fx_rates.csv')) insert('fx_rates', { date: r.date, usd_to_cad: num(r.usd_to_cad) });

    csv('approval_policies.csv').forEach((r, i) => {
      const s = POLICY_STRUCTURE[r.rule_id] || { kind: 'custom', chain: [] };
      insert('policies', {
        rule_id: r.rule_id, rule_type: r.rule_type, kind: s.kind, min_amount_cad: s.min ?? null, max_amount_cad: s.max ?? null,
        chain: JSON.stringify(s.chain), param: s.param ?? null, condition_text: r.condition, required_text: r.required, notes: r.notes, active: 1, sort: i,
      });
    });

    const lines = csv('invoice_lines.csv');
    const linesByInv = new Map();
    for (const l of lines) (linesByInv.get(l.invoice_id) || linesByInv.set(l.invoice_id, []).get(l.invoice_id)).push(l);

    let maxInv = 0;
    for (const r of csv('invoices.csv')) {
      maxInv = Math.max(maxInv, Number(r.invoice_id.replace(/\D/g, '')));
      const total = num(r.total);
      insert('invoices', {
        ...r, invoice_number_norm: normInvoiceNumber(r.vendor_invoice_number), doc_type: total < 0 ? 'credit_note' : 'invoice',
        subtotal: num(r.subtotal), gst_hst_amount: num(r.gst_hst_amount), pst_qst_amount: num(r.pst_qst_amount), total,
        fx_rate_to_cad: num(r.fx_rate_to_cad), total_cad: num(r.total_cad), po_id: r.po_id || null, contract_id: r.contract_id || null,
        source: 'history', created_at: r.received_date, updated_at: r.received_date,
      });
      const ls = linesByInv.get(r.invoice_id) || [];
      for (const l of ls) {
        insert('invoice_lines', {
          invoice_id: l.invoice_id, line_no: num(l.line_no), description: l.description, quantity: num(l.quantity), unit_price: num(l.unit_price), amount: num(l.amount),
          gl_account: l.gl_account, department_id: l.department_id, gst_hst_code: l.gst_hst_code || null, pst_qst_code: l.pst_qst_code || null, line_type: l.line_type, coding_source: 'history',
        });
      }
      const gstCode = ls.find((l) => l.gst_hst_code)?.gst_hst_code;
      const pstCode = ls.find((l) => l.pst_qst_code)?.pst_qst_code;
      if (num(r.gst_hst_amount)) insert('invoice_taxes', { invoice_id: r.invoice_id, code: gstCode || 'GST5', label: gstCode || 'GST', amount: num(r.gst_hst_amount) });
      if (num(r.pst_qst_amount)) insert('invoice_taxes', { invoice_id: r.invoice_id, code: pstCode || 'PST7_BC', label: pstCode || 'PST', amount: num(r.pst_qst_amount) });
    }
    setSequenceAtLeast('invoice', maxInv);

    let maxA = 0;
    for (const r of csv('approvals.csv')) {
      maxA = Math.max(maxA, Number(r.approval_id.replace(/\D/g, '')));
      insert('approvals', { ...r, step_no: num(r.step_no), assigned_user_id: r.approver_user_id, comment: r.comment || null, reason: 'Historical approval' });
    }
    setSequenceAtLeast('approval', maxA);

    let maxP = 0;
    for (const r of csv('payments.csv')) {
      maxP = Math.max(maxP, Number(r.payment_id.replace(/\D/g, '')));
      insert('payments', {
        ...r, amount: num(r.amount), fx_rate_to_cad: num(r.fx_rate_to_cad), amount_cad: num(r.amount_cad), discount_taken: num(r.discount_taken) || 0,
        paid_date: r.paid_date || null, released_by: r.released_by || null, released_at: r.released_by ? r.scheduled_date : null, prepared_at: r.scheduled_date,
      });
    }
    setSequenceAtLeast('payment', maxP);

    for (const r of csv('bank_statement.csv')) insert('bank_statement', { ...r, debit: num(r.debit), credit: num(r.credit) });

    const vendors = db.prepare('SELECT vendor_id, legal_name FROM vendors').all().map((v) => ({ ...v, n: normName(v.legal_name).replace(/ /g, '') }));
    for (const r of csv('card_transactions.csv')) {
      let invoiceId = null, vendorId = null;
      const m = /AP payment (AP-\d+)/.exec(r.memo || '');
      if (m) {
        invoiceId = m[1];
        vendorId = get('SELECT vendor_id FROM invoices WHERE invoice_id = ?', invoiceId)?.vendor_id || null;
      } else {
        const d = normName(r.merchant_descriptor).replace(/ /g, '');
        const hit = vendors.find((v) => d.length >= 8 && (v.n.startsWith(d.slice(0, Math.min(d.length, 16))) || d.startsWith(v.n.slice(0, 16))));
        vendorId = hit?.vendor_id || null;
      }
      insert('card_transactions', { ...r, amount: num(r.amount), amount_cad: num(r.amount_cad), vendor_id: vendorId, invoice_id: invoiceId });
    }

    for (const r of JSON.parse(fs.readFileSync(path.join(config.datasetDir, 'inbox', 'emails.json'), 'utf8'))) {
      insert('emails', { ...r, attachments: JSON.stringify(r.attachments || []), status: 'new' });
    }
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('seeded_at', datetime('now'))").run();
    audit({ actor: 'system', action: 'system.seeded', entityType: 'system', entityId: 'seed', details: { source: 'brim_ap_dataset CSVs' } });
  });
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const reset = process.argv.includes('--reset');
  const t = Date.now();
  seedHistory({ reset });
  const { processInbox } = await import('./services/ingest.js');
  const r = await processInbox({ actor: 'system' });
  console.log(`seeded in ${Date.now() - t}ms`, r.summary);
}
