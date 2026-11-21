// Shared pure helpers: CSV, money, dates, string similarity.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export function toCsv(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

export const round2 = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round((Number(n) + Number.EPSILON) * 100) / 100);
export const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
export const money = (n, cur = 'CAD') => {
  if (n === null || n === undefined) return '—';
  const s = Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}$${s}${cur && cur !== 'CAD' ? ' ' + cur : ''}`;
};
export const near = (a, b, tol = 0.02) => a !== null && b !== null && Math.abs(a - b) <= tol + 1e-9;

// Dates are ISO strings (YYYY-MM-DD). Arithmetic in UTC to avoid DST drift.
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
export function isWeekend(iso) {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay();
  return d === 0 || d === 6;
}
export function prevBusinessDay(iso) {
  let d = iso;
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}
export function nextBusinessDay(iso) {
  let d = iso;
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}
export function quarterRange(year, q) {
  const sm = (q - 1) * 3 + 1;
  const start = `${year}-${String(sm).padStart(2, '0')}-01`;
  const end = addDays(`${sm + 3 > 12 ? year + 1 : year}-${String(sm + 3 > 12 ? 1 : sm + 3).padStart(2, '0')}-01`, -1);
  return [start, end];
}

// Normalisation used by vendor matching and duplicate detection.
export function normName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(inc|incorporated|ltd|limited|llc|llp|corp|corporation|co|company|s e n c r l|senc|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function normInvoiceNumber(s) {
  // "INV-00734", "inv 734", "00734" -> "734"; keeps letters that are not generic prefixes.
  let x = (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  x = x.replace(/^(INVOICE|INV|NO|FACTURE|FA|FACT|N)(?=\d)/, '');
  x = x.replace(/^0+(?=\d)/, '');
  return x;
}
export function digitsOnly(s) {
  return (s || '').replace(/\D/g, '');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
export function similarity(a, b) {
  if (!a || !b) return 0;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}
export function tokens(s) {
  return normName(s).split(' ').filter((t) => t.length > 1);
}
export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function emailDomain(addr) {
  const m = /@([^>\s]+)/.exec(addr || '');
  return m ? m[1].toLowerCase() : '';
}

export function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}
