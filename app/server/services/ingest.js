// Intake pipeline: email -> attachments -> extraction -> vendor match -> coding -> checks -> routing.
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, insert, update, tx, nextId } from '../db.js';
import { config, nowIso, today } from '../config.js';
import { round2, normInvoiceNumber, money, emailDomain, daysBetween } from '../util.js';
import { extractDocument, sha256 } from './extract.js';
import { matchVendor } from './vendors.js';
import { suggestLine, inferRequester } from './coding.js';
import { runChecks, splitCheck, fxRate, expectedTaxes } from './checks.js';
import { buildRoute, describeRoute } from './routing.js';
import { audit } from './audit.js';
import { recommend } from './insights.js';

const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff' };
export const mimeFor = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

// ---------- email classification ----------
export function classifyEmail(e) {
  const atts = JSON.parse(e.attachments || '[]');
  const text = `${e.subject}\n${e.body}`.toLowerCase();
  const vendor = get('SELECT vendor_id, legal_name FROM vendors WHERE lower(ap_contact_email) = ?', (e.from_address || '').toLowerCase())
    || get('SELECT vendor_id, legal_name FROM vendors WHERE lower(ap_contact_email) LIKE ?', '%@' + emailDomain(e.from_address));
  const mentionsInvoice = /\b(invoice|facture|bill|inv\b)/.test(text);
  if (atts.length) return { classification: 'invoice', reason: `${atts.length} attachment${atts.length > 1 ? 's' : ''}; each becomes a draft bill`, vendor };
  if (/statement of account|relev[ée] de compte/.test(text)) return { classification: 'statement', reason: 'Vendor statement with no attachment; filed for reconciliation, no bill created', vendor };
  if (/where is payment|not (yet )?(seen|received) payment|payment status|confirm the status|paiement/.test(text)) {
    const m = /invoice\s+#?\s*([A-Z0-9-]+)/i.exec(`${e.subject} ${e.body}`);
    return { classification: 'payment_inquiry', reason: `Vendor asking about payment${m ? ` for invoice ${m[1]}` : ''}; routed to AP with the status answer`, vendor, ref: m?.[1] };
  }
  if (/(sale|% off|shop now|unsubscribe|newsletter|promo)/.test(text) || /^(news|marketing|promo|noreply)@/.test(e.from_address || '')) return { classification: 'not_invoice', reason: 'Marketing email; ignored', vendor };
  if (mentionsInvoice) return { classification: 'missing_attachment', reason: 'Says an invoice is attached but nothing is attached; ask the sender to resend', vendor };
  return { classification: 'not_invoice', reason: 'No invoice content; ignored', vendor };
}

export function paymentInquiryAnswer(vendorId, ref) {
  if (!ref) return null;
  const inv = get(`SELECT * FROM invoices WHERE vendor_id = ? AND invoice_number_norm = ?`, vendorId, normInvoiceNumber(ref));
  if (!inv) return { found: false, text: `No invoice ${ref} on file for this vendor. Ask them to send a copy.` };
  const pay = get(`SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_id DESC LIMIT 1`, inv.invoice_id);
  const text = pay
    ? `Invoice ${ref} (${inv.invoice_id}, ${money(inv.total, inv.currency)}) was ${pay.status === 'settled' ? `paid on ${pay.paid_date}` : `scheduled for ${pay.scheduled_date} (${pay.status})`} by ${pay.method}, reference ${pay.reference}.`
    : `Invoice ${ref} (${inv.invoice_id}) is ${inv.status.replace('_', ' ')}; no payment yet.`;
  return { found: true, invoice_id: inv.invoice_id, payment_id: pay?.payment_id, text };
}

// ---------- processing ----------
export async function processInbox({ actor = 'system', emailIds = null } = {}) {
  const emails = all(`SELECT * FROM emails WHERE status = 'new' ${emailIds ? `AND email_id IN (${emailIds.map(() => '?').join(',')})` : ''} ORDER BY received_at`, ...(emailIds || []));
  const summary = { emails: emails.length, bills: 0, ignored: 0, inquiries: 0, errors: 0 };
  const created = [];
  for (const e of emails) {
    const c = classifyEmail(e);
    update('emails', 'email_id', e.email_id, { classification: c.classification, classification_reason: c.reason, matched_vendor_id: c.vendor?.vendor_id || null, status: c.classification === 'invoice' ? 'processing' : 'routed', processed_at: nowIso() });
    audit({ actor, action: 'email.classified', entityType: 'email', entityId: e.email_id, details: { classification: c.classification, reason: c.reason } });
    if (c.classification !== 'invoice') { if (c.classification === 'payment_inquiry') summary.inquiries++; else summary.ignored++; continue; }
    for (const name of JSON.parse(e.attachments || '[]')) {
      const src = path.join(config.datasetDir, 'incoming_invoices', name);
      if (!fs.existsSync(src)) { summary.errors++; continue; }
      try {
        const inv = await ingestFile({ buffer: fs.readFileSync(src), filename: name, source: 'email', email: e, actor });
        created.push(inv.invoice_id); summary.bills++;
      } catch (err) {
        summary.errors++;
        audit({ actor, action: 'ingest.error', entityType: 'email', entityId: e.email_id, details: { file: name, error: err.message } });
      }
    }
    update('emails', 'email_id', e.email_id, { status: 'processed' });
  }
  return { summary, created };
}

export async function ingestFile({ buffer, filename, source = 'upload', email = null, actor = 'system', submitter = null, note = null }) {
  const sha = sha256(buffer);
  const mime = mimeFor(filename);
  const ex = await extractDocument({ buffer, filename, mime });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const docId = `DOC-${sha.slice(0, 12)}-${Date.now().toString(36)}`;
  const storage = path.join(config.uploadsDir, `${docId}${path.extname(filename).toLowerCase()}`);
  fs.writeFileSync(storage, buffer);
  return tx(() => {
    insert('documents', {
      doc_id: docId, filename, mime, sha256: sha, size: buffer.length, storage_path: path.relative(config.dataDir, storage), source, email_id: email?.email_id || null,
      uploaded_by: submitter?.user_id || (typeof actor === 'string' ? actor : actor.user_id), uploaded_at: nowIso(), extraction_method: ex.method, extraction_confidence: ex.confidence,
      raw_text: ex.text?.slice(0, 20000) || null, extraction: JSON.stringify(ex.result), extraction_notes: JSON.stringify(ex.notes),
    });
    const inv = createInvoiceFromExtraction({ ex, docId, email, source, submitter, actor, note });
    return inv;
  });
}

function createInvoiceFromExtraction({ ex, docId, email, source, submitter, actor, note }) {
  const r = ex.result;
  const vm = matchVendor(r, email);
  const vendor = vm.vendor;
  const invoiceId = nextId('invoice', 'AP-');
  const received = (email?.received_at || nowIso()).slice(0, 10);
  const currency = (r.currency || vendor?.currency || 'CAD').toUpperCase();
  const fx = fxRate(r.invoice_date || received, currency);
  const total = r.total ?? round2((r.subtotal || 0) + (r.taxes || []).reduce((a, t) => a + (t.amount || 0), 0));
  const poRaw = r.po_number ? String(r.po_number).trim() : null;
  const po = poRaw ? get(`SELECT * FROM purchase_orders WHERE upper(replace(po_id,'-','')) = upper(replace(?,'-',''))`, poRaw) : null;

  const lines = (r.line_items || []).map((l, i) => ({ ...l, line_no: i + 1 }));
  const coded = lines.map((l) => ({ l, s: suggestLine({ vendor, description: l.description, poDept: po?.department_id, submitterDept: submitter?.department_id }) }));
  // Department: submitter (employee upload) > PO > most common across suggested lines.
  const deptVotes = {};
  for (const { s } of coded) if (s.department_id) deptVotes[s.department_id] = (deptVotes[s.department_id] || 0) + 1;
  const department = (submitter?.role === 'employee' || submitter?.role === 'approver' ? submitter.department_id : null) || po?.department_id || Object.entries(deptVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || submitter?.department_id || null;
  let requester = submitter && ['employee', 'approver'].includes(submitter.role) ? submitter.user_id : po?.requester_user_id || null;
  const reqInfo = !requester && vendor ? inferRequester(vendor.vendor_id, department) : null;
  if (!requester) requester = reqInfo?.user_id || null;
  if (!requester && submitter) requester = submitter.user_id;

  const contract = vendor ? get(`SELECT contract_id FROM contracts WHERE vendor_id = ? AND start_date <= ? AND end_date >= ?`, vendor.vendor_id, r.invoice_date || received, r.invoice_date || received) : null;
  const inv = {
    invoice_id: invoiceId, vendor_id: vendor?.vendor_id || null, vendor_invoice_number: r.invoice_number || null, invoice_number_norm: normInvoiceNumber(r.invoice_number),
    doc_type: r.doc_type === 'credit_note' || total < 0 ? 'credit_note' : 'invoice', credit_note_ref: r.credit_note_ref || null,
    invoice_date: r.invoice_date || received, received_date: received, due_date: r.due_date || null, terms_text: r.terms || null,
    currency, subtotal: r.subtotal, total, fx_rate_to_cad: fx, total_cad: round2(total * fx),
    department_id: department, requester_user_id: requester, po_id: po?.po_id || poRaw, contract_id: contract?.contract_id || null,
    ship_to_province: r.ship_to_province || null, status: 'draft', source, doc_id: docId, email_id: email?.email_id || null,
    extracted_vendor_name: r.vendor_name || null, extracted_vendor_tax_id: r.vendor_gst_hst_number || null, extracted_qst_number: r.vendor_qst_number || null,
    extracted_bank: r.bank ? JSON.stringify(r.bank) : null, bill_to_address: r.ship_to_address || r.bill_to_address || null, payment_instructions: r.payment_instructions || null,
    vendor_match_method: vm.method, vendor_match_score: vm.score, created_at: nowIso(), updated_at: nowIso(), submitted_by: submitter?.user_id || null,
  };
  insert('invoices', inv);
  const exp = expectedTaxes(inv.ship_to_province, { foreign: vendor && vendor.country !== 'CA', exempt: vendor?.category === 'Insurance' });
  const gstCode = exp.parts.find((p) => ['GST', 'HST'].includes(p.type))?.code || (vendor && vendor.country !== 'CA' ? 'FOREIGN' : vendor?.category === 'Insurance' ? 'EXEMPT' : null);
  const pstPart = exp.parts.find((p) => ['QST', 'PST'].includes(p.type));
  for (const { l, s } of coded) {
    insert('invoice_lines', {
      invoice_id: invoiceId, line_no: l.line_no, description: l.description, quantity: l.quantity, unit_price: l.unit_price, amount: l.amount,
      gl_account: s.gl_account, department_id: s.department_id || department, line_type: s.line_type,
      gst_hst_code: gstCode, pst_qst_code: pstPart && (pstPart.base === 'all' || s.line_type === 'goods') ? pstPart.code : null,
      suggested_gl: s.gl_account, suggested_department: s.department_id, coding_confidence: s.confidence, coding_reason: s.reason, coding_source: 'suggested',
    });
  }
  for (const t of r.taxes || []) {
    const type = String(t.type || '').toUpperCase();
    const code = type === 'HST' ? 'HST13' : type === 'GST' ? 'GST5' : type === 'QST' ? 'QST9975' : type === 'PST' ? 'PST7_BC' : type;
    insert('invoice_taxes', { invoice_id: invoiceId, code, label: t.label || type, rate: t.rate_percent, amount: t.amount });
  }
  update('invoices', 'invoice_id', invoiceId, { gst_hst_amount: round2((r.taxes || []).filter((t) => /GST|HST/i.test(t.type)).reduce((a, t) => a + t.amount, 0)), pst_qst_amount: round2((r.taxes || []).filter((t) => /PST|QST/i.test(t.type)).reduce((a, t) => a + t.amount, 0)) });

  audit({ actor, action: 'invoice.captured', entityType: 'invoice', entityId: invoiceId, invoiceId, details: {
    source, file: get('SELECT filename FROM documents WHERE doc_id = ?', docId).filename, email: email?.email_id, method: ex.method, confidence: ex.confidence,
    vendor: vendor?.vendor_id || null, vendor_match: vm.method, note,
  } });
  const extraFlags = [];
  if (ex.confidence < 0.75) extraFlags.push({ code: 'LOW_CONFIDENCE', category: 'capture', severity: 'warn', title: 'Check the captured fields', detail: `Capture confidence ${Math.round(ex.confidence * 100)}% (${ex.method}). ${ex.notes.join(' ')} Compare the fields with the document before submitting.` });
  if (reqInfo?.departed?.length) extraFlags.push({ code: 'REQUESTER_DEPARTED', category: 'policy', severity: 'info', title: 'Usual requester has left', detail: `${reqInfo.departed.map((d) => d.full_name).join(', ')} used to request these invoices but is no longer with Harborline. Requester set to ${reqInfo.name || 'none'}; confirm the owner.` });
  if (po) {
    const pr = get('SELECT * FROM users WHERE user_id = ?', po.requester_user_id);
    if (pr?.status === 'terminated') extraFlags.push({ code: 'PO_REQUESTER_DEPARTED', category: 'po', severity: 'warn', title: 'PO owner has left', detail: `${po.po_id} was raised by ${pr.full_name}, who left on ${pr.status_since}. Confirm someone in ${po.department_id} owns this spend.` });
  }
  if (r.payment_instructions && /card|carte/i.test(r.payment_instructions)) extraFlags.push({ code: 'PAY_BY_CARD', category: 'payment', severity: 'info', title: 'Vendor takes card payments', detail: 'The invoice asks for payment by credit card. Pay with a single-use Brim virtual card from the payment screen.' });
  recompute(invoiceId, { actor, extraFlags, initial: true });
  // A new bill can turn earlier open bills from the same vendor into a split or duplicate set.
  if (vendor) {
    for (const s of all(`SELECT invoice_id FROM invoices WHERE vendor_id = ? AND invoice_id != ? AND source != 'history' AND status IN ('draft','pending_approval','needs_review')`, vendor.vendor_id, invoiceId)) recompute(s.invoice_id, { actor: 'system' });
  }
  return get('SELECT * FROM invoices WHERE invoice_id = ?', invoiceId);
}

// Re-run checks and routing after capture or any edit. Resolved flags stay resolved if the same issue recurs.
export function recompute(invoiceId, { actor = 'system', extraFlags = [], initial = false } = {}) {
  const inv = get('SELECT * FROM invoices WHERE invoice_id = ?', invoiceId);
  const vendor = inv.vendor_id ? get('SELECT * FROM vendors WHERE vendor_id = ?', inv.vendor_id) : null;
  const lines = all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no', invoiceId);
  const taxes = all('SELECT * FROM invoice_taxes WHERE invoice_id = ?', invoiceId).map((t) => ({ ...t, type: t.code?.startsWith('HST') ? 'HST' : t.code?.startsWith('GST') ? 'GST' : t.code?.startsWith('QST') ? 'QST' : t.code?.startsWith('PST') ? 'PST' : t.label, rate_percent: t.rate }));
  const email = inv.email_id ? get('SELECT * FROM emails WHERE email_id = ?', inv.email_id) : null;
  const doc = inv.doc_id ? get('SELECT * FROM documents WHERE doc_id = ?', inv.doc_id) : null;
  const flags = runChecks({ inv, lines, taxes, vendor, email, doc });
  const split = splitCheck(inv, vendor);
  if (split) flags.push(split);
  const keepCodes = new Set(['LOW_CONFIDENCE', 'REQUESTER_DEPARTED', 'PO_REQUESTER_DEPARTED', 'PAY_BY_CARD']);
  const prev = all('SELECT * FROM flags WHERE invoice_id = ?', invoiceId);
  const carried = prev.filter((p) => keepCodes.has(p.code));
  const all_ = [...flags, ...extraFlags];
  run('DELETE FROM flags WHERE invoice_id = ?', invoiceId);
  const key = (x) => `${x.code}|${x.related_id || ''}`;
  const reused = new Set();
  for (const fl of [...all_, ...carried.filter((c) => !all_.some((a) => key(a) === key(c)))]) {
    const old = prev.find((p) => key(p) === key(fl) && !reused.has(p.id)) || prev.find((p) => key(p) === key(fl));
    // Keep the flag's id across recomputes so audit rows and open UIs keep pointing at the same flag.
    const id = old && !reused.has(old.id) ? old.id : null;
    if (id) reused.add(id);
    insert('flags', {
      id, invoice_id: invoiceId, code: fl.code, category: fl.category, severity: fl.severity, title: fl.title, detail: fl.detail, related_id: fl.related_id || null,
      status: old?.status || 'open', resolved_by: old?.resolved_by || null, resolved_at: old?.resolved_at || null, resolution_note: old?.resolution_note || null, created_at: old?.created_at || nowIso(),
    });
  }
  // Route only invoices that are not yet decided.
  const stored = all('SELECT * FROM flags WHERE invoice_id = ?', invoiceId);
  const amount = Math.max(Math.abs(inv.total_cad || 0), split?.combined || 0);
  if (['draft', 'pending_approval', 'needs_review'].includes(inv.status)) {
    const acted = get(`SELECT count(*) c FROM approvals WHERE invoice_id = ? AND action IN ('approved','rejected')`, invoiceId).c;
    if (!acted) {
      run(`DELETE FROM approvals WHERE invoice_id = ? AND action = 'pending'`, invoiceId);
      const steps = buildRoute({ inv, vendor, flags: stored.filter((f) => f.status === 'open' || f.severity !== 'info'), amountCad: amount });
      for (const s of steps) insert('approvals', { approval_id: nextId('approval', 'AP-A-'), invoice_id: invoiceId, ...s, approver_user_id: null, action: 'pending' });
      if (initial) audit({ actor, action: 'invoice.routed', entityType: 'invoice', entityId: invoiceId, invoiceId, details: { route: describeRoute(steps) } });
    }
  }
  const open = stored.filter((f) => f.status === 'open');
  const risk = open.reduce((a, f) => a + (f.severity === 'block' ? 40 : f.severity === 'warn' ? 15 : 0), 0);
  const rec = recommend(invoiceId);
  const patch = { risk_score: Math.min(100, risk), recommendation: JSON.stringify(rec), updated_at: nowIso() };
  // Straight-through: high-confidence capture with no open blocking/warning flags skips the AP review queue.
  if (initial) {
    const doc2 = doc || {};
    const clean = !open.some((f) => f.severity !== 'info') && (doc2.extraction_confidence ?? 1) >= 0.9 && inv.vendor_id;
    if (clean) {
      patch.status = 'pending_approval';
      audit({ actor: 'system', action: 'invoice.auto_submitted', entityType: 'invoice', entityId: invoiceId, invoiceId, details: { reason: 'No issues found and capture confidence ≥ 90%: sent straight to approval' } });
    }
  }
  update('invoices', 'invoice_id', invoiceId, patch);
  return { flags: stored, recommendation: rec };
}

export function openBlocking(invoiceId) {
  return all(`SELECT * FROM flags WHERE invoice_id = ? AND status = 'open' AND severity = 'block'`, invoiceId);
}

export { daysBetween, today };
