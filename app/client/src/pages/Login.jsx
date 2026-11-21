import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { api, roleLabel } from '../api.js';
import { Spinner } from '../components/ui.jsx';
import { Mark } from '../App.jsx';

const FEATURED = ['U013', 'U004', 'U007', 'U003', 'U002', 'U006'];

export default function Login({ onSignIn }) {
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => { api('/auth/users').then(setUsers).catch((e) => setErr(e.message)); }, []);
  const go = async (id) => { setBusy(id); try { await onSignIn(id); } catch (e) { setErr(e.message); setBusy(null); } };
  const list = useMemo(() => {
    if (!q) return FEATURED.map((id) => users.find((u) => u.user_id === id)).filter(Boolean);
    return users.filter((u) => `${u.full_name} ${u.title} ${roleLabel(u.role)} ${u.department}`.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  }, [users, q]);

  return (
    <div className="flex min-h-full flex-col items-center bg-side px-4">
      <div className="mt-[12vh] w-full max-w-[420px]">
        <div className="mb-10"><Mark className="text-[18px]" /></div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Choose a demo account</h1>
        <p className="mt-1 text-[14px] text-ink-2">Harborline Logistics Inc.</p>
        {err && <p className="mt-3 text-[13px] text-red-600">{err}</p>}

        <div className="mt-5 overflow-hidden rounded-md border border-line bg-white">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-3.5 text-ink-4" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${users.length || ''} people`} className="h-10 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-4" />
          </div>
          <ul className="divide-y divide-line-2">
            {list.map((u) => (
              <li key={u.user_id}>
                <button onClick={() => go(u.user_id)} disabled={!!busy} className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{u.full_name}</div>
                    <div className="truncate text-xs text-ink-3">{u.title} · {u.department}{u.status === 'on_leave' ? ' · On leave' : ''}</div>
                  </div>
                  {!u.title.toLowerCase().includes(roleLabel(u.role).toLowerCase().split(' /')[0]) && <span className="hidden shrink-0 text-[13px] text-ink-3 sm:inline">{roleLabel(u.role)}</span>}
                  {busy === u.user_id ? <Spinner className="size-3.5" /> : <ChevronRight className="size-4 text-ink-4 transition group-hover:text-ink-2" />}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-3 py-6 text-center text-[13px] text-ink-3">No one matches “{q}”</li>}
          </ul>
        </div>
        <p className="mt-4 text-xs text-ink-4">Demo environment. Synthetic data; payments are simulated.</p>
      </div>
    </div>
  );
}
