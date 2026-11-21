// Vendor resolution and vendor-risk signals.
import { all, get } from '../db.js';
import { normName, similarity, jaccard, tokens, digitsOnly, emailDomain } from '../util.js';

export function vendorsAll() {
  return all('SELECT * FROM vendors');
}

// Score every vendor on independent evidence; the strongest identifiers (tax number, bank account)
// outweigh the name, because names are exactly what a fraudster imitates.
export function matchVendor(ex, email = null) {
  const vendors = vendorsAll();
  const exName = normName(ex.vendor_name);
  const exGst = digitsOnly(ex.vendor_gst_hst_number).slice(0, 9);
  const exAcct = ex.bank?.account ? digitsOnly(ex.bank.account) : '';
  const from = email?.from_address?.toLowerCase() || '';
  const scored = vendors.map((v) => {
    const reasons = [];
    let score = 0;
    const vn = normName(v.legal_name);
    const nameSim = Math.max(similarity(exName, vn), jaccard(tokens(ex.vendor_name), tokens(v.legal_name)));
    if (exName && vn === exName) { score += 0.55; reasons.push('name matches'); }
    else if (nameSim >= 0.8) { score += 0.45 * nameSim; reasons.push(`name ${Math.round(nameSim * 100)}% similar`); }
    if (exGst && digitsOnly(v.gst_hst_number).slice(0, 9) === exGst) { score += 0.6; reasons.push('GST/HST number matches'); }
    if (exAcct && digitsOnly(v.bank_account) === exAcct) { score += 0.25; reasons.push('bank account matches'); }
    if (from && v.ap_contact_email && v.ap_contact_email.toLowerCase() === from) { score += 0.15; reasons.push('sender email matches'); }
    return { vendor: v, score, nameSim, reasons };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.5) {
    return { vendor: null, score: best?.score || 0, method: 'none', candidates: scored.slice(0, 3).filter((s) => s.score > 0.2) };
  }
  return { vendor: best.vendor, score: Math.min(1, best.score), method: best.reasons.join(', '), candidates: scored.slice(1, 3).filter((s) => s.score > 0.3) };
}

// Other vendor records that look like this one (lookalike names, shared bank account).
export function lookalikes(vendor) {
  if (!vendor) return [];
  const vn = normName(vendor.legal_name);
  const out = [];
  for (const v of vendorsAll()) {
    if (v.vendor_id === vendor.vendor_id) continue;
    const sim = similarity(vn, normName(v.legal_name));
    const sameBank = v.bank_account && v.bank_account === vendor.bank_account;
    if (sim >= 0.82 || sameBank) {
      const diffs = [];
      if (v.gst_hst_number !== vendor.gst_hst_number) diffs.push('GST number');
      if (v.address !== vendor.address) diffs.push('address');
      if (v.bank_account !== vendor.bank_account) diffs.push('bank account');
      if (emailDomain(v.ap_contact_email) !== emailDomain(vendor.ap_contact_email)) diffs.push('email domain');
      out.push({ vendor_id: v.vendor_id, legal_name: v.legal_name, status: v.status, onboarded_at: v.onboarded_at, similarity: Math.round(sim * 100), sameBank, diffs });
    }
  }
  return out;
}

// Vendor master hygiene: duplicate records and shared bank accounts across vendor IDs.
export function masterHealth() {
  const vs = vendorsAll();
  const issues = [];
  const seen = new Set();
  for (const v of vs) {
    for (const l of lookalikes(v)) {
      const key = [v.vendor_id, l.vendor_id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const other = vs.find((x) => x.vendor_id === l.vendor_id);
      // The record with more payment history is treated as the genuine one (same rule as the invoice checks).
      const hist = (id) => get(`SELECT count(*) c FROM invoices WHERE vendor_id = ? AND source = 'history'`, id).c;
      const hv = hist(v.vendor_id), ho = hist(other.vendor_id);
      const older = hv > ho || (hv === ho && v.onboarded_at <= other.onboarded_at) ? v : other;
      const newer = older === v ? other : v;
      issues.push({
        a: older.vendor_id, b: newer.vendor_id, a_name: older.legal_name, b_name: newer.legal_name, similarity: l.similarity, sameBank: l.sameBank, diffs: l.diffs,
        explanation: l.sameBank
          ? `${newer.legal_name} (${newer.vendor_id}) pays into the same bank account as ${older.legal_name} (${older.vendor_id}) but has a different ${listJoin(l.diffs.filter((d) => d !== 'bank account')) || 'record'}. Likely a duplicate vendor record: invoices can be paid twice across the two.`
          : `${newer.legal_name} (${newer.vendor_id}) has a name ${l.similarity}% similar to ${older.legal_name} (${older.vendor_id}) but a different ${listJoin(l.diffs)}. Could be an impostor record.`,
      });
    }
  }
  return issues;
}

export function vendorStats(vendorId) {
  return get(`SELECT count(*) n, round(avg(total_cad),2) avg_cad, max(invoice_date) last_date, round(sum(total_cad),2) sum_cad
    FROM invoices WHERE vendor_id = ? AND source = 'history' AND status != 'rejected'`, vendorId);
}

export function listJoin(a) {
  if (!a?.length) return '';
  return a.length === 1 ? a[0] : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;
}
