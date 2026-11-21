import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search, Landmark, AlertOctagon, Copy, ShieldAlert, PhoneCall, Check, X, Plus } from 'lucide-react';
import { useAuth, useMeta } from '../App.jsx';
import { api, money, fmtDate, fmtDateTime, can, compact } from '../api.js';
import { useApi, Card, Button, PageHeader, Empty, PageLoader, Status, Badge, Tabs, Drawer, KV, Field, Modal, cx, useToast } from '../components/ui.jsx';

export default function Vendors() {
  const { user } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'all';
  const { data, reload } = useApi('/vendors');
  const { data: changes, reload: reloadChanges } = useApi('/bank-changes');
  const { data: health } = useApi('/vendors/health');
  const [q, setQ] = useState('');
  const [onboard, setOnboard] = useState(false);
  const rows = useMemo(() => (data || []).filter((v) => (tab !== 'pending' || v.status === 'pending_review') && (!q || `${v.legal_name} ${v.category} ${v.vendor_id}`.toLowerCase().includes(q.toLowerCase()))), [data, q, tab]);
  if (!data) return <PageLoader />;
  const pendingChanges = (changes || []).filter((c) => c.status === 'pending');
  return (
    <div className="space-y-4">
      <PageHeader title="Vendors">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a vendor" className="input h-9 w-60 pl-9" /></div>
        {can(user, 'vendor.create') && <Button variant="primary" icon={Plus} onClick={() => setOnboard(true)}>New vendor</Button>}
      </PageHeader>
      <Tabs value={tab} onChange={(v) => setSp({ tab: v })} tabs={[
        { value: 'all', label: 'All', count: data.length },
        { value: 'pending', label: 'Pending approval', count: data.filter((v) => v.status === 'pending_review').length },
        { value: 'bank', label: 'Bank changes', count: pendingChanges.length || (changes || []).length },
        { value: 'health', label: 'Duplicates & lookalikes', count: health?.length },
      ]} />
      {(tab === 'all' || tab === 'pending') && (
        <div className="card overflow-hidden">
          {rows.length ? (
            <table className="w-full">
              <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">Vendor</th><th className="th">Category</th><th className="th">Location</th><th className="th">Pays by</th><th className="th">Terms</th><th className="th">Bank</th><th className="th text-right">Spend, 2026</th><th className="th">Status</th></tr></thead>
              <tbody className="divide-y divide-line-2">
                {rows.map((v) => (
                  <tr key={v.vendor_id} className="row-link" onClick={() => nav(`/vendors/${v.vendor_id}?tab=${tab}`)}>
                    <td className="td"><div className="font-medium">{v.legal_name}</div><div className="text-[13px] text-ink-3">{v.vendor_id}</div></td>
                    <td className="td text-ink-2">{v.category}</td>
                    <td className="td text-ink-2">{v.province_or_state}{v.country !== 'CA' ? `, ${v.country}` : ''}</td>
                    <td className="td whitespace-nowrap text-ink-2">{v.preferred_payment_method === 'CARD' ? 'Card' : v.preferred_payment_method === 'CHEQUE' ? 'Cheque' : 'EFT'}{v.requires_po ? <span className="text-ink-4"> · PO required</span> : null}</td>
                    <td className="td text-ink-2 tnum">{v.early_pay_discount || `Net ${v.payment_terms_days}`}</td>
                    <td className="td text-xs tnum text-ink-2">{v.bank_account_masked || '—'}{v.pending_bank_changes ? <Badge tone="red" className="ml-1.5">Change pending</Badge> : null}</td>
                    <td className="td text-right tnum">{compact(v.spend_cad || 0)}</td>
                    <td className="td">{v.status === 'active' ? <span className="text-ink-3">Active</span> : <Status value={v.status} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty title="No vendors match" />}
        </div>
      )}
      {tab === 'bank' && <BankChanges rows={changes || []} user={user} onChange={() => { reloadChanges(); reload(); }} />}
      {tab === 'health' && <Health rows={health || []} />}
      {id && <VendorDrawer id={id} onClose={() => nav(`/vendors?tab=${tab}`)} onChange={() => { reload(); reloadChanges(); }} />}
      {onboard && <NewVendor onClose={() => setOnboard(false)} onDone={() => { setOnboard(false); reload(); }} />}
    </div>
  );
}

function riskTone(n) { return n >= 60 ? 'red' : n >= 35 ? 'amber' : 'green'; }

function BankChanges({ rows, user, onChange }) {
  const toast = useToast();
  const [verify, setVerify] = useState(null);
  const [note, setNote] = useState('');
  const call = async (path, body, msg) => { try { await api(path, { method: 'POST', body }); toast(msg); onChange(); setVerify(null); setNote(''); } catch (e) { toast(e.message, 'error'); } };
  if (!rows.length) return <Card><Empty title="No bank changes" /></Card>;
  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">Vendor</th><th className="th">Change</th><th className="th">Requested</th><th className="th">Channel</th><th className="th">Callback</th><th className="th">Risk</th><th className="th">Status</th><th className="th"></th></tr></thead>
        <tbody className="divide-y divide-line-2">
          {rows.map((c) => (
            <tr key={c.change_id} className={cx(c.status === 'pending' && 'bg-amber-50/30')}>
              <td className="td"><div className="font-medium">{c.legal_name}</div><div className="text-xs text-ink-3">{c.change_id}</div></td>
              <td className="td tnum text-[13px]">••{c.old_account_last4} → ••{c.new_account_last4}</td>
              <td className="td text-xs text-ink-2">{fmtDate(c.changed_at?.slice(0, 10))}<div className="text-ink-3">{c.changed_by_name}</div></td>
              <td className="td text-xs">{String(c.request_channel).replace(/_/g, ' ')}</td>
              <td className="td">{c.verified_by_callback === 'yes' ? <Badge tone="green"><Check className="size-3" />Verified</Badge> : <Badge tone="red">Not verified</Badge>}</td>
              <td className="td">{c.risk_score !== null ? <Badge tone={riskTone(c.risk_score)} className="cursor-help" title={c.risk_reasons.join('\n')}>{c.risk_score}</Badge> : c.verified_by_callback === 'no' ? <Badge tone="red">High</Badge> : <span className="text-xs text-ink-3">—</span>}
                {c.risk_reasons?.length > 0 && <div className="mt-1 max-w-[240px] text-[11px] leading-snug text-ink-3">{c.risk_reasons.join(' · ')}</div>}</td>
              <td className="td"><Status value={c.status} /></td>
              <td className="td text-right whitespace-nowrap">
                {c.status === 'pending' && c.verified_by_callback !== 'yes' && (can(user, 'vendor.bank.verify') || can(user, 'vendor.bank.approve')) && <Button size="sm" icon={PhoneCall} onClick={() => setVerify(c)}>Log callback</Button>}
                {c.status === 'pending' && can(user, 'vendor.bank.approve') && <>
                  <Button size="sm" variant="primary" className="ml-1.5" disabled={c.verified_by_callback !== 'yes'} title={c.verified_by_callback !== 'yes' ? 'Verify by phone first' : ''} onClick={() => call(`/bank-changes/${c.change_id}/approve`, {}, 'Bank details updated')}>Approve</Button>
                  <Button size="sm" variant="danger" className="ml-1.5" onClick={() => call(`/bank-changes/${c.change_id}/reject`, { note: 'Rejected' }, 'Change rejected')}>Reject</Button>
                </>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!verify} onClose={() => setVerify(null)} title="Log callback verification" footer={<><Button onClick={() => setVerify(null)}>Cancel</Button><Button variant="primary" onClick={() => call(`/bank-changes/${verify.change_id}/verify`, { note }, 'Callback recorded')}>Record</Button></>}>
        <p className="mb-3 text-[13px] text-ink-2">Call {verify?.legal_name} on the phone number already in the vendor file, never one from the request, and confirm the new account.</p>
        <Field label="Who you spoke to and the number you called"><input autoFocus className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

function Health({ rows }) {
  const nav = useNavigate();
  if (!rows.length) return <Card><Empty title="No duplicate or lookalike vendor records" /></Card>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.a + r.b} className="card flex flex-wrap items-start gap-4 p-4">
          {r.sameBank ? <Copy className="mt-0.5 size-5 text-red-500" /> : <ShieldAlert className="mt-0.5 size-5 text-amber-500" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
              <button className="hover:underline" onClick={() => nav(`/vendors/${r.a}?tab=health`)}>{r.a_name}</button><span className="text-ink-3">vs</span><button className="hover:underline" onClick={() => nav(`/vendors/${r.b}?tab=health`)}>{r.b_name}</button>
              {r.sameBank && <Badge tone="red">Same bank account</Badge>}<Badge>{r.similarity}% name match</Badge>
            </div>
            <p className="mt-1 text-[13px] text-ink-2">{r.explanation}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function VendorDrawer({ id, onClose, onChange }) {
  const { user } = useAuth();
  const { data, reload } = useApi(`/vendors/${id}`, [id]);
  const [bank, setBank] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const v = data?.vendor;
  const approve = async () => { try { await api(`/vendors/${id}/approve`, { method: 'POST', body: {} }); toast('Vendor approved'); reload(); onChange(); } catch (e) { toast(e.message, 'error'); } };
  const setStatus = async (status) => { try { await api(`/vendors/${id}/status`, { method: 'POST', body: { status } }); toast(`Vendor ${status.replace('_', ' ')}`); reload(); onChange(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Drawer open onClose={onClose} title={v?.legal_name || 'Vendor'}>
      {!data ? <PageLoader /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Status value={v.status} />
            {v.status === 'pending_review' && can(user, 'vendor.approve') && <Button size="sm" variant="primary" onClick={approve}>Approve vendor</Button>}
            {v.status === 'active' && can(user, 'vendor.approve') && <Button size="sm" variant="danger" onClick={() => setStatus('on_hold')}>Put on hold</Button>}
            {v.status === 'on_hold' && can(user, 'vendor.approve') && <Button size="sm" onClick={() => setStatus('active')}>Lift hold</Button>}
            {can(user, 'vendor.bank.request') && <Button size="sm" icon={Landmark} onClick={() => setBank(true)}>Change bank details</Button>}
          </div>
          {data.lookalikes.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-[13px]">
              <div className="flex items-center gap-2 font-semibold text-red-800"><AlertOctagon className="size-4" />Lookalike vendor records</div>
              {data.lookalikes.map((l) => <p key={l.vendor_id} className="mt-1 text-red-900">{l.legal_name} ({l.vendor_id}, {l.status}): {l.similarity}% similar{l.sameBank ? ', same bank account' : ''}; differs on {l.diffs.join(', ') || 'nothing'}.</p>)}
            </div>
          )}
          <Card title="Profile">
            <KV items={[['Vendor ID', v.vendor_id], ['Category', v.category], ['GST/HST', v.gst_hst_number], ['QST', v.qst_number], ['Address', v.address], ['AP contact', v.ap_contact_email], ['Terms', v.early_pay_discount || `Net ${v.payment_terms_days}`], ['Pays by', `${v.preferred_payment_method}${v.accepts_card_payment ? ' · accepts card' : ''}`], ['Default GL', v.default_gl_account], ['Requires PO', v.requires_po ? 'Yes' : 'No'], ['Onboarded', fmtDate(v.onboarded_at)], ['Bank', `${v.bank_institution || '—'} / ${v.bank_transit || '—'} / ${v.bank_account_masked}`]]} />
            <div className="mt-3 border-t border-line pt-3 text-[13px] text-ink-2 tnum">{data.stats.n} bills in history · {money(data.stats.sum_cad || 0)} · avg {money(data.stats.avg_cad || 0)}</div>
          </Card>
          {data.bank_changes.length > 0 && (
            <Card title="Bank change history" pad={false}>
              <ul className="divide-y divide-line-2">
                {data.bank_changes.map((c) => (
                  <li key={c.change_id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                    <span className="tnum">••{c.old_account_last4} → ••{c.new_account_last4} <span className="text-ink-3">· {fmtDate(c.changed_at?.slice(0, 10))} · {String(c.request_channel).replace(/_/g, ' ')}</span></span>
                    <span className="flex items-center gap-2">{c.verified_by_callback === 'yes' ? <Badge tone="green">Verified</Badge> : <Badge tone="red">Not verified</Badge>}<Status value={c.status} /></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.contracts.length > 0 && (
            <Card title="Contracts" pad={false}>
              <ul className="divide-y divide-line-2">
                {data.contracts.map((c) => (
                  <li key={c.contract_id} className="px-4 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between"><span className="font-medium">{c.contract_id} · {c.description}</span><Status value={c.status === 'active' ? 'active' : 'inactive'} /></div>
                    <div className="mt-0.5 text-xs text-ink-3 tnum">{fmtDate(c.start_date)} to {fmtDate(c.end_date)}{c.monthly_fee ? ` · ${money(c.monthly_fee, c.currency)}/mo` : ''}{c.hourly_rate_cap ? ` · cap ${money(c.hourly_rate_cap)}/h` : ''}{c.fuel_surcharge_cap_pct ? ` · fuel ≤ ${c.fuel_surcharge_cap_pct}%` : ''}{c.not_to_exceed_monthly ? ` · NTE ${money(c.not_to_exceed_monthly)}/mo` : ''}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Recent bills" pad={false}>
            <ul className="divide-y divide-line-2">
              {data.invoices.slice(0, 12).map((i) => (
                <li key={i.invoice_id} className="row-link flex items-center justify-between px-4 py-2 text-[13px]" onClick={() => nav(`/invoices/${i.invoice_id}`)}>
                  <span>#{i.vendor_invoice_number} <span className="text-ink-3">· {fmtDate(i.invoice_date)}</span></span>
                  <span className="flex items-center gap-3"><span className="tnum">{money(i.total, i.currency)}</span><Status value={i.status} /></span>
                </li>
              ))}
            </ul>
          </Card>
          {data.audit.length > 0 && (
            <Card title="Changes" pad={false}>
              <ul className="divide-y divide-line-2">{data.audit.map((a) => <li key={a.seq} className="flex justify-between px-4 py-2 text-xs"><span><span className="font-medium">{a.actor_name || 'System'}</span> {a.action.replace(/[._]/g, ' ')}</span><span className="text-ink-3">{fmtDateTime(a.ts)}</span></li>)}</ul>
            </Card>
          )}
          {bank && <BankChangeModal vendor={v} onClose={() => setBank(false)} onDone={() => { setBank(false); reload(); onChange(); }} />}
        </div>
      )}
    </Drawer>
  );
}

function BankChangeModal({ vendor, onClose, onDone }) {
  const [f, setF] = useState({ institution: '', transit: '', account: '', request_channel: 'email_request', note: '' });
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async () => { try { const r = await api(`/vendors/${vendor.vendor_id}/bank-changes`, { method: 'POST', body: f }); toast(`Change ${r.change_id} logged with risk ${r.risk_score}. It needs a callback and a finance manager's approval.`); onDone(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Modal open onClose={onClose} title={`Change bank details: ${vendor.legal_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go}>Submit for approval</Button></>}>
      <p className="mb-3 text-[13px] text-ink-2">Held until verified by callback and approved by a finance manager.</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Institution"><input className="input tnum" maxLength={3} value={f.institution} onChange={set('institution')} placeholder="004" /></Field>
        <Field label="Transit"><input className="input tnum" maxLength={5} value={f.transit} onChange={set('transit')} placeholder="12345" /></Field>
        <Field label="Account"><input className="input tnum" maxLength={12} value={f.account} onChange={set('account')} /></Field>
        <Field label="How it was requested" className="col-span-3">
          <select className="input" value={f.request_channel} onChange={set('request_channel')}><option value="email_request">Email</option><option value="vendor_portal">Vendor portal</option><option value="phone_callback_verified">Phone (we called them)</option><option value="letter">Signed letter</option></select>
        </Field>
      </div>
    </Modal>
  );
}

function NewVendor({ onClose, onDone }) {
  const meta = useMeta();
  const [f, setF] = useState({ legal_name: '', category: '', gst_hst_number: '', ap_contact_email: '', province_or_state: 'ON', country: 'CA', payment_terms_days: 30, preferred_payment_method: 'EFT', bank_institution: '', bank_transit: '', bank_account: '', default_gl_account: '' });
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cats = [...new Set(meta.vendors.map((v) => v.category))].sort();
  const go = async () => { try { await api('/vendors', { method: 'POST', body: f }); toast('Vendor created as pending review'); onDone(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Modal open wide onClose={onClose} title="New vendor" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go}>Create as pending review</Button></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label="Legal name" className="col-span-2 md:col-span-3"><input className="input" value={f.legal_name} onChange={set('legal_name')} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={set('category')}><option value="">Choose</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Default GL"><select className="input" value={f.default_gl_account} onChange={set('default_gl_account')}><option value="">Choose</option>{meta.gl_accounts.filter((g) => g.account_type === 'expense').map((g) => <option key={g.account_number} value={g.account_number}>{g.account_number} {g.name}</option>)}</select></Field>
        <Field label="GST/HST number"><input className="input" value={f.gst_hst_number} onChange={set('gst_hst_number')} /></Field>
        <Field label="AP contact email"><input className="input" value={f.ap_contact_email} onChange={set('ap_contact_email')} /></Field>
        <Field label="Province / state"><input className="input" value={f.province_or_state} onChange={set('province_or_state')} /></Field>
        <Field label="Country"><select className="input" value={f.country} onChange={set('country')}><option>CA</option><option>US</option></select></Field>
        <Field label="Terms (days)"><input type="number" className="input" value={f.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
        <Field label="Pays by"><select className="input" value={f.preferred_payment_method} onChange={set('preferred_payment_method')}><option>EFT</option><option>CHEQUE</option><option value="CARD">Card</option></select></Field>
        <Field label="Institution"><input className="input" value={f.bank_institution} onChange={set('bank_institution')} /></Field>
        <Field label="Transit"><input className="input" value={f.bank_transit} onChange={set('bank_transit')} /></Field>
        <Field label="Account"><input className="input" value={f.bank_account} onChange={set('bank_account')} /></Field>
      </div>
    </Modal>
  );
}
