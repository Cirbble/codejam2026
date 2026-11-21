import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CheckSquare } from 'lucide-react';
import { useAuth, useMeta } from '../App.jsx';
import { api, money, fmtDate, roleLabel } from '../api.js';
import { useApi, Button, PageHeader, Empty, PageLoader, Field, Modal, cx, useToast } from '../components/ui.jsx';
import { Issues } from './Invoices.jsx';
import { overdueDays } from '../issues.js';

export default function Approvals() {
  const { user, refresh } = useAuth();
  const { data: raw, reload, loading } = useApi('/invoices?view=mine_to_approve');
  const data = raw ? [...raw].sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9'))) : raw;
  const coverAll = data?.length > 0 && data.every((r) => r.next_on_behalf && r.next_on_behalf === data[0].next_on_behalf) ? data[0].next_on_behalf : null;
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const quick = async (inv) => {
    setBusy(inv.invoice_id);
    try { await api(`/invoices/${inv.invoice_id}/approve`, { method: 'POST', body: { acknowledge: false } }); toast(`Approved ${inv.vendor_name} ${inv.vendor_invoice_number}`); reload(); } catch (e) {
      if (e.status === 409) nav(`/invoices/${inv.invoice_id}`); else toast(e.message, 'error');
    }
    setBusy(null);
  };
  const total = (data || []).reduce((a, r) => a + (r.total_cad || 0), 0);
  return (
    <div className="space-y-5">
      <Delegation user={user} onChange={() => { refresh(); reload(); }} total={total} count={data?.length} />
      <div className="card overflow-hidden">
        {loading && !data ? <PageLoader /> : !data?.length ? <Empty icon={CheckSquare} title="Nothing awaiting your approval" /> : (
          <>
            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_90px_120px_minmax(0,1.6fr)_110px] items-center gap-4 border-b border-line px-4 text-xs font-medium text-ink-3 md:grid h-9">
              <span>Bill</span><span>Requested by</span><span>Due date</span><span className="text-right">Amount (CAD)</span><span>Compared with last bill</span><span />
            </div>
            <ul className="divide-y divide-line-2">
              {data.map((r) => {
                const rec = r.recommendation || {};
                const recCls = rec.decision === 'approve' ? 'text-ink-2' : rec.decision === 'reject' ? 'font-medium text-[#a11b1b]' : 'text-[#8a5a00]';
                const clean = !r.warns && !r.blocks;
                return (
                  <li key={r.invoice_id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_90px_120px_minmax(0,1.6fr)_110px]">
                    <button className="min-w-0 text-left" onClick={() => nav(`/invoices/${r.invoice_id}`)}>
                      <div className="truncate font-medium hover:underline">{r.vendor_name}</div>
                      <div className="truncate text-xs text-ink-3 tnum">
                        {r.vendor_invoice_number} · {r.department}
                        {r.next_role && r.next_role !== 'dept_manager' && <> · {r.next_role === 'cfo' ? 'CFO' : roleLabel(r.next_role)} step</>}
                        {r.next_on_behalf && !coverAll && <> · for {r.next_on_behalf}</>}
                      </div>
                    </button>
                    <span className="hidden truncate text-ink-2 md:block">{r.requester || '—'}</span>
                    <span className="hidden whitespace-nowrap text-[#262626] tnum md:block">{fmtDate(r.due_date)}{overdueDays(r.due_date) > 0 && <span className="block text-[13px] text-[#b54708]">{overdueDays(r.due_date)}d overdue</span>}</span>
                    <span className="text-right font-medium tnum">{money(r.total, r.currency)}</span>
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      {!clean ? <Issues row={r} /> : r.prev_total_cad ? (() => {
                        const pct = Math.round(((r.total_cad - r.prev_total_cad) / r.prev_total_cad) * 100);
                        return <span className="text-[14px] text-[#262626] tnum">{money(r.prev_total_cad)} <span className={cx('ml-1', Math.abs(pct) >= 25 ? 'font-medium text-[#b54708]' : 'text-ink-3')}>{pct === 0 ? 'same amount' : `${pct > 0 ? '+' : ''}${pct}%`}</span></span>;
                      })() : <span className="text-[14px] text-ink-3">First bill from vendor</span>}
                    </div>
                    <div className="col-span-2 flex justify-end md:col-span-1">
                      {clean ? <Button size="sm" icon={Check} loading={busy === r.invoice_id} onClick={() => quick(r)}>Approve</Button>
                        : <Button size="sm" onClick={() => nav(`/invoices/${r.invoice_id}`)}>Review</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Delegation({ user, onChange, total, count }) {
  const meta = useMeta();
  const { data, reload } = useApi('/delegations');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ delegate_user_id: '', starts_on: new Date().toISOString().slice(0, 10), ends_on: '', reason: '' });
  const toast = useToast();
  const mine = (data || []).find((d) => d.user_id === user.user_id && d.active);
  const covering = (data || []).filter((d) => d.delegate_user_id === user.user_id && d.active);
  const eligible = meta.users.filter((u) => ['approver', 'finance_manager', 'controller_admin'].includes(u.role) && u.user_id !== user.user_id && u.status === 'active');
  const save = async () => {
    try { await api('/delegations', { method: 'POST', body: { ...f, ends_on: f.ends_on || null } }); toast('Out of office set. Open approvals were re-routed.'); setOpen(false); reload(); onChange(); } catch (e) { toast(e.message, 'error'); }
  };
  const end = async () => { try { await api(`/delegations/${mine.id}`, { method: 'DELETE' }); toast('Approvals route to you again.'); reload(); onChange(); } catch (e) { toast(e.message, 'error'); } };
  const sub = [
    count !== undefined ? `${count} awaiting · ${money(total)} CAD` : null,
    covering.length ? `Covering for ${covering.map((c) => c.user_name).join(', ')}` : null,
    mine ? `Out of office · ${mine.delegate_name} approving` : null,
  ].filter(Boolean).join('  ·  ');
  return (
    <>
      <PageHeader title="Approvals" sub={sub}>
        {mine ? <Button onClick={end}>End out of office</Button> : <Button onClick={() => setOpen(true)}>Out of office</Button>}
      </PageHeader>
      <Modal open={open} onClose={() => setOpen(false)} title="Out of office" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!f.delegate_user_id} onClick={save}>Save</Button></>}>
        <p className="mb-3 text-[13px] text-ink-2">Approvals assigned to you go to your delegate and are recorded as on your behalf.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Delegate" className="col-span-2">
            <select className="input" value={f.delegate_user_id} onChange={(e) => setF({ ...f, delegate_user_id: e.target.value })}>
              <option value="">Select a person</option>
              {eligible.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name} · {u.title}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" className="input" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></Field>
          <Field label="Until"><input type="date" className="input" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
