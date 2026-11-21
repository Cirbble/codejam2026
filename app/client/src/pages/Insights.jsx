import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Search, ArrowUp, Loader2 } from 'lucide-react';
import { useAuth } from '../App.jsx';
import { api, money, compact, can } from '../api.js';
import { useApi, Card, PageHeader, PageLoader, Badge, cx, useToast } from '../components/ui.jsx';

const SUGGEST = ['What did Operations spend on freight last quarter?', 'Top vendors by spend this year', 'Spend by department in Q3', 'How many legal invoices this year?', 'Monthly software spend'];
const BRAND = '#6680e8';

export default function Insights() {
  const { user } = useAuth();
  const all = can(user, 'spend.view.all');
  const { data } = useApi('/analytics');
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-5">
      <PageHeader title={all ? 'Spend' : `${user.department} spend`} />
      <Ask />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="By month">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.by_month} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid vertical={false} stroke="#eef0f3" />
              <XAxis dataKey="month" tickFormatter={(m) => new Date(m + '-15').toLocaleString('en-CA', { month: 'short' })} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip formatter={(v) => money(v)} cursor={{ fill: '#f1f5f9' }} />
              <Bar isAnimationActive={false} dataKey="cad" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Budget used, year to date">
          <ul className="space-y-3">
            {data.budgets.map((b) => (
              <li key={b.department_id}>
                <div className="flex justify-between text-[13px]"><span className="font-medium">{b.name}</span><span className="tnum text-ink-2">{compact(b.ytd)} <span className="text-ink-3">/ {compact(b.budget)}</span></span></div>
                <div className="mt-1 h-2 rounded-full bg-zinc-100"><div className={cx('h-2 rounded-full', b.pct > 0.9 ? 'bg-red-500' : b.pct > 0.75 ? 'bg-amber-500' : 'bg-[#6680e8]')} style={{ width: `${Math.min(100, (b.pct || 0) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
        {all && <CardSpend rows={data.card} />}
        <Ranked title="Top vendors" rows={data.by_vendor} />
        <Ranked title="By category" rows={data.by_category} />
        {all && <Ranked title="By department" rows={data.by_department} />}
        <Ranked title="By GL account" rows={data.by_gl.map((g) => ({ ...g, label: `${g.key} ${g.label}` }))} />
      </div>
    </div>
  );
}

function Ranked({ title, rows }) {
  const max = Math.max(...rows.map((r) => r.cad), 1);
  return (
    <Card title={title}>
      <ul className="space-y-2.5">
        {rows.slice(0, 8).map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 text-[13px]">
            <div className="min-w-0">
              <div className="truncate">{r.label}</div>
              <div className="mt-1 h-1.5 rounded-full bg-zinc-100"><div className="h-1.5 rounded-full bg-[#6680e8]" style={{ width: `${(r.cad / max) * 100}%` }} /></div>
            </div>
            <span className="text-right tnum font-medium">{compact(r.cad)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Ask() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const toast = useToast();
  const go = async (question) => {
    const text = question ?? q;
    if (!text.trim()) return;
    setQ(text); setBusy(true);
    try { setRes(await api('/ask', { method: 'POST', body: { question: text } })); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const max = res?.rows?.length ? Math.max(...res.rows.map((r) => r.value || 0), 1) : 1;
  return (
    <div className="card p-4">
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-brand" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about spend, e.g. what did Operations spend on freight last quarter?" className="input h-10 pl-10 pr-12 text-[14px]" />
        <button disabled={busy} className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg bg-brand text-white disabled:opacity-60">{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</button>
      </form>
      {!res && <div className="mt-3 flex flex-wrap gap-2">{SUGGEST.map((s) => <button key={s} onClick={() => go(s)} className="rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink-2 hover:border-zinc-300 hover:text-ink">{s}</button>)}</div>}
      {res && (
        <div className="mt-4 fade-in">
          <p className="text-[15px] font-semibold tracking-tight">{res.answer}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            {res.interpretation && <span>Read as: {res.interpretation}</span>}
            <Badge tone="outline">{res.via === 'gemini' ? 'Parsed by model' : 'Parsed by rules'}</Badge>
            {Object.entries(res.spec.filters || {}).filter(([, v]) => v).map(([k, v]) => <Badge key={k} tone="brand">{k.replace('_', ' ')}: {v}</Badge>)}
            {res.spec.group_by && <Badge tone="brand">by {res.spec.group_by}</Badge>}
          </div>
          {res.rows?.length > 1 && res.rows[0].label !== undefined && (
            <ul className="mt-3 space-y-2">
              {res.rows.map((r) => (
                <li key={r.label} className="grid grid-cols-[200px_minmax(0,1fr)_100px] items-center gap-3 text-[13px]">
                  <span className="truncate">{r.label}</span>
                  <div className="h-2 rounded-full bg-zinc-100"><div className="h-2 rounded-full bg-brand" style={{ width: `${((r.value || 0) / max) * 100}%` }} /></div>
                  <span className="text-right tnum">{res.spec.metric === 'count' ? r.value : money(r.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CardSpend({ rows }) {
  const by = {};
  for (const r of rows) { by[r.month] = by[r.month] || { month: r.month, employee: 0, ap: 0 }; by[r.month][r.source === 'ap_virtual_card' ? 'ap' : 'employee'] += r.cad; }
  const data = Object.values(by).sort((a, b) => (a.month < b.month ? -1 : 1));
  return (
    <Card title="Brim card spend">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis dataKey="month" tickFormatter={(m) => new Date(m + '-15').toLocaleString('en-CA', { month: 'short' })} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={52} />
          <Tooltip formatter={(v) => money(v)} cursor={{ fill: '#f1f5f9' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="employee" name="Employee cards" stackId="a" fill="#d4d8e2" maxBarSize={36} />
          <Bar isAnimationActive={false} dataKey="ap" name="AP virtual cards" stackId="a" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
