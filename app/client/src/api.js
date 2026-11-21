// Thin fetch wrapper. The server enforces every permission; the client only mirrors them for display.
const KEY = 'brim.token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') { setToken(null); window.dispatchEvent(new Event('brim:logout')); }
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data?.code);
  }
  return data;
}

export const download = (path) => {
  const t = getToken();
  window.open(`/api${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`, '_blank');
};
export const docUrl = (id) => `/api/invoices/${id}/document?token=${encodeURIComponent(getToken())}`;

export const money = (n, cur = 'CAD', opts = {}) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: opts.whole ? 0 : 2, maximumFractionDigits: opts.whole ? 0 : 2 });
  return `${n < 0 ? '−' : ''}$${s}${cur && cur !== 'CAD' ? ` ${cur}` : ''}`;
};
export const compact = (n) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
};
export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
};
export const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') || iso.length <= 10 ? iso : iso + 'Z');
  return d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};
export const roleLabel = (r) => ({ employee: 'Employee', ap_clerk: 'AP Clerk', approver: 'Approver', finance_manager: 'Finance Manager', controller_admin: 'Controller / Admin', auditor: 'Auditor' }[r] || r);
export const can = (user, perm) => !!user?.permissions?.includes(perm);
export const initials = (name = '') => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
