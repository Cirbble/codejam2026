// Smart GL / department coding learned from history.
// For each new line we combine three explainable signals:
//   (a) how this vendor's past lines were coded,
//   (b) the most similar past line descriptions across all vendors (token overlap, k nearest),
//   (c) the vendor's default GL from the vendor master.
// Human corrections are stored with coding_source='human' and immediately become training data.
import { all, get } from '../db.js';
import { jaccard, round2 } from '../util.js';

const STOP = new Set(['the', 'and', 'for', 'of', 'de', 'des', 'du', 'la', 'le', 'les', 'et', 'to', 'in', 'qty', 'x']);
export function descTokens(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\d[^)]*\)/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

let index = null;
let indexVersion = 0;
export function invalidateCodingIndex() { index = null; indexVersion++; }

function getIndex() {
  if (index) return index;
  const rows = all(`SELECT l.description, l.gl_account, l.department_id, l.line_type, l.invoice_id, i.vendor_id, i.requester_user_id, i.invoice_date
    FROM invoice_lines l JOIN invoices i ON i.invoice_id = l.invoice_id
    WHERE l.gl_account IS NOT NULL AND (l.coding_source IN ('history','human','accepted')) AND i.status != 'rejected'`);
  index = rows.map((r) => ({ ...r, toks: descTokens(r.description) }));
  return index;
}

const glName = (n) => get('SELECT name FROM gl_accounts WHERE account_number = ?', n)?.name || '';
const deptName = (d) => get('SELECT name FROM departments WHERE department_id = ?', d)?.name || d;

export function suggestLine({ vendor, description, poDept = null, submitterDept = null }) {
  const idx = getIndex();
  const toks = descTokens(description);
  const scores = new Map();
  const add = (gl, w) => scores.set(gl, (scores.get(gl) || 0) + w);
  const evidence = [];

  // (a) vendor history
  const vLines = vendor ? idx.filter((r) => r.vendor_id === vendor.vendor_id) : [];
  if (vLines.length) {
    const byGl = countBy(vLines, (r) => r.gl_account);
    for (const [gl, n] of byGl) add(gl, 0.5 * (n / vLines.length));
    const [topGl, topN] = [...byGl].sort((a, b) => b[1] - a[1])[0];
    evidence.push(`${topN} of ${vLines.length} past ${vendor.legal_name} lines were coded ${topGl} ${glName(topGl)}`);
  }
  // (b) nearest descriptions
  const sims = idx.map((r) => ({ r, s: jaccard(toks, r.toks) + (vendor && r.vendor_id === vendor.vendor_id ? 0.15 : 0) }))
    .filter((x) => x.s > 0.2).sort((a, b) => b.s - a.s).slice(0, 7);
  if (sims.length) {
    const tot = sims.reduce((a, x) => a + x.s, 0);
    for (const x of sims) add(x.r.gl_account, 0.35 * (x.s / tot));
    const best = sims[0].r;
    evidence.push(`closest past line: "${best.description}" (${best.invoice_id}) → ${best.gl_account}`);
  }
  // (c) vendor default
  if (vendor?.default_gl_account) {
    add(vendor.default_gl_account, 0.15);
    if (!vLines.length) evidence.push(`vendor master default account ${vendor.default_gl_account} ${glName(vendor.default_gl_account)}`);
  }
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  const totalW = ranked.reduce((a, [, w]) => a + w, 0) || 1;
  const gl = ranked[0]?.[0] || null;
  const confidence = gl ? round2(ranked[0][1] / totalW) : 0;

  // Department: PO department wins, then vendor history, then submitter's department.
  let department = null, deptReason = '';
  if (poDept) { department = poDept; deptReason = `PO is for ${deptName(poDept)}`; }
  else if (vLines.length) {
    const byD = [...countBy(vLines, (r) => r.department_id)].sort((a, b) => b[1] - a[1]);
    department = byD[0][0];
    deptReason = `${byD[0][1]} of ${vLines.length} past ${vendor.legal_name} lines charged to ${deptName(department)}`;
  } else if (submitterDept) { department = submitterDept; deptReason = `submitted by ${deptName(submitterDept)}`; }
  else if (sims.length) { department = sims[0].r.department_id; deptReason = `similar past lines charged to ${deptName(department)}`; }

  // Goods vs services (drives BC PST)
  let lineType = null;
  const typeVotes = countBy(sims.length ? sims.map((x) => x.r) : vLines, (r) => r.line_type);
  if (typeVotes.size) lineType = [...typeVotes].sort((a, b) => b[1] - a[1])[0][0];
  if (!lineType) lineType = GOODS_CATEGORIES.has(vendor?.category) ? 'goods' : 'services';

  return {
    gl_account: gl, gl_name: glName(gl), department_id: department, line_type: lineType, confidence,
    reason: [evidence.join('; '), deptReason].filter(Boolean).join('. ') || 'No history for this vendor or description; please code manually.',
    alternatives: ranked.slice(1, 3).map(([g, w]) => ({ gl_account: g, name: glName(g), weight: round2(w / totalW) })),
  };
}

export const GOODS_CATEGORIES = new Set(['Warehouse & Packaging', 'Safety Supplies', 'Office Supplies', 'Office Furniture', 'Printing & Signage', 'Fuel & Fleet']);

// Who usually requests this vendor's invoices (used when an invoice arrives by email with no requester).
export function inferRequester(vendorId, departmentId) {
  const rows = all(`SELECT i.requester_user_id u, count(*) n, u.status, u.full_name FROM invoices i JOIN users u ON u.user_id = i.requester_user_id
    WHERE i.vendor_id = ? AND (? IS NULL OR i.department_id = ?) GROUP BY i.requester_user_id ORDER BY n DESC`, vendorId, departmentId, departmentId);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const active = rows.find((r) => r.status === 'active');
  const departed = rows.filter((r) => r.status === 'terminated' && r.n / total > 0.3);
  return active ? { user_id: active.u, name: active.full_name, share: `${active.n} of ${total}`, departed } : { user_id: null, departed };
}

function countBy(arr, f) {
  const m = new Map();
  for (const x of arr) { const k = f(x); if (k !== null && k !== undefined && k !== '') m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

// Offline evaluation: leave-one-invoice-out accuracy on history (reported in the UI and README).
export function evaluateCoding(sample = 200) {
  const idx = getIndex().filter((r) => r.invoice_id < 'AP-9');
  const invIds = [...new Set(idx.map((r) => r.invoice_id))].slice(-sample);
  let n = 0, glOk = 0, deptOk = 0;
  const saved = index;
  for (const id of invIds) {
    index = saved.filter((r) => r.invoice_id !== id);
    for (const r of saved.filter((x) => x.invoice_id === id)) {
      const vendor = get('SELECT * FROM vendors WHERE vendor_id = ?', r.vendor_id);
      const s = suggestLine({ vendor, description: r.description });
      n++; if (s.gl_account === r.gl_account) glOk++; if (s.department_id === r.department_id) deptOk++;
    }
  }
  index = saved;
  return { lines: n, gl_accuracy: round2(glOk / n), dept_accuracy: round2(deptOk / n) };
}
