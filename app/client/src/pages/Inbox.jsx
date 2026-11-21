import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Paperclip, PackageOpen, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../App.jsx';
import { api, money, fmtDateTime, can } from '../api.js';
import { useApi, Card, Button, PageHeader, Empty, PageLoader, Status, Badge, Tabs, Modal, cx, useToast } from '../components/ui.jsx';
import { Dropzone, UploadModal } from './Submit.jsx';

const CLASS = {
  invoice: { label: 'Invoice', dot: 'bg-brand' },
  payment_inquiry: { label: 'Payment inquiry', dot: 'bg-amber-500' },
  missing_attachment: { label: 'Missing attachment', dot: 'bg-amber-500' },
  statement: { label: 'Statement', dot: 'bg-zinc-400' },
  not_invoice: { label: 'Not an invoice', dot: 'bg-zinc-300' },
};

export default function InboxPage() {
  const { user } = useAuth();
  const { data, reload } = useApi('/inbox');
  const [tab, setTab] = useState('all');
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [upload, setUpload] = useState(false);
  const [openId, setOpenId] = useState(null);
  const nav = useNavigate();
  const toast = useToast();
  if (!data) return <PageLoader />;
  const fresh = data.filter((e) => e.status === 'new').length;
  const rows = data.filter((e) => tab === 'all' || (tab === 'action' ? ['payment_inquiry', 'missing_attachment'].includes(e.classification) : tab === 'not_invoice' ? ['not_invoice', 'statement'].includes(e.classification) : e.classification === tab));
  const process = async () => {
    setBusy(true);
    try { const r = await api('/inbox/process', { method: 'POST' }); toast(`${r.summary.bills} bills created, ${r.summary.ignored} ignored`); reload(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Inbox" sub="ap@harborline-logistics.example">
        {can(user, 'invoice.ingest') && <>
          <Button onClick={() => setImportOpen(true)}>Import mailbox</Button>
          <Button onClick={() => setUpload(true)}>Upload bills</Button>
          {fresh ? <Button variant="primary" loading={busy} onClick={process}>Process {fresh} new</Button> : <span className="inline-flex items-center gap-1.5 text-[14px] text-ink-2"><CheckCircle2 className="size-4 text-ok" />All messages processed</span>}
        </>}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'all', label: 'All', count: data.length },
        { value: 'invoice', label: 'Invoices', count: data.filter((e) => e.classification === 'invoice').length },
        { value: 'action', label: 'Needs reply', count: data.filter((e) => ['payment_inquiry', 'missing_attachment'].includes(e.classification)).length },
        { value: 'not_invoice', label: 'Filtered', count: data.filter((e) => ['not_invoice', 'statement'].includes(e.classification)).length },
      ]} />
      <div className="card overflow-hidden">
        {rows.length === 0 && <Empty icon={Mail} title="No messages" />}
        <ul className="divide-y divide-line-2">
          {rows.map((e) => {
            const c = CLASS[e.classification] || { label: e.status, dot: 'bg-zinc-300' };
            const expanded = openId === e.email_id;
            return (
              <li key={e.email_id}>
                <button onClick={() => setOpenId(expanded ? null : e.email_id)} className="grid w-full grid-cols-[minmax(0,200px)_minmax(0,1fr)_150px_112px] items-center gap-4 px-4 py-3 text-left hover:bg-[#fafafa]">
                  <span className="truncate font-medium">{e.from_name.replace(/ Accounts Receivable$/, '')}</span>
                  <span className="min-w-0 truncate"><span className="font-medium text-ink">{e.subject}</span><span className="text-ink-3"> · {e.body.replace(/\s+/g, ' ').slice(0, 90)}</span></span>
                  <span className={cx('text-[13px]', tab === 'invoice' && 'invisible', e.classification === 'invoice' ? 'text-ink-2' : ['payment_inquiry', 'missing_attachment'].includes(e.classification) ? 'font-medium text-[#8a5a00]' : 'text-ink-4')}>{c.label}{e.invoices.length > 1 ? ` · ${e.invoices.length}` : ''}</span>
                  <span className="w-28 whitespace-nowrap text-right text-xs text-ink-3 tnum">{fmtDateTime(e.received_at)}</span>
                </button>
                {expanded && (
                  <div className="border-t border-line-2 bg-zinc-50/60 px-4 py-3">
                    <div className="text-xs text-ink-3">{e.from_name} &lt;{e.from_address}&gt;</div>
                    <p className="mt-2 whitespace-pre-line text-[13px] text-ink-2">{e.body}</p>
                    {e.classification !== 'invoice' && <p className="mt-2 text-xs text-ink-3">{e.classification_reason}</p>}
                    {e.answer && <div className="mt-3 rounded-md border border-line bg-white px-3 py-2 text-[13px]"><div className="text-xs font-medium text-ink-3">Suggested reply</div><div className="mt-0.5 text-ink-2">{e.answer.text}</div></div>}
                    {e.invoices.length > 0 && (
                      <div className="mt-3 overflow-hidden rounded-md border border-line bg-white">
                        {e.invoices.map((i) => (
                          <button key={i.invoice_id} onClick={() => nav(`/invoices/${i.invoice_id}`)} className="flex w-full items-center gap-3 border-b border-line-2 px-3 py-2 text-left text-[13px] last:border-0 hover:bg-zinc-50">
                            <Paperclip className="size-3.5 text-ink-4" /><span className="flex-1 truncate">{i.filename}</span><span className="text-xs text-ink-3 tnum">{i.invoice_id}</span><span className="tnum">{money(i.total, i.currency)}</span><Status value={i.status} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
      <UploadModal open={upload} onClose={() => setUpload(false)} onDone={reload} />
    </div>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const toast = useToast();
  const close = () => { setFiles([]); setRes(null); onClose(); };
  const go = async () => {
    setBusy(true);
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    try { setRes(await api('/inbox/import', { method: 'POST', form: fd })); onDone(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const json = files.find((f) => f.name.endsWith('.json'));
  return (
    <Modal open={open} onClose={close} title="Import a mailbox export" footer={res ? <Button variant="primary" onClick={close}>Done</Button> : <><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} disabled={!files.length} onClick={go}>Import</Button></>}>
      {res ? (
        <div className="flex items-center gap-3 text-[13px]"><PackageOpen className="size-5 text-brand" />{res.results.emails} emails, {res.results.bills} bills from attachments, {res.results.loose_files} loose files, {res.results.skipped} already imported.</div>
      ) : (
        <div className="space-y-3">
          <Dropzone accept=".json,.pdf,.png,.jpg,.jpeg" onFiles={(f) => setFiles((x) => [...x, ...f])} label="Drop emails.json and its attachments" />
          {files.length > 0 && <p className="text-[13px] text-ink-2">{json ? `${json.name} + ` : ''}{files.length - (json ? 1 : 0)} attachment{files.length - (json ? 1 : 0) === 1 ? '' : 's'}</p>}
        </div>
      )}
    </Modal>
  );
}
