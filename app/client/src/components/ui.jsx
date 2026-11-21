import { useEffect, useState, useCallback, createContext, useContext, useRef } from 'react';
import { X, AlertOctagon, AlertTriangle, Info, CheckCircle2, Loader2, ChevronRight, Check, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, initials } from '../api.js';

export function cx(...a) { return a.filter(Boolean).join(' '); }

// Buttons: 36px default, 32px small. Solid blue only for the principal action in a context.
export function Button({ variant = 'secondary', size = 'md', icon: Icon, children, className, loading, ...p }) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-2 border border-brand shadow-[0_1px_2px_rgba(16,24,40,0.08)]',
    accent: 'bg-brand text-white hover:bg-brand-2 border border-brand',
    secondary: 'bg-white text-ink border border-[#d4d4d4] hover:bg-[#fafafa] shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
    ghost: 'text-ink-2 hover:bg-[#f4f4f4] hover:text-ink border border-transparent',
    danger: 'bg-white text-danger border border-[#d4d4d4] hover:bg-danger-soft hover:border-[#fda29b]',
    dark: 'bg-ink text-white hover:bg-[#243041] border border-ink',
    link: 'text-brand hover:underline border border-transparent !px-0',
  }[variant];
  const s = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-[14px] gap-2', lg: 'h-10 px-4 text-[14px] gap-2' }[size];
  return (
    <button className={cx('inline-flex items-center justify-center rounded-md font-medium disabled:cursor-not-allowed whitespace-nowrap select-none',
      variant === 'primary' ? 'disabled:bg-[#b2c5f5] disabled:border-[#b2c5f5]' : 'disabled:opacity-50', v, s, className)} disabled={loading || p.disabled} {...p}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" strokeWidth={1.75} /> : null}
      {children}
    </button>
  );
}

// Status tags: 22px, 12px/500. Colour only for states that ask for attention.
const TONE = {
  amber: 'bg-warn-soft text-warn ring-[#fde68a]', blue: 'bg-brand-soft text-brand-2 ring-[#c7d7fe]', green: 'bg-ok-soft text-ok ring-[#abefc6]',
  gray: 'bg-[#f4f4f4] text-[#262626] ring-[#e5e5e5]', red: 'bg-danger-soft text-danger ring-[#fecdca]', violet: 'bg-[#f4f3ff] text-[#5925dc] ring-[#d9d6fe]',
};
const STATUS = {
  draft: ['Needs review', 'amber'], needs_review: ['Needs review', 'amber'], pending_approval: ['Awaiting approval', 'blue'],
  approved: ['Ready to schedule', 'green'], scheduled: ['In payment', 'gray'], paid: ['Paid', 'gray'], rejected: ['Rejected', 'red'], applied: ['Credit applied', 'gray'],
  released: ['Sent to bank', 'blue'], settled: ['Settled', 'gray'], outstanding: ['Cheque outstanding', 'amber'], cancelled: ['Cancelled', 'gray'],
  pending: ['Pending', 'amber'], active: ['Active', 'gray'], pending_review: ['Pending review', 'amber'], on_hold: ['On hold', 'red'],
  inactive: ['Inactive', 'gray'], on_leave: ['On leave', 'amber'], terminated: ['Left', 'gray'],
};
export function Status({ value, className }) {
  const [label, tone] = STATUS[value] || [String(value || '').replace(/_/g, ' '), 'gray'];
  return <span className={cx('inline-flex h-[22px] items-center whitespace-nowrap rounded-[4px] px-2 text-xs font-medium ring-1 ring-inset', TONE[tone], className)}>{label}</span>;
}
export function Badge({ tone = 'slate', children, className, title }) {
  const t = { slate: TONE.gray, red: TONE.red, amber: TONE.amber, green: TONE.green, blue: TONE.blue, violet: TONE.violet, brand: TONE.blue, outline: 'ring-line text-ink-2' }[tone];
  return <span title={title} className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[4px] px-2 text-xs font-medium ring-1 ring-inset', t, className)}>{children}</span>;
}

export const SEV = {
  block: { icon: AlertOctagon, label: 'Blocking', text: 'text-danger', tag: 'red' },
  warn: { icon: AlertTriangle, label: 'Review', text: 'text-warn', tag: 'amber' },
  info: { icon: Info, label: 'Note', text: 'text-ink-3', tag: 'slate' },
};

export function Card({ title, actions, children, className, pad = true, sub }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold text-ink">{title}</h3>
            {sub && <p className="meta">{sub}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Section({ title, actions, children, className, first }) {
  return (
    <section className={cx(!first && 'border-t border-line pt-6', className)}>
      {(title || actions) && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          <h2 className="section-title">{title}</h2>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// Figures: 28/32 600 values, 12px labels. Grouped figures share a container.
export function Metrics({ children, className }) {
  return <div className={cx('flex flex-wrap gap-x-14 gap-y-5', className)}>{children}</div>;
}
export function Stat({ label, value, sub, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('min-w-[120px] text-left', onClick && 'group')}>
      <div className="text-[13px] font-medium text-ink-2">{label}</div>
      <div className={cx('mt-1 text-[28px] font-semibold leading-8 tnum tracking-[-0.01em]', tone === 'red' ? 'text-danger' : tone === 'amber' ? 'text-warn' : 'text-ink', onClick && 'group-hover:text-brand')}>{value}</div>
      {sub && <div className="mt-1 text-[13px] text-ink-3 tnum">{sub}</div>}
    </Tag>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-[14px] font-medium text-ink-2">{title}</p>
      {children && <div className="mt-1 text-[14px] text-ink-3">{children}</div>}
    </div>
  );
}

export function Spinner({ className }) { return <Loader2 className={cx('size-4 animate-spin text-ink-4', className)} />; }
export function PageLoader() { return <div className="flex h-64 items-center justify-center"><Spinner /></div>; }

export function Avatar({ name, size = 'md' }) {
  const s = { sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-10 text-sm' }[size];
  return <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-[#f4f4f4] font-semibold text-ink-2 ring-1 ring-inset ring-line', s)}>{initials(name || '?')}</span>;
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled }) {
  return (
    <button type="button" role="checkbox" aria-checked={indeterminate ? 'mixed' : !!checked} aria-label={label} disabled={disabled}
      title={disabled ? 'Resolve blocking issues first' : undefined}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
      className={cx('inline-flex size-4 items-center justify-center rounded-[4px] border', disabled ? 'cursor-not-allowed border-[#d4d4d4] bg-[#f4f4f4]' : checked || indeterminate ? 'border-brand bg-brand text-white' : 'border-[#a3a3a3] bg-white hover:border-brand')}>
      {indeterminate ? <Minus className="size-3" strokeWidth={3} /> : checked ? <Check className="size-3" strokeWidth={3} /> : null}
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0c111d]/40 p-4 pt-[12vh] fade-in" onMouseDown={onClose}>
      <div className={cx('w-full rounded-xl bg-white shadow-[0_20px_24px_-4px_rgba(16,24,40,0.08),0_8px_8px_-4px_rgba(16,24,40,0.03)]', wide ? 'max-w-2xl' : 'max-w-md')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 pb-2 pt-5">
          <h3 className="text-[18px] font-semibold leading-7">{title}</h3>
          <button onClick={onClose} className="-mr-2 rounded-md p-2 text-ink-4 hover:bg-[#f4f4f4] hover:text-ink-2"><X className="size-5" /></button>
        </div>
        <div className="px-6 py-2">{children}</div>
        {footer && <div className="flex justify-end gap-3 px-6 pb-5 pt-5">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 'max-w-2xl', actions }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-[#0c111d]/30 fade-in" onMouseDown={onClose}>
      <aside className={cx('absolute right-0 top-0 h-full w-full overflow-y-auto bg-white shadow-2xl', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-line bg-white px-6">
          <h3 className="truncate text-[16px] font-semibold">{title}</h3>
          <div className="flex items-center gap-2">{actions}<button onClick={onClose} className="rounded-md p-2 text-ink-4 hover:bg-[#f4f4f4] hover:text-ink-2"><X className="size-5" /></button></div>
        </div>
        <div className="p-6">{children}</div>
      </aside>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-6 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('relative -mb-px flex h-10 items-center gap-2 whitespace-nowrap border-b-2 text-[14px] font-medium',
            value === t.value ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:border-[#d4d4d4] hover:text-ink')}>
          {t.label}
          {t.count !== undefined && t.count !== null && <span className={cx('rounded-full px-2 text-xs font-semibold leading-5 tnum', value === t.value ? 'bg-brand-soft text-brand' : 'bg-[#f4f4f4] text-ink-2')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex h-9 items-center gap-0.5 rounded-md bg-[#f4f4f4] p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cx('h-8 rounded-[5px] px-3 text-[14px]', value === o.value ? 'bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(16,24,40,0.1)]' : 'font-medium text-ink-2 hover:text-ink')}>{o.label}</button>
      ))}
    </div>
  );
}

// One summary strip for every screen: equal columns, label, primary figure, secondary figure, optional actions.
export function SummaryStrip({ items }) {
  return (
    <div className={cx('grid gap-px overflow-hidden rounded-md border border-line bg-line', items.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
      {items.map((it) => (
        <div key={it.label} className="flex flex-col bg-white px-5 py-4">
          <button onClick={it.onClick} disabled={!it.onClick} className="group text-left">
            <div className="text-[13px] font-medium text-ink-2 group-hover:text-brand">{it.label}</div>
            <div className="mt-1.5 flex items-baseline gap-2.5">
              <span className="text-[28px] font-semibold leading-[34px] tnum">{it.value}</span>
              {it.sub && <span className="text-[13px] text-ink-2 tnum">{it.sub}</span>}
            </div>
          </button>
          {it.children && <div className="mt-3 space-y-1 border-t border-line pt-3">{it.children}</div>}
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children, className, hint }) {
  return <label className={cx('block', className)}><span className="label">{label}</span>{children}{hint && <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span>}</label>;
}

export function KV({ items, cols = 2 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-4', cols === 3 ? 'grid-cols-3' : cols === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2')}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[13px] text-ink-3">{k}</dt>
          <dd className="mt-0.5 break-words text-[14px] text-ink tnum">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tone = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[60] flex w-[400px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="fade-in flex items-start gap-3 rounded-lg border border-line bg-white px-4 py-3 text-[14px] text-ink shadow-[0_12px_16px_-4px_rgba(16,24,40,0.08)]">
            {t.tone === 'error' ? <AlertOctagon className="mt-0.5 size-4 shrink-0 text-danger" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- data hook ----------
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try { setState({ data: await api(path), error: null, loading: false }); } catch (e) { setState({ data: null, error: e, loading: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="rounded-md border border-[#fecdca] bg-danger-soft px-4 py-3 text-[14px] text-danger">{error.message}</div>;
}

export function PageHeader({ title, children, sub, crumbs }) {
  return (
    <div className="mb-6">
      {crumbs && (
        <nav className="mb-3 flex items-center gap-1.5 text-[13px] text-ink-3">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="size-3.5 text-ink-4" />}
              {c.to ? <Link to={c.to} className="font-medium hover:text-ink">{c.label}</Link> : <span className="font-medium text-ink-2">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.01em]">{title}</h1>
          {sub && <p className="mt-1 text-[14px] text-ink-3">{sub}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      </div>
    </div>
  );
}

export function Table({ children, className }) {
  return <div className={cx('overflow-x-auto', className)}><table className="w-full border-collapse">{children}</table></div>;
}
export function THead({ children }) {
  return <thead className="border-b border-line bg-[#fafafa]">{children}</thead>;
}

export function useOutside(onOut) {
  const ref = useRef();
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && onOut();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOut]);
  return ref;
}
