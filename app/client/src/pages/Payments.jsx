import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ChevronDown } from 'lucide-react';
import { useAuth } from '../App.jsx';
import { api, money, fmtDate, can, download, compact } from '../api.js';
import { useApi, Card, Button, PageHeader, Empty, PageLoader, Status, Badge, Stat, Metrics, SummaryStrip, Tabs, Checkbox, cx, useToast, useOutside } from '../components/ui.jsx';

export default function Payments() {
  const { user } = useAuth();
  const { data, reload } = useApi('/payments');
  const [tab, setTab] = useState(can(user, 'payment.release') ? 'release' : 'ready');
  const [busy, setBusy] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useOutside(() => setExportOpen(false));
  const nav = useNavigate();
  const toast = useToast();
  if (!data) return <PageLoader />;
  const k = data.kpis;
  const awaiting = data.payments.filter((p) => p.status === 'scheduled');
  const inflight = data.payments.filter((p) => p.status === 'released');
  const done = data.payments.filter((p) => ['settled', 'outstanding', 'cancelled'].includes(p.status));
  const rows = tab === 'ready' ? data.ready : tab === 'release' ? awaiting : [];
  const idOf = (r) => (tab === 'ready' ? r.invoice_id : r.payment_id);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const switchTab = (t) => { setTab(t); setSel(new Set()); };

  const scheduleOne = (inv) => api('/payments', { method: 'POST', body: { invoice_id: inv.invoice_id, method: inv.suggestion.method, scheduled_date: inv.suggestion.pay_on } });
  const releaseOne = (p) => api(`/payments/${p.payment_id}/release`, { method: 'POST' });
  const runBatch = async (fn, list, verb) => {
    setBusy('batch');
    let ok = 0; const errs = [];
    for (const r of list) { try { await fn(r); ok++; } catch (e) { errs.push(e.message); } }
    toast(errs.length ? `${ok} ${verb}. ${errs.length} not: ${errs[0]}` : `${ok} payment${ok === 1 ? '' : 's'} ${verb}`, errs.length ? 'error' : 'ok');
    setSel(new Set()); setBusy(null); reload();
  };
  const one = async (fn, r, msg) => { setBusy(idOf(r)); try { await fn(r); toast(msg); reload(); } catch (e) { toast(e.message, 'error'); } setBusy(null); };
  const settle = async () => { try { const r = await api('/payments/settle', { method: 'POST' }); toast(`${r.settled} payment${r.settled === 1 ? '' : 's'} settled`); reload(); } catch (e) { toast(e.message, 'error'); } };
  const canAct = tab === 'ready' ? can(user, 'payment.prepare') : tab === 'release' && can(user, 'payment.release');
  const selRows = rows.filter((r) => sel.has(idOf(r)));
  const selTotal = selRows.reduce((a, r) => a + (r.amount_cad ?? r.total_cad ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Payments">
        {can(user, 'payment.release') && inflight.length > 0 && <Button onClick={settle}>Run settlement</Button>}
      </PageHeader>

      <Tabs value={tab} onChange={switchTab} tabs={[
        { value: 'ready', label: 'Ready to schedule', count: data.ready.length },
        { value: 'release', label: 'Awaiting release', count: awaiting.length },
        { value: 'inflight', label: 'Sent to bank', count: inflight.length },
        { value: 'done', label: 'Payment history', count: done.length },
      ]} />
      <div className="flex min-h-10 items-center justify-between gap-3">
        <span className="text-[14px] text-ink-2 tnum">
          {tab === 'ready' && `${data.ready.length} bills · ${money(k.ready_to_schedule.cad)} CAD`}
          {tab === 'release' && `${awaiting.length} payments · ${money(k.awaiting_release.cad)} CAD`}
          {tab === 'inflight' && `${inflight.length} payments · ${money(k.in_flight.cad)} CAD`}
          {tab === 'done' && `${done.length} payments`}
          {tab === 'ready' && k.discounts_available.length > 0 && <span className="ml-3 font-medium text-ok">{money(k.discounts_available.reduce((a, d) => a + d.saving, 0))} in early-pay discounts available</span>}
        </span>
        <div className="flex items-center gap-2">
          {canAct && rows.length > 0 && !sel.size && (tab === 'ready'
            ? <Button variant="primary" loading={busy === 'batch'} onClick={() => runBatch(scheduleOne, rows, 'scheduled')}>Schedule all ({rows.length})</Button>
            : <Button variant="primary" loading={busy === 'batch'} onClick={() => runBatch(releaseOne, rows, 'released')}>Release all ({rows.length})</Button>)}
        <div className="relative" ref={exportRef}>
          <Button variant="ghost" icon={Download} onClick={() => setExportOpen(!exportOpen)}>Export<ChevronDown className="size-4 text-ink-3" /></Button>
          {exportOpen && (
            <div className="absolute right-0 top-10 z-20 w-56 rounded-md border border-line bg-white p-1 shadow-[0_12px_16px_-4px_rgba(16,24,40,0.08)]">
              <button onClick={() => { setExportOpen(false); download('/payments/eft-file'); }} className="block w-full rounded px-3 py-2 text-left text-[14px] hover:bg-[#fafafa]">EFT batch file</button>
              {can(user, 'journal.export') && <button onClick={() => { setExportOpen(false); download('/journal.csv'); }} className="block w-full rounded px-3 py-2 text-left text-[14px] hover:bg-[#fafafa]">Journal entries (CSV)</button>}
            </div>
          )}
        </div>
        </div>
      </div>
      {canAct && sel.size > 0 && (
        <div className="flex min-h-9 items-center justify-between">
          {sel.size ? (
            <div className="flex items-center gap-3">
              <span className="text-[14px] font-medium tnum">{sel.size} selected · {money(selTotal)} CAD</span>
              {tab === 'ready'
                ? <Button variant="primary" loading={busy === 'batch'} onClick={() => runBatch(scheduleOne, selRows, 'scheduled')}>Schedule selected ({sel.size})</Button>
                : <Button variant="primary" loading={busy === 'batch'} onClick={() => runBatch(releaseOne, selRows, 'released')}>Release selected ({sel.size})</Button>}
              <Button variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
            </div>
          ) : null}
        </div>
      )}
      <div className="card overflow-hidden">
        {tab === 'ready' && (data.ready.length ? (
          <table className="w-full">
            <thead className="border-b border-line bg-[#fafafa]"><tr>
              {canAct && <th className="th w-10"><Checkbox checked={sel.size === rows.length} indeterminate={sel.size > 0 && sel.size < rows.length} onChange={(v) => setSel(new Set(v ? rows.map(idOf) : []))} label="Select all" /></th>}
              <th className="th">Vendor</th><th className="th">Bill number</th><th className="th">Due date</th><th className="th">Send date</th><th className="th">Method</th><th className="th text-right">Amount (CAD)</th>{canAct && <th className="th w-28" />}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {data.ready.map((i) => (
                <tr key={i.invoice_id} className={cx('row-link', sel.has(i.invoice_id) && 'bg-[#eff4ff]/60')} onClick={() => nav(`/invoices/${i.invoice_id}`)}>
                  {canAct && <td className="td w-10" onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.has(i.invoice_id)} onChange={() => toggle(i.invoice_id)} label={`Select ${i.vendor_name}`} /></td>}
                  <td className="td font-medium">{i.vendor_name}</td>
                  <td className="td text-ink-2 tnum">{i.vendor_invoice_number}</td>
                  <td className="td text-ink-2 tnum">{fmtDate(i.due_date)}</td>
                  <td className="td whitespace-nowrap tnum" title={i.suggestion.reason}>{fmtDate(i.suggestion.pay_on)}{i.suggestion.discount && <span className="ml-2 text-[13px] font-medium text-ok">{i.suggestion.discount.percent}% discount</span>}</td>
                  <td className="td whitespace-nowrap text-ink-2">{i.suggestion.method === 'CARD' ? 'Virtual card' : i.suggestion.method === 'CHEQUE' ? 'Cheque' : 'EFT'}</td>
                  <td className="td whitespace-nowrap text-right font-medium tnum">{money(i.total, i.currency)}</td>
                  {canAct && <td className="td text-right" onClick={(e) => e.stopPropagation()}><Button size="sm" loading={busy === i.invoice_id} onClick={() => one(scheduleOne, i, `Scheduled ${i.vendor_name} for ${fmtDate(i.suggestion.pay_on)}`)}>Schedule</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="No approved bills waiting to be scheduled" />)}
        {tab === 'release' && (awaiting.length ? <PayTable rows={awaiting} sel={canAct ? sel : null} toggle={toggle} setSel={setSel}
          action={canAct ? (p) => <Button size="sm" loading={busy === p.payment_id} onClick={() => one(releaseOne, p, p.method === 'CARD' ? `Paid ${p.vendor_name} by virtual card` : `Released ${money(p.amount, p.currency)} to ${p.vendor_name}`)}>{p.method === 'CARD' ? 'Pay by card' : 'Release'}</Button> : null} />
          : <Empty title="No payments awaiting release" />)}
        {tab === 'inflight' && (inflight.length ? <PayTable rows={inflight} /> : <Empty title="No payments with the bank" />)}
        {tab === 'done' && (done.length ? <PayTable rows={done.slice(0, 200)} /> : <Empty title="No payment history yet" />)}
      </div>
    </div>
  );
}

function PayTable({ rows, action, sel, toggle, setSel }) {
  const nav = useNavigate();
  return (
    <table className="w-full">
      <thead className="border-b border-line bg-[#fafafa]"><tr>
        {sel && <th className="th w-10"><Checkbox checked={sel.size === rows.length} indeterminate={sel.size > 0 && sel.size < rows.length} onChange={(v) => setSel(new Set(v ? rows.map((r) => r.payment_id) : []))} label="Select all" /></th>}
        <th className="th">Vendor</th><th className="th">Bill number</th><th className="th">Method</th><th className="th">Date</th><th className="th">Status</th><th className="th">Prepared by</th><th className="th">Released by</th><th className="th text-right">Amount</th>{action && <th className="th w-28" />}
      </tr></thead>
      <tbody className="divide-y divide-line">
        {rows.map((p) => (
          <tr key={p.payment_id} className={cx('row-link', sel?.has(p.payment_id) && 'bg-[#eff4ff]/60')} onClick={() => nav(`/invoices/${p.invoice_id}`)}>
            {sel && <td className="td w-10" onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.has(p.payment_id)} onChange={() => toggle(p.payment_id)} label={`Select ${p.vendor_name}`} /></td>}
            <td className="td font-medium">{p.vendor_name}</td>
            <td className="td text-ink-2 tnum">{p.vendor_invoice_number}</td>
            <td className="td whitespace-nowrap text-ink-2">{p.method === 'CARD' ? 'Virtual card' : p.method === 'CHEQUE' ? 'Cheque' : 'EFT'}</td>
            <td className="td whitespace-nowrap text-ink-2 tnum">{fmtDate(p.paid_date || p.scheduled_date)}</td>
            <td className="td"><Status value={p.status} /></td>
            <td className="td whitespace-nowrap text-ink-2">{p.prepared_by_name || '—'}</td>
            <td className="td whitespace-nowrap text-ink-2">{p.released_by_name || '—'}</td>
            <td className="td whitespace-nowrap text-right font-medium tnum">{money(p.amount, p.currency)}{p.discount_taken > 0 && <div className="text-[13px] font-normal text-ok">−{money(p.discount_taken, p.currency)} discount</div>}</td>
            {action && <td className="td text-right" onClick={(e) => e.stopPropagation()}>{action(p)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
