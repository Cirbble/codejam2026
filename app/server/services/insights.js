// Decision support: approval recommendation and best-day-to-pay.
import { all, get } from '../db.js';
import { today } from '../config.js';
import { round2, money, addDays, daysBetween, prevBusinessDay, nextBusinessDay } from '../util.js';

// Recommendation = open flags + how this bill compares with the vendor's own history.
export function recommend(invoiceId) {
  const inv = get('SELECT * FROM invoices WHERE invoice_id = ?', invoiceId);
  const flags = all(`SELECT * FROM flags WHERE invoice_id = ? AND status = 'open'`, invoiceId);
  const reasons = [];
  const good = [];
  const blocks = flags.filter((f) => f.severity === 'block');
  const warns = flags.filter((f) => f.severity === 'warn');
  for (const f of blocks) reasons.push(f.title);
  for (const f of warns) reasons.push(f.title);
  if (inv.vendor_id) {
    const hist = all(`SELECT total_cad, invoice_date FROM invoices WHERE vendor_id = ? AND source = 'history' AND status != 'rejected' AND doc_type = 'invoice' ORDER BY invoice_date DESC LIMIT 12`, inv.vendor_id);
    if (hist.length >= 3) {
      const avg = hist.reduce((a, h) => a + h.total_cad, 0) / hist.length;
      const sd = Math.sqrt(hist.reduce((a, h) => a + (h.total_cad - avg) ** 2, 0) / hist.length);
      const dev = avg ? (inv.total_cad - avg) / avg : 0;
      const z = sd ? (inv.total_cad - avg) / sd : 0;
      if (Math.abs(z) > 2.5 && Math.abs(dev) > 0.25) reasons.push(`${money(inv.total_cad)} is ${Math.round(Math.abs(dev) * 100)}% ${dev > 0 ? 'above' : 'below'} this vendor's usual ${money(round2(avg))}`);
      else good.push(`Amount in line with last ${hist.length} bills`);
    } else if (hist.length === 0) reasons.push('First bill from this vendor');
    const rejected = get(`SELECT count(*) c FROM invoices WHERE vendor_id = ? AND status = 'rejected'`, inv.vendor_id).c;
    if (rejected >= 2) reasons.push(`${rejected} earlier bills from this vendor were rejected`);
  }
  if (inv.po_id && !flags.some((f) => f.category === 'po')) good.push(`Matches ${inv.po_id}`);
  if (inv.contract_id && !flags.some((f) => f.category === 'contract')) good.push(`Within contract ${inv.contract_id}`);
  if (!flags.some((f) => f.category === 'tax')) good.push('Tax correct');
  if (!flags.some((f) => f.category === 'duplicate')) good.push('No duplicates found');
  let decision = 'approve';
  if (blocks.some((f) => ['duplicate', 'fraud'].includes(f.category))) decision = 'reject';
  else if (blocks.length || warns.length || reasons.length) decision = 'review';
  const headline = decision === 'approve' ? 'Ready to approve' : decision === 'reject' ? (blocks.some((f) => f.category === 'duplicate') ? 'Likely duplicate' : 'Possible fraud') : 'Needs review';
  return { decision, headline, concerns: reasons, positives: good };
}

// Best day to pay: take an early-payment discount when it beats the cost of cash, otherwise pay as late
// as terms allow (minus rail lead time), never on a weekend; card-accepting vendors can go on a virtual card.
export function bestPayDay(inv, vendor, method = null) {
  const t = today();
  const m = method || (vendor?.preferred_payment_method === 'CARD' || vendor?.accepts_card_payment ? 'CARD' : vendor?.preferred_payment_method || 'EFT');
  const lead = m === 'CHEQUE' ? 5 : m === 'EFT' ? 1 : 0;
  const due = inv.due_date || addDays(inv.invoice_date, vendor?.payment_terms_days ?? 30);
  const disc = parseDiscount(vendor?.early_pay_discount) || parseDiscount(inv.terms_text);
  const out = { method: m, due_date: due, lead_days: lead };
  if (disc) {
    const discDate = addDays(inv.invoice_date, disc.days);
    const netDays = daysBetween(inv.invoice_date, due) || 30;
    const annual = round2((disc.percent / (100 - disc.percent)) * (365 / Math.max(1, netDays - disc.days)) * 100);
    const saving = round2(Math.abs(inv.total) * disc.percent / 100);
    if (discDate >= t) {
      const payOn = prevBusinessDay(addDays(discDate, -lead));
      return { ...out, pay_on: payOn < t ? nextBusinessDay(t) : payOn, discount: { ...disc, deadline: discDate, saving, annualized_pct: annual }, reason: `Takes the ${disc.percent}% early-payment discount (${money(saving, inv.currency)}), a ${annual}% annualised return.` };
    }
    out.missed_discount = { ...disc, deadline: discDate, saving };
  }
  let payOn = prevBusinessDay(addDays(due, -lead));
  let reason = m === 'CARD' ? 'Pay on the due date by virtual card for maximum float.' : `Latest date that still lands by the due date (${m === 'EFT' ? 'EFT' : 'cheque'} takes ${lead} business day${lead === 1 ? '' : 's'}).`;
  if (payOn < t) { payOn = nextBusinessDay(t); reason = due < t ? 'Overdue. Pay at the next run.' : 'Due before the next run. Pay at the next run.'; }
  if (out.missed_discount) reason += ` ${out.missed_discount.percent}% discount window closed.`;
  return { ...out, pay_on: payOn, reason };
}

export function parseDiscount(s) {
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*,?\s*net\s*(\d+)/i.exec(s) || /(\d+(?:\.\d+)?)\s*%[^\d]+(\d+)\s*days/i.exec(s);
  return m ? { percent: Number(m[1]), days: Number(m[2]) } : null;
}
