// Invoice capture.
//   1. PDF with a text layer  -> pdf.js text in content-stream order -> deterministic parser (EN/FR).
//   2. Parser confidence low, arithmetic does not tie, or no text layer (scan/PNG/JPG)
//      -> Gemini (text prompt for PDFs, vision for images/scanned PDFs), JSON output, cached by file hash.
//   3. Results are reconciled field by field; every choice is recorded in `notes` so a reviewer sees why.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { round2, near } from '../util.js';

// ---------- PDF text ----------
let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

export async function pdfText(buffer) {
  const { getDocument } = await loadPdfjs();
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0, isEvalSupported: false }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // Content-stream order keeps label/value pairs together even when the visual layout is scrambled.
    let line = '';
    for (const it of tc.items) {
      line += it.str;
      if (it.hasEOL) { out += line + '\n'; line = ''; }
    }
    if (line) out += line + '\n';
    out += '\n';
  }
  await doc.destroy();
  return out.replace(/ | | /g, ' ');
}

// ---------- money / dates ----------
const MONEY_RE = new RegExp(
  [
    // French: 1 014,18 $  | -1 428,50 $
    String.raw`(?<fr>-?\s?\d{1,3}(?:[ .]\d{3})*,\d{2})\s?\$`,
    // English with symbol: -$1,042.76 | $1,230.00 | US$ 1,950.00 | (1,000.00)
    String.raw`(?<en>\(?-?\s?(?:US|CA|C)?\$\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?)`,
    // Bare decimals: 1,230.00
    String.raw`(?<bare>\(?-?\d{1,3}(?:,\d{3})*\.\d{2}\)?|\(?-?\d+\.\d{2}\)?)(?![\d%])`,
  ].join('|'),
  'g',
);

export function parseMoney(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  const neg = /^\(.*\)$/.test(s) || /-/.test(s.replace(/\d-\d/g, ''));
  if (/,\d{2}\s*\$?\s*$/.test(s) && !/\.\d{2}/.test(s)) s = s.replace(/[ .]/g, '').replace(',', '.');
  s = s.replace(/[^\d.]/g, '');
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? round2(neg ? -v : v) : null;
}

export function findMoney(line) {
  const out = [];
  MONEY_RE.lastIndex = 0;
  let m;
  while ((m = MONEY_RE.exec(line))) {
    const raw = m.groups.fr ?? m.groups.en ?? m.groups.bare;
    // Ignore percentages like "(9.68%)" and tax numbers.
    if (/%/.test(line.slice(m.index + m[0].length, m.index + m[0].length + 1))) continue;
    out.push({ raw, value: parseMoney(raw), index: m.index, end: m.index + m[0].length, kind: m.groups.fr ? 'fr' : m.groups.en ? 'en' : 'bare' });
  }
  return out;
}

const MONTHS = {
  jan: 1, january: 1, janvier: 1, feb: 2, february: 2, fevrier: 2, février: 2, mar: 3, march: 3, mars: 3, apr: 4, april: 4, avril: 4,
  may: 5, mai: 5, jun: 6, june: 6, juin: 6, jul: 7, july: 7, juillet: 7, aug: 8, august: 8, aout: 8, août: 8, sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12, décembre: 12,
};
const pad = (n) => String(n).padStart(2, '0');
function validYmd(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function parseDate(s, { monthFirst = false } = {}) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  let m;
  if ((m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t))) return validYmd(+m[1], +m[2], +m[3]);
  if ((m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t))) {
    // Canadian invoices: assume DD/MM/YYYY unless the first part cannot be a day-of-month swap.
    // US vendors (USD documents) write MM/DD/YYYY.
    const a = +m[1], b = +m[2];
    return a > 12 ? validYmd(+m[3], b, a) : b > 12 ? validYmd(+m[3], a, b) : monthFirst ? validYmd(+m[3], a, b) : validYmd(+m[3], b, a);
  }
  if ((m = /([a-zéû]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(t)) && MONTHS[m[1]]) return validYmd(+m[3], MONTHS[m[1]], +m[2]);
  if ((m = /(\d{1,2})(?:er)?\s+([a-zéû]{3,9})\.?\s+(\d{4})/.exec(t)) && MONTHS[m[2]]) return validYmd(+m[3], MONTHS[m[2]], +m[1]);
  return null;
}

// ---------- labels (EN + FR) ----------
const L = {
  invoiceNo: /^(?:tax\s+)?(?:invoice|inv|facture|bill|statement|credit\s*note|credit\s*memo|memo|note\s+de\s+cr[ée]dit|avoir)\s*(?:#|no\.?|n[°ºo]\.?|number|num[ée]ro)\s*[:#]?\s*(.+)$/i,
  invoiceNo2: /^(?:no\.?\s*de\s*facture|num[ée]ro\s+de\s+facture|document\s*(?:#|no\.?))\s*[:#]?\s*(.+)$/i,
  invoiceDate: /^(?:invoice\s+date|bill\s+date|statement\s+date|memo\s+date|credit\s+date|date\s+of\s+issue|issue\s+date|issued(?:\s+on)?|date|date\s+de\s+(?:la\s+)?facture|date\s+d['’]?[ée]mission|dated)\s*[:]?\s*(.+)$/i,
  dueDate: /^(?:due\s+date|due\s+by|due\s+on|payment\s+due|due|[ée]ch[ée]ance|date\s+d['’][ée]ch[ée]ance|payable\s+(?:le|by))\s*[:]?\s*(.+)$/i,
  terms: /^(?:payment\s+terms|terms|conditions(?:\s+de\s+paiement)?|modalit[ée]s)\s*[:]?\s*(.+)$/i,
  po: /^(?:p\.?o\.?\b\s*(?:ref|#|no\.?|number)?|your\s+po|customer\s+po|purchase\s+order(?:\s*(?:#|no\.?))?|bon\s+de\s+commande|n[°º]?\s*de\s+commande|votre\s+bc)\s*[:#]?\s*(.*)$/i,
  creditRef: /^(?:credit\s+note\s+ref|applies\s+to(?:\s+invoice)?|applied\s+to(?:\s+invoice)?|against\s+invoice|original\s+invoice(?:\s*(?:no\.?|#|number))?|ref(?:erence)?\s+invoice|r[ée]f(?:[ée]rence)?\s+(?:facture|avoir))\s*[:#]?\s*(.*)$/i,
  billTo: /^(?:bill[\s-]*to|billed\s+to|sold\s+to|invoice\s+to|billing\s+address|customer|facturer\s+[àa]|factur[ée]\s+[àa]|client|adresse\s+de\s+facturation)\s*:?\s*$/i,
  shipTo: /^(?:ship\s*to|deliver\s+to|delivery\s+address|livrer\s+[àa]|lieu\s+de\s+livraison|service\s+location)\s*:?\s*(.*)$/i,
  subtotal: /^(?:sub[\s-]?total|sous[\s-]?total|montant\s+avant\s+taxes|total\s+before\s+tax(?:es)?|total\s+current\s+charges|current\s+charges\s+total|net\s+amount)\b/i,
  total: /^(?:total(?:\s+(?:cad|usd|due|amount|à\s+payer|payable|ttc))*|amount\s+due|balance\s+due|montant\s+(?:total|d[ûu])|grand\s+total)\b/i,
  tax: /^(gst\s*\/\s*hst|tps\s*\/\s*tvh|hst|gst|pst|qst|rst|tps|tvh|tvq|tvp|sales\s+tax)\b/i,
  tableHeader: /^(?:(?:qty|quantity|qt[ée])\s+)?(?:description|item|d[ée]signation|article|current\s+charges|service|details)\b.*(?:amount|montant|total)\s*$/i,
};
const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const PROV_RE = new RegExp(String.raw`\b(${PROVINCES.join('|')})\b\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d`);
const PROV_NAMES = { ontario: 'ON', quebec: 'QC', 'québec': 'QC', 'british columbia': 'BC', alberta: 'AB', manitoba: 'MB', saskatchewan: 'SK' };
// Harborline's four offices: if no bill-to block was recognised, its postal code still identifies the delivery province.
const OFFICES = { 'M5J 0B8': 'ON', 'V6E 2E9': 'BC', 'T2P 3H7': 'AB', 'H3B 4W8': 'QC' };
export function officeProvince(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const hits = Object.entries(OFFICES).filter(([pc]) => t.includes(pc));
  return hits.length === 1 ? hits[0][1] : null;
}
export function provinceFromAddress(s) {
  if (!s) return null;
  const m = PROV_RE.exec(s);
  if (m) return m[1];
  const m2 = /\b(AB|BC|MB|ON|QC|SK|NS|NB|PE|NL)\b/.exec(s);
  if (m2) return m2[1];
  const low = s.toLowerCase();
  for (const [k, v] of Object.entries(PROV_NAMES)) if (low.includes(k)) return v;
  return null;
}

function taxTypeFromLabel(label) {
  const l = label.toLowerCase().replace(/\s+/g, '');
  if (/gst\/hst|tps\/tvh/.test(l)) return 'GST/HST';
  if (/hst|tvh/.test(l)) return 'HST';
  if (/gst|tps/.test(l)) return 'GST';
  if (/qst|tvq/.test(l)) return 'QST';
  if (/pst|rst|tvp/.test(l)) return 'PST';
  return 'TAX';
}
const DEFAULT_RATES = { GST: 5, HST: 13, QST: 9.975, PST: 7 };

// ---------- deterministic parser ----------
export function parseInvoiceText(text) {
  const notes = [];
  const lines = text.split(/\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s && !/^[=\-_*]{5,}$/.test(s));
  const r = {
    vendor_name: null, vendor_address: null, vendor_gst_hst_number: null, vendor_qst_number: null, doc_type: 'invoice',
    invoice_number: null, invoice_date: null, due_date: null, terms: null, po_number: null, credit_note_ref: null,
    currency: null, bill_to_address: null, ship_to_address: null, ship_to_province: null, line_items: [], subtotal: null,
    taxes: [], total: null, bank: null, payment_instructions: null, early_payment_discount: null, language: 'en',
  };
  if (/\b(facture|sous-total|tps|tvq|[ée]ch[ée]ance|montant)\b/i.test(text)) r.language = 'fr';
  if (/\b(credit\s+note|credit\s+memo|note\s+de\s+cr[ée]dit|avoir)\b/i.test(text)) r.doc_type = 'credit_note';
  const monthFirst = /\bUSD\b|US\$/.test(text);

  // Tax registration numbers (the buyer's own number appears in the bill-to block and is skipped).
  const bn = [...text.matchAll(/\b(\d{9})\s?RT\s?(\d{4})\b/g)].map((m) => `${m[1]}RT${m[2]}`).filter((x) => !config.buyerTaxIds.includes(x));
  r.vendor_gst_hst_number = bn[0] || null;
  const qst = /\b(\d{10})\s?TQ\s?(\d{4})\b/.exec(text);
  r.vendor_qst_number = qst ? `${qst[1]}TQ${qst[2]}` : null;

  // Vendor block = top lines before the first label/doc title.
  const isTitle = (s) => /^(tax\s+)?(invoice|facture|credit\s+note|note\s+de\s+cr[ée]dit|statement|bill)$/i.test(s);
  const headerLines = [];
  for (const s of lines) {
    if (isTitle(s) || L.billTo.test(s) || /:/.test(s) || L.invoiceNo.test(s)) break;
    headerLines.push(s);
  }
  const vend = headerLines.filter((s) => !/\b(GST|HST|TPS|TVH|TVQ|QST)\b/.test(s) && !isTitle(s.replace(/\s+(INVOICE|FACTURE|TAX INVOICE|CREDIT NOTE)$/i, '')));
  if (vend.length) {
    r.vendor_name = vend[0].replace(/\s+(TAX\s+)?(INVOICE|FACTURE|CREDIT NOTE)$/i, '').trim();
    r.vendor_address = vend.slice(1, 4).join(', ') || null;
  }

  let inTable = false, inBillTo = false, inShipTo = false, afterTotals = false;
  const billTo = [], shipTo = [];
  let pendingDesc = null;

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    let m;
    if (L.billTo.test(s)) { inBillTo = true; inShipTo = false; continue; }
    if ((m = L.shipTo.exec(s)) && !L.invoiceNo.test(s)) { inShipTo = true; inBillTo = false; if (m[1]) shipTo.push(m[1]); continue; }
    if (inBillTo || inShipTo) {
      if (L.tableHeader.test(s) || /^description\b/i.test(s) || isTitle(s) || /:/.test(s) || /^(remit|ship|deliver)/i.test(s) || findMoney(s).length) { inBillTo = inShipTo = false; }
      else { (inBillTo ? billTo : shipTo).push(s); if ((inBillTo ? billTo : shipTo).length >= 4) inBillTo = inShipTo = false; continue; }
    }

    if (!r.invoice_number && ((m = L.invoiceNo.exec(s)) || (m = L.invoiceNo2.exec(s)))) {
      const v = m[1].trim().split(/\s{2,}|\s+(?=date|due|issued)/i)[0].trim();
      if (/\d/.test(v)) { r.invoice_number = v.replace(/[.,;]$/, ''); continue; }
    }
    if (!r.due_date && (m = L.dueDate.exec(s))) { const d = parseDate(m[1], { monthFirst }); if (d) { r.due_date = d; continue; } }
    if (!r.invoice_date && (m = L.invoiceDate.exec(s)) && !/due|[ée]ch[ée]ance/i.test(s)) { const d = parseDate(m[1], { monthFirst }); if (d) { r.invoice_date = d; continue; } }
    if (!r.terms && (m = L.terms.exec(s))) { r.terms = m[1].trim(); continue; }
    if (r.po_number === null && (m = L.po.exec(s)) && !findMoney(s).length) { r.po_number = m[1].trim() || ''; continue; }
    if (!r.credit_note_ref && (m = L.creditRef.exec(s))) { r.credit_note_ref = m[1].trim() || null; continue; }

    if (L.tableHeader.test(s) || /^(description|d[ée]signation)\s+(qty|qt[ée]|quantity|quantit[ée])/i.test(s)) { inTable = true; continue; }

    const moneys = findMoney(s);
    if (L.subtotal.test(s) && moneys.length) { r.subtotal = moneys.at(-1).value; inTable = false; afterTotals = true; continue; }
    if ((m = L.tax.exec(s)) && moneys.length && !/\bRT\d{4}|\d{9}/.test(s)) {
      const rateM = /(\d{1,2}(?:[.,]\d{1,3})?)\s?%/.exec(s);
      const type = taxTypeFromLabel(m[1]);
      const rate = rateM ? Number(rateM[1].replace(',', '.')) : DEFAULT_RATES[type] ?? null;
      r.taxes.push({ type: type === 'GST/HST' ? (rate === 13 ? 'HST' : 'GST') : type, label: s.slice(0, s.indexOf(moneys.at(-1).raw)).trim(), rate_percent: rate, amount: moneys.at(-1).value });
      inTable = false; afterTotals = true;
      continue;
    }
    if (L.total.test(s) && !L.subtotal.test(s)) {
      // Total can sit on the next line when the layout wraps.
      const mv = moneys.length ? moneys : findMoney(lines[i + 1] || '');
      if (mv.length) {
        r.total = mv.at(-1).value;
        const cur = /\b(USD|CAD|EUR)\b/i.exec(s) || /\b(US\$|USD)\b/.exec(mv.at(-1).raw);
        if (cur) r.currency = cur[1].toUpperCase().replace('US$', 'USD');
        inTable = false; afterTotals = true;
        continue;
      }
    }
    // Bank / remittance: "Inst. 004 Transit 12345 Acct 1234567" on one line, or labelled over several lines.
    if (!r.bank && /\b(bank|banking|remit|remittance|virement|deposit|eft|wire|institution|transit)\b/i.test(s)) {
      const win = lines.slice(i, i + 5).join(' ');
      const inst = /(?:inst(?:itution)?|financial\s+institution|bank\s+(?:no|number|#))\.?\s*(?:no\.?|#|number)?\s*:?\s*(\d{3})\b/i.exec(win);
      const tr = /(?:transit|branch(?:\s+transit)?|succursale)\s*(?:no\.?|#|number)?\s*:?\s*(\d{5})\b/i.exec(win);
      const ac = /(?:acc(?:oun)?t|compte)\.?\s*(?:no\.?|#|number)?\s*:?\s*(\d{5,12})\b/i.exec(win);
      if (inst && tr && ac) r.bank = { institution: inst[1], transit: tr[1], account: ac[1] };
      else if (/(transit|account\s+(?:no|number|#)|acct|compte)/i.test(win)) r.bank_hint = true;
    }
    if ((m = /(?:inst(?:itution)?\.?\s*(?:no\.?|#)?\s*:?\s*(\d{3}))[\s,;]+(?:transit\s*(?:no\.?|#)?\s*:?\s*(\d{5}))[\s,;]+(?:acc(?:oun)?t|compte|account\s*no\.?)\s*(?:no\.?|#)?\s*:?\s*(\d{5,12})/i.exec(s))) {
      r.bank = { institution: m[1], transit: m[2], account: m[3] };
      continue;
    }
    if (/credit card|carte de cr[ée]dit|online portal|portail/i.test(s)) r.payment_instructions = s;
    if ((m = /(\d{1,2}(?:\.\d+)?)\s?%\s*(?:discount|escompte)[^\d]*(\d{1,3})\s*(?:days|jours)/i.exec(s)) || (m = /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*,?\s*net\s*\d+/i.exec(s))) {
      r.early_payment_discount = { percent: Number(m[1]), days: Number(m[2]) };
    }

    // Line items: within the table, or any line with qty/unit/amount shape before totals.
    if ((inTable || (!afterTotals && moneys.length >= 2)) && !afterTotals) {
      const item = parseItemLine(s, moneys);
      if (item) {
        if (pendingDesc && (!item.description || item.description.length < 3)) item.description = pendingDesc;
        else if (pendingDesc) item.description = `${pendingDesc} ${item.description}`.trim();
        pendingDesc = null;
        r.line_items.push(item);
      } else if (inTable && !moneys.length && !/^(remit|thank|merci)/i.test(s)) {
        pendingDesc = pendingDesc ? `${pendingDesc} ${s}` : s;
      }
    }
  }
  if (r.terms && !r.early_payment_discount) {
    const m = /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*,?\s*net\s*\d+/i.exec(r.terms);
    if (m) r.early_payment_discount = { percent: Number(m[1]), days: Number(m[2]) };
  }
  r.bill_to_address = billTo.filter((x) => !/RT\d{4}/.test(x) && x !== config.buyerName).join(', ') || null;
  r.ship_to_address = shipTo.filter((x) => !/RT\d{4}/.test(x)).join(', ') || null;
  r.ship_to_province = provinceFromAddress(r.ship_to_address) || provinceFromAddress(r.bill_to_address) || officeProvince(text);
  if (!r.currency) r.currency = /\bUSD\b|US\$/.test(text) ? 'USD' : 'CAD';
  if (r.po_number === '') r.po_number = null;
  if (r.subtotal === null && r.line_items.length) { r.subtotal = round2(r.line_items.reduce((a, l) => a + l.amount, 0)); notes.push('Subtotal not printed; computed from lines.'); }
  return { result: r, notes };
}

function parseItemLine(s, moneys) {
  if (!moneys.length) return null;
  if (/^(subtotal|sous|total|gst|hst|pst|qst|tps|tvq|balance|amount due|remit|inst\.)/i.test(s)) return null;
  const amountTok = moneys.at(-1);
  const unitTok = moneys.length >= 2 ? moneys.at(-2) : null;
  let rest = s.slice(0, (unitTok || amountTok).index).trim();
  let qty = null;
  let unit = unitTok ? unitTok.value : null;
  const qm = /(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*(?:x|hrs?|h|units?)?\s*$/i.exec(rest);
  if (qm) { qty = Number(qm[1].replace(',', '.')); rest = rest.slice(0, qm.index).trim(); }
  // French ambiguity: "11 114,18 $" could be qty 11 + 114,18. Use qty*unit = amount to decide.
  if (unitTok && unitTok.kind === 'fr' && qty === null) {
    const parts = unitTok.raw.trim().split(' ');
    if (parts.length > 1) {
      const q2 = Number(parts[0]), u2 = parseMoney(parts.slice(1).join(' ') + ' $');
      if (near(q2 * u2, amountTok.value, 0.05)) { qty = q2; unit = u2; }
    }
  }
  if (qty === null && unitTok) {
    // Quantity-first tables: "12 Toner cartridge $89.50 $1,074.00".
    const lead = /^(\d+(?:[.,]\d+)?)\s+(?=\D)/.exec(rest);
    // Only when it makes qty x unit = amount; otherwise it is part of the description ("2026 annual fee")
    // and the line is left for the second reader.
    const q = lead ? Number(lead[1].replace(',', '.')) : null;
    if (lead && unit && near(round2(q * unit), amountTok.value, 0.05)) { qty = q; rest = rest.slice(lead[0].length).trim(); }
  }
  if (unit === null) { unit = amountTok.value; qty = qty ?? 1; }
  if (qty === null) {
    // Never invent a fractional quantity: leave it unknown so a second reader takes over.
    const q = unit ? amountTok.value / unit : null;
    qty = near(unit, amountTok.value) ? 1 : q !== null && Math.abs(q - Math.round(q)) < 0.001 ? Math.round(q) : null;
  }
  const description = rest.replace(/[\s|:]+$/, '').trim();
  if (!description && !unitTok) return null;
  return { description, quantity: qty, unit_price: unit, amount: amountTok.value };
}

// ---------- quality ----------
export function assess(r) {
  const issues = [];
  if (!r.vendor_name) issues.push('vendor name');
  if (!r.invoice_number) issues.push('invoice number');
  if (!r.invoice_date) issues.push('invoice date');
  if (r.total === null || r.total === undefined) issues.push('total');
  if (!r.line_items?.length) issues.push('line items');
  const missing = issues.length;
  const lineSum = round2((r.line_items || []).reduce((a, l) => a + (Number(l.amount) || 0), 0));
  const taxSum = round2((r.taxes || []).reduce((a, t) => a + (Number(t.amount) || 0), 0));
  const tiesLines = r.subtotal !== null && near(lineSum, r.subtotal, 0.02);
  const tiesTotal = r.subtotal !== null && r.total !== null && near(round2(r.subtotal + taxSum), r.total, 0.02);
  const lineMath = (r.line_items || []).every((l) => l.quantity === null || l.unit_price === null || near(round2(l.quantity * l.unit_price), l.amount, 0.02));
  let confidence = 1 - missing * 0.18;
  if (!tiesLines) confidence -= 0.15;
  if (!tiesTotal) confidence -= 0.15;
  if (!lineMath) confidence -= 0.1;
  // Fields the checks depend on count too: without them a check silently can't run.
  if (!r.ship_to_province && r.currency !== 'USD') confidence -= 0.15;
  if (r.bank_hint && !r.bank) confidence -= 0.15;
  if (r.doc_type === 'credit_note' && !r.credit_note_ref) confidence -= 0.15;
  if ((r.line_items || []).some((l) => l.quantity === null)) confidence -= 0.15;
  return { confidence: Math.max(0, round2(confidence)), missing: issues, tiesLines, tiesTotal, lineMath, lineSum, taxSum };
}

// ---------- Gemini ----------
const PROMPT = `You extract data from a Canadian supplier invoice or credit note (English or French) sent to Harborline Logistics Inc.
Return ONLY JSON matching this shape (use null when a field is absent; never invent values; copy numbers exactly as printed, even if the invoice's own arithmetic is wrong):
{"vendor_name":str,"vendor_address":str,"vendor_gst_hst_number":str,"vendor_qst_number":str,"doc_type":"invoice"|"credit_note",
"invoice_number":str,"invoice_date":"YYYY-MM-DD","due_date":"YYYY-MM-DD","terms":str,"po_number":str,"credit_note_ref":str,
"currency":"CAD"|"USD","bill_to_address":str,"ship_to_address":str,"ship_to_province":"two-letter province of the bill-to/ship-to (delivery) address",
"line_items":[{"description":str,"quantity":num,"unit_price":num,"amount":num}],"subtotal":num,
"taxes":[{"type":"GST"|"HST"|"PST"|"QST","rate_percent":num,"amount":num}],"total":num,
"bank":{"institution":str,"transit":str,"account":str},"payment_instructions":str,"early_payment_discount":{"percent":num,"days":num},"language":"en"|"fr"}
Rules: Harborline's own GST number 100000001RT0001 is the BUYER's, not the vendor's. Credit notes use negative amounts. TPS=GST, TVH=HST, TVQ=QST. Dates must be ISO.`;

let spentUsd = 0;
export const llmStats = () => ({ spentUsd: round2(spentUsd * 1000) / 1000, model: config.geminiModel, enabled: !!config.geminiKey });

function cachePath(key) {
  return path.join(config.llmCacheDir, `${key}.json`);
}
// Writes go to the configured cache dir (a volume in production); the cache committed with the repo is
// read as a fallback so a fresh deploy re-processes the sample batch with zero API calls.
const SEED_CACHE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'cache', 'llm');
export function cacheGet(key) {
  for (const dir of [config.llmCacheDir, SEED_CACHE]) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8')); } catch { /* next */ }
  }
  return null;
}
export function cachePut(key, value) {
  fs.mkdirSync(config.llmCacheDir, { recursive: true });
  fs.writeFileSync(cachePath(key), JSON.stringify(value, null, 1));
}

export async function gemini({ parts, cacheKey, json = true, temperature = 0 }) {
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return { ...hit, cached: true };
  }
  if (!config.geminiKey) throw new Error('LLM unavailable: no GEMINI_API_KEY configured');
  if (spentUsd >= config.llmBudgetUsd) throw new Error('LLM budget reached for this process');
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Gemini HTTP ${res.status}`); await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      const data = await res.json();
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${data?.error?.message || 'error'}`);
      const usage = data.usageMetadata || {};
      // Conservative flash-tier estimate: $0.50/M input, $3.00/M output (incl. thinking).
      const cost = ((usage.promptTokenCount || 0) * 0.5 + ((usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0)) * 3) / 1e6;
      spentUsd += cost;
      const textOut = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      const value = json ? JSON.parse(textOut.replace(/^```json\s*|```\s*$/g, '')) : textOut;
      const out = { value, usage, cost, model: config.geminiModel, at: new Date().toISOString() };
      if (cacheKey) cachePut(cacheKey, out);
      return out;
    } catch (e) {
      lastErr = e;
      if (/HTTP 4\d\d/.test(e.message) && !/429/.test(e.message)) break;
    }
  }
  throw lastErr;
}

async function llmExtract({ buffer, mime, text, sha }) {
  const parts = [{ text: PROMPT }];
  if (text && text.trim().length > 80) parts.push({ text: `INVOICE TEXT (content order):\n${text.slice(0, 12000)}` });
  else parts.push({ inlineData: { mimeType: mime, data: buffer.toString('base64') } });
  const r = await gemini({ parts, cacheKey: `extract-${config.geminiModel}-${sha}` });
  return { result: normaliseLlm(r.value), cached: !!r.cached, cost: r.cost || 0 };
}

function normaliseLlm(v) {
  const r = { ...v };
  r.line_items = (v.line_items || []).map((l) => {
    const amount = parseMoney(l.amount);
    const quantity = l.quantity ?? 1;
    const unit = parseMoney(l.unit_price);
    return { description: l.description || '', quantity, unit_price: unit ?? (quantity ? round2(amount / quantity) : amount), amount };
  });
  r.taxes = (v.taxes || []).filter((t) => t && t.amount !== null).map((t) => ({ type: (t.type || 'TAX').toUpperCase(), rate_percent: t.rate_percent ?? DEFAULT_RATES[(t.type || '').toUpperCase()] ?? null, amount: parseMoney(t.amount), label: t.type }));
  for (const k of ['subtotal', 'total']) r[k] = parseMoney(v[k]);
  for (const k of ['invoice_date', 'due_date']) r[k] = parseDate(v[k]) || null;
  r.currency = (v.currency || 'CAD').toUpperCase();
  r.doc_type = v.doc_type === 'credit_note' || (r.total !== null && r.total < 0) ? 'credit_note' : 'invoice';
  r.ship_to_province = (v.ship_to_province || '').toUpperCase().slice(0, 2) || provinceFromAddress(v.ship_to_address) || provinceFromAddress(v.bill_to_address);
  if (r.vendor_gst_hst_number && config.buyerTaxIds.includes(r.vendor_gst_hst_number.replace(/\s/g, ''))) r.vendor_gst_hst_number = null;
  if (r.bank && !r.bank.account) r.bank = null;
  return r;
}

// ---------- orchestration ----------
export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function extractDocument({ buffer, filename, mime }) {
  const sha = sha256(buffer);
  const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(filename);
  const notes = [];
  let text = '';
  if (isPdf) {
    try { text = await pdfText(buffer); } catch (e) { notes.push(`PDF text layer unreadable (${e.message}).`); }
  }
  const hasText = text.replace(/\s/g, '').length > 120;
  let det = null, detQ = null;
  if (hasText) {
    det = parseInvoiceText(text);
    detQ = assess(det.result);
    notes.push(...det.notes);
  }
  // Deterministic result is accepted when every key field is found and the arithmetic ties out.
  if (det && detQ.confidence >= 0.9 && detQ.tiesLines && detQ.tiesTotal) {
    return { sha, method: 'pdf-text', confidence: detQ.confidence, text, result: det.result, notes: [...notes, 'Parsed from the PDF text layer; all totals tie out.'] };
  }
  const why = !hasText ? (isPdf ? 'No usable text layer (scanned PDF)' : 'Image file') : `Text parse incomplete (${[...detQ.missing, !detQ.tiesLines && 'lines ≠ subtotal', !detQ.tiesTotal && 'subtotal + tax ≠ total'].filter(Boolean).join(', ')})`;
  try {
    const llm = await llmExtract({ buffer, mime: isPdf ? 'application/pdf' : mime, text: hasText ? text : null, sha });
    const q = assess(llm.result);
    notes.push(`${why}; read with ${config.geminiModel}${hasText ? ' over the PDF text' : ' vision'}${llm.cached ? ' (cached)' : ''}.`);
    let result = llm.result;
    if (det) {
      // Field-level merge: keep deterministic values that the LLM agrees with or left empty.
      result = mergeResults(det.result, llm.result, notes);
      const mq = assess(result);
      if (!mq.tiesLines || !mq.tiesTotal) notes.push('Both readers agree the printed numbers do not tie out; this is treated as an invoice error, not a capture error.');
      return { sha, method: 'pdf-text+llm', confidence: Math.max(mq.confidence, q.confidence), text, result, notes };
    }
    return { sha, method: isPdf ? 'llm-pdf' : 'llm-vision', confidence: round2(q.confidence * 0.95), text, result, notes };
  } catch (e) {
    notes.push(`${why}; LLM fallback unavailable (${e.message}).`);
    if (det) return { sha, method: 'pdf-text', confidence: detQ.confidence, text, result: det.result, notes };
    return { sha, method: 'none', confidence: 0, text, result: emptyResult(), notes: [...notes, 'Needs manual entry.'] };
  }
}

function mergeResults(a, b, notes) {
  const out = { ...b };
  for (const k of ['invoice_number', 'invoice_date', 'due_date', 'vendor_gst_hst_number', 'vendor_qst_number', 'po_number', 'terms', 'ship_to_province', 'currency']) {
    if (a[k] && b[k] && String(a[k]) !== String(b[k])) notes.push(`${k}: text parser read "${a[k]}", LLM read "${b[k]}"; using LLM value.`);
    if (!b[k] && a[k]) out[k] = a[k];
  }
  if (!out.bank && a.bank) out.bank = a.bank;
  if (!out.early_payment_discount && a.early_payment_discount) out.early_payment_discount = a.early_payment_discount;
  if (!out.payment_instructions && a.payment_instructions) out.payment_instructions = a.payment_instructions;
  return out;
}

function emptyResult() {
  return { vendor_name: null, invoice_number: null, invoice_date: null, due_date: null, currency: 'CAD', line_items: [], taxes: [], subtotal: null, total: null, doc_type: 'invoice' };
}
