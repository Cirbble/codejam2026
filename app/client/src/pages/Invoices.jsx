import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Upload, Search, ArrowDown, AlertOctagon, AlertTriangle } from 'lucide-react';
import { parseIssues, shortName, STAGE, overdueDays } from '../issues.js';
import { useAuth } from '../App.jsx';
import { useApi, Status, Tabs, PageHeader, Button, PageLoader, Empty, Badge, Checkbox, Segmented, cx, useToast, useOutside } from '../components/ui.jsx';
import { money, fmtDate, can, api } from '../api.js';
import { UploadModal } from './Submit.jsx';

const TABS = [
  { value: 'review', label: STAGE.review, statuses: ['draft', 'needs_review'] },
  { value: 'pending', label: STAGE.pending, statuses: ['pending_approval'] },
  { value: 'approved', label: STAGE.ready, statuses: ['approved'] },
  { value: 'scheduled', label: STAGE.scheduled, statuses: ['scheduled'] },
  { value: 'paid', label: 'Paid', statuses: ['paid', 'applied'] },
  { value: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { value: 'all', label: 'All', statuses: null },
];

const today = () => new Date().toISOString().slice(0, 10);
// Triage order: blocking first, then overdue, then soonest due.
export function triage(a, b) {
  const t = today();
  return (b.blocks > 0) - (a.blocks > 0) || ((b.due_date || '9') < t) - ((a.due_date || '9') < t) || String(a.due_date || '9').localeCompare(String(b.due_date || '9'));
}

export default function Invoices() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const q0 = sp.get('q') || '';
  const [q, setQ] = useState(q0);
  const history = true;
  const tab = sp.get('tab') || (q0 ? 'all' : user.role === 'approver' ? 'pending' : 'review');
  const { data, loading, reload } = useApi(`/invoices?source=${history ? 'all' : 'new'}${q0 ? `&q=${encodeURIComponent(q0)}` : ''}`, [history, q0]);
  const [upload, setUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const toast = useToast();
  const queue = sp.get('queue') || 'all';
  const sort = sp.get('sort') || (['all', 'paid', 'rejected'].includes(tab) ? 'recent' : 'priority');
  const issueF = sp.get('issue') || '';
  const deptF = sp.get('dept') || '';
  const overdueF = sp.get('overdue') === '1';
  const setParam = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); };
  const todayIso = new Date().toISOString().slice(0, 10);
  const inTab = useMemo(() => {
    const t = TABS.find((x) => x.value === tab);
    return (data || []).filter((r) => !t?.statuses || t.statuses.includes(r.status));
  }, [data, tab]);
  const isBlocked = (r) => r.blocks > 0 || !r.vendor_id;
  const rows = useMemo(() => {
    let list = inTab;
    if (tab === 'review' && queue === 'blocked') list = list.filter(isBlocked);
    if (tab === 'review' && queue === 'ready') list = list.filter((r) => !isBlocked(r));
    if (issueF) list = list.filter((r) => parseIssues(r.flag_codes).some((i) => shortName(i.code) === issueF));
    if (deptF) list = list.filter((r) => r.department === deptF);
    if (overdueF) list = list.filter((r) => r.due_date && r.due_date < todayIso);
    const by = { due: (x, y) => String(x.due_date || '9').localeCompare(String(y.due_date || '9')), amount: (x, y) => (y.total_cad || 0) - (x.total_cad || 0), recent: (x, y) => String(y.invoice_date).localeCompare(String(x.invoice_date)), priority: triage };
    return [...list].sort(by[sort] || triage);
  }, [inTab, tab, queue, issueF, deptF, overdueF, sort]);
  useEffect(() => { try { sessionStorage.setItem('brim.queue', JSON.stringify({ ids: rows.map((r) => r.invoice_id), label: TABS.find((t) => t.value === tab)?.label, search: sp.toString() })); } catch { /* ignore */ } }, [rows]);
  useEffect(() => setSelected(new Set()), [tab, q0, queue]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, (data || []).filter((r) => !t.statuses || t.statuses.includes(r.status)).length])), [data]);
  const issueOptions = useMemo(() => [...new Set(inTab.flatMap((r) => parseIssues(r.flag_codes).map((i) => shortName(i.code))))].sort(), [inTab]);
  const deptOptions = useMemo(() => [...new Set(inTab.map((r) => r.department).filter(Boolean))].sort(), [inTab]);
  const selectable = tab === 'review' && can(user, 'invoice.route');
  const nBlocked = tab === 'review' ? inTab.filter(isBlocked).length : 0;
  const currencies = [...new Set(rows.map((r) => r.currency))];

  const submitSelected = async () => {
    setBusy(true);
    try {
      const r = await api('/invoices/bulk-submit', { method: 'POST', body: { ids: [...selected] } });
      const ok = r.filter((x) => x.ok).length;
      toast(`${ok} bill${ok === 1 ? '' : 's'} submitted for approval${ok < r.length ? `; ${r.length - ok} still have blocking issues` : ''}`, ok < r.length ? 'error' : 'ok');
      setSelected(new Set());
      reload();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <div>
      <PageHeader title={user.role === 'approver' ? 'Department bills' : 'Bills'}>
        {can(user, 'invoice.ingest') && <Button variant="primary" icon={Upload} onClick={() => setUpload(true)}>Upload bills</Button>}
      </PageHeader>
      <Tabs tabs={TABS.map((t) => ({ ...t, count: counts[t.value] }))} value={tab} onChange={(v) => setSp({ ...(q0 ? { q: q0 } : {}), tab: v })} />
      <div className="flex min-h-[64px] flex-wrap items-center gap-2 py-3.5">
        {selected.size > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-medium tnum">{selected.size} ready bill{selected.size === 1 ? '' : 's'} selected · {money(rows.filter((r) => selected.has(r.invoice_id)).reduce((a, r) => a + (r.total_cad || 0), 0))} CAD</span>
            <Button variant="primary" loading={busy} onClick={submitSelected}>Submit for approval</Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'review' && (
              <Segmented value={queue} onChange={(v) => setParam('queue', v === 'all' ? '' : v)} options={[
                { value: 'all', label: 'All' }, { value: 'blocked', label: <>Blocked <span className="font-normal text-ink-3 tnum">{nBlocked}</span></> }, { value: 'ready', label: <>Ready to submit <span className="font-normal text-ink-3 tnum">{inTab.length - nBlocked}</span></> },
              ]} />
            )}
            <form onSubmit={(e) => { e.preventDefault(); setSp(q ? { q, tab: 'all' } : {}); }} className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bills" className="input w-52 pl-9" />
            </form>
            {issueOptions.length > 0 && (
              <select value={issueF} onChange={(e) => setParam('issue', e.target.value)} className={cx("input w-44", issueF && "border-brand text-brand")}>
                <option value="">All issues</option>{issueOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
            {deptOptions.length > 1 && (
              <select value={deptF} onChange={(e) => setParam('dept', e.target.value)} className={cx("input w-48", deptF && "border-brand text-brand")}>
                <option value="">All departments</option>{deptOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
            {overdueF && <Button size="sm" variant="ghost" onClick={() => setParam('overdue', '')}>Overdue only ✕</Button>}
 <select value={sort} onChange={(e) => setParam('sort', e.target.value)} className="input w-40" aria-label="Sort">
              <option value="priority">Blocking first</option><option value="due">Due date</option><option value="amount">Amount</option><option value="recent">Newest</option>
            </select>
            {(issueF || deptF) && <Button variant="ghost" onClick={() => { const n = new URLSearchParams(sp); n.delete('issue'); n.delete('dept'); n.delete('overdue'); setSp(n); }}>Clear filters</Button>}
          </div>
        )}
      </div>
      <div className="mb-3 text-[13px] text-ink-2 tnum">{rows.length} bills · {money(rows.reduce((a, r) => a + (r.total_cad || 0), 0))} CAD</div>
      <div className="card overflow-hidden">
        {loading && !data ? <PageLoader /> : rows.length ? (
          <InvoiceTable rows={rows} view={tab} selectable={selectable} selected={selected} setSelected={setSelected} currency={currencies.length === 1 ? currencies[0] : null} />
        ) : <Empty title="No bills in this view" />}
      </div>
      <UploadModal open={upload} onClose={() => setUpload(false)} onDone={reload} />
    </div>
  );
}

// The leading (highest-severity) issue by its short name; the rest behind an explicit "N more" disclosure.
export function Issues({ row }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  const items = parseIssues(row.flag_codes);
  if (!items.length) return <span className="text-ink-4">—</span>;
  const lead = items[0];
  const block = lead.sev === 'block';
  const Icon = block ? AlertOctagon : AlertTriangle;
  return (
    <span className="relative flex min-w-0 items-center gap-2" ref={ref}>
      <Icon className={cx('size-4 shrink-0', block ? 'text-danger' : 'text-[#b54708]')} strokeWidth={1.75} />
      <span className="truncate text-[#262626]">{shortName(lead.code)}</span>
      {items.length > 1 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-expanded={open} aria-label={`${items.length - 1} more issue${items.length > 2 ? 's' : ''}`}
          className="-my-1 inline-flex h-7 shrink-0 items-center rounded-md border border-line px-2 text-xs font-medium text-ink-2 hover:bg-[#f4f4f4] hover:text-ink">+{items.length - 1} issue{items.length > 2 ? 's' : ''}</button>
      )}
      {open && (
        <div onClick={(e) => e.stopPropagation()} className="absolute left-0 top-8 z-20 w-64 rounded-md border border-line bg-white py-1.5 shadow-[0_12px_16px_-4px_rgba(16,24,40,0.1)]">
          {items.map((i, k) => (
            <div key={k} className="flex items-center gap-2 px-3 py-1.5 text-[14px]">
              {i.sev === 'block' ? <AlertOctagon className="size-4 shrink-0 text-danger" strokeWidth={1.75} /> : <AlertTriangle className="size-4 shrink-0 text-[#b54708]" strokeWidth={1.75} />}
              <span className="text-[#262626]">{shortName(i.code)}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export function InvoiceTable({ rows, compact, view = 'all', selectable, selected, setSelected, currency = 'CAD', hideOverdue }) {
  const nav = useNavigate();
  const t = today();
  const showStatus = view === 'all';
  const showWith = view === 'pending';
  const readyRows = rows.filter((r) => !r.blocks && r.vendor_id);
  const allSel = selectable && readyRows.length > 0 && readyRows.every((r) => selected.has(r.invoice_id));
  const someSel = selectable && rows.some((r) => selected.has(r.invoice_id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-line bg-[#fafafa]">
          <tr>
            {selectable && <th className="th w-10 pl-4"><Checkbox checked={allSel} indeterminate={!allSel && someSel} onChange={(v) => setSelected(new Set(v ? rows.filter((r) => !r.blocks && r.vendor_id).map((r) => r.invoice_id) : []))} label="Select all ready bills" /></th>}
            <th className={cx('th min-w-[220px]', !selectable && 'pl-4')}>Vendor</th>
            {!compact && <th className="th w-[130px]">Department</th>}
            <th className="th w-[150px]">Due date</th>
            <th className="th w-[140px] text-right">{currency ? `Amount (${currency})` : 'Amount'}</th>
            {showStatus && <th className="th">Status</th>}
            <th className="th w-[34%] min-w-[300px]">Issues</th>
            {showWith && <th className="th pr-4">Approver</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const overdue = r.due_date && r.due_date < t && !['paid', 'rejected', 'applied'].includes(r.status);
            return (
              <tr key={r.invoice_id} className={cx('row-link group/row h-12', selected?.has(r.invoice_id) && 'bg-brand-soft/50')} onClick={() => nav(`/invoices/${r.invoice_id}`)}>
                {selectable && <td className="td w-10 pl-4" onClick={(e) => e.stopPropagation()}>{r.blocks > 0 || !r.vendor_id ? null : <Checkbox checked={selected.has(r.invoice_id)} onChange={() => toggle(r.invoice_id)} label={`Select ${r.vendor_name}`} />}</td>}
                <td className={cx('td max-w-[300px]', !selectable && 'pl-4')}>
                  <div className="flex items-center gap-2">
                    <span className={cx('truncate font-medium decoration-[#a3a3a3] underline-offset-2 group-hover/row:underline', !r.vendor_name && 'text-danger')}>{r.vendor_name || 'Unknown vendor'}</span>
                    {r.doc_type === 'credit_note' && <Badge>Credit</Badge>}
                  </div>
                  <div className="text-[13px] text-ink-3 tnum">{r.vendor_invoice_number || 'No bill number'}</div>
                </td>
                {!compact && <td className="td whitespace-nowrap text-ink-2">{r.department || '—'}</td>}
                <td className="td whitespace-nowrap text-[#262626] tnum">{fmtDate(r.due_date)}{overdue && !hideOverdue && <span className="text-[#b54708]"> · {overdueDays(r.due_date)}d overdue</span>}</td>
                <td className="td whitespace-nowrap text-right font-medium tnum">{money(r.total, r.currency)}</td>
                {showStatus && <td className="td"><Status value={r.status} /></td>}
                <td className="td max-w-[420px]"><Issues row={r} /></td>
                {showWith && <td className="td whitespace-nowrap pr-4 text-ink-2">{r.next_approver || '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
