// Bank reconciliation: match statement debits to AP payments and explain whatever is left.
import { all } from '../db.js';
import { today } from '../config.js';
import { daysBetween, near, normName, round2, money } from '../util.js';

export function reconcile() {
  const bank = all(`SELECT * FROM bank_statement WHERE debit IS NOT NULL ORDER BY posted_date, bank_txn_id`);
  const pays = all(`SELECT p.*, v.legal_name FROM payments p LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
    WHERE p.method IN ('EFT','CHEQUE') AND p.status IN ('settled','outstanding','released') ORDER BY coalesce(p.paid_date, p.scheduled_date)`);
  const used = new Set();
  const matched = [], unmatched = [];
  const byRef = new Map();
  for (const p of pays) if (p.reference) byRef.set(String(p.reference).slice(-6), p);

  for (const b of bank) {
    const d = b.description || '';
    let hit = null, method = null, note = null;
    const ref = /(\d{6})\s*$/.exec(d);
    if (/^EFT PMT/.test(d) && ref && byRef.has(ref[1]) && !used.has(byRef.get(ref[1]).payment_id)) {
      hit = byRef.get(ref[1]); method = 'reference';
      if (!near(hit.amount_cad, b.debit, 0.01)) note = `Reference matches but amount differs by ${money(round2(b.debit - hit.amount_cad))}.`;
    }
    if (!hit && /^(EFT PMT|CHEQUE)/.test(d)) {
      // Amount + date window + (for EFT) vendor name in the descriptor. Closest date wins.
      const kind = /^CHEQUE/.test(d) ? 'CHEQUE' : 'EFT';
      const desc = normName(d.replace(/^EFT PMT/, '')).replace(/ /g, '');
      const cands = pays.filter((p) => !used.has(p.payment_id) && p.method === kind && near(p.amount_cad, b.debit, 0.01)
        && daysBetween(p.paid_date || p.scheduled_date, b.posted_date) >= -3 && daysBetween(p.paid_date || p.scheduled_date, b.posted_date) <= (kind === 'CHEQUE' ? 60 : 7)
        && (kind === 'CHEQUE' || normName(p.legal_name).replace(/ /g, '').startsWith(desc.slice(0, 8))))
        .sort((a, c) => Math.abs(daysBetween(a.paid_date || a.scheduled_date, b.posted_date)) - Math.abs(daysBetween(c.paid_date || c.scheduled_date, b.posted_date)));
      if (cands[0]) { hit = cands[0]; method = kind === 'CHEQUE' ? 'cheque amount + date' : 'amount + date + payee'; }
    }
    if (hit) {
      used.add(hit.payment_id);
      matched.push({ bank: b, payment_id: hit.payment_id, invoice_id: hit.invoice_id, vendor: hit.legal_name, method, note });
    } else {
      unmatched.push({ bank: b, ...explainBank(b) });
    }
  }
  const t = today();
  const unpresented = pays.filter((p) => !used.has(p.payment_id) && ['settled', 'outstanding'].includes(p.status)).map((p) => {
    const age = daysBetween(p.paid_date || p.scheduled_date, t);
    return {
      payment: p,
      explanation: p.method === 'CHEQUE'
        ? `Cheque to ${p.legal_name} for ${money(p.amount_cad)} issued ${p.paid_date} hasn't cleared (${age} days). ${age > 90 ? 'Stale: contact the vendor and consider voiding and reissuing.' : 'Outstanding cheque; normal timing difference.'}`
        : `EFT ${p.reference} to ${p.legal_name} (${money(p.amount_cad)}) is marked paid but not on the statement. Check with the bank before paying again.`,
      suggested_gl: null,
    };
  });
  const stats = {
    bank_debits: bank.length, matched: matched.length, unmatched: unmatched.length, unpresented: unpresented.length,
    match_rate: bank.length ? round2(matched.length / bank.length) : 1,
    unmatched_cad: round2(unmatched.reduce((a, u) => a + u.bank.debit, 0)),
  };
  return { stats, matched, unmatched, unpresented };
}

function explainBank(b) {
  const d = b.description || '';
  if (/ACCOUNT FEE|SERVICE CHARGE/.test(d)) return { kind: 'bank_fee', explanation: 'Monthly bank account fee. Not an AP item; post to 7010 Bank & Payment Fees.', suggested_gl: '7010' };
  if (/WIRE FEE/.test(d)) return { kind: 'bank_fee', explanation: 'Wire transfer fee charged by the bank. Post to 7010 Bank & Payment Fees.', suggested_gl: '7010' };
  if (/PREAUTH|PAD|PRE-AUTH/.test(d)) return { kind: 'unknown_debit', explanation: 'Pre-authorised debit with no AP invoice behind it. Find the signed PAD agreement and the invoice, or dispute it with the bank (90-day window under Payments Canada rule H1).', suggested_gl: null };
  if (/^CHEQUE/.test(d)) return { kind: 'unmatched_cheque', explanation: 'Cheque cleared with no matching AP cheque payment of that amount. Check the cheque register for a manual cheque.', suggested_gl: null };
  if (/^EFT PMT/.test(d)) return { kind: 'unmatched_eft', explanation: 'EFT left the account but no AP payment matches the reference or amount. Possible payment made outside the AP process, or a duplicate.', suggested_gl: null };
  return { kind: 'other', explanation: 'Unrecognised debit. Investigate.', suggested_gl: null };
}
