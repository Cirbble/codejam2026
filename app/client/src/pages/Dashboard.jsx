import { useNavigate } from 'react-router-dom';
import { ArrowRight, Upload, Inbox } from 'lucide-react';
import { useAuth } from '../App.jsx';
import { useApi, Card, PageLoader, Status, Empty, Button, Metrics, Stat, PageHeader, SummaryStrip, cx } from '../components/ui.jsx';
import { STAGE } from '../issues.js';
import { money, compact, fmtDate, can } from '../api.js';
import { InvoiceTable, triage } from './Invoices.jsx';

const pct = (x) => `${Math.round((x || 0) * 100)}%`;

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data: d } = useApi('/dashboard');
  const { data: queue } = useApi(can(user, 'invoice.approve') ? '/invoices?view=mine_to_approve' : null);
  const { data: drafts } = useApi(user.role === 'ap_clerk' ? '/invoices?status=draft,needs_review' : null);
  const { data: mine } = useApi(user.role === 'employee' ? '/invoices?view=mine' : null);
  if (!d) return <PageLoader />;
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdue = (drafts || []).filter((r) => r.due_date && r.due_date < todayIso && (r.blocks || r.warns)).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const today = new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-6">
      <PageHeader title="Overview">
        {user.role === 'employee' && <Button variant="primary" icon={Upload} onClick={() => nav('/submit')}>Submit bill</Button>}
        {['approver', 'finance_manager', 'controller_admin'].includes(user.role) && (d.my_queue?.c > 0) && <Button variant="primary" onClick={() => nav('/approvals')}>Review approvals ({d.my_queue.c})</Button>}
      </PageHeader>

      {(user.away || user.acting_for?.length > 0) && (
        <div className="flex items-center justify-between rounded-lg border border-line bg-white px-4 py-2.5 text-[13px]">
          <span className="text-ink-2">
            {user.away ? <>You're out of office. <span className="font-medium text-ink">{user.away.delegate}</span> is approving for you.</>
              : <>You're covering approvals for <span className="font-medium text-ink">{user.acting_for.map((a) => a.name).join(', ')}</span>.</>}
          </span>
          <Button size="sm" variant="ghost" onClick={() => nav('/approvals')}>Manage</Button>
        </div>
      )}

      {user.role === 'ap_clerk' && drafts && <Workload d={d} drafts={drafts} nav={nav} />}
      <Metrics className={cx('border-b border-line pb-6', user.role === 'ap_clerk' && 'hidden')}>
        {user.role === 'employee' && (<>
          <Stat label="Open bills" value={(mine || []).filter((i) => !['paid', 'rejected'].includes(i.status)).length} />
          <Stat label="Awaiting approval" value={(mine || []).filter((i) => i.status === 'pending_approval').length} />
          <Stat label="Paid" value={(mine || []).filter((i) => i.status === 'paid').length} />
          {d.department && <Stat label={`${d.department.name} spend, YTD`} value={compact(d.department.ytd)} sub={`${pct(d.department.pct)} of ${compact(d.department.annual_budget_cad)} budget`} />}
        </>)}
        {user.role === 'ap_clerk' && (<>
          <Stat label="Bills to review" value={d.drafts.c} sub={<><span className={d.flagged.c ? 'font-medium text-danger' : ''}>{d.flagged.c} blocked</span> · {money(d.drafts.cad)}</>} onClick={() => nav('/invoices?tab=review')} />
          <Stat label="Awaiting approval" value={d.pending.c} sub={money(d.pending.cad)} onClick={() => nav('/invoices?tab=pending')} />
          <Stat label="Approved, unscheduled" value={d.approved.c} sub={money(d.approved.cad)} onClick={() => nav('/payments')} />
        </>)}
        {user.role === 'approver' && (<>
          <Stat label="Awaiting your approval" value={d.my_queue?.c ?? 0} sub={money(d.my_queue?.cad || 0)} onClick={() => nav('/approvals')} />
          <Stat label="Open department bills" value={d.drafts.c + d.pending.c} onClick={() => nav('/invoices')} />
          {d.department && <Stat label={`${d.department.name} spend, YTD`} value={compact(d.department.ytd)} sub={`${pct(d.department.pct)} of ${compact(d.department.annual_budget_cad)} budget`} onClick={() => nav('/insights')} />}
          <Stat label="Paid, last 30 days" value={d.paid30.c} sub={money(d.paid30.cad)} />
        </>)}
        {['finance_manager', 'controller_admin'].includes(user.role) && (<>
          <Stat label="Awaiting your approval" value={d.my_queue?.c ?? 0} sub={money(d.my_queue?.cad || 0)} onClick={() => nav('/approvals')} />
          <Stat label="Payments to release" value={d.payments_to_release?.c ?? 0} sub={money(d.payments_to_release?.cad || 0)} onClick={() => nav('/payments')} />
          <Stat label="Bank changes to approve" value={d.bank_changes?.c ?? 0} tone={d.bank_changes?.c ? 'red' : undefined} onClick={() => nav('/vendors?tab=bank')} />
          <Stat label="Vendors to approve" value={d.vendors_pending?.c ?? 0} onClick={() => nav('/vendors?tab=pending')} />
        </>)}
        {user.role === 'auditor' && (<>
          <Stat label="Bills in process" value={d.drafts.c + d.pending.c + d.approved.c} onClick={() => nav('/invoices')} />
          <Stat label="Blocked bills" value={d.flagged.c} tone={d.flagged.c ? 'red' : undefined} onClick={() => nav('/invoices?tab=review')} />
          <Stat label="Scheduled payments" value={d.scheduled.c} sub={money(d.scheduled.cad)} onClick={() => nav('/payments')} />
          <Stat label="Audit log" value="Intact" sub="Hash chain verified" onClick={() => nav('/audit')} />
        </>)}
      </Metrics>

      {queue && (
        <Card title="Awaiting your approval" pad={false} actions={queue.length > 0 && <Button size="sm" variant="link" onClick={() => nav('/approvals')}>View all approvals</Button>}>
          {queue.length ? <InvoiceTable rows={queue.slice(0, 8)} compact view="pending" /> : <Empty title="Nothing awaiting your approval" />}
        </Card>
      )}
      {drafts && (
        <Card title={<>Overdue bills <span className="ml-1 font-normal text-ink-3 tnum">{overdue.length} · {money(overdue.reduce((a, r) => a + (r.total_cad || 0), 0))} CAD</span></>} pad={false} actions={<Button size="sm" variant="link" onClick={() => nav('/invoices?tab=review&overdue=1')}>Review overdue bills ({overdue.length})</Button>}>
          {overdue.length ? <InvoiceTable rows={overdue.slice(0, 8)} compact view="review" /> : <Empty title="No overdue bills with issues" />}
        </Card>
      )}
      {mine && (
        <Card title="My bills" pad={false}>
          {mine.length ? <InvoiceTable rows={mine} compact /> : <Empty icon={Upload} title="No bills yet"><Button className="mt-3" variant="primary" onClick={() => nav('/submit')}>Submit bill</Button></Empty>}
        </Card>
      )}
      {!queue && !drafts && !mine && d.recent?.length > 0 && (
        <Card title="Recent activity" pad={false}>
          <ul className="divide-y divide-line-2">
            {d.recent.map((r) => (
              <li key={r.invoice_id} onClick={() => nav(`/invoices/${r.invoice_id}`)} className="row-link flex items-center justify-between gap-4 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.vendor_name}</div>
                  <div className="text-xs text-ink-3">#{r.vendor_invoice_number} · updated {fmtDate(r.updated_at)}</div>
                </div>
                <div className="flex items-center gap-4"><span className="tnum">{money(r.total, r.currency)}</span><Status value={r.status} /></div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// AP workload: what the clerk can move now leads; queues that wait on others stay compact.
function Workload({ d, drafts, nav }) {
  const blocked = drafts.filter((r) => r.blocks > 0 || !r.vendor_id);
  const ready = drafts.filter((r) => !r.blocks && r.vendor_id);
  const sum = (a) => a.reduce((x, r) => x + (r.total_cad || 0), 0);
  const Queue = ({ label, n, amount, to }) => (
    <button onClick={() => nav(to)} className="flex items-center justify-between rounded-md border border-line bg-white px-4 py-3 text-left hover:border-[#a3a3a3]">
      <span className="text-[14px] font-medium text-ink-2">{label}</span>
      <span className="text-[14px] tnum"><span className="font-semibold text-ink">{n}</span><span className="ml-2 text-ink-3">{money(amount)}</span></span>
    </button>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="rounded-md border border-line bg-white p-5">
        <div className="text-[14px] font-semibold text-ink">{STAGE.review}</div>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[13px] font-medium text-danger">Blocked</div>
            <div className="mt-1 text-[28px] font-semibold leading-[34px] tnum">{blocked.length}</div>
            <div className="text-[14px] text-ink-2 tnum">{money(sum(blocked))} CAD</div>
            <Button className="mt-3" variant="primary" onClick={() => nav('/invoices?tab=review&queue=blocked')}>Resolve blocked ({blocked.length})</Button>
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink-2">Ready to submit</div>
            <div className="mt-1 text-[28px] font-semibold leading-[34px] tnum">{ready.length}</div>
            <div className="text-[14px] text-ink-2 tnum">{money(sum(ready))} CAD</div>
            <Button className="mt-3" onClick={() => nav('/invoices?tab=review&queue=ready')}>Submit for approval ({ready.length})</Button>
          </div>
        </div>
      </div>
      <div className="grid content-start gap-3">
        <Queue label={STAGE.pending} n={d.pending.c} amount={d.pending.cad} to="/invoices?tab=pending" />
        <Queue label={STAGE.ready} n={d.approved.c} amount={d.approved.cad} to="/payments" />
        <Queue label={STAGE.scheduled} n={d.scheduled.c} amount={d.scheduled.cad} to="/payments" />
      </div>
    </div>
  );
}
