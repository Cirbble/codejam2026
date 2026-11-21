import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getDevice, RoomView, SERVER } from './api';

type Session = { code: string; playerId: string; secret: string };
type Squad = {
  room: RoomView | null;
  session: Session | null;
  connected: boolean;
  error: string | null;
  skew: number; // local - server ms
  create: (name: string, quick: boolean) => void;
  join: (code: string, name: string) => void;
  send: (m: Record<string, unknown>) => void;
  leave: () => void;
  clearError: () => void;
};
const Ctx = createContext<Squad>(null as unknown as Squad);
export const useSquad = () => useContext(Ctx);

const KEY = 'rarefind.squad';
const wsUrl = SERVER.replace(/^http/, 'ws') + '/rt';

export function SquadProvider({ children }: { children: React.ReactNode }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null); // first message to send on open
  const sessionRef = useRef<Session | null>(null);
  const want = useRef(false);
  const attempts = useRef(0);
  const skews = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMsg = useRef(0);


  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    ws.current?.close();
    const sock = new WebSocket(wsUrl);
    ws.current = sock;
    sock.onopen = () => {
      if (ws.current !== sock) return;
      attempts.current = 0;
      lastMsg.current = Date.now();
      setConnected(true);
      const s = sessionRef.current;
      const first = s ? { t: 'resume', ...s } : pending.current;
      if (first) sock.send(JSON.stringify(first)); // pending stays until 'welcome', so a dropped handshake is retried
    };
    sock.onmessage = (e) => {
      if (ws.current !== sock) return;
      lastMsg.current = Date.now();
      let m: any;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        const s = { code: m.code, playerId: m.playerId, secret: m.secret };
        pending.current = null;
        if (ackTimer.current) clearTimeout(ackTimer.current);
        sessionRef.current = s;
        setSession(s);
        AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
      } else if (m.t === 'state') {
        skews.current = [...skews.current.slice(-19), Date.now() - m.room.now];
        setSkew(Math.min(...skews.current));
        setRoom(m.room);
      } else if (m.t === 'error') {
        setError(m.message || 'Something went wrong');
        if (m.code === 'no_room' || m.code === 'kicked' || m.code === 'full' || m.code === 'in_progress') {
          want.current = false;
          sessionRef.current = null;
          setSession(null);
          setRoom(null);
          AsyncStorage.removeItem(KEY).catch(() => {});
          sock.close();
        }
      }
    };
    sock.onclose = () => {
      if (ws.current !== sock) return;
      setConnected(false);
      if (!want.current) return;
      const delay = Math.min(8000, 500 * 2 ** attempts.current++) + Math.random() * 300;
      timer.current = setTimeout(open, delay);
    };
  }, []);

  // the server sends state at least every few seconds; silence means a dead socket, even if it still says OPEN
  useEffect(() => {
    const id = setInterval(() => {
      if (!want.current || !sessionRef.current) return;
      if (ws.current?.readyState === WebSocket.OPEN && Date.now() - lastMsg.current > 12_000) {
        setConnected(false);
        open();
      }
    }, 3000);
    return () => clearInterval(id);
  }, [open]);

  // resume a saved squad on launch
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const s = JSON.parse(raw) as Session;
        sessionRef.current = s;
        setSession(s);
        want.current = true;
        open();
      })
      .catch(() => {});
  }, [open]);

  // reconnect promptly when the app comes back to the foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && want.current && (ws.current?.readyState !== WebSocket.OPEN || Date.now() - lastMsg.current > 6000)) open();
    });
    return () => sub.remove();
  }, [open]);

  const start = useCallback(
    async (first: Record<string, unknown>) => {
      setError(null);
      sessionRef.current = null;
      setSession(null);
      setRoom(null);
      pending.current = { ...first, device: await getDevice(), op: Date.now().toString(36) + Math.random().toString(36).slice(2) }; // op makes a retried create/join idempotent
      want.current = true;
      open();
      if (ackTimer.current) clearTimeout(ackTimer.current);
      ackTimer.current = setTimeout(() => {
        if (sessionRef.current) return;
        want.current = false;
        pending.current = null;
        ws.current?.close();
        setError("Couldn't reach the server. Check your connection and try again.");
      }, 12_000);
    },
    [open],
  );

  const send = useCallback((m: Record<string, unknown>) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);

  const leave = useCallback(() => {
    send({ t: 'leave' });
    want.current = false;
    sessionRef.current = null;
    setSession(null);
    setRoom(null);
    AsyncStorage.removeItem(KEY).catch(() => {});
    ws.current?.close();
  }, [send]);

  const value = useMemo<Squad>(
    () => ({
      room,
      session,
      connected,
      error,
      skew,
      create: (name, quick) => start({ t: 'create', name, quick }),
      join: (code, name) => start({ t: 'join', code: code.toUpperCase(), name }),
      send,
      leave,
      clearError: () => setError(null),
    }),
    [room, session, connected, error, skew, start, send, leave],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
