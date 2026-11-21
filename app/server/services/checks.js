// Validation & matching. Each check returns flags written in plain language:
// what is wrong, the evidence, and what to do. Severity:
//   block = cannot be approved or paid until resolved; warn = approver must look; info = context.
import { all, get } from '../db.js';
import { round2, near, money, daysBetween, addDays, normInvoiceNumber, emailDomain, digitsOnly, normName, similarity } from '../util.js';
import { lookalikes, listJoin } from './vendors.js';
import { GOODS_CATEGORIES } from './coding.js';

// Place-of-supply rules (rates from tax_codes.csv; Atlantic HST added for completeness).
export function expectedTaxes(province, { foreign = false, exempt = false } = {}) {
  if (foreign) return { label: 'no Canadian tax (foreign vendor)', parts: [] };
  if (exempt) return { label: 'exempt (insurance premiums)', parts: [] };
  switch (province) {
    case 'ON': return { label: 'Ontario HST 13%', parts: [{ type: 'HST', code: 'HST13', rate: 0.13, base: 'all' }] };
    case 'QC': return { label: 'GST 5% + QST 9.975%', parts: [{ type: 'GST', code: 'GST5', rate: 0.05, base: 'all' }, { type: 'QST', code: 'QST9975', rate: 0.09975, base: 'all' }] };
    case 'BC': return { label: 'GST 5% + BC PST 7% on goods', parts: [{ type: 'GST', code: 'GST5', rate: 0.05, base: 'all' }, { type: 'PST', code: 'PST7_BC', rate: 0.07, base: 'goods' }] };
    case 'NS': case 'NB': case 'NL': case 'PE': return { label: 'HST 15%', parts: [{ type: 'HST', code: 'HST15', rate: 0.15, base: 'all' }] };
    default: return { label: 'GST 5%', parts: [{ type: 'GST', code: 'GST5', rate: 0.05, base: 'all' }] };
  }
}

export function fxRate(date, currency) {
  if (!currency || currency === 'CAD') return 1;
  const r = get('SELECT usd_to_cad FROM fx_rates WHERE date <= ? ORDER BY date DESC LIMIT 1', date || '2026-12-31')
    || get('SELECT usd_to_cad FROM fx_rates ORDER BY date LIMIT 1');
  return r?.usd_to_cad || 1;
}

export function runChecks(ctx) {
  const { inv, lines, taxes, vendor, email } = ctx;
  const flags = [];
  const f = (code, category, severity, title, detail, extra = {}) => flags.push({ code, category, severity, title, detail, ...extra });
  const cur = inv.currency || 'CAD';
  const m = (n) => money(n, cur);
  const isCredit = inv.doc_type === 'credit_note';

  // ---------- arithmetic ----------
  for (const l of lines) {
    if (l.quantity !== null && l.unit_price !== null && l.amount !== null && !near(round2(l.quantity * l.unit_price), l.amount, 0.02)) {
      f('ARITH_LINE', 'arithmetic', 'block', `Line ${l.line_no} doesn't add up`,
        `"${l.description}": ${l.quantity} × ${m(l.unit_price)} = ${m(round2(l.quantity * l.unit_price))}, but the invoice shows ${m(l.amount)} (difference ${m(round2(l.amount - l.quantity * l.unit_price))}). Ask the vendor for a corrected invoice.`);
    }
  }
  const lineSum = round2(lines.reduce((a, l) => a + (l.amount || 0), 0));
  if (inv.subtotal !== null && lines.length && !near(lineSum, inv.subtotal, 0.02)) {
    f('ARITH_SUBTOTAL', 'arithmetic', 'block', 'Lines don\'t add up to the subtotal', `Lines total ${m(lineSum)} but the subtotal says ${m(inv.subtotal)} (difference ${m(round2(inv.subtotal - lineSum))}).`);
  }
  const taxSum = round2(taxes.reduce((a, t) => a + (t.amount || 0), 0));
  if (inv.subtotal !== null && inv.total !== null && !near(round2(inv.subtotal + taxSum), inv.total, 0.02)) {
    f('ARITH_TOTAL', 'arithmetic', 'block', 'Total doesn\'t match subtotal plus tax', `${m(inv.subtotal)} + tax ${m(taxSum)} = ${m(round2(inv.subtotal + taxSum))}, but the invoice total is ${m(inv.total)} (difference ${m(round2(inv.total - inv.subtotal - taxSum))}).`);
  }

  // ---------- tax by place of supply ----------
  const foreign = vendor ? vendor.country && vendor.country !== 'CA' : cur === 'USD' && !inv.extracted_vendor_tax_id;
  const exempt = vendor?.category === 'Insurance';
  const prov = inv.ship_to_province;
  if (!prov && !foreign) f('TAX_NO_PROVINCE', 'tax', 'warn', 'Delivery province unknown', 'Could not read the bill-to / ship-to province, so tax could not be checked. Set the province on the invoice.');
  else {
    const exp = expectedTaxes(prov, { foreign, exempt });
    const base = inv.subtotal ?? lineSum;
    const goodsBase = round2(lines.filter((l) => l.line_type === 'goods').reduce((a, l) => a + (l.amount || 0), 0));
    const remaining = [...taxes];
    for (const p of exp.parts) {
      const b = p.base === 'goods' ? goodsBase : base;
      const want = round2(b * p.rate);
      const idx = remaining.findIndex((t) => normTaxType(t) === p.type || (p.type === 'HST' && normTaxType(t) === 'GST/HST'));
      const got = idx >= 0 ? remaining.splice(idx, 1)[0] : null;
      if (!got) {
        if (Math.abs(want) >= 0.5) {
          f(`TAX_MISSING_${p.type}`, 'tax', 'warn', `${p.type} not charged`, `Delivery is to ${prov}, where ${exp.label} applies. Expected ${p.type} of ${m(want)} on ${m(b)}, but none was charged. Ask the vendor to reissue, or self-assess if appropriate.`);
        }
      } else if (p.base === 'goods' && Math.abs(want) < 0.01 && Math.abs(got.amount) >= 0.01) {
        f('TAX_UNEXPECTED_PST', 'tax', 'block', 'PST charged on services', `BC PST applies to goods only, and every line on this invoice is a service. The ${m(got.amount)} of PST shouldn't be charged. Ask the vendor for a corrected invoice.`);
      } else if (!near(got.amount, want, Math.max(0.05, Math.abs(want) * 0.002))) {
        const ratePrinted = got.rate_percent ? ` (printed rate ${got.rate_percent}%)` : '';
        f(`TAX_AMOUNT_${p.type}`, 'tax', 'block', `${p.type} amount is wrong`, `${p.type} should be ${(p.rate * 100).toFixed(p.rate === 0.09975 ? 3 : 0)}% of ${m(b)} = ${m(want)}, but the invoice charges ${m(got.amount)}${ratePrinted}. Difference ${m(round2(got.amount - want))}.`);
      }
    }
    for (const t of remaining) {
      if (Math.abs(t.amount) < 0.01) continue;
      const why = foreign ? 'the vendor is outside Canada' : exempt ? 'insurance premiums are exempt' : `delivery is to ${prov}, where ${exp.label} applies`;
      f(`TAX_UNEXPECTED_${normTaxType(t)}`, 'tax', 'block', `${normTaxType(t)} charged incorrectly`, `The invoice charges ${normTaxType(t)} of ${m(t.amount)}, but ${why}. This tax shouldn't be on the invoice. Ask the vendor for a corrected invoice before paying.`);
    }
    if (prov === 'BC' && lines.some((l) => l.line_type === 'goods') && !taxes.some((t) => normTaxType(t) === 'PST')) {
      // already covered by TAX_MISSING_PST
    }
  }
  if (taxes.some((t) => Math.abs(t.amount) > 0) && !inv.extracted_vendor_tax_id && !foreign) {
    f('TAX_NO_REG', 'tax', 'warn', 'Tax charged without a GST/HST number', 'The invoice charges GST/HST but shows no registration number, so Harborline cannot claim the input tax credit. Request the vendor\'s GST/HST number.');
  }

  // ---------- vendor ----------
  if (!vendor) {
    f('VENDOR_UNKNOWN', 'vendor', 'block', 'Vendor not in vendor master', `"${inv.extracted_vendor_name || 'Unknown'}" doesn't match any approved vendor${inv.extracted_vendor_tax_id ? ` (GST ${inv.extracted_vendor_tax_id})` : ''}. Onboard the vendor (a finance manager must approve) or reject the invoice.`);
  } else {
    if (vendor.status === 'pending_review') f('VENDOR_PENDING', 'vendor', 'warn', 'Vendor not yet approved', `${vendor.legal_name} is still pending review in the vendor master. A finance manager approval is added to this invoice (policy P05).`);
    if (vendor.status === 'on_hold') f('VENDOR_ON_HOLD', 'vendor', 'block', 'Vendor is on hold', `${vendor.legal_name} (${vendor.vendor_id}) is on hold in the vendor master. Payments are blocked until the hold is lifted.`);
    if (vendor.status === 'inactive' || vendor.status === 'blocked') f('VENDOR_INACTIVE', 'vendor', 'block', 'Vendor is inactive', `${vendor.legal_name} is ${vendor.status}.`);
    const exGst = digitsOnly(inv.extracted_vendor_tax_id).slice(0, 9);
    if (exGst && vendor.gst_hst_number && exGst !== digitsOnly(vendor.gst_hst_number).slice(0, 9)) {
      f('VENDOR_TAXID_MISMATCH', 'fraud', 'block', 'GST number doesn\'t match vendor master', `The invoice shows GST/HST ${inv.extracted_vendor_tax_id}, but ${vendor.legal_name} is registered as ${vendor.gst_hst_number}. Could be an impostor invoice. Verify with the vendor using the phone number on file.`);
    }
    const twins = lookalikes(vendor);
    const histCount = (id) => get(`SELECT count(*) c FROM invoices WHERE vendor_id = ? AND source = 'history'`, id).c;
    const mine = histCount(vendor.vendor_id);
    for (const t of twins) {
      // The record with the longer payment history is treated as the genuine one; bills matched to the
      // newer/thinner twin are blocked, bills to the established record just carry a hygiene note.
      const theirs = histCount(t.vendor_id);
      const established = mine > theirs || (mine === theirs && vendor.onboarded_at <= t.onboarded_at);
      if (established) {
        f('VENDOR_TWIN_RECORD', 'vendor', 'info', `Vendor master has a lookalike: ${t.legal_name}`, `${t.legal_name} (${t.vendor_id}) is ${t.similarity}% similar to this vendor${t.sameBank ? ' and shares its bank account' : ''}. This bill matched the established record (${mine} past bills vs ${theirs}). Clean up the duplicate record in Vendors.`, { related_id: t.vendor_id });
        continue;
      }
      f('VENDOR_LOOKALIKE', 'fraud', 'block', `Looks like another vendor: ${t.legal_name}`,
        `${vendor.legal_name} (${vendor.vendor_id}) is ${t.similarity}% similar to ${t.legal_name} (${t.vendor_id})${t.sameBank ? ' and uses the same bank account' : ''}, but has a different ${listJoin(t.diffs) || 'nothing'}. Confirm which record is genuine before paying; duplicate or impostor vendor records are a common fraud path.`, { related_id: t.vendor_id });
    }
    // Bank details printed on the invoice vs the vendor master.
    const exB = inv.extracted_bank ? JSON.parse(inv.extracted_bank) : null;
    if (exB?.account && vendor.bank_account && digitsOnly(exB.account) !== digitsOnly(vendor.bank_account)) {
      f('BANK_MISMATCH', 'fraud', 'block', 'Bank details differ from vendor master', `The invoice asks for payment to account ••${digitsOnly(exB.account).slice(-4)} (inst. ${exB.institution}, transit ${exB.transit}); the vendor master has ••${String(vendor.bank_account).slice(-4)}. Never update bank details from an invoice. Call the vendor on the number on file.`);
    }
    const recent = all(`SELECT * FROM bank_changes WHERE vendor_id = ? ORDER BY changed_at DESC`, vendor.vendor_id);
    for (const c of recent) {
      const age = daysBetween(c.changed_at.slice(0, 10), inv.received_date || inv.invoice_date);
      if (c.status === 'pending') {
        f('BANK_CHANGE_PENDING', 'fraud', 'block', 'Bank change awaiting verification', `A bank-detail change for ${vendor.legal_name} (${c.change_id}) is waiting for callback verification and approval. Payment is held until it is resolved.`, { related_id: c.change_id });
      } else if (c.verified_by_callback === 'no' && age <= 120) {
        f('BANK_CHANGE_UNVERIFIED', 'fraud', 'block', 'Unverified bank change on this vendor', `${vendor.legal_name}'s bank account was changed on ${c.changed_at.slice(0, 10)} via ${String(c.request_channel).replace(/_/g, ' ')} (••${c.old_account_last4} → ••${c.new_account_last4}) without a callback. This is the classic business email compromise pattern. Verify by phone before any payment.`, { related_id: c.change_id });
      } else if (age >= 0 && age <= 30) {
        f('BANK_CHANGE_RECENT', 'fraud', 'warn', 'Bank details changed recently', `${vendor.legal_name}'s bank account changed ${age} days before this invoice (${c.change_id}, requested via ${String(c.request_channel).replace(/_/g, ' ')}${c.verified_by_callback === 'yes' ? ', callback verified' : ''}). Double-check the first payment to the new account.`, { related_id: c.change_id });
      }
    }
    if (email?.from_address && vendor.ap_contact_email) {
      const d1 = emailDomain(email.from_address), d2 = emailDomain(vendor.ap_contact_email);
      if (d1 && d2 && d1 !== d2) {
        const sim = similarity(d1, d2);
        f('SENDER_MISMATCH', 'fraud', sim > 0.6 ? 'block' : 'warn', sim > 0.6 ? 'Lookalike sender domain' : 'Sender isn\'t the vendor\'s usual address',
          `This came from ${email.from_address}, but ${vendor.legal_name}'s AP contact is ${vendor.ap_contact_email}.${sim > 0.6 ? ' The domains are similar but not identical, a common spoofing trick.' : ''} Confirm the invoice with the vendor directly.`);
      }
    }
    // Currency vs history / contract.
    const usual = get(`SELECT currency, count(*) n FROM invoices WHERE vendor_id = ? AND source='history' GROUP BY currency ORDER BY n DESC LIMIT 1`, vendor.vendor_id);
    if (usual && usual.currency !== cur) f('CURRENCY_CHANGE', 'vendor', 'warn', `Billed in ${cur}, usually ${usual.currency}`, `${vendor.legal_name} has billed in ${usual.currency} ${usual.n} times before; this invoice is in ${cur}. Confirm the currency before paying.`);
  }
  if (cur !== 'CAD') {
    f('FX', 'currency', 'info', `${cur} invoice converted to CAD`, `${m(inv.total)} × ${inv.fx_rate_to_cad} (rate for ${inv.invoice_date}) = ${money(inv.total_cad)} CAD. Approval limits use the CAD amount.`);
  }

  // ---------- PO ----------
  if (inv.po_id) {
    const po = get('SELECT * FROM purchase_orders WHERE po_id = ?', inv.po_id);
    if (!po) f('PO_NOT_FOUND', 'po', 'block', 'PO number not found', `The invoice quotes PO ${inv.po_id}, which doesn't exist. Ask the requester for the right PO.`);
    else {
      if (vendor && po.vendor_id !== vendor.vendor_id) f('PO_VENDOR', 'po', 'block', 'PO belongs to another vendor', `${po.po_id} was issued to ${get('SELECT legal_name FROM vendors WHERE vendor_id=?', po.vendor_id)?.legal_name}, not ${vendor.legal_name}.`);
      if (po.status === 'closed') f('PO_CLOSED', 'po', 'block', 'PO is closed', `${po.po_id} is already closed. A closed PO can't be billed again.`);
      const used = get(`SELECT coalesce(sum(subtotal),0) s FROM invoices WHERE po_id = ? AND invoice_id != ? AND status NOT IN ('rejected') AND doc_type='invoice'`, po.po_id, inv.invoice_id).s;
      const remaining = round2(po.total_amount - used);
      if ((inv.subtotal || 0) > remaining + 0.01) {
        f('PO_OVER_BALANCE', 'po', 'warn', 'Over the PO\'s remaining balance', `${po.po_id} was for ${money(po.total_amount, po.currency)}; ${money(used, po.currency)} is already invoiced, leaving ${money(remaining, po.currency)}. This invoice's subtotal is ${m(inv.subtotal)}, ${m(round2(inv.subtotal - remaining))} over. Routed to the finance manager (P12).`);
      }
      if (po.currency && po.currency !== cur) f('PO_CURRENCY', 'po', 'warn', 'PO currency differs', `PO is in ${po.currency}; invoice is in ${cur}.`);
    }
  } else if (vendor?.requires_po && !isCredit) {
    f('PO_MISSING', 'po', 'block', 'PO required but missing', `${vendor.legal_name} is set up as PO-required (${vendor.category}), and this invoice has no PO number. Hold it until the requester supplies a PO (P13).`);
  }

  // ---------- contract ----------
  if (vendor && !isCredit) {
    const contracts = all('SELECT * FROM contracts WHERE vendor_id = ?', vendor.vendor_id);
    const d = inv.invoice_date;
    const active = contracts.find((c) => c.start_date <= d && d <= c.end_date && c.status !== 'terminated');
    if (!active && contracts.length) {
      const last = contracts.sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0];
      f('CONTRACT_EXPIRED', 'contract', 'warn', 'Contract has expired', `${last.contract_id} (${last.description}) ended ${last.end_date}; this invoice is dated ${d}. Work billed outside an active contract needs the department manager to confirm it was authorised.`, { related_id: last.contract_id });
    }
    if (active) {
      ctx.contract = active;
      const ccur = active.currency || 'CAD';
      if (ccur !== cur) f('CONTRACT_CURRENCY', 'contract', 'warn', 'Currency differs from contract', `${active.contract_id} is priced in ${ccur}; this invoice is in ${cur}.`);
      if (active.billing_type === 'fixed_monthly' && active.monthly_fee !== null && inv.subtotal !== null) {
        if (inv.subtotal > active.monthly_fee * 2.5) {
          f('CONTRACT_SCOPE', 'contract', 'warn', 'Billed outside the fixed-fee contract', `${active.contract_id} covers a fixed ${money(active.monthly_fee, ccur)} a month, but this invoice bills ${m(inv.subtotal)}. If it is separate project work, confirm it was authorised; otherwise it is an overcharge.`, { related_id: active.contract_id });
        } else if (inv.subtotal > active.monthly_fee + 0.5) {
          f('CONTRACT_PRICE', 'contract', 'block', 'Billed above the contract price', `${active.contract_id} fixes the monthly fee at ${money(active.monthly_fee, ccur)}; this invoice bills ${m(inv.subtotal)} before tax (${m(round2(inv.subtotal - active.monthly_fee))} over, ${Math.round(((inv.subtotal / active.monthly_fee) - 1) * 1000) / 10}%). Short-pay or ask for a credit.`, { related_id: active.contract_id });
        }
      }
      if (active.fuel_surcharge_cap_pct !== null) {
        const fuel = lines.filter((l) => /fuel/i.test(l.description) && /surcharge|suppl/i.test(l.description));
        const freight = round2(lines.filter((l) => !fuel.includes(l)).reduce((a, l) => a + l.amount, 0));
        for (const l of fuel) {
          const printed = /(\d+(?:[.,]\d+)?)\s*%/.exec(l.description);
          const pct = printed ? Number(printed[1].replace(',', '.')) : freight ? round2((l.amount / freight) * 100) : null;
          if (pct !== null && pct > active.fuel_surcharge_cap_pct + 0.001) {
            const allowed = round2(freight * active.fuel_surcharge_cap_pct / 100);
            f('CONTRACT_FUEL_CAP', 'contract', 'block', 'Fuel surcharge above contract cap', `Fuel surcharge is ${pct}% but ${active.contract_id} caps it at ${active.fuel_surcharge_cap_pct}%. On ${m(freight)} of freight the most allowed is ${m(allowed)}; billed ${m(l.amount)} (${m(round2(l.amount - allowed))} over).`, { related_id: active.contract_id });
          }
        }
      }
      if (active.hourly_rate_cap !== null) {
        for (const l of lines) {
          const hourly = /hour|hrs?\b|heures|legal services|consult|advisory|services juridiques/i.test(l.description) && l.quantity > 1;
          if (hourly && l.unit_price > active.hourly_rate_cap + 0.001) {
            f('CONTRACT_RATE_CAP', 'contract', 'block', 'Hourly rate above contract cap', `"${l.description}" bills ${l.quantity} h at ${m(l.unit_price)}/h; ${active.contract_id} caps the rate at ${money(active.hourly_rate_cap, ccur)}/h. Overcharge ${m(round2((l.unit_price - active.hourly_rate_cap) * l.quantity))}.`, { related_id: active.contract_id });
          }
        }
      }
      if (active.not_to_exceed_monthly !== null) {
        const month = (d || '').slice(0, 7);
        const spent = get(`SELECT coalesce(sum(subtotal),0) s FROM invoices WHERE vendor_id = ? AND substr(invoice_date,1,7) = ? AND invoice_id != ? AND status != 'rejected' AND doc_type='invoice'`, vendor.vendor_id, month, inv.invoice_id).s;
        if (spent + (inv.subtotal || 0) > active.not_to_exceed_monthly + 0.01) {
          f('CONTRACT_NTE', 'contract', 'warn', 'Monthly contract limit exceeded', `${active.contract_id} allows at most ${money(active.not_to_exceed_monthly, ccur)} a month. ${month} already has ${money(spent)} billed; with this invoice it reaches ${money(round2(spent + inv.subtotal))}.`, { related_id: active.contract_id });
        }
      }
    }
  }

  // ---------- dates ----------
  const recv = inv.received_date || inv.invoice_date;
  if (inv.invoice_date && recv && inv.invoice_date > addDays(recv, 1)) {
    f('DATE_FUTURE', 'dates', 'warn', 'Invoice dated in the future', `Dated ${inv.invoice_date} but received ${recv} (${daysBetween(recv, inv.invoice_date)} days later). Likely a typo or a pre-billed invoice; confirm the service date before approving.`);
  }
  if (inv.due_date && inv.invoice_date && inv.due_date < inv.invoice_date) f('DATE_DUE_BEFORE', 'dates', 'warn', 'Due before it was issued', `Due date ${inv.due_date} is before the invoice date ${inv.invoice_date}.`);
  if (inv.invoice_date && recv && daysBetween(inv.invoice_date, recv) > 60 && !isCredit) {
    f('DATE_STALE', 'dates', 'warn', 'Old invoice', `Dated ${inv.invoice_date}, received ${daysBetween(inv.invoice_date, recv)} days later. Old invoices are often re-sends of bills already paid; check the duplicates panel.`);
  }
  const net = /net\s*(\d+)/i.exec(inv.terms_text || '');
  if (net && inv.invoice_date && inv.due_date && Math.abs(daysBetween(inv.invoice_date, inv.due_date) - Number(net[1])) > 2) {
    f('DATE_TERMS', 'dates', 'info', 'Due date doesn\'t match terms', `Terms say Net ${net[1]} but the due date is ${daysBetween(inv.invoice_date, inv.due_date)} days after the invoice date.`);
  }
  if (vendor?.payment_terms_days !== null && vendor?.payment_terms_days !== undefined && inv.invoice_date && inv.due_date) {
    const days = daysBetween(inv.invoice_date, inv.due_date);
    if (days < vendor.payment_terms_days - 2) f('TERMS_SHORTER', 'dates', 'info', 'Shorter terms than agreed', `Vendor master terms are ${vendor.payment_terms_days} days; this invoice asks for payment in ${days}.`);
  }

  // ---------- duplicates ----------
  flags.push(...duplicateChecks(ctx));

  // ---------- credit notes ----------
  if (isCredit) {
    const ref = inv.credit_note_ref;
    const orig = ref && vendor ? findByNumber(vendor.vendor_id, ref, inv.invoice_id) : null;
    if (!ref || normInvoiceNumber(ref) === normInvoiceNumber(inv.vendor_invoice_number)) {
      f('CREDIT_NO_REF', 'credit', 'warn', 'Credit note has no original invoice', `This credit note${ref ? ' references itself' : ' quotes no original invoice'}. Find the invoice it credits before applying it.`);
    } else if (!orig) {
      f('CREDIT_REF_UNKNOWN', 'credit', 'warn', 'Original invoice not found', `Credits invoice ${ref}, which isn't in AP history for ${vendor?.legal_name || 'this vendor'}.`);
    } else {
      f('CREDIT_APPLY', 'credit', 'info', `Credits ${orig.invoice_id}`, `Credits ${ref} (${orig.invoice_id}, ${money(orig.total)} ${orig.status}). It will be applied against the vendor's next payment instead of paid out.`, { related_id: orig.invoice_id });
      if (Math.abs(inv.total) > Math.abs(orig.total) + 0.01) f('CREDIT_EXCEEDS', 'credit', 'block', 'Credit is larger than the original invoice', `Credit ${m(inv.total)} exceeds the original ${money(orig.total)}.`);
    }
  }

  return flags;
}

function normTaxType(t) {
  const s = String(t.type || t.label || '').toUpperCase();
  if (/QST|TVQ/.test(s)) return 'QST';
  if (/PST|RST|TVP/.test(s)) return 'PST';
  if (/HST|TVH/.test(s) && !/GST\/HST/.test(s)) return 'HST';
  if (/GST\/HST|TPS\/TVH/.test(s)) return t.rate_percent >= 13 ? 'HST' : 'GST';
  return 'GST';
}

function findByNumber(vendorId, number, excludeId) {
  const n = normInvoiceNumber(number);
  return get(`SELECT * FROM invoices WHERE vendor_id = ? AND invoice_number_norm = ? AND invoice_id != ? AND status != 'rejected'`, vendorId, n, excludeId);
}

// Exact, reformatted, near-exact, cross-vendor and paid-by-card duplicates; plus split invoices.
export function duplicateChecks({ inv, vendor, doc }) {
  const out = [];
  const f = (code, severity, title, detail, related_id = null) => out.push({ code, category: 'duplicate', severity, title, detail, related_id });
  const describe = (o) => `${o.invoice_id} (#${o.vendor_invoice_number}, ${o.invoice_date}, ${money(o.total, o.currency)}, ${o.status}${o.source !== 'history' ? ', in this batch' : ''})`;
  const n = inv.invoice_number_norm;

  if (doc?.sha256) {
    const same = get(`SELECT i.* FROM documents d JOIN invoices i ON i.doc_id = d.doc_id WHERE d.sha256 = ? AND i.invoice_id != ?`, doc.sha256, inv.invoice_id);
    if (same) f('DUP_FILE', 'block', 'Same file already received', `This exact file was already captured as ${describe(same)}.`, same.invoice_id);
  }
  if (!vendor) return out;
  const vendorIds = [vendor.vendor_id, ...lookalikes(vendor).map((l) => l.vendor_id)];
  const others = all(`SELECT * FROM invoices WHERE vendor_id IN (${vendorIds.map(() => '?').join(',')}) AND invoice_id != ? AND status != 'rejected'`, ...vendorIds, inv.invoice_id);
  const seen = new Set();
  const fixedFee = !!get(`SELECT 1 FROM contracts WHERE vendor_id = ? AND billing_type = 'fixed_monthly'`, vendor.vendor_id);
  for (const o of others) {
    const sameVendor = o.vendor_id === vendor.vendor_id;
    const on = o.invoice_number_norm || '';
    const sameAmt = near(Math.abs(o.total), Math.abs(inv.total), 0.01);
    const dd = o.invoice_date && inv.invoice_date ? Math.abs(daysBetween(o.invoice_date, inv.invoice_date)) : 999;
    if (o.doc_type !== inv.doc_type) continue;
    // Within a batch only the later copy is the duplicate; the first one received stays clean.
    if (o.source !== 'history' && o.invoice_id > inv.invoice_id) continue;
    if (n && on === n) {
      seen.add(o.invoice_id);
      f('DUP_EXACT', 'block', sameVendor ? 'Duplicate invoice number' : 'Same invoice number under a lookalike vendor',
        `Invoice #${inv.vendor_invoice_number} was already recorded as ${describe(o)}${sameVendor ? '' : ` under ${o.vendor_id}`}.${sameAmt ? ' Same amount.' : ` Amount differs (${money(o.total, o.currency)} vs ${money(inv.total, inv.currency)}).`}${o.status === 'paid' ? ' It has already been paid; paying again would be a duplicate payment.' : ''}`, o.invoice_id);
    } else if (n && on && n.length >= 3 && on.length >= 3 && (n.startsWith(on) || on.startsWith(n)) && Math.abs(n.length - on.length) <= 3 && sameAmt) {
      seen.add(o.invoice_id);
      f('DUP_REFORMATTED', 'block', 'Re-sent invoice with a changed number', `#${inv.vendor_invoice_number} looks like #${o.vendor_invoice_number} with a suffix: same vendor, same amount ${money(inv.total, inv.currency)}. Original: ${describe(o)}.`, o.invoice_id);
    } else if (sameAmt && dd <= 10 && Math.abs(inv.total) > 0 && !(fixedFee && o.invoice_date?.slice(0, 7) !== inv.invoice_date?.slice(0, 7))) {
      // (Fixed-fee vendors bill the same amount every month; two bills in different months aren't duplicates.)
      seen.add(o.invoice_id);
      f('DUP_NEAR', 'warn', 'Possible duplicate', `Same ${sameVendor ? 'vendor' : 'lookalike vendor (' + o.vendor_id + ')'} and same amount ${money(inv.total, inv.currency)} as ${describe(o)}, ${dd} days apart, with a different invoice number. Check it isn't the same bill re-issued.`, o.invoice_id);
    }
  }
  // Same lines + amount but different vendor record sharing the bank account (cross-vendor duplicate).
  // Paid by card: virtual-card payments linked to an invoice with the same number, or unlinked
  // employee-card charges at this vendor for the same amount around the invoice date.
  const cards = all(`SELECT c.*, i.vendor_invoice_number FROM card_transactions c LEFT JOIN invoices i ON i.invoice_id = c.invoice_id WHERE c.vendor_id IN (${vendorIds.map(() => '?').join(',')})`, ...vendorIds);
  for (const c of cards) {
    const amtMatch = near(c.amount, Math.abs(inv.total), 0.01) || near(c.amount_cad, Math.abs(inv.total_cad), 0.01);
    if (!amtMatch) continue;
    const dd = daysBetween(inv.invoice_date, c.posted_date);
    if (c.invoice_id) {
      if (normInvoiceNumber(c.vendor_invoice_number) === n) {
        f('DUP_PAID_CARD', 'block', 'Already paid by Brim card', `Invoice #${inv.vendor_invoice_number} was paid by Brim virtual card on ${c.posted_date} (${c.txn_id}, ${money(c.amount, c.currency)}, for ${c.invoice_id}). Do not pay again.`, c.txn_id);
      }
    } else if (dd >= -10 && dd <= 45) {
      const holder = get('SELECT full_name FROM users WHERE user_id = ?', c.cardholder_user_id)?.full_name || c.cardholder_user_id;
      f('DUP_PAID_CARD', 'block', 'Looks already paid on an employee card', `${holder} paid ${money(c.amount, c.currency)} to ${c.merchant_descriptor} on ${c.posted_date} (${c.txn_id}) on a Brim card, the same amount as this invoice. If it is the same bill, close the invoice and attach it to the card transaction instead of paying twice.`, c.txn_id);
    }
  }
  return out;
}

// Invoices split to stay under an approval limit: same vendor + department, close dates, each under the limit, together over it.
export function splitCheck(inv, vendor, limit = 10000) {
  // Splitting shows up as several bills just under the limit, days apart; routine small bills don't count.
  const floor = limit * 0.3;
  if (!vendor || inv.doc_type !== 'invoice' || (inv.total_cad || 0) >= limit || (inv.total_cad || 0) < floor) return null;
  const sib = all(`SELECT * FROM invoices WHERE vendor_id = ? AND invoice_id != ? AND doc_type = 'invoice' AND status NOT IN ('rejected')
    AND abs(julianday(invoice_date) - julianday(?)) <= 3 AND total_cad < ? AND total_cad >= ? AND (department_id = ? OR ? IS NULL)`, vendor.vendor_id, inv.invoice_id, inv.invoice_date, limit, floor, inv.department_id, inv.department_id);
  if (!sib.length) return null;
  const sum = round2(sib.reduce((a, s) => a + s.total_cad, 0) + inv.total_cad);
  if (sum <= limit) return null;
  const nums = [inv.vendor_invoice_number, ...sib.map((s) => s.vendor_invoice_number)];
  return {
    code: 'SPLIT_INVOICE', category: 'policy', severity: 'warn', title: 'Possible split to avoid approval limit',
    detail: `${sib.length + 1} invoices from ${vendor.legal_name} within 3 days (#${nums.join(', #')}) are each under the ${money(limit)} manager limit but total ${money(sum)}. Approval is routed as if they were one ${money(sum)} invoice.`,
    related_id: sib.map((s) => s.invoice_id).join(','), combined: sum,
  };
}

export function isGoodsCategory(cat) { return GOODS_CATEGORIES.has(cat); }
export { normName };
