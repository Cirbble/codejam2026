import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { WS_URL } from '../config';
import { cancelScheduled } from '../game/coach';
import type { ClientMsg, GameEvent, RoomView, ServerMsg } from '../shared/types';

type Session = { code: string; playerId: string; secret: string; watchToken: string };
type Status = 'idle' | 'connecting' | 'online' | 'reconnecting';

type Ctx = {
  status: Status;
  room: RoomView | null;
  session: Session | null;
  error: string | null;
  clockSkew: number; // local - server
  /** true when we're in a room but haven't heard from the server for a while */
  stale: boolean;
  name: string;
  setName: (n: string) => void;
  create: () => void;
  join: (code: string) => void;
  send: (m: ClientMsg) => void;
  leave: () => void;
  onEvent: (fn: (ev: GameEvent) => void) => () => void;
  clearError: () => void;
};

const GameCtx = createContext<Ctx | null>(null);
const SESSION_KEY = 'squall.session';
const NAME_KEY = 'squall.name';

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('idle');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setNameState] = useState('');
  const [clockSkew, setSkew] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const want = useRef<{ code?: string; create?: boolean } | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const nameRef = useRef('');
  const listeners = useRef(new Set<(ev: GameEvent) => void>());
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMsgAt = useRef(0);
  const openedAt = useRef(0);
  const attempts = useRef(0);
  const skews = useRef<number[]>([]);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(NAME_KEY).then((n) => n && (setNameState(n), (nameRef.current = n)));
    AsyncStorage.getItem(SESSION_KEY).then((s) => {
      if (!s) return;
      try {
        const parsed = JSON.parse(s) as Session;
        sessionRef.current = parsed;
        setSession(parsed);
        want.current = { code: parsed.code };
        open();
      } catch {}
    });
    // resync when the app returns to the foreground (sockets often die while pocketed)
    const sub = AppState.addEventListener('change', (st) => {
      // tell the server first: a locked or backgrounded phone can't be hit and doesn't count as standing
      if (st !== 'unknown' && ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'active', on: st === 'active' } satisfies ClientMsg));
      // A pocketed phone's socket often looks open but is dead: reconnect unless we heard from the server very recently.
      if (st === 'active' && want.current && (!ws.current || ws.current.readyState > 1 || Date.now() - lastMsgAt.current > 4000)) open();
    });
    const tick = setInterval(() => {
      const quiet = Date.now() - lastMsgAt.current;
      setStale(!!want.current && quiet > 5000);
      // Watchdog: the server broadcasts at 2 Hz, so 8 s of silence means the socket is dead even if it looks open.
      if (want.current && quiet > 8000 && Date.now() - openedAt.current > 8000) open();
    }, 1000);
    return () => {
      sub.remove();
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setName = useCallback((n: string) => {
    setNameState(n);
    nameRef.current = n;
    AsyncStorage.setItem(NAME_KEY, n);
  }, []);

  const raw = useCallback((m: ClientMsg) => {
    if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(m));
  }, []);

  const open = useCallback(() => {
    if (retry.current) clearTimeout(retry.current);
    if (!want.current) return; // we left meanwhile
    try {
      ws.current?.close();
    } catch {}
    setStatus((s) => (s === 'online' ? 'reconnecting' : 'connecting'));
    const sock = new WebSocket(WS_URL);
    ws.current = sock;
    openedAt.current = Date.now();
    sock.onopen = () => {
      const s = sessionRef.current;
      const w = want.current;
      if (!w) return;
      if (s && w.code && s.code === w.code) raw({ t: 'hello', name: nameRef.current, code: s.code, playerId: s.playerId, secret: s.secret });
      else raw({ t: 'hello', name: nameRef.current, code: w.code, create: !!w.create });
    };
    sock.onmessage = (e) => {
      if (ws.current !== sock) return; // a replaced socket
      lastMsgAt.current = Date.now();
      attempts.current = 0;
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        const s = { code: m.code, playerId: m.playerId, secret: m.secret, watchToken: m.watchToken };
        sessionRef.current = s;
        setSession(s);
        want.current = { code: m.code };
        AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s));
        setStatus('online');
        setError(null);
      } else if (m.t === 'state') {
        setRoom(m.room);
        // clock offset: the smallest (receive - server) seen recently is the least delayed packet
        skews.current = [...skews.current.slice(-19), Date.now() - m.room.now];
        setSkew(Math.min(...skews.current));
      } else if (m.t === 'watchToken') {
        if (sessionRef.current) {
          const s2 = { ...sessionRef.current, watchToken: m.watchToken };
          sessionRef.current = s2;
          setSession(s2);
          AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s2));
        }
      } else if (m.t === 'ev') {
        listeners.current.forEach((fn) => fn(m.ev));
        // the warning reached this phone (and the voice has it): only now does the walk-out clock start
        if (m.ev.kind === 'warn' && sock.readyState === 1) sock.send(JSON.stringify({ t: 'ack', id: m.ev.strikeId } satisfies ClientMsg));
      } else if (m.t === 'error') {
        setError(m.message);
        if (m.code === 'no_room' || m.code === 'full' || m.code === 'in_progress' || m.code === 'kicked' || !sessionRef.current) {
          want.current = null;
          sessionRef.current = null;
          setSession(null);
          setRoom(null);
          AsyncStorage.removeItem(SESSION_KEY);
          setStatus('idle');
          sock.close();
        }
      }
    };
    sock.onclose = () => {
      if (ws.current !== sock) return;
      if (want.current) {
        setStatus('reconnecting');
        // exponential backoff with jitter, so a venue full of phones doesn't reconnect in lockstep
        const delay = Math.min(15_000, 1000 * 2 ** attempts.current++) * (0.6 + Math.random() * 0.8);
        retry.current = setTimeout(open, delay);
      } else setStatus('idle');
    };
    sock.onerror = () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback(() => {
    sessionRef.current = null;
    want.current = { create: true };
    setError(null);
    open();
  }, [open]);

  const join = useCallback(
    (code: string) => {
      const c = code.trim().toUpperCase();
      if (sessionRef.current?.code !== c) sessionRef.current = null;
      want.current = { code: c };
      setError(null);
      open();
    },
    [open],
  );

  const leave = useCallback(() => {
    raw({ t: 'leave' });
    cancelScheduled();
    if (retry.current) clearTimeout(retry.current);
    want.current = null;
    sessionRef.current = null;
    setSession(null);
    setRoom(null);
    AsyncStorage.removeItem(SESSION_KEY);
    const old = ws.current; // close the socket we left on, never a newer one
    setTimeout(() => old?.close(), 100);
    setStatus('idle');
  }, []);

  const onEvent = useCallback((fn: (ev: GameEvent) => void) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ status, room, session, error, clockSkew, stale, name, setName, create, join, send: raw, leave, onEvent, clearError: () => setError(null) }),
    [status, room, session, error, clockSkew, stale, name, setName, create, join, raw, leave, onEvent],
  );
  return <GameCtx.Provider value={value}>{children}</GameCtx.Provider>;
}

export function useGame() {
  const c = useContext(GameCtx);
  if (!c) throw new Error('useGame outside GameProvider');
  return c;
}

export function useMe() {
  const { room, session } = useGame();
  return room?.players.find((p) => p.id === session?.playerId) ?? null;
}

/** Server-synced "now" in ms that ticks every 250 ms. */
export function useNow(ms = 250) {
  const { clockSkew } = useGame();
  const [now, setNow] = useState(Date.now() - clockSkew);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() - clockSkew), ms);
    return () => clearInterval(id);
  }, [clockSkew, ms]);
  return now;
}
