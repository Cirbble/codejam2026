import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, ExternalLink } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cx, Spinner } from './ui.jsx';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// In-app document viewer: renders PDFs with pdf.js onto canvases so the page sits on a neutral canvas
// with our own toolbar (zoom, fit width, open), instead of the browser's dark embedded viewer.
export default function DocViewer({ url, mime, filename, height = 680 }) {
  const isPdf = mime === 'application/pdf';
  const wrap = useRef(null);
  const [doc, setDoc] = useState(null);
  const [zoom, setZoom] = useState('fit');
  const [width, setWidth] = useState(0);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    setDoc(null); setErr(null);
    pdfjs.getDocument({ url }).promise.then((d) => { if (!cancelled) setDoc(d); }).catch((e) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [url, isPdf]);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const [fitScale, setFitScale] = useState(1);
  const pct = Math.round((zoom === 'fit' ? fitScale : zoom * fitScale) * 100);
  const step = (d) => setZoom((z) => Math.min(3, Math.max(0.5, Math.round(((z === 'fit' ? 1 : z) + d) * 100) / 100)));

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className="flex h-12 items-center justify-between gap-2 border-b border-line bg-white px-2">
        <span className="truncate px-2 text-[13px] font-medium text-ink-2" title={filename}>{filename}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {isPdf && <>
            <div className="flex items-center rounded-md border border-[#d4d4d4]">
              <ToolBtn label="Zoom out" onClick={() => step(-0.25)}><Minus className="size-4" /></ToolBtn>
              <span className="w-12 border-x border-[#d4d4d4] text-center text-[13px] font-medium leading-8 text-ink-2 tnum">{pct}%</span>
              <ToolBtn label="Zoom in" onClick={() => step(0.25)}><Plus className="size-4" /></ToolBtn>
            </div>
            <button onClick={() => setZoom('fit')} className={cx('ml-1 h-8 rounded-md px-2.5 text-[13px] font-medium', zoom === 'fit' ? 'bg-[#f4f4f4] text-ink' : 'text-ink-2 hover:bg-[#f4f4f4]')}>Fit width</button>
          </>}
          <a href={url} target="_blank" rel="noreferrer" title="Open in new tab" className="ml-1 inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-[#f4f4f4] hover:text-ink"><ExternalLink className="size-4" /></a>
        </div>
      </div>
      <div ref={wrap} className="overflow-auto bg-[#f3f4f6] p-4" style={{ height }}>
        {!isPdf ? <img alt={filename} src={url} className="mx-auto w-full rounded-sm bg-white shadow-[0_1px_3px_rgba(16,24,40,0.12)]" />
          : err ? <p className="p-6 text-center text-[14px] text-ink-3">Couldn't render this PDF. Open it in a new tab.</p>
            : !doc || !width ? <div className="flex h-full items-center justify-center"><Spinner /></div>
              : Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} n={i + 1} avail={width - 32} zoom={zoom} onFit={i === 0 ? setFitScale : undefined} />)}
      </div>
    </div>
  );
}

function ToolBtn({ children, label, onClick, active }) {
  return <button title={label} aria-label={label} onClick={onClick} className={cx('inline-flex size-8 items-center justify-center hover:bg-[#f4f4f4] hover:text-ink', active ? 'bg-[#f4f4f4] text-ink' : 'text-ink-2')}>{children}</button>;
}

function Page({ doc, n, avail, zoom, onFit }) {
  const ref = useRef(null);
  useEffect(() => {
    let task;
    let cancelled = false;
    doc.getPage(n).then((page) => {
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const fit = avail / base.width;
      onFit?.(fit);
      const scale = zoom === 'fit' ? fit : zoom * fit;
      const vp = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const c = ref.current;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      c.style.width = `${Math.floor(vp.width)}px`;
      c.style.height = `${Math.floor(vp.height)}px`;
      task = page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
    });
    return () => { cancelled = true; task?.cancel?.(); };
  }, [doc, n, avail, zoom]);
  return <canvas ref={ref} className="mx-auto mb-4 block bg-white shadow-[0_1px_3px_rgba(16,24,40,0.12)] last:mb-0" />;
}
