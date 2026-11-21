import { useState } from 'react';
import { ArrowRight, RotateCcw, Save } from 'lucide-react';
import { useAuth, useMeta } from '../App.jsx';
import { api, money, roleLabel } from '../api.js';
import { useApi, Card, PageHeader, PageLoader, Button, Tabs, Badge, Field, Status, Modal, cx, useToast } from '../components/ui.jsx';

const CHAIN_ROLES = ['dept_manager', 'finance_manager', 'controller_admin', 'cfo'];
const CHAIN_LABEL = { dept_manager: 'Dept manager', finance_manager: 'Finance manager', controller_admin: 'Controller', cfo: 'CFO', manager: "Approver's manager", delegate: 'Delegate' };

export default function Admin() {
  const [tab, setTab] = useState('policies');
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "policies", label: "Approval rules" }, { value: 'users', label: 'Users & roles' }, { value: 'system', label: 'System' }]} />
      {tab === 'policies' && <Policies />}
      {tab === 'users' && <Users />}
      {tab === 'system' && <System />}
    </div>
  );
}

function Policies() {
  const { data, reload } = useApi('/policies');
  const toast = useToast();
  const [edit, setEdit] = useState({});
  if (!data) return <PageLoader />;
  const save = async (p) => {
    try { await api(`/policies/${p.rule_id}`, { method: 'PUT', body: edit[p.rule_id] }); toast(`${p.rule_id} saved; open invoices re-routed`); setEdit({ ...edit, [p.rule_id]: undefined }); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const set = (p, k, v) => setEdit({ ...edit, [p.rule_id]: { ...(edit[p.rule_id] || {}), [k]: v } });
  const val = (p, k) => (edit[p.rule_id]?.[k] !== undefined ? edit[p.rule_id][k] : p[k]);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">Rule</th><th className="th">When</th><th className="th">Band (CAD)</th><th className="th">Requires</th><th className="th">On</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-line-2">
            {data.map((p) => {
              const dirty = !!edit[p.rule_id];
              const banded = ['amount_chain', 'release_limit'].includes(p.kind);
              const chain = val(p, 'chain');
              return (
                <tr key={p.rule_id} className={cx(!val(p, 'active') && 'opacity-50')}>
                  <td className="td"><Badge>{p.rule_id}</Badge><div className="mt-1 text-[11px] text-ink-3">{p.rule_type.replace('_', ' ')}</div></td>
                  <td className="td max-w-[220px] text-[13px]">{p.condition_text}{p.kind === 'vendor_category' && <input className="input mt-1 h-7 text-xs" value={val(p, 'param') || ''} onChange={(e) => set(p, 'param', e.target.value)} />}</td>
                  <td className="td">
                    {banded ? (
                      <div className="flex items-center gap-1.5">
                        <input type="number" className="input h-8 w-24 text-xs tnum" value={val(p, 'min_amount_cad') ?? ''} onChange={(e) => set(p, 'min_amount_cad', e.target.value)} />
                        <span className="text-ink-3">–</span>
                        <input type="number" className="input h-8 w-24 text-xs tnum" placeholder="no cap" value={val(p, 'max_amount_cad') ?? ''} onChange={(e) => set(p, 'max_amount_cad', e.target.value)} />
                      </div>
                    ) : <span className="text-xs text-ink-3">—</span>}
                  </td>
                  <td className="td">
                    {['amount_chain', 'vendor_new', 'vendor_category', 'po_balance', 'release_limit'].includes(p.kind) ? (
                      <div className="flex flex-wrap gap-1">
                        {(p.kind === 'release_limit' ? ['finance_manager', 'controller_admin'] : CHAIN_ROLES).map((r) => (
                          <button key={r} onClick={() => set(p, 'chain', chain.includes(r) ? chain.filter((x) => x !== r) : CHAIN_ROLES.filter((x) => [...chain, r].includes(x)))}
                            className={cx('rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset', chain.includes(r) ? 'bg-brand-soft text-brand-2 ring-brand/30' : 'text-ink-3 ring-line hover:text-ink-2')}>{CHAIN_LABEL[r]}</button>
                        ))}
                      </div>
                    ) : <span className="text-xs text-ink-2">{p.required_text}</span>}
                  </td>
                  <td className="td"><input type="checkbox" className="accent-teal-700" checked={!!val(p, 'active')} onChange={(e) => set(p, 'active', e.target.checked)} /></td>
                  <td className="td text-right">{dirty && <Button size="sm" variant="primary" icon={Save} onClick={() => save(p)}>Save</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Simulator />
    </div>
  );
}

function Simulator() {
  const meta = useMeta();
  const [f, setF] = useState({ amount_cad: 12500, department_id: 'D07', vendor_id: '', requester_user_id: '' });
  const [res, setRes] = useState(null);
  const run = async () => setRes(await api('/policies/preview', { method: 'POST', body: { ...f, vendor_id: f.vendor_id || null, requester_user_id: f.requester_user_id || null } }));
  return (
    <Card title="Who would approve?">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (CAD)"><input type="number" className="input tnum" value={f.amount_cad} onChange={(e) => setF({ ...f, amount_cad: e.target.value })} /></Field>
        <Field label="Department"><select className="input" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}>{meta.departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}</select></Field>
        <Field label="Vendor" className="col-span-2"><select className="input" value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}><option value="">Any established vendor</option>{meta.vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.legal_name}{v.status !== 'active' ? ` (${v.status.replace('_', ' ')})` : ''}</option>)}</select></Field>
        <Field label="Requested by" className="col-span-2"><select className="input" value={f.requester_user_id} onChange={(e) => setF({ ...f, requester_user_id: e.target.value })}><option value="">An employee</option>{meta.users.filter((u) => u.status !== 'terminated').map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name} · {roleLabel(u.role)}</option>)}</select></Field>
      </div>
      <Button className="mt-3 w-full" variant="dark" onClick={run}>Simulate route</Button>
      {res && (
        <ol className="mt-4 space-y-2.5 fade-in">
          {res.steps.map((s) => (
            <li key={s.step_no} className="text-[13px]">
              <div className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">{s.step_no}</span><span className="font-medium">{s.assigned_name}</span><span className="text-ink-3">{s.role_label}</span></div>
              <div className="ml-7 text-xs text-ink-3">{s.reason}</div>
            </li>
          ))}
          <li className="flex items-center gap-2 border-t border-line pt-2.5 text-xs text-ink-2"><ArrowRight className="size-3.5" />Release: {res.release.roles.map(roleLabel).join(' or ')} ({res.release.rule})</li>
        </ol>
      )}
    </Card>
  );
}

function Users() {
  const { user: me, refresh } = useAuth();
  const meta = useMeta();
  const { data, reload } = useApi('/users');
  const [sel, setSel] = useState(null);
  const toast = useToast();
  if (!data) return <PageLoader />;
  const save = async () => {
    try { await api(`/users/${sel.user_id}`, { method: 'PATCH', body: { role: sel.role, approval_limit_cad: sel.approval_limit_cad, status: sel.status, delegate_user_id: sel.delegate_user_id, manager_id: sel.manager_id } }); toast('User updated; open invoices re-routed'); setSel(null); reload(); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">Person</th><th className="th">Role</th><th className="th">Department</th><th className="th">Manager</th><th className="th text-right">Approval limit</th><th className="th">Status</th><th className="th">Delegate</th></tr></thead>
        <tbody className="divide-y divide-line-2">
          {data.map((u) => (
            <tr key={u.user_id} className="row-link" onClick={() => setSel({ ...u })}>
              <td className="td"><div className="font-medium">{u.full_name}</div><div className="text-xs text-ink-3">{u.title} · {u.user_id}</div></td>
              <td className="td"><Badge tone={u.role === 'controller_admin' ? 'violet' : u.role === 'finance_manager' ? 'blue' : u.role === 'approver' ? 'brand' : 'slate'}>{roleLabel(u.role)}</Badge></td>
              <td className="td text-ink-2">{u.department}</td>
              <td className="td text-ink-2">{u.manager_name || '—'}</td>
              <td className="td text-right tnum">{u.approval_limit_cad ? money(u.approval_limit_cad, 'CAD') : '—'}</td>
              <td className="td"><Status value={u.status} /></td>
              <td className="td text-ink-2">{u.delegate_name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.full_name} footer={<><Button onClick={() => setSel(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        {sel && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role"><select className="input" disabled={sel.user_id === me.user_id} value={sel.role} onChange={(e) => setSel({ ...sel, role: e.target.value })}>{['employee', 'ap_clerk', 'approver', 'finance_manager', 'controller_admin', 'auditor'].map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></Field>
            <Field label="Approval limit (CAD)"><input type="number" className="input tnum" value={sel.approval_limit_cad} onChange={(e) => setSel({ ...sel, approval_limit_cad: e.target.value })} /></Field>
            <Field label="Status"><select className="input" value={sel.status} onChange={(e) => setSel({ ...sel, status: e.target.value })}><option value="active">Active</option><option value="on_leave">On leave</option><option value="terminated">Left</option></select></Field>
            <Field label="Delegate while away"><select className="input" value={sel.delegate_user_id || ''} onChange={(e) => setSel({ ...sel, delegate_user_id: e.target.value })}><option value="">None</option>{meta.users.filter((u) => ['approver', 'finance_manager', 'controller_admin'].includes(u.role) && u.user_id !== sel.user_id).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}</select></Field>
            <Field label="Manager" className="col-span-2"><select className="input" value={sel.manager_id || ''} onChange={(e) => setSel({ ...sel, manager_id: e.target.value })}><option value="">None</option>{meta.users.filter((u) => u.user_id !== sel.user_id).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}</select></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function System() {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  const { data: ev } = useApi('/coding/eval');
  const meta = useMeta();
  const reset = async () => {
    setBusy(true);
    try { const r = await api('/admin/reset', { method: 'POST' }); toast(`Demo reset: ${r.bills} bills re-captured from the inbox`); setConfirm(false); window.location.href = '/'; } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="Coding model">
        {ev ? <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="text-2xl font-semibold tnum">{Math.round(ev.gl_accuracy * 100)}%</div><div className="text-xs text-ink-3">GL accuracy</div></div>
          <div><div className="text-2xl font-semibold tnum">{Math.round(ev.dept_accuracy * 100)}%</div><div className="text-xs text-ink-3">Department accuracy</div></div>
          <div><div className="text-2xl font-semibold tnum">{ev.lines}</div><div className="text-xs text-ink-3">Lines, leave-one-out</div></div>
        </div> : <PageLoader />}
      </Card>
      <Card title="Extraction">
        <div className="text-[13px] text-ink-2">LLM fallback: {meta.llm.enabled ? <Badge tone="green">{meta.llm.model}</Badge> : <Badge tone="amber">off (text parser only)</Badge>} · spent this process ${meta.llm.spentUsd}</div>
      </Card>
      <Card title="Demo data">
        <p className="text-[13px] text-ink-2">Rebuild the database from the dataset CSVs and re-process the AP inbox.</p>
        <Button className="mt-3" variant="danger" icon={RotateCcw} onClick={() => setConfirm(true)}>Reset demo</Button>
      </Card>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset demo data?" footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={reset}>Reset</Button></>}>
        <p className="text-[13px] text-ink-2">Every change made in this demo (approvals, payments, uploads) is erased.</p>
      </Modal>
    </div>
  );
}
