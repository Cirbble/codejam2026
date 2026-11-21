import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Receipt, Clock } from 'lucide-react';
import { money, fmtDate } from '../api.js';
import { useApi, Card, PageHeader, PageLoader, Stat, Metrics, Tabs, Badge, Empty } from '../components/ui.jsx';

export default function Recon() {
  const { data } = useApi('/recon');
  const [tab, setTab] = useState('unmatched');
  const nav = useNavigate();
  if (!data) return <PageLoader />;
  const s = data.stats;
  const KIND = { bank_fee: ['Bank fee', 'slate'], unknown_debit: ['Unknown debit', 'red'], unmatched_eft: ['Unmatched EFT', 'red'], unmatched_cheque: ['Unmatched cheque', 'amber'], other: ['Other', 'slate'] };
  return (
    <div className="space-y-5">
      <PageHeader title="Bank reconciliation" />
      <Metrics>
        <Stat primary label="Statement debits" value={s.bank_debits} sub="Operating account, 2026" />
        <Stat label="Matched to payments" value={`${Math.round(s.match_rate * 100)}%`} sub={`${s.matched} of ${s.bank_debits}`} />
        <Stat label="Not from AP" value={s.unmatched} sub={money(s.unmatched_cad)} tone={s.unmatched ? 'amber' : undefined} onClick={() => setTab('unmatched')} />
        <Stat label="Paid, not yet cleared" value={s.unpresented} onClick={() => setTab('unpresented')} />
      </Metrics>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'unmatched', label: 'Unmatched bank items', count: data.unmatched.length },
        { value: 'unpresented', label: 'Not yet on statement', count: data.unpresented.length },
        { value: 'matched', label: 'Matched', count: data.matched.length },
      ]} />
      <div className="card overflow-hidden">
        {tab === 'unmatched' && (data.unmatched.length ? (
          <table className="w-full">
            <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">Date</th><th className="th">Description</th><th className="th text-right">Debit</th><th className="th">Type</th><th className="th">What it is / what to do</th></tr></thead>
            <tbody className="divide-y divide-line-2">
              {data.unmatched.map((u) => (
                <tr key={u.bank.bank_txn_id}>
                  <td className="td tnum whitespace-nowrap">{fmtDate(u.bank.posted_date)}</td>
                  <td className="td mono text-ink-2">{u.bank.description}</td>
                  <td className="td text-right tnum font-medium">{money(u.bank.debit)}</td>
                  <td className="td"><Badge tone={KIND[u.kind]?.[1]}>{KIND[u.kind]?.[0]}</Badge></td>
                  <td className="td max-w-lg text-[13px] text-ink-2">{u.explanation}{u.suggested_gl && <Badge className="ml-1.5">GL {u.suggested_gl}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="Every bank debit is explained" />)}
        {tab === 'unpresented' && (data.unpresented.length ? (
          <table className="w-full">
            <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">Payment</th><th className="th">Vendor</th><th className="th">Method</th><th className="th text-right">Amount</th><th className="th">Explanation</th></tr></thead>
            <tbody className="divide-y divide-line-2">
              {data.unpresented.map((u) => (
                <tr key={u.payment.payment_id} className="row-link" onClick={() => nav(`/invoices/${u.payment.invoice_id}`)}>
                  <td className="td text-xs tnum">{u.payment.payment_id}<div className="text-ink-3">{fmtDate(u.payment.paid_date)}</div></td>
                  <td className="td">{u.payment.legal_name}</td>
                  <td className="td"><Badge>{u.payment.method}</Badge></td>
                  <td className="td text-right tnum">{money(u.payment.amount_cad)}</td>
                  <td className="td max-w-lg text-[13px] text-ink-2">{u.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="All payments have cleared" />)}
        {tab === 'matched' && (
          <table className="w-full">
            <thead className="border-b border-line bg-[#fafafa]"><tr><th className="th">Date</th><th className="th">Bank description</th><th className="th text-right">Debit</th><th className="th">Payment</th><th className="th">Matched by</th></tr></thead>
            <tbody className="divide-y divide-line-2">
              {data.matched.slice().reverse().slice(0, 300).map((m) => (
                <tr key={m.bank.bank_txn_id} className="row-link" onClick={() => nav(`/invoices/${m.invoice_id}`)}>
                  <td className="td tnum whitespace-nowrap">{fmtDate(m.bank.posted_date)}</td>
                  <td className="td mono text-ink-2">{m.bank.description}</td>
                  <td className="td text-right tnum">{money(m.bank.debit)}</td>
                  <td className="td text-xs">{m.payment_id} · {m.vendor}</td>
                  <td className="td"><Badge tone={m.method === 'reference' ? 'green' : 'blue'}>{m.method}</Badge>{m.note && <div className="text-xs text-amber-700">{m.note}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
