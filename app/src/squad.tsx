import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { getDevice, joinCodeFrom, prefetchCards, RoomView, SERVER } from './api';
import { cap } from './api';
import { clearReminders, initNotifications, remindRound } from './notify';

type Session = { code: string; playerId: string; secret: string };
type Squad = {
  room: RoomView | null;
  session: Session | null;
  connected: boolean;
  error: string | null;
  skew: number; // local - server ms
  create: (name: string, quick: boolean) => void;
  solo: (name: string, team: string) => void;
  join: (code: string, name: string) => void;
  send: (m: Record<string, unknown>) => void;
  leave: () => void;
  clearError: () => void;
  pendingJoin: string | null;
  pendingSolo: boolean;
};
const Ctx = createContext<Squad>(null as unknown as Squad);
export const useSquad = () => useContext(Ctx);

const KEY = 'rarefind.squad';
const LEAVE_KEY = 'rarefind.pendingLeave';

/** Send an authenticated leave on its own socket; forget it only once the server confirms. */
function retryLeave(s: Session) {
  const sock = new WebSocket(wsUrl);
  sock.onopen = () => sock.send(JSON.stringify({ t: 'leave', ...s }));
  sock.onmessage = (e) => {
    const d = String(e.data);
    if (d.includes('"left"') || d.includes('no_room')) {
      AsyncStorage.removeItem(LEAVE_KEY).catch(() => {});
      sock.close();
    }
  };
  setTimeout(() => sock.close(), 10_000);
}
const wsUrl = SERVER.replace(/^http/, 'ws') + '/rt';

export function SquadProvider({ children }: { children: React.ReactNode }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const [pendingSolo, setPendingSolo] = useState(false); // a solo run was just requested (its room hasn't arrived yet)
  // a squad code from an invite link, used to prefill Join
  const [pendingJoin, setPendingJoin] = useState<string | null>(() => (Platform.OS === 'web' ? joinCodeFrom((globalThis as any).location?.search) : null));
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Linking.getInitialURL().then((u) => u && setPendingJoin(joinCodeFrom(u))).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => setPendingJoin(joinCodeFrom(e.url)));
    return () => sub.remove();
  }, []);
  const ws = useRef<WebSocket | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null); // first message to send on open
  const sessionRef = useRef<Session | null>(null);
  const want = useRef(false);
  const attempts = useRef(0);
  const skews = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMsg = useRef(0);
  const lastOp = useRef<{ key: string; op: string; at: number } | null>(null);
  const openedAt = useRef(0);


  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    ws.current?.close();
    const sock = new WebSocket(wsUrl);
    ws.current = sock;
    openedAt.current = Date.now();
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
        lastOp.current = null;
        if (ackTimer.current) clearTimeout(ackTimer.current);
        sessionRef.current = s;
        setSession(s);
        AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
      } else if (m.t === 'state') {
        skews.current = [...skews.current.slice(-19), Date.now() - m.room.now];
        setSkew(Math.min(...skews.current));
        if (m.room.reveal?.length) prefetchCards(m.room.reveal);
        setRoom(m.room);
      } else if (m.t === 'error') {
        setError(m.message || 'Something went wrong');
        if (m.code === 'no_room' || m.code === 'kicked' || m.code === 'full' || m.code === 'in_progress') {
          clearReminders();
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
      const st = ws.current?.readyState;
      const stalled = st === WebSocket.CONNECTING && Date.now() - openedAt.current > 8_000;
      if ((st === WebSocket.OPEN && Date.now() - lastMsg.current > 12_000) || stalled) {
        setConnected(false);
        open();
      }
    }, 3000);
    return () => clearInterval(id);
  }, [open]);

  // finish any leave the server hasn't confirmed: on launch and whenever the app comes back
  useEffect(() => {
    const flush = () =>
      AsyncStorage.getItem(LEAVE_KEY)
        .then((raw) => raw && retryLeave(JSON.parse(raw) as Session))
        .catch(() => {});
    flush();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && flush());
    return () => sub.remove();
  }, []);

  // lock-screen reminders follow the room's real deadlines
  const me = session?.playerId;
  const foundMe = !!room?.players.find((p) => p.id === me)?.found;
  useEffect(() => {
    if (!room) return;
    if (room.phase === 'hunting' && room.endsAt != null) {
      const revealMs = room.revealMs ?? Math.min(20_000, 6_000 + 3_000 * room.players.length);
      remindRound(`${room.code}:${room.round}:${room.endsAt}`, room.endsAt + skew, room.bingo ? 'Finish your bingo card' : cap(room.prompt?.text),room.round, room.totalRounds, foundMe, revealMs);
    } else if (room.phase === 'reveal' && room.endsAt != null) {
      // the round may have ended early: re-aim the "next round" call-back at the real reveal end
      remindRound(`${room.code}:${room.round}:reveal:${room.endsAt}`, room.endsAt + skew, cap(room.prompt?.text), room.round, room.totalRounds, true, 0);
    } else if (room.phase === 'ended' || room.phase === 'lobby') clearReminders();
  }, [room?.phase, room?.endsAt, room?.round, room?.code, foundMe, skew]);

  // resume a saved squad on launch
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const s = JSON.parse(raw) as Session;
        sessionRef.current = s;
        setSession(s);
        want.current = true;
        initNotifications().catch(() => {});
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
      if (!first.solo) initNotifications().catch(() => {}); // squads only, and only when one starts
      setPendingSolo(!!first.solo);
      const opKey = JSON.stringify([first.t, first.code ?? '', first.team ?? '', first.solo ?? false]);
      if (!lastOp.current || lastOp.current.key !== opKey || Date.now() - lastOp.current.at > 9 * 60_000)
        lastOp.current = { key: opKey, op: Date.now().toString(36) + Math.random().toString(36).slice(2), at: Date.now() };
      pending.current = { ...first, device: await getDevice(), op: lastOp.current.op }; // the same op for a retry, so a lost welcome comes back instead of a duplicate
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
    clearReminders();
    const s = sessionRef.current;
    if (s) {
      AsyncStorage.setItem(LEAVE_KEY, JSON.stringify(s)).catch(() => {}); // kept until the server confirms
      retryLeave(s);
    }
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
      solo: (name, team) => start({ t: 'create', name, quick: true, solo: true, team }),
      join: (code, name) => start({ t: 'join', code: code.toUpperCase(), name }),
      send,
      leave,
      clearError: () => setError(null),
      pendingJoin,
      pendingSolo,
    }),
    [room, session, connected, error, skew, start, send, leave, pendingJoin, pendingSolo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
