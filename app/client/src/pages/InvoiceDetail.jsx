import { useEffect, useState, useRef, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Check, ChevronDown, ChevronRight, ChevronLeft, FileText, Circle, CheckCircle2, XCircle, Building2, Pencil,
} from 'lucide-react';
import { useAuth, useMeta } from '../App.jsx';
import { api, docUrl, money, fmtDate, fmtDateTime, can, roleLabel } from '../api.js';
import { useApi, Card, Section, Button, Status, Badge, SEV, Modal, Field, KV, PageLoader, ErrorNote, cx, useToast } from '../components/ui.jsx';
import DocViewer from '../components/DocViewer.jsx';
import { GROUP, VERB, shortName } from '../issues.js';

export default function InvoiceDetail() {
  const { id } = useParams();
  const { data, error, setData, reload } = useApi(`/invoices/${id}`, [id]);
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null);
  let queueCtx = null;
  try { queueCtx = JSON.parse(sessionStorage.getItem('brim.queue') || 'null'); } catch { /* ignore */ }
  const pos = queueCtx?.ids ? queueCtx.ids.indexOf(id) : -1;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <PageLoader />;
  const { invoice: inv, vendor, flags, actions, can_approve: canApprove } = data;
  const open = flags.filter((f) => f.status === 'open');
  const blocks = open.filter((f) => f.severity === 'block');
  const warns = open.filter((f) => f.severity === 'warn');

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (r?.invoice) setData(r); else await reload(); if (okMsg) toast(okMsg); setModal(null); return true; } catch (e) { toast(e.message, 'error'); return false; } finally { setBusy(false); }
  };
  const submit = () => act(() => api(`/invoices/${id}/submit`, { method: 'POST' }), 'Submitted for approval');
  const blockCats = [...new Set(blocks.map((f) => f.category))];
  const nBlockGroups = blockCats.length;
  const blockedNote = actions.submit && (blocks.length > 0 || !inv.vendor_id)
    ? (!inv.vendor_id && !blocks.length ? 'Vendor not in vendor master' : `${nBlockGroups} blocking issue${nBlockGroups > 1 ? 's' : ''}`) : null;
  const firstCat = blockCats[0];
  const canResolveFirst = actions.resolve && firstCat && (firstCat !== 'fraud' || can(user, 'flag.resolve.fraud'));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <nav className="flex items-center gap-1.5 text-[13px] text-ink-3">
          <Link to={`/invoices${queueCtx?.search ? `?${queueCtx.search}` : ''}`} className="font-medium hover:text-ink">Bills</Link>
          <ChevronRight className="size-3.5 text-ink-4" />
          <span className="font-medium text-ink-2 tnum">{inv.vendor_invoice_number || inv.invoice_id}</span>
        </nav>
        {pos >= 0 && (
          <div className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="tnum">{pos + 1} of {queueCtx.ids.length}{queueCtx.label ? ` in ${queueCtx.label}` : ''}</span>
            <button aria-label="Previous bill" disabled={pos === 0} onClick={() => nav(`/invoices/${queueCtx.ids[pos - 1]}`)} className="inline-flex size-8 items-center justify-center rounded-md border border-[#d4d4d4] text-ink-2 hover:bg-[#fafafa] disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <button aria-label="Next bill" disabled={pos === queueCtx.ids.length - 1} onClick={() => nav(`/invoices/${queueCtx.ids[pos + 1]}`)} className="inline-flex size-8 items-center justify-center rounded-md border border-[#d4d4d4] text-ink-2 hover:bg-[#fafafa] disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-[24px] font-semibold leading-8 tracking-[-0.01em]">{vendor?.legal_name || inv.extracted_vendor_name || 'Unknown vendor'}</h1>
            {blockedNote && blocks.length ? <Badge tone="red">Blocked · {nBlockGroups} issue{nBlockGroups > 1 ? 's' : ''}</Badge> : <Status value={inv.status} />}
            {inv.doc_type === 'credit_note' && <Badge>Credit note</Badge>}
          </div>
          <p className="mt-1 text-[14px] text-ink-3 tnum">Bill {inv.vendor_invoice_number || '—'} · {inv.department || 'No department'} · requested by {inv.requester || '—'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {inv.status === 'pending_approval' && !canApprove.ok && can(user, 'invoice.approve') && <span className="max-w-xs text-right text-[13px] text-ink-3">{canApprove.reason}</span>}
          {!inv.vendor_id && can(user, 'vendor.create') && <Button onClick={() => setModal('vendor')}>Add to vendor master</Button>}
          {(actions.approve || actions.reject) && <Button variant="ghost" onClick={() => setModal('reject')}>Reject</Button>}
          {actions.submit && <Button variant={blockedNote ? 'secondary' : 'primary'} loading={busy} disabled={!!blockedNote} title={blockedNote || ''} onClick={submit}>Submit for approval</Button>}
          {actions.approve && <Button variant="primary" onClick={() => setModal('approve')}>Approve</Button>}
          {actions.schedule && <Button variant="primary" onClick={() => setModal('pay')}>Schedule payment</Button>}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[480px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Summary data={data} />
          <FlagsCard flags={flags} inv={inv} canResolve={actions.resolve} user={user} onChange={setData} focus={focus} data={data} />
          <DetailsCard data={data} editable={actions.edit} onChange={setData} />
        </div>
        <div className="xl:sticky xl:top-6 xl:self-start">
          <DocumentCard data={data} />
        </div>
      </div>
      <div className="mt-8 space-y-6">
        <LinesCard data={data} editable={actions.edit && can(user, 'invoice.code')} onChange={setData} />
        <div className="grid gap-8 border-t border-line pt-6 lg:grid-cols-2">
          <div className="space-y-6"><ApprovalChain data={data} first />{data.payments.length > 0 && <PaymentCard data={data} user={user} reload={reload} />}</div>
          <AuditTrail rows={data.audit} first />
        </div>
      </div>

      <ApproveModal open={modal === 'approve'} onClose={() => setModal(null)} warns={warns} busy={busy} onBehalf={canApprove.onBehalfOf}
        onConfirm={(comment) => act(() => api(`/invoices/${id}/approve`, { method: 'POST', body: { comment, acknowledge: true } }), 'Approved')} />
      <RejectModal open={modal === 'reject'} onClose={() => setModal(null)} busy={busy}
        onConfirm={(comment) => act(() => api(`/invoices/${id}/reject`, { method: 'POST', body: { comment } }), 'Rejected')} />
      {modal === 'pay' && <ScheduleModal data={data} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); toast('Payment scheduled. A finance manager or controller releases it.'); }} />}
      {modal === 'vendor' && <OnboardVendorModal inv={inv} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); toast('Vendor added as pending review'); }} />}
    </div>
  );
}

// Amount, due date and, while it's in workflow, who it's waiting on. No commentary.
function Summary({ data }) {
  const { invoice: inv, approvals, payments } = data;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = inv.due_date && inv.due_date < today && !['paid', 'rejected', 'applied'].includes(inv.status);
  const next = approvals.find((a) => a.action === 'pending');
  const pay = payments.find((p) => p.status !== 'cancelled');
  const third = inv.status === 'pending_approval' && next ? ['Waiting on', `${next.assigned_name}${next.on_behalf_of_name ? ` for ${next.on_behalf_of_name}` : ''}`]
    : pay ? ['Payment', `${pay.method === 'CARD' ? 'Virtual card' : pay.method === 'CHEQUE' ? 'Cheque' : 'EFT'} · ${pay.status === 'scheduled' ? fmtDate(pay.scheduled_date) : pay.paid_date ? `paid ${fmtDate(pay.paid_date)}` : 'sent'}`]
      : ['Terms', inv.terms_text || '—'];
  return (
    <div className="rounded-md border border-line px-5 py-4">
      <div className="text-[13px] font-medium text-ink-2">{inv.doc_type === 'credit_note' ? 'Credit' : 'Amount due'}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 whitespace-nowrap">
        <span className="text-[28px] font-semibold leading-8 tnum tracking-[-0.01em]">{money(inv.total, inv.currency)}</span>
        <span className="text-[14px] font-medium text-ink-3">{inv.currency}</span>
        {inv.currency !== 'CAD' && <span className="text-[13px] text-ink-3 tnum">{money(inv.total_cad)} CAD at {inv.fx_rate_to_cad}</span>}
      </div>
      <div className="mt-1"><AmountDetails data={data} /></div>
      <dl className="mt-4 grid grid-cols-2 gap-6 border-t border-line pt-3">
        <div>
          <dt className="text-[13px] font-medium text-ink-2">Due date</dt>
          <dd className="mt-0.5 text-[15px] font-semibold tnum">{fmtDate(inv.due_date)}{overdue && <span className="ml-2 text-[13px] font-medium text-[#b54708]">{Math.floor((Date.now() - new Date(inv.due_date + 'T12:00:00')) / 86400000)}d overdue</span>}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[13px] font-medium text-ink-2">{third[0]}</dt>
          <dd className="mt-0.5 truncate text-[15px] font-semibold">{third[1]}</dd>
        </div>
      </dl>
    </div>
  );
}

// Findings in the same category are one decision: one card, one action, every finding listed.
function FlagsCard({ flags, inv, canResolve, user, onChange, focus, data }) {
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const toast = useToast();
  const open = flags.filter((f) => f.status === 'open' && f.severity !== 'info');
  const info = flags.filter((f) => f.status === 'open' && f.severity === 'info');
  const resolved = flags.filter((f) => f.status !== 'open');
  const groups = [];
  for (const f of open) {
    const g = groups.find((x) => x.cat === f.category);
    if (g) g.items.push(f); else groups.push({ cat: f.category, items: [f] });
  }
  for (const g of groups) g.sev = g.items.some((f) => f.severity === 'block') ? 'block' : 'warn';
  groups.sort((x, y) => (x.sev === 'block' ? 0 : 1) - (y.sev === 'block' ? 0 : 1));
  const editable = canResolve && ['draft', 'needs_review', 'pending_approval'].includes(inv.status);
  const passed = inv.recommendation?.positives || [];
  const listRef = useRef(null);
  useEffect(() => {
    if (!focus) return;
    setResolving(focus.cat); setNote('');
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);
  const resolve = async (g) => {
    try {
      let last;
      for (const f of g.items) last = await api(`/invoices/${inv.invoice_id}/flags/${f.id}/resolve`, { method: 'POST', body: { note } });
      onChange(last); setResolving(null); setNote(''); toast('Marked as resolved');
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Section first title={groups.length > 1 ? 'Issues' : null}
      actions={resolved.length > 0 && <Button size="sm" variant="ghost" onClick={() => setShowResolved(!showResolved)}>{showResolved ? 'Hide resolved' : `Resolved (${resolved.length})`}</Button>}>
      {!groups.length && <p className="rounded-md border border-line px-4 py-3 text-[14px] text-ink-2">No open issues{passed.length ? `. ${passed.join(', ')}.` : '.'}</p>}
      {groups.length > 0 && (
        <ul ref={listRef} className="scroll-mt-6 divide-y divide-line overflow-hidden rounded-md border border-line">
          {groups.map((g) => {
            const s = SEV[g.sev];
            const key = `${g.cat}`;
            const canFix = editable && (g.cat !== 'fraud' || can(user, 'flag.resolve.fraud'));
            const Icon = s.icon;
            return (
              <li key={key} className="p-4">
                <div className="flex items-start gap-3">
                  <Icon className={cx('mt-0.5 size-4 shrink-0', s.text)} strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold">{g.items.length > 1 ? GROUP[g.cat] || g.items[0].title : g.items[0].title}</span>
                        {groups.length > 1 && <Badge tone={s.tag}>{s.label}</Badge>}
                      </div>
                      {editable && g.cat === 'fraud' && !can(user, 'flag.resolve.fraud') && <span className="shrink-0 text-[13px] text-ink-3">Finance manager clears</span>}
                    </div>
                    {g.cat === 'tax' ? <TaxCompare data={data} items={g.items} /> : <div className="mt-2 space-y-2">
                      {g.items.map((f) => (
                        <div key={f.id} className="text-[14px] leading-5">
                          {g.items.length > 1 && <div className="font-medium text-ink">{f.title}</div>}
                          <p className="text-ink-2">{f.detail}</p>
                          {f.related_id && /^AP-\d+$/.test(f.related_id) && <Link to={`/invoices/${f.related_id}`} className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">Open the other bill<ChevronRight className="size-3.5" /></Link>}
                        </div>
                      ))}
                    </div>}
                    {canFix && resolving !== key && (
                      <div className="mt-3">
                        <Button variant={g === groups[0] ? 'primary' : 'secondary'} size="sm" onClick={() => { setResolving(key); setNote(''); }}>Resolve {(g.items.length > 1 ? GROUP[g.cat] : shortName(g.items[0].code)).toLowerCase()}</Button>
                      </div>
                    )}
                    {resolving === key && (
                      <div className="mt-3 flex gap-2">
                        <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && resolve(g)} className="input" placeholder="What did you check or change?" />
                        <Button variant="primary" onClick={() => resolve(g)}>Mark resolved</Button>
                        <Button variant="ghost" onClick={() => setResolving(null)}>Cancel</Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {showResolved && resolved.length > 0 && (
        <ul className="mt-3 space-y-2">
          {resolved.map((f) => <li key={f.id} className="text-[14px] text-ink-3"><span className="font-medium text-ink-2">{f.title}</span> · resolved by {f.resolved_by_name}{f.resolution_note ? `: “${f.resolution_note}”` : ''}</li>)}
        </ul>
      )}
      {info.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {info.map((f) => <li key={f.id} className="text-[13px] leading-5 text-ink-3"><span className="font-medium text-ink-2">{f.title}.</span> {f.detail}</li>)}
        </ul>
      )}
    </Section>
  );
}

function DetailsCard({ data, editable, onChange }) {
  const meta = useMeta();
  const { invoice: inv, vendor, po, contract } = data;
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});
  const toast = useToast();
  useEffect(() => { setForm({ ...inv }); }, [inv]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    const body = {};
    for (const k of ['vendor_id', 'vendor_invoice_number', 'invoice_date', 'due_date', 'currency', 'ship_to_province', 'po_id', 'department_id', 'requester_user_id', 'credit_note_ref']) if ((form[k] ?? '') !== (inv[k] ?? '')) body[k] = form[k];
    for (const k of ['subtotal', 'total']) if (Number(form[k]) !== inv[k]) body[k] = Number(form[k]);
    try { onChange(await api(`/invoices/${inv.invoice_id}`, { method: 'PATCH', body })); setEdit(false); toast('Saved and re-checked'); } catch (e) { toast(e.message, 'error'); }
  };
  if (edit) {
    return (
      <Section title="Details" actions={<><Button size="sm" onClick={() => setEdit(false)}>Cancel</Button><Button size="sm" variant="primary" onClick={save}>Save and re-check</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Vendor" className="col-span-2 md:col-span-3">
            <select className="input" value={form.vendor_id || ''} onChange={set('vendor_id')}>
              <option value="">Unknown vendor</option>
              {meta.vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.legal_name} ({v.vendor_id}{v.status !== 'active' ? `, ${v.status.replace('_', ' ')}` : ''})</option>)}
            </select>
          </Field>
          <Field label="Invoice number"><input className="input" value={form.vendor_invoice_number || ''} onChange={set('vendor_invoice_number')} /></Field>
          <Field label="Invoice date"><input type="date" className="input" value={form.invoice_date || ''} onChange={set('invoice_date')} /></Field>
          <Field label="Due date"><input type="date" className="input" value={form.due_date || ''} onChange={set('due_date')} /></Field>
          <Field label="Delivered to (province)">
            <select className="input" value={form.ship_to_province || ''} onChange={set('ship_to_province')}>
              <option value="">—</option>{['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="PO"><input className="input" value={form.po_id || ''} onChange={set('po_id')} placeholder="PO-2026-0000" /></Field>
          <Field label="Currency"><select className="input" value={form.currency} onChange={set('currency')}><option>CAD</option><option>USD</option></select></Field>
          <Field label="Department">
            <select className="input" value={form.department_id || ''} onChange={set('department_id')}>{meta.departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}</select>
          </Field>
          <Field label="Requester">
            <select className="input" value={form.requester_user_id || ''} onChange={set('requester_user_id')}>
              <option value="">—</option>{meta.users.filter((u) => u.status !== 'terminated').map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field label="Subtotal"><input type="number" step="0.01" className="input tnum" value={form.subtotal ?? ''} onChange={set('subtotal')} /></Field>
          <Field label="Total"><input type="number" step="0.01" className="input tnum" value={form.total ?? ''} onChange={set('total')} /></Field>
        </div>
      </Section>
    );
  }
  const taxes = data.taxes;
  const matchedOn = vendor ? (inv.vendor_match_method || '').replace(/ matches/g, '').replace(/GST\/HST number/, 'GST number').split(', ').filter(Boolean) : [];
  return (
    <Section title="Bill details" actions={editable && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>}>
      <div className="space-y-5">
        <div>
          <div className="mb-4">
            <div className="text-[13px] text-ink-3">Vendor</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {vendor ? <Link className="text-[14px] font-semibold text-brand hover:underline" to={`/vendors/${vendor.vendor_id}`}>{vendor.legal_name}</Link> : <span className="text-[14px] font-semibold text-danger">{inv.extracted_vendor_name || 'Unknown'}</span>}
              {vendor ? <Status value={vendor.status} /> : <Badge tone="red">Not in vendor master</Badge>}
            </div>
          </div>
        <KV cols={2} items={[
          ['Bill date', fmtDate(inv.invoice_date)], ['Received', fmtDate(inv.received_date)],
          ['Delivered to', inv.ship_to_province || '—'], ['PO', po ? po.po_id : inv.po_id || 'None'],
          ['Contract', contract ? contract.contract_id : 'None'], ['Currency', inv.currency],
        ]} />
        </div>

      </div>
      <details className="group mt-4">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink"><ChevronRight className="size-3.5 transition group-open:rotate-90" />More details</summary>
        <div className="mt-3">
          <KV cols={4} items={[
            ['Vendor matched on', matchedOn.slice(0, 2).join(', ') || 'Set by AP'],
            ['GST/HST on bill', inv.extracted_vendor_tax_id || '—'],
            ['Terms', inv.terms_text || (vendor ? `Net ${vendor.payment_terms_days}` : '—')],
            ['Due', fmtDate(inv.due_date)],
            ['Contract terms', contract ? contract.description : '—'],
            ['PO amount', po ? money(po.total_amount, po.currency) : '—'],
            ['Requester', inv.requester || '—'], ['Bill ID', inv.invoice_id],
          ]} />
        </div>
      </details>
    </Section>
  );
}

// Charged vs expected, from the bill's captured taxes and the place-of-supply rule the checks apply.
const RULES = {
  ON: [['HST 13%', 0.13, 'all']], QC: [['GST 5%', 0.05, 'all'], ['QST 9.975%', 0.09975, 'all']],
  BC: [['GST 5%', 0.05, 'all'], ['PST 7% (goods)', 0.07, 'goods']], NS: [['HST 15%', 0.15, 'all']], NB: [['HST 15%', 0.15, 'all']], NL: [['HST 15%', 0.15, 'all']], PE: [['HST 15%', 0.15, 'all']],
};
function TaxCompare({ data, items }) {
  const { invoice: inv, taxes, lines, vendor } = data;
  const foreign = vendor && vendor.country && vendor.country !== 'CA';
  const exempt = vendor?.category === 'Insurance';
  const goods = lines.filter((l) => l.line_type === 'goods').reduce((a, l) => a + (l.amount || 0), 0);
  const rules = foreign || exempt ? [] : (RULES[inv.ship_to_province] || [['GST 5%', 0.05, 'all']]);
  const expected = rules.map(([label, rate, base]) => [label, Math.round((base === 'goods' ? goods : inv.subtotal) * rate * 100) / 100]);
  const charged = taxes.map((t) => [taxLabel(t), t.amount]);
  const sum = (a) => a.reduce((x, [, v]) => x + v, 0);
  const diff = Math.round((sum(charged) - sum(expected)) * 100) / 100;
  const Row = ({ label, items: it, strong }) => (
    <div className="grid grid-cols-[88px_1fr_auto] items-baseline gap-3 py-2">
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="text-[14px] text-ink-2">{it.length ? it.map(([l]) => l).join(' + ') : 'None'}</span>
      <span className={cx('text-[14px] tnum', strong ? 'font-semibold' : 'font-medium')}>{money(sum(it), inv.currency)}</span>
    </div>
  );
  return (
    <div className="mt-2">
      <p className="text-[14px] text-ink-2">Delivered to {inv.ship_to_province || 'an unknown province'}{foreign ? '; the vendor is outside Canada' : exempt ? '; insurance is exempt' : ''}. Tax should be {expected.length ? expected.map(([l]) => l).join(' + ') : 'nil'} on {money(inv.subtotal, inv.currency)}.</p>
      <div className="mt-2 divide-y divide-line border-y border-line">
        <Row label="Charged" items={charged} />
        <Row label="Expected" items={expected} />
        <div className={cx('-mx-3 grid grid-cols-[88px_1fr_auto] items-baseline gap-3 px-3 py-2', diff && 'bg-danger-soft')}>
          <span className={cx('text-[13px] font-medium', diff ? 'text-danger' : 'text-ink-3')}>Difference</span><span />
          <span className={cx('text-[14px] font-semibold tnum', diff ? 'text-danger' : 'text-ok')}>{diff > 0 ? '+' : ''}{money(diff, inv.currency)}</span>
        </div>
      </div>
    </div>
  );
}

function AmountDetails({ data }) {
  const { invoice: inv, taxes } = data;
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink"><ChevronRight className="size-3.5 transition group-open:rotate-90" />Amount details</summary>
      <dl className="mt-2 w-56 space-y-1 text-[13px] tnum">
        <div className="flex justify-between"><dt className="text-ink-3">Subtotal</dt><dd>{money(inv.subtotal, inv.currency)}</dd></div>
        {taxes.map((t) => <div key={t.id} className="flex justify-between"><dt className="text-ink-3">{taxLabel(t)}</dt><dd>{money(t.amount, inv.currency)}</dd></div>)}
        <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Total {inv.currency}</dt><dd>{money(inv.total, inv.currency)}</dd></div>
      </dl>
    </details>
  );
}

function taxLabel(t) {
  return { HST13: 'HST 13%', GST5: 'GST 5%', QST9975: 'QST 9.975%', PST7_BC: 'BC PST 7%' }[t.code] || t.label || t.code;
}

function LinesCard({ data, editable, onChange }) {
  const meta = useMeta();
  const { invoice: inv, lines } = data;
  const [openWhy, setOpenWhy] = useState(null);
  const toast = useToast();
  const setLine = async (l, patch) => {
    try { onChange(await api(`/invoices/${inv.invoice_id}/lines/${l.id}`, { method: 'PUT', body: patch })); } catch (e) { toast(e.message, 'error'); }
  };
  const acceptAll = async () => { try { onChange(await api(`/invoices/${inv.invoice_id}/accept-coding`, { method: 'POST' })); toast('Coding accepted'); } catch (e) { toast(e.message, 'error'); } };
  const pending = lines.filter((l) => l.coding_source === 'suggested').length;
  const glName = (n) => meta.gl_accounts.find((g) => g.account_number === n)?.name;
  return (
    <Section title="Line items" actions={editable && pending > 0 && <Button size="sm" onClick={acceptAll}>Accept {pending} suggested code{pending > 1 ? 's' : ''}</Button>}>
      <div className="overflow-x-auto border-y border-line-2">
        <table className="w-full">
          <thead className="border-b border-line-2"><tr>
            <th className="th pl-0">Description</th><th className="th text-right">Amount</th><th className="th">GL account</th><th className="th">Department</th><th className="th pr-0">Coding</th>
          </tr></thead>
          <tbody className="divide-y divide-line-2">
            {lines.map((l) => (
              <Fragment key={l.id}>
                <tr>
                  <td className="td max-w-[220px] pl-0">
                    <div className="truncate" title={l.description}>{l.description}</div>
                    <div className="mt-0.5 text-xs text-ink-3 tnum">{l.quantity} × {money(l.unit_price, inv.currency)}{l.line_type === 'goods' ? ' · goods' : ''}</div>
                  </td>
                  <td className="td text-right tnum font-medium">{money(l.amount, inv.currency)}</td>
                  <td className="td min-w-[230px]">
                    {editable ? (
                      <select className="input h-7 py-0 text-xs" value={l.gl_account || ''} onChange={(e) => setLine(l, { gl_account: e.target.value })}>
                        {meta.gl_accounts.filter((g) => g.account_type === 'expense').map((g) => <option key={g.account_number} value={g.account_number}>{g.account_number} {g.name}</option>)}
                      </select>
                    ) : <span><span className="tnum">{l.gl_account}</span> <span className="text-ink-3">{l.gl_name}</span></span>}
                  </td>
                  <td className="td min-w-[120px]">
                    {editable ? (
                      <select className="input h-7 py-0 text-xs" value={l.department_id || ''} onChange={(e) => setLine(l, { department_id: e.target.value })}>
                        {meta.departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
                      </select>
                    ) : <span>{meta.departments.find((d) => d.department_id === l.department_id)?.name}</span>}
                  </td>
                  <td className="td whitespace-nowrap pr-0">
                    <button onClick={() => setOpenWhy(openWhy === l.id ? null : l.id)} className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
                      {l.coding_source === 'suggested' ? <>Suggested · {Math.round((l.coding_confidence || 0) * 100)}%</> : l.coding_source === 'human' ? 'Edited' : l.coding_source === 'accepted' ? 'Confirmed' : 'History'}
                      {openWhy === l.id ? <ChevronDown className="size-3 text-ink-4" /> : <ChevronRight className="size-3 text-ink-4" />}
                    </button>
                  </td>
                </tr>
                {openWhy === l.id && (
                  <tr className="bg-[#f7f8fa]">
                    <td colSpan={5} className="px-3 py-2.5 text-xs leading-relaxed text-ink-2">
                      <span className="font-medium text-ink">Suggested {l.suggested_gl} {glName(l.suggested_gl)}.</span> {l.coding_reason || 'Coded in history.'}
                      {l.suggested_gl && l.gl_account !== l.suggested_gl && <span className="ml-1 text-ink-3">Overridden; the correction is used for future suggestions.</span>}
                      {editable && l.coding_source === 'suggested' && <button onClick={() => setLine(l, { gl_account: l.gl_account })} className="ml-2 font-medium text-brand hover:underline">Confirm</button>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ApprovalChain({ data, first }) {
  const { approvals, invoice: inv, release_rule: rr } = data;
  if (!approvals.length) return null;
  const pendingIdx = approvals.findIndex((a) => a.action === 'pending');
  return (
    <Section first={first} title="Approvals" actions={['draft', 'needs_review'].includes(inv.status) && <span className="text-xs text-ink-3">Starts after AP review</span>}>
      <ol className="space-y-0">
        {approvals.map((a, i) => {
          const isNext = i === pendingIdx && inv.status === 'pending_approval';
          const Icon = a.action === 'approved' ? CheckCircle2 : a.action === 'rejected' ? XCircle : Circle;
          return (
            <li key={a.approval_id} className="flex gap-4 border-b border-line-2 py-2.5 first:pt-0">
              <span className={cx('w-16 shrink-0 pt-px text-xs font-medium', a.action === 'approved' ? 'text-[#1d6b37]' : a.action === 'rejected' ? 'text-[#a11b1b]' : isNext ? 'text-brand' : 'text-ink-4')}>{a.action === 'approved' ? 'Approved' : a.action === 'rejected' ? 'Rejected' : isNext ? 'Waiting' : `Step ${a.step_no}`}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="font-medium">{a.approver_name || a.assigned_name}</span>
                  <span className="text-ink-3">{a.role_label}</span>
                  {a.on_behalf_of_name && <span className="text-ink-3">· for {a.on_behalf_of_name}</span>}
                  {a.rule_id && a.rule_id !== 'default' && <span className="text-[11px] text-ink-4 tnum">{a.rule_id}</span>}
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {a.action === 'pending' ? a.reason : `${a.action === 'approved' ? 'Approved' : a.action === 'rejected' ? 'Rejected' : a.action} ${fmtDateTime(a.acted_at)}${a.comment ? ` · “${a.comment}”` : ''}`}
                </div>
              </div>
            </li>
          );
        })}
        <li className="pt-3 text-xs text-ink-3">Payment release: {rr.roles.map(roleLabel).join(' or ')} ({rr.rule}). Approvers of this bill cannot release it.</li>
      </ol>
    </Section>
  );
}

function PaymentCard({ data, user, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const release = async (p) => {
    setBusy(true);
    try { await api(`/payments/${p.payment_id}/release`, { method: 'POST' }); toast(p.method === 'CARD' ? 'Paid by single-use virtual card' : 'Released to the EFT rail'); reload(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const cancel = async (p) => { try { await api(`/payments/${p.payment_id}/cancel`, { method: 'POST', body: { reason: 'Cancelled from invoice' } }); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Section title="Payment">
      {data.payments.map((p) => (
        <div key={p.payment_id} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5"><span className="text-[15px] font-semibold tnum">{money(p.amount, p.currency)}</span><span className="text-ink-3">{p.method === 'CARD' ? 'Virtual card' : p.method === 'CHEQUE' ? 'Cheque' : 'EFT'}</span><Status value={p.status} /></div>
            <div className="mt-1 text-xs text-ink-3">
              {p.payment_id} · {p.status === 'scheduled' ? `for ${fmtDate(p.scheduled_date)}` : p.paid_date ? `paid ${fmtDate(p.paid_date)}` : `settles ${fmtDate(p.scheduled_date)}`}
              {p.reference && ` · ${p.reference}`}{p.card_last4 && ` · card ••${p.card_last4}`}
              {p.discount_taken > 0 && ` · discount ${money(p.discount_taken, p.currency)}`}
            </div>
            <div className="mt-0.5 text-xs text-ink-3">Prepared by {p.prepared_by_name}{p.released_by_name ? ` · released by ${p.released_by_name}` : ''}</div>
          </div>
          <div className="flex gap-2">
            {p.status === 'scheduled' && (can(user, 'payment.prepare') || can(user, 'payment.release')) && <Button variant="ghost" onClick={() => cancel(p)}>Cancel</Button>}
            {p.status === 'scheduled' && can(user, 'payment.release') && <Button variant="primary" loading={busy} onClick={() => release(p)}>Release payment</Button>}
          </div>
        </div>
      ))}
    </Section>
  );
}

function DocumentCard({ data }) {
  const { invoice: inv, document: doc, email } = data;
  if (!doc) return <div className="rounded-md border border-line px-5 py-8 text-center text-[14px] text-ink-3">Imported from AP history. No document on file.</div>;
  const conf = Math.round((doc.extraction_confidence || 0) * 100);
  const method = { 'pdf-text': 'PDF text', 'pdf-text+llm': 'PDF text, verified by model', 'llm-vision': 'Scanned image, read by model', 'llm-pdf': 'PDF, read by model', none: 'Manual entry' }[doc.extraction_method] || doc.extraction_method;
  return (
    <div>
      <DocViewer url={docUrl(inv.invoice_id)} mime={doc.mime} filename={doc.filename} />
      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink"><ChevronRight className="size-3.5 transition group-open:rotate-90" />Document information</summary>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <div><dt className="text-ink-3">Source</dt><dd className="text-ink">{email ? `Email from ${email.from_address}` : 'Uploaded'}</dd></div>
          <div><dt className="text-ink-3">Received</dt><dd className="text-ink tnum">{fmtDateTime(email?.received_at || doc.uploaded_at)}</dd></div>
          <div><dt className="text-ink-3">Read from</dt><dd className="text-ink">{method}</dd></div>
          <div><dt className="text-ink-3">Capture confidence</dt><dd className={cx('tnum', conf < 75 ? 'font-medium text-danger' : conf < 90 ? 'text-warn' : 'text-ink')}>{conf}%</dd></div>
          {email && <div className="col-span-2"><dt className="text-ink-3">Subject</dt><dd className="text-ink">{email.subject}</dd></div>}
        </dl>
      </details>
    </div>
  );
}

export const ACTION_LABEL = {
  'invoice.captured': 'Captured', 'invoice.routed': 'Routed', 'invoice.auto_submitted': 'Sent straight to approval', 'invoice.submitted': 'Sent for approval', 'invoice.approved': 'Approved', 'invoice.rejected': 'Rejected',
  'invoice.fully_approved': 'Fully approved', 'invoice.edited': 'Edited', 'coding.changed': 'Coding changed', 'coding.accepted': 'Coding accepted', 'flag.resolved': 'Flag resolved', 'flag.reopened': 'Flag reopened',
  'payment.prepared': 'Payment prepared', 'payment.released': 'Payment released', 'payment.settled': 'Payment settled', 'payment.cancelled': 'Payment cancelled', 'payment.release_denied': 'Release blocked', 'invoice.approve_denied': 'Approval blocked', 'credit_note.applied': 'Credit applied',
  'auth.login': 'Signed in', 'email.classified': 'Email sorted', 'access.denied': 'Access denied', 'vendor.created': 'Vendor added', 'vendor.approved': 'Vendor approved', 'vendor.status_changed': 'Vendor status changed',
  'bank_change.requested': 'Bank change requested', 'bank_change.callback_verified': 'Callback verified', 'bank_change.approved': 'Bank change approved', 'bank_change.rejected': 'Bank change rejected',
  'delegation.created': 'Out of office set', 'delegation.ended': 'Out of office ended', 'policy.updated': 'Rule changed', 'user.updated': 'User changed', 'audit.exported': 'Audit exported', 'journal.exported': 'Journal exported', 'system.seeded': 'Database built',
};
export function auditSummary(a) {
  const d = a.details || {};
  switch (a.action) {
    case 'invoice.captured': return `${d.file || ''} via ${d.source}${d.email ? ` (${d.email})` : ''}, ${d.method}, ${Math.round((d.confidence || 0) * 100)}%`;
    case 'invoice.routed': case 'invoice.submitted': return d.route;
    case 'invoice.approved': return `Step ${d.step}${d.as_delegate ? ' as delegate' : ''}${d.comment ? `: “${d.comment}”` : ''}${d.acknowledged?.length ? ` · reviewed: ${d.acknowledged.join(', ')}` : ''}`;
    case 'invoice.rejected': return d.comment;
    case 'invoice.edited': return Object.entries(d.changes || {}).map(([k, [a1, b]]) => `${k}: ${a1 ?? '—'} → ${b ?? '—'}`).join('; ');
    case 'coding.changed': return `Line ${d.line}: ${d.from?.gl}/${d.from?.dept} → ${d.to?.gl_account || d.from?.gl}/${d.to?.department_id || d.from?.dept}`;
    case 'flag.resolved': return `${d.title}: “${d.note}”`;
    case 'payment.prepared': return `${d.method} ${money(d.amount, d.currency)} for ${d.scheduled_date}`;
    case 'payment.released': return `${d.reference} (${d.rule})`;
    case 'payment.release_denied': case 'invoice.approve_denied': case 'access.denied': return d.reason;
    case 'auth.login': return 'Signed in';
    case 'email.classified': return `${String(d.classification || '').replace(/_/g, ' ')}${d.reason ? `: ${d.reason}` : ''}`;
    case 'vendor.created': return `${d.legal_name} created as ${String(d.status || 'pending_review').replace('_', ' ')}${d.from_invoice ? ` from ${d.from_invoice}` : ''}`;
    case 'vendor.approved': return `Approved (was ${String(d.from || '').replace('_', ' ')})`;
    case 'vendor.status_changed': return `${d.from} → ${d.to}${d.reason ? `: ${d.reason}` : ''}`;
    case 'bank_change.requested': return `${d.vendor}: new account ••${d.new_last4} via ${String(d.channel || '').replace(/_/g, ' ')}, risk ${d.risk}`;
    case 'bank_change.callback_verified': return d.note;
    case 'bank_change.approved': return `${d.vendor}: account ••${d.new_last4} now active`;
    case 'bank_change.rejected': return d.note || 'Rejected';
    case 'delegation.created': return `Delegated to ${d.delegate}${d.ends_on ? ` until ${d.ends_on}` : ''}`;
    case 'delegation.ended': return 'Delegation ended';
    case 'policy.updated': return Object.entries(d.after || {}).map(([k, v]) => `${k}: ${JSON.stringify(d.before?.[k])} → ${JSON.stringify(v)}`).join('; ');
    case 'user.updated': return Object.entries(d.after || {}).map(([k, v]) => `${k}: ${d.before?.[k] ?? '—'} → ${v ?? '—'}`).join('; ');
    case 'payment.settled': return `Settled ${d.paid_date} (simulated)`;
    case 'payment.cancelled': return d.reason;
    case 'credit_note.applied': return `Applied against ${d.against}`;
    case 'invoice.auto_submitted': return d.reason;
    case 'system.seeded': return 'Database built from the dataset';
    case 'audit.exported': case 'journal.exported': return 'Exported';
    default: return d.reason || '';
  }
}
function AuditTrail({ rows, first }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(-8);
  return (
    <Section first={first} title="Activity" actions={rows.length > 8 && <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show recent' : `Show all ${rows.length}`}</Button>}>
      <ol className="space-y-2.5">
        {list.map((a) => (
          <li key={a.seq} className="relative flex gap-3 text-[13px]">
            <span className="w-28 shrink-0 pt-px text-xs text-ink-4 tnum">{fmtDateTime(a.ts)}</span>
            <div className="min-w-0 flex-1">
              <div><span className="font-medium">{a.actor_name || 'System'}</span>{a.on_behalf_of_name && <span className="text-ink-3"> for {a.on_behalf_of_name}</span>} <span className="text-ink-2">{(ACTION_LABEL[a.action] || a.action).toLowerCase()}</span></div>
              <div className="truncate text-xs text-ink-3" title={auditSummary(a)}>{auditSummary(a)}</div>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function ApproveModal({ open, onClose, onConfirm, warns, busy, onBehalf }) {
  const [comment, setComment] = useState('');
  const [ack, setAck] = useState(false);
  useEffect(() => { setAck(false); setComment(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Approve invoice" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={warns.length > 0 && !ack} onClick={() => onConfirm(comment)}>Approve</Button></>}>
      {onBehalf && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">You're approving as a delegate. It will be recorded as on behalf of the original approver.</p>}
      {warns.length > 0 && (
        <div className="mb-3 space-y-2">
          {warns.map((w) => <div key={w.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm"><span className="font-medium">{w.title}.</span> <span className="text-ink-2">{w.detail}</span></div>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-teal-700" />I've reviewed these</label>
        </div>
      )}
      <Field label="Comment (optional)"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
    </Modal>
  );
}
function RejectModal({ open, onClose, onConfirm, busy }) {
  const [comment, setComment] = useState('');
  useEffect(() => setComment(''), [open]);
  return (
    <Modal open={open} onClose={onClose} title="Reject invoice" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={comment.trim().length < 3} onClick={() => onConfirm(comment)}>Reject</Button></>}>
      <Field label="Reason (the vendor contact and requester will see this)"><textarea rows={3} className="input" value={comment} onChange={(e) => setComment(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function ScheduleModal({ data, onClose, onDone }) {
  const { invoice: inv, vendor, pay_suggestion: s } = data;
  const [method, setMethod] = useState(s?.method || 'EFT');
  const [date, setDate] = useState(s?.pay_on || '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const go = async () => {
    setBusy(true);
    try { await api('/payments', { method: 'POST', body: { invoice_id: inv.invoice_id, method, scheduled_date: date } }); onDone(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const methods = ['EFT', 'CHEQUE', ...(vendor?.accepts_card_payment ? ['CARD'] : [])];
  return (
    <Modal open onClose={onClose} title="Schedule payment" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Schedule</Button></>}>
      {s && <div className="mb-4 rounded-lg bg-brand-soft px-3 py-2.5 text-sm text-brand-2"><span className="font-semibold">Best day: {fmtDate(s.pay_on)}.</span> {s.reason}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {methods.map((m) => <button key={m} onClick={() => setMethod(m)} className={cx('flex-1 rounded-md px-2 py-1.5 text-xs font-medium', method === m ? 'bg-white shadow-sm' : 'text-ink-3')}>{m === 'CARD' ? 'Virtual card' : m === 'CHEQUE' ? 'Cheque' : 'EFT'}</button>)}
          </div>
        </Field>
        <Field label="Pay on"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="mt-4 text-sm text-ink-2">
        {method === 'CARD' ? 'A single-use Brim virtual card is issued for the exact amount when released, then closed.' : vendor?.bank_institution ? `To ${vendor.legal_name}, inst. ${vendor.bank_institution} transit ${vendor.bank_transit} account ••${String(vendor.bank_account || '').slice(-4)} (vendor master).` : ''}
      </div>
    </Modal>
  );
}

function OnboardVendorModal({ inv, onClose, onDone }) {
  const meta = useMeta();
  const bank = inv.extracted_bank || {};
  const [f, setF] = useState({ legal_name: inv.extracted_vendor_name || '', gst_hst_number: inv.extracted_vendor_tax_id || '', category: '', default_gl_account: '', payment_terms_days: 30, bank_institution: bank.institution || '', bank_transit: bank.transit || '', bank_account: bank.account || '', ap_contact_email: '', province_or_state: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cats = [...new Set(meta.vendors.map((v) => v.category))].sort();
  const go = async () => {
    setBusy(true);
    try { await api('/vendors', { method: 'POST', body: { ...f, from_invoice: inv.invoice_id } }); onDone(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title="Onboard vendor" wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Create as pending review</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Legal name" className="col-span-2"><input className="input" value={f.legal_name} onChange={set('legal_name')} /></Field>
        <Field label="GST/HST number"><input className="input" value={f.gst_hst_number} onChange={set('gst_hst_number')} /></Field>
        <Field label="AP contact email"><input className="input" value={f.ap_contact_email} onChange={set('ap_contact_email')} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={set('category')}><option value="">Choose</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Default GL"><select className="input" value={f.default_gl_account} onChange={set('default_gl_account')}><option value="">Choose</option>{meta.gl_accounts.filter((g) => g.account_type === 'expense').map((g) => <option key={g.account_number} value={g.account_number}>{g.account_number} {g.name}</option>)}</select></Field>
        <Field label="Institution"><input className="input" value={f.bank_institution} onChange={set('bank_institution')} /></Field>
        <Field label="Transit"><input className="input" value={f.bank_transit} onChange={set('bank_transit')} /></Field>
        <Field label="Account"><input className="input" value={f.bank_account} onChange={set('bank_account')} /></Field>
        <Field label="Terms (days)"><input type="number" className="input" value={f.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
      </div>
    </Modal>
  );
}
