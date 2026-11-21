import { useEffect, useState, createContext, useContext, useRef } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutGrid, Inbox, FileText, CheckSquare, CreditCard, Building2, Scale, BarChart3, ShieldCheck, Settings, Upload, LogOut, Search, ChevronsUpDown, Menu, X, Check,
} from 'lucide-react';
import { api, getToken, setToken, roleLabel, can, money } from './api.js';
import { Avatar, cx, PageLoader, Status } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import InboxPage from './pages/Inbox.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import Approvals from './pages/Approvals.jsx';
import Payments from './pages/Payments.jsx';
import Vendors from './pages/Vendors.jsx';
import Recon from './pages/Recon.jsx';
import Insights from './pages/Insights.jsx';
import Audit from './pages/Audit.jsx';
import Admin from './pages/Admin.jsx';
import Submit from './pages/Submit.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
const MetaCtx = createContext(null);
export const useMeta = () => useContext(MetaCtx);

function nav(user, counts = {}) {
  const r = user.role;
  const work = [{ to: '/', label: 'Overview', icon: LayoutGrid, end: true }];
  if (r === 'employee') work.push({ to: '/submit', label: 'My bills', icon: Upload });
  if (can(user, 'inbox.view') && r !== 'auditor') work.push({ to: '/inbox', label: 'Inbox', icon: Inbox });
  if (can(user, 'invoice.approve')) work.push({ to: '/approvals', label: 'Approvals', icon: CheckSquare, count: counts.approvals });
  if (can(user, 'invoice.view.all') || r === 'approver') work.push({ to: '/invoices', label: r === 'approver' ? 'Department bills' : 'Bills', icon: FileText, count: counts.review });
  const fin = [];
  if (can(user, 'payment.view') || can(user, 'payment.prepare')) fin.push({ to: '/payments', label: 'Payments', icon: CreditCard, count: counts.release });
  if (can(user, 'vendor.view') && r !== 'approver') fin.push({ to: '/vendors', label: 'Vendors', icon: Building2 });
  if (can(user, 'recon.view')) fin.push({ to: '/reconciliation', label: 'Reconciliation', icon: Scale });
  if (can(user, 'spend.view.all') || can(user, 'spend.view.dept')) fin.push({ to: '/insights', label: r === 'approver' ? 'Department spend' : 'Spend', icon: BarChart3 });
  const gov = [];
  if (can(user, 'audit.view')) gov.push({ to: '/audit', label: 'Audit trail', icon: ShieldCheck });
  if (can(user, 'policies.manage')) gov.push({ to: '/admin', label: 'Settings', icon: Settings });
  return [{ items: work }, { label: 'Finance', items: fin }, { label: 'Governance', items: gov }].filter((g) => g.items.length);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState(null);
  const [ready, setReady] = useState(false);
  const [counts, setCounts] = useState({});
  const [mobileNav, setMobileNav] = useState(false);
  const [palette, setPalette] = useState(false);
  const loc = useLocation();

  const loadMe = async () => {
    if (!getToken()) { setUser(null); setReady(true); return; }
    try {
      const [me, m] = await Promise.all([api('/me'), api('/meta')]);
      setUser(me); setMeta(m);
    } catch { setUser(null); }
    setReady(true);
  };
  useEffect(() => {
    loadMe();
    const out = () => setUser(null);
    window.addEventListener('brim:logout', out);
    return () => window.removeEventListener('brim:logout', out);
  }, []);
  useEffect(() => {
    if (!user) return;
    api('/dashboard').then((d) => setCounts({
      approvals: d.my_queue?.c || 0,
      review: user.role === 'ap_clerk' ? d.drafts.c : 0,
      release: d.payments_to_release?.c || 0,
    })).catch(() => {});
  }, [user, loc.pathname]);
  useEffect(() => { setMobileNav(false); }, [loc.pathname]);
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const signIn = async (userId) => {
    const r = await api('/auth/login', { method: 'POST', body: { user_id: userId } });
    setToken(r.token);
    await loadMe();
  };
  const signOut = () => { setToken(null); setUser(null); };

  if (!ready) return <PageLoader />;
  if (!user) return <Login onSignIn={signIn} />;

  const sidebar = <Sidebar user={user} counts={counts} signIn={signIn} signOut={signOut} openSearch={() => setPalette(true)} />;
  return (
    <AuthCtx.Provider value={{ user, signIn, signOut, refresh: loadMe }}>
      <MetaCtx.Provider value={meta}>
        <div className="flex h-full">
          <div className="hidden md:flex">{sidebar}</div>
          {mobileNav && (
            <div className="fixed inset-0 z-40 bg-zinc-950/30 md:hidden" onClick={() => setMobileNav(false)}>
              <div className="h-full w-64" onClick={(e) => e.stopPropagation()}>{sidebar}</div>
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-white px-4 md:hidden">
              <button onClick={() => setMobileNav(true)} className="rounded p-1 text-ink-2 hover:bg-zinc-100"><Menu className="size-5" /></button>
              <Mark />
              <Avatar name={user.full_name} />
            </header>
            <main className="flex-1 overflow-y-auto">
              <div key={loc.pathname} className="mx-auto max-w-[1400px] px-4 py-6 md:px-10 md:py-8">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/submit" element={<Submit />} />
                  <Route path="/inbox" element={<InboxPage />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/invoices/:id" element={<InvoiceDetail />} />
                  <Route path="/approvals" element={<Approvals />} />
                  <Route path="/payments" element={<Payments />} />
                  <Route path="/vendors" element={<Vendors />} />
                  <Route path="/vendors/:id" element={<Vendors />} />
                  <Route path="/reconciliation" element={<Recon />} />
                  <Route path="/insights" element={<Insights />} />
                  <Route path="/audit" element={<Audit />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="*" element={<Navigate to="/" />} />
                </Routes>
              </div>
            </main>
          </div>
        </div>
        {palette && <CommandPalette user={user} onClose={() => setPalette(false)} />}
      </MetaCtx.Provider>
    </AuthCtx.Provider>
  );
}

// Wordmark only; no logo tile.
export function Mark({ className = '' }) {
  return <span className={cx('select-none text-[15px] font-semibold tracking-[-0.01em] text-ink', className)}>brim<span className="text-brand">.</span></span>;
}

function Sidebar({ user, counts, signIn, signOut, openSearch }) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-white">
      <div className="px-5 pb-4 pt-5">
        <Mark className="text-[18px]" />
        <div className="mt-3 truncate text-[14px] font-semibold text-ink">Harborline Logistics</div>
      </div>
      <div className="px-3 pb-3">
        <button onClick={openSearch} title="Search (Ctrl+K)" className="flex h-9 w-full items-center gap-2 rounded-md border border-[#d4d4d4] bg-white px-3 text-[14px] text-ink-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-ink-4">
          <Search className="size-4" />Search
        </button>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {nav(user, counts).map((g, gi) => (
          <div key={gi} className={gi ? 'mt-4 border-t border-line pt-4' : ''}>
            <div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}
                  className={({ isActive }) => cx('flex h-9 items-center rounded-md px-3 text-[14px]', isActive ? 'bg-[#eff4ff] font-semibold text-brand' : 'font-medium text-[#404040] hover:bg-[#f4f4f4] hover:text-ink')}>
                  <span className="flex-1">{n.label}</span>
                  {n.count > 0 && <span className="rounded-full bg-[#f4f4f4] px-2 text-xs font-medium leading-5 text-[#262626] tnum">{n.count}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <UserMenu user={user} signIn={signIn} signOut={signOut} />
    </aside>
  );
}

function UserMenu({ user, signIn, signOut }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const ref = useRef();
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    api('/auth/users').then(setUsers);
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const quick = ['U013', 'U004', 'U007', 'U003', 'U002', 'U001', 'U006'];
  const list = q ? users.filter((u) => `${u.full_name} ${u.title} ${roleLabel(u.role)}`.toLowerCase().includes(q.toLowerCase())) : users.filter((u) => quick.includes(u.user_id));
  return (
    <div className="relative border-t border-line p-2" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-left hover:bg-[#eceef1]">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[14px] font-semibold">{user.full_name}</div>
          <div className="truncate text-xs text-ink-3">{roleLabel(user.role)}</div>
        </div>
        <ChevronsUpDown className="size-3.5 text-ink-4" />
      </button>
      {open && (
        <div className="absolute bottom-full left-2 z-50 mb-1 w-72 rounded-lg border border-line bg-white p-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.2)] fade-in">
          <div className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-ink-4">Switch account</div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or roles" className="input mb-1 h-7 text-xs" />
          <div className="max-h-72 overflow-y-auto">
            {list.map((u) => (
              <button key={u.user_id} onClick={async () => { setOpen(false); await signIn(u.user_id); navigate('/'); }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{u.full_name}</div>
                  <div className="truncate text-[11px] text-ink-3">{roleLabel(u.role)} · {u.department}{u.status === 'on_leave' ? ' · on leave' : ''}</div>
                </div>
                {u.user_id === user.user_id && <Check className="size-3.5 text-ink-2" />}
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <button onClick={signOut} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-zinc-100"><LogOut className="size-3.5" />Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommandPalette({ user, onClose }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const navigate = useNavigate();
  const meta = useMeta();
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); setVendors([]); return; }
    const t = setTimeout(() => {
      api(`/invoices?source=all&limit=8&q=${encodeURIComponent(q.trim())}`).then(setRows).catch(() => {});
      if (can(user, 'vendor.view') && user.role !== 'approver') setVendors((meta?.vendors || []).filter((v) => v.legal_name.toLowerCase().includes(q.toLowerCase())).slice(0, 5));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);
  const go = (to) => { onClose(); navigate(to); };
  const pages = nav(user).flatMap((g) => g.items).filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/30 p-4 pt-[14vh] fade-in" onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-white shadow-[0_24px_64px_-16px_rgba(0,0,0,0.35)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="size-4 text-ink-4" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bills, vendors and pages" className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-4" />
          <button onClick={onClose} className="rounded p-1 text-ink-4 hover:bg-zinc-100"><X className="size-4" /></button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {rows.length > 0 && <Group label="Bills">{rows.map((r) => (
            <Item key={r.invoice_id} onClick={() => go(`/invoices/${r.invoice_id}`)}>
              <FileText className="size-4 text-ink-4" strokeWidth={1.75} /><span className="flex-1 truncate">{r.vendor_name || 'Unknown vendor'} <span className="text-ink-3">#{r.vendor_invoice_number}</span></span>
              <span className="tnum text-ink-2">{money(r.total, r.currency)}</span><Status value={r.status} />
            </Item>))}</Group>}
          {vendors.length > 0 && <Group label="Vendors">{vendors.map((v) => (
            <Item key={v.vendor_id} onClick={() => go(`/vendors/${v.vendor_id}`)}><Building2 className="size-4 text-ink-4" strokeWidth={1.75} /><span className="flex-1 truncate">{v.legal_name}</span><span className="text-xs text-ink-3">{v.vendor_id}</span></Item>))}</Group>}
          {pages.length > 0 && <Group label="Go to">{pages.map((p) => (
            <Item key={p.to} onClick={() => go(p.to)}><p.icon className="size-4 text-ink-4" strokeWidth={1.75} /><span className="flex-1">{p.label}</span></Item>))}</Group>}
        </div>
      </div>
    </div>
  );
}
function Group({ label, children }) {
  return <div className="py-1"><div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-ink-4">{label}</div>{children}</div>;
}
function Item({ children, onClick }) {
  return <button onClick={onClick} className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] hover:bg-zinc-100">{children}</button>;
}
