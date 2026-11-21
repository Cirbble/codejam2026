import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ShieldCheck, ShieldAlert, Search, Link2 } from 'lucide-react';
import { useAuth } from '../App.jsx';
import { money, fmtDate, fmtDateTime, download, can } from '../api.js';
import { useApi, Card, PageHeader, PageLoader, Button, Tabs, Badge, Status, Empty } from '../components/ui.jsx';
import { auditSummary, ACTION_LABEL } from './InvoiceDetail.jsx';

export default function Audit() {
  const { user } = useAuth();
  const [tab, setTab] = useState('log');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data } = useApi(`/audit?limit=500${query ? `&q=${encodeURIComponent(query)}` : ''}`, [query]);
  const { data: trace } = useApi(tab === 'trace' ? '/audit/trace' : null, [tab]);
  const { data: hist } = useApi(tab === 'dupes' ? '/history-audit' : null, [tab]);
  const nav = useNavigate();
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <PageHeader title="Audit trail">
        {data.chain.ok
          ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-800"><ShieldCheck className="size-4" />{data.chain.count} entries · hash chain intact</span>
          : <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-[13px] font-medium text-red-700"><ShieldAlert className="size-4" />Chain broken at #{data.chain.brokenAt}</span>}
        {can(user, 'audit.export') && <><Button icon={Download} onClick={() => download('/audit/export.csv')}>Export log</Button><Button icon={Download} onClick={() => download('/audit/trace.csv')}>Export payment trace</Button></>}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'log', label: 'Activity' }, { value: 'trace', label: 'Payment → invoice trace' }, { value: 'dupes', label: 'Past duplicate payments' }]} />
      {tab === 'log' && (
        <>
          <form onSubmit={(e) => { e.preventDefault(); setQuery(q); }} className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice, person, action" className="input h-9 pl-9" />
          </form>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">#</th><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Record</th><th className="th">Detail</th><th className="th">Hash</th></tr></thead>
              <tbody className="divide-y divide-line-2">
                {data.rows.map((a) => (
                  <tr key={a.seq} className={a.invoice_id ? 'row-link' : ''} onClick={() => a.invoice_id && nav(`/invoices/${a.invoice_id}`)}>
                    <td className="td text-xs text-ink-3 tnum">{a.seq}</td>
                    <td className="td whitespace-nowrap text-xs tnum">{fmtDateTime(a.ts)}</td>
                    <td className="td whitespace-nowrap text-[13px]">{a.actor_name || 'System'}{a.on_behalf_of_name && <div className="text-xs text-amber-700">for {a.on_behalf_of_name}</div>}</td>
                    <td className="td whitespace-nowrap" title={a.action}><span className={/denied/.test(a.action) ? 'font-medium text-danger' : 'text-ink'}>{ACTION_LABEL[a.action] || a.action}</span></td>
                    <td className="td text-xs tnum">{a.entity_type} {a.entity_id}</td>
                    <td className="td max-w-md truncate text-xs text-ink-2" title={auditSummary(a)}>{auditSummary(a) || '—'}</td>
                    <td className="td font-mono text-[11px] text-ink-3">{a.hash.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === 'trace' && (!trace ? <PageLoader /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">Payment</th><th className="th">Invoice</th><th className="th text-right">Amount</th><th className="th">Approval chain</th><th className="th">Coding</th><th className="th">Prepared → released</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-line-2">
              {trace.map((r) => (
                <tr key={r.payment_id} className="row-link" onClick={() => nav(`/invoices/${r.invoice_id}`)}>
                  <td className="td text-xs tnum">{r.payment_id}<div className="text-ink-3">{r.reference}</div></td>
                  <td className="td text-[13px]">{r.vendor}<div className="text-xs text-ink-3">{r.invoice_id} · #{r.vendor_invoice_number}</div></td>
                  <td className="td text-right tnum">{money(r.amount, r.currency)}</td>
                  <td className="td max-w-[260px] text-xs text-ink-2"><Link2 className="mr-1 inline size-3 text-ink-3" />{r.approval_chain || '—'}</td>
                  <td className="td text-xs text-ink-2">{r.coding}</td>
                  <td className="td text-xs">{r.prepared_by_name} → {r.released_by_name || '—'}</td>
                  <td className="td"><Status value={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {tab === 'dupes' && (!hist ? <PageLoader /> : (
        <div className="space-y-4">
        {hist.card.length > 0 && (
          <Card title={`${hist.card.length} bill${hist.card.length > 1 ? 's' : ''} paid twice: by AP and on an employee card`} pad={false}>
            <ul className="divide-y divide-line-2">
              {hist.card.map((c) => (
                <li key={c.txn_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]">
                  <div>
                    <div className="font-medium">{c.legal_name}</div>
                    <div className="text-xs text-ink-3"><button className="hover:underline" onClick={() => nav(`/invoices/${c.invoice_id}`)}>{c.invoice_id} #{c.vendor_invoice_number}</button> paid by AP, and {c.holder} charged {c.merchant_descriptor} on {fmtDate(c.posted_date)} ({c.txn_id})</div>
                  </div>
                  <span className="tnum font-semibold">{money(c.amount_cad)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title={`${hist.pairs.length} likely duplicate payments in history`} sub={`${money(hist.recoverable_cad)} to recover in total`} pad={false}>
          {hist.pairs.length ? (
            <ul className="divide-y divide-line-2">
              {hist.pairs.map((p) => (
                <li key={p.a_id + p.b_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]">
                  <div>
                    <div className="font-medium">{p.a_name}{p.a_vendor !== p.b_vendor && <span className="text-red-700"> / {p.b_name}</span>}</div>
                    <div className="text-xs text-ink-3"><button className="hover:underline" onClick={() => nav(`/invoices/${p.a_id}`)}>{p.a_id} #{p.a_num} {fmtDate(p.a_date)}</button> and <button className="hover:underline" onClick={() => nav(`/invoices/${p.b_id}`)}>{p.b_id} #{p.b_num} {fmtDate(p.b_date)}</button>{p.a_vendor !== p.b_vendor && ' · different vendor records, same bank account'}</div>
                  </div>
                  <span className="tnum font-semibold">{money(p.total)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No duplicate payments found" />}
        </Card>
        </div>
      ))}
    </div>
  );
}
