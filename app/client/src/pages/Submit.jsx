import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, FileText, CheckCircle2, AlertOctagon, Loader2 } from 'lucide-react';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { Modal, Button, Card, useApi, PageHeader, Empty, cx, useToast } from '../components/ui.jsx';
import { InvoiceTable } from './Invoices.jsx';

export function Dropzone({ onFiles, accept = '.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff', multiple = true, label }) {
  const [over, setOver] = useState(false);
  const ref = useRef();
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}
      onClick={() => ref.current.click()}
      className={cx('flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition', over ? 'border-brand bg-brand-soft' : 'border-zinc-300 bg-[#f7f8fa] hover:border-zinc-400')}>
      <UploadCloud className="size-8 text-ink-3" />
      <p className="mt-2 text-[13px] font-medium">{label || 'Drop invoices here or click to choose'}</p>
      <input ref={ref} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => onFiles([...e.target.files])} />
    </div>
  );
}

export function UploadModal({ open, onClose, onDone }) {
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const nav = useNavigate();
  const toast = useToast();
  const close = () => { setFiles([]); setResults(null); setNote(''); onClose(); };
  const send = async () => {
    setBusy(true);
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    if (note) fd.append('note', note);
    try {
      const r = await api('/invoices/upload', { method: 'POST', form: fd });
      setResults(r);
      onDone?.();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={close} title="Upload invoices" footer={results ? <Button variant="primary" onClick={close}>Done</Button> : <>
      <Button onClick={close}>Cancel</Button>
      <Button variant="primary" disabled={!files.length} loading={busy} onClick={send}>{busy ? 'Reading…' : `Capture ${files.length || ''} file${files.length === 1 ? '' : 's'}`}</Button>
    </>}>
      {results ? (
        <ul className="divide-y divide-line-2">
          {results.map((r) => (
            <li key={r.filename} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                {r.error ? <AlertOctagon className="size-4 shrink-0 text-red-600" /> : <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
                <span className="truncate text-[13px]">{r.filename}</span>
              </div>
              {r.error ? <span className="text-xs text-red-600">{r.error}</span> : <Button size="sm" variant="ghost" onClick={() => { close(); nav(`/invoices/${r.invoice_id}`); }}>{r.invoice_id}</Button>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          <Dropzone onFiles={(f) => setFiles((x) => [...x, ...f])} />
          {files.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {files.map((f, i) => <li key={i} className="flex items-center gap-2 text-[13px] text-ink-2"><FileText className="size-4 text-ink-3" />{f.name}<span className="text-xs text-ink-3">{Math.round(f.size / 1024)} KB</span></li>)}
            </ul>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="Note for AP (optional)" />
        </div>
      )}
    </Modal>
  );
}

export default function Submit() {
  const { user } = useAuth();
  const { data, reload } = useApi('/invoices?view=mine');
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-5">
      <PageHeader title="My invoices"><Button variant="primary" icon={UploadCloud} onClick={() => setOpen(true)}>Submit an invoice</Button></PageHeader>
      <Card pad={false}>
        {data?.length ? <InvoiceTable rows={data} compact /> : <Empty icon={FileText} title="Nothing submitted yet" />}
      </Card>
      <UploadModal open={open} onClose={() => setOpen(false)} onDone={reload} />
    </div>
  );
}
