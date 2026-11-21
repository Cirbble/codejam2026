// Journal export, spend analytics and plain-language spend questions.
import { all, get } from '../db.js';
import { today } from '../config.js';
import { round2, money, quarterRange, addDays, toCsv } from '../util.js';
import { gemini } from './extract.js';

// ---------- journal ----------
const CASH = { account: '1000', name: 'Cash - Operating (Brim)' };
const CARD_CLEARING = { account: '2110', name: 'Brim Card Payable' };

export function journal({ from = '2026-01-01', to = '2026-12-31' } = {}) {
  const gl = Object.fromEntries(all('SELECT account_number, name FROM gl_accounts').map((g) => [g.account_number, g.name]));
  const cc = Object.fromEntries(all('SELECT department_id, cost_centre FROM departments').map((d) => [d.department_id, d.cost_centre]));
  const rows = [];
  const push = (e) => rows.push({ ...e, debit: e.debit ? round2(e.debit) : '', credit: e.credit ? round2(e.credit) : '', account_name: e.account_name || gl[e.account] || '', cost_centre: e.department ? cc[e.department] : '' });
  const invs = all(`SELECT i.*, v.legal_name FROM invoices i LEFT JOIN vendors v ON v.vendor_id = i.vendor_id
    WHERE i.invoice_date BETWEEN ? AND ? AND i.status IN ('approved','scheduled','paid','applied') ORDER BY i.invoice_date, i.invoice_id`, from, to);
  for (const inv of invs) {
    const fx = inv.fx_rate_to_cad || 1;
    const lines = all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no', inv.invoice_id);
    const taxes = all('SELECT * FROM invoice_taxes WHERE invoice_id = ?', inv.invoice_id);
    const nonRecoverable = taxes.filter((t) => t.code === 'PST7_BC').reduce((a, t) => a + t.amount, 0);
    const base = lines.reduce((a, l) => a + l.amount, 0) || 1;
    const memo = `${inv.legal_name || inv.extracted_vendor_name} #${inv.vendor_invoice_number}`;
    const id = `JE-${inv.invoice_id}`;
    let dr = 0;
    for (const l of lines) {
      // Non-recoverable BC PST is a cost: spread over the lines it was charged on.
      const amt = (l.amount + (nonRecoverable * l.amount) / base) * fx;
      dr += amt;
      push({ entry_id: id, date: inv.invoice_date, source: 'AP invoice', reference: inv.invoice_id, account: l.gl_account, department: l.department_id, ...(amt >= 0 ? { debit: amt } : { credit: -amt }), memo: `${memo} - ${l.description}` });
    }
    for (const t of taxes.filter((t) => t.code !== 'PST7_BC')) {
      const acct = t.code === 'QST9975' ? '1165' : '1160';
      const amt = t.amount * fx;
      dr += amt;
      push({ entry_id: id, date: inv.invoice_date, source: 'AP invoice', reference: inv.invoice_id, account: acct, ...(amt >= 0 ? { debit: amt } : { credit: -amt }), memo: `${t.code} ${memo}` });
    }
    const ap = round2(dr);
    push({ entry_id: id, date: inv.invoice_date, source: 'AP invoice', reference: inv.invoice_id, account: '2100', ...(ap >= 0 ? { credit: ap } : { debit: -ap }), memo });
  }
  const pays = all(`SELECT p.*, i.total_cad inv_cad, i.vendor_invoice_number, v.legal_name FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
    WHERE p.paid_date BETWEEN ? AND ? AND p.status IN ('settled','outstanding') ORDER BY p.paid_date`, from, to);
  for (const p of pays) {
    const id = `JE-${p.payment_id}`;
    const memo = `Payment ${p.reference} ${p.legal_name} #${p.vendor_invoice_number}`;
    const apAmt = round2(p.inv_cad);
    const cash = round2(p.amount_cad);
    const discCad = round2((p.discount_taken || 0) * (p.fx_rate_to_cad || 1));
    const fxDiff = round2(cash + discCad - apAmt);
    push({ entry_id: id, date: p.paid_date, source: 'AP payment', reference: p.payment_id, account: '2100', debit: apAmt, memo });
    push({ entry_id: id, date: p.paid_date, source: 'AP payment', reference: p.payment_id, ...(p.method === 'CARD' ? CARD_CLEARING : CASH), account_name: (p.method === 'CARD' ? CARD_CLEARING : CASH).name, credit: cash, memo });
    if (discCad) push({ entry_id: id, date: p.paid_date, source: 'AP payment', reference: p.payment_id, account: '7020', account_name: 'Early-payment discount', credit: discCad, memo: `Discount taken ${memo}` });
    if (Math.abs(fxDiff) >= 0.01) push({ entry_id: id, date: p.paid_date, source: 'AP payment', reference: p.payment_id, account: '7020', ...(fxDiff > 0 ? { debit: fxDiff } : { credit: -fxDiff }), memo: `FX ${memo}` });
  }
  return rows;
}
export function journalCsv(opts) {
  return toCsv(journal(opts), ['entry_id', 'date', 'source', 'reference', 'account', 'account_name', 'department', 'cost_centre', 'debit', 'credit', 'memo']);
}

// ---------- spend ----------
// Line-level spend (pre-tax, CAD) so a bill split across departments is counted where it belongs.
const SPEND_SQL = `SELECT i.invoice_id, i.invoice_date, i.vendor_id, v.legal_name vendor, v.category, l.gl_account, g.name gl_name,
    coalesce(l.department_id, i.department_id) department_id, d.name department, round(l.amount * coalesce(i.fx_rate_to_cad,1), 2) cad
  FROM invoice_lines l JOIN invoices i ON i.invoice_id = l.invoice_id LEFT JOIN vendors v ON v.vendor_id = i.vendor_id
  LEFT JOIN gl_accounts g ON g.account_number = l.gl_account LEFT JOIN departments d ON d.department_id = coalesce(l.department_id, i.department_id)
  WHERE i.status NOT IN ('rejected','draft','needs_review')`;

export function spendRows({ department_id = null } = {}) {
  return all(`${SPEND_SQL} ${department_id ? 'AND coalesce(l.department_id, i.department_id) = ?' : ''}`, ...(department_id ? [department_id] : []));
}

export function analytics({ department_id = null } = {}) {
  const rows = spendRows({ department_id });
  const group = (key, label) => {
    const m = new Map();
    for (const r of rows) { const k = r[key] || 'Uncoded'; const o = m.get(k) || { key: k, label: r[label] || k, cad: 0, n: 0 }; o.cad += r.cad; o.n++; m.set(k, o); }
    return [...m.values()].map((o) => ({ ...o, cad: round2(o.cad) })).sort((a, b) => b.cad - a.cad);
  };
  const byMonth = new Map();
  for (const r of rows) { const k = r.invoice_date.slice(0, 7); byMonth.set(k, round2((byMonth.get(k) || 0) + r.cad)); }
  const budgets = all('SELECT * FROM departments').map((d) => {
    const ytd = round2(rows.filter((r) => r.department_id === d.department_id && r.invoice_date.startsWith('2026')).reduce((a, r) => a + r.cad, 0));
    return { department_id: d.department_id, name: d.name, budget: d.annual_budget_cad, ytd, pct: d.annual_budget_cad ? round2(ytd / d.annual_budget_cad) : null };
  }).filter((b) => !department_id || b.department_id === department_id);
  const card = all(`SELECT substr(posted_date,1,7) month, source, round(sum(amount_cad),2) cad, count(*) n FROM card_transactions GROUP BY month, source ORDER BY month`);
  return {
    total: round2(rows.reduce((a, r) => a + r.cad, 0)),
    by_vendor: group('vendor_id', 'vendor').slice(0, 15),
    by_department: group('department_id', 'department'),
    by_category: group('category', 'category'),
    by_gl: group('gl_account', 'gl_name'),
    by_month: [...byMonth].sort().map(([month, cad]) => ({ month, cad })),
    budgets, card,
  };
}

// ---------- plain-language questions ----------
// The question is turned into a small, typed query spec (by Gemini, or by rules if it is unavailable).
// The spec is validated and run with parameterised SQL; the model never writes SQL.
const SPEC_PROMPT = (q, ctx) => `Turn a question about Harborline Logistics' accounts-payable spend into a JSON query spec.
Today is ${today()}. Fiscal year = calendar year. Quarters: Q1 Jan-Mar, Q2 Apr-Jun, Q3 Jul-Sep, Q4 Oct-Dec. "Last quarter" = the most recent completed quarter.
Departments: ${ctx.departments.join(', ')}.
Vendor categories: ${ctx.categories.join(', ')}.
GL accounts: ${ctx.gls.join('; ')}.
Return ONLY: {"metric":"sum"|"count"|"avg","group_by":null|"vendor"|"department"|"category"|"gl"|"month","filters":{"department":str|null,"category":str|null,"vendor":str|null,"gl_account":str|null,"date_from":"YYYY-MM-DD"|null,"date_to":"YYYY-MM-DD"|null},"limit":int|null,"interpretation":"one short sentence restating the question"}
Use exact names from the lists. "Freight" means category "Freight & Carriers".
Question: ${q}`;

export async function ask(question, { department_id = null } = {}) {
  const ctx = {
    departments: all('SELECT name FROM departments').map((d) => d.name),
    categories: all('SELECT DISTINCT category FROM vendors').map((c) => c.category),
    gls: all(`SELECT account_number || ' ' || name x FROM gl_accounts WHERE account_type = 'expense'`).map((g) => g.x),
  };
  let spec = null, via = 'rules';
  try {
    const r = await gemini({ parts: [{ text: SPEC_PROMPT(question, ctx) }], cacheKey: `ask-${hash(question.toLowerCase().trim() + today())}` });
    spec = r.value; via = 'gemini';
  } catch { spec = ruleSpec(question, ctx); }
  if (!spec || typeof spec !== 'object') spec = ruleSpec(question, ctx);
  return runSpec(spec, question, via, department_id);
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }

function runSpec(spec, question, via, scopeDept) {
  const f = spec.filters || {};
  const where = [];
  const params = [];
  const dept = f.department ? get('SELECT department_id, name FROM departments WHERE lower(name) = lower(?)', f.department) : null;
  if (scopeDept) { where.push('department_id = ?'); params.push(scopeDept); }
  else if (dept) { where.push('department_id = ?'); params.push(dept.department_id); }
  if (f.category) { where.push('lower(category) = lower(?)'); params.push(f.category); }
  if (f.vendor) { where.push('lower(vendor) LIKE lower(?)'); params.push(`%${f.vendor}%`); }
  if (f.gl_account) { where.push('gl_account = ?'); params.push(String(f.gl_account).slice(0, 4)); }
  if (f.date_from && /^\d{4}-\d{2}-\d{2}$/.test(f.date_from)) { where.push('invoice_date >= ?'); params.push(f.date_from); }
  if (f.date_to && /^\d{4}-\d{2}-\d{2}$/.test(f.date_to)) { where.push('invoice_date <= ?'); params.push(f.date_to); }
  const groups = { vendor: 'vendor', department: 'department', category: 'category', gl: "gl_account || ' ' || gl_name", month: 'substr(invoice_date,1,7)' };
  const g = groups[spec.group_by] || null;
  const agg = spec.metric === 'count' ? 'count(DISTINCT invoice_id)' : spec.metric === 'avg' ? 'round(sum(cad) / count(DISTINCT invoice_id), 2)' : 'round(sum(cad), 2)';
  const base = `SELECT * FROM (${SPEND_SQL}) s ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const limit = Math.min(Number(spec.limit) || 10, 50);
  const rows = g
    ? all(`SELECT ${g} label, ${agg} value, count(DISTINCT invoice_id) invoices FROM (${base}) GROUP BY label ORDER BY ${spec.group_by === 'month' ? 'label' : 'value DESC'} LIMIT ${limit}`, ...params)
    : all(`SELECT ${agg} value, count(DISTINCT invoice_id) invoices FROM (${base})`, ...params);
  const total = g ? round2(rows.reduce((a, r) => a + (r.value || 0), 0)) : rows[0]?.value || 0;
  const scope = [dept?.name || (scopeDept ? 'your department' : null), f.category, f.vendor, f.gl_account].filter(Boolean).join(', ');
  const period = f.date_from || f.date_to ? `${f.date_from || 'start'} to ${f.date_to || 'today'}` : 'all of 2026 to date';
  const fmt = (v) => (spec.metric === 'count' ? `${v} invoices` : money(v));
  const answer = g
    ? `${rows.length ? `${spec.group_by === 'month' ? 'Highest month' : 'Top'}: ${(spec.group_by === 'month' ? [...rows].sort((a, b) => b.value - a.value)[0] : rows[0]).label} at ${fmt((spec.group_by === 'month' ? [...rows].sort((a, b) => b.value - a.value)[0] : rows[0]).value)}.` : 'No matching spend.'} ${spec.metric === 'count' ? '' : `The ${rows.length} shown total ${money(total)}`} across ${rows.reduce((a, r) => a + r.invoices, 0)} invoices${scope ? ` for ${scope}` : ''}, ${period}.`
    : `${fmt(total || 0)}${spec.metric === 'sum' ? ' (pre-tax, CAD)' : ''}${scope ? ` for ${scope}` : ''}, ${period}, across ${rows[0]?.invoices || 0} invoices.`;
  return { question, answer: answer.replace(/\s+/g, ' ').trim(), interpretation: spec.interpretation || null, spec, via, rows, total };
}

function ruleSpec(q, ctx) {
  const s = q.toLowerCase();
  const t = today();
  const year = Number(t.slice(0, 4));
  const curQ = Math.floor((Number(t.slice(5, 7)) - 1) / 3) + 1;
  let from = null, to = null;
  let m;
  if (/last quarter|previous quarter/.test(s)) { const lq = curQ === 1 ? 4 : curQ - 1; [from, to] = quarterRange(curQ === 1 ? year - 1 : year, lq); }
  else if (/this quarter/.test(s)) [from, to] = quarterRange(year, curQ);
  else if ((m = /\bq([1-4])\b/.exec(s))) [from, to] = quarterRange(year, Number(m[1]));
  else if (/last month/.test(s)) { const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); from = d.toISOString().slice(0, 10); to = addDays(t.slice(0, 8) + '01', -1); }
  else if (/this year|ytd|year to date/.test(s)) { from = `${year}-01-01`; to = t; }
  const department = ctx.departments.find((d) => s.includes(d.toLowerCase())) || null;
  const syn = { freight: 'Freight & Carriers', fuel: 'Fuel & Fleet', software: 'Software & SaaS', saas: 'Software & SaaS', rent: 'Rent & Property', legal: 'Legal', utilities: 'Utilities', marketing: 'Marketing & Advertising', travel: 'Travel', consulting: 'Consulting', insurance: 'Insurance', telecom: 'Telecom', catering: 'Events & Catering' };
  const category = ctx.categories.find((c) => s.includes(c.toLowerCase())) || Object.entries(syn).find(([k]) => s.includes(k))?.[1] || null;
  const group_by = /by vendor|top vendors|which vendors|suppliers/.test(s) ? 'vendor' : /by department|which department/.test(s) ? 'department' : /by category/.test(s) ? 'category' : /by month|monthly|trend/.test(s) ? 'month' : null;
  const metric = /how many|number of|count/.test(s) ? 'count' : /average|avg/.test(s) ? 'avg' : 'sum';
  return { metric, group_by, filters: { department, category, vendor: null, gl_account: null, date_from: from, date_to: to }, limit: 10, interpretation: null };
}
