import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { DEMO_ORIGIN } from '../config';
import { useGame } from './GameProvider';

export type Fix = { lat: number; lng: number; acc: number; at: number; heading: number | null };

type Ctx = {
  fix: Fix | null;
  permission: 'unknown' | 'granted' | 'denied';
  demo: boolean;
  setDemo: (on: boolean) => void;
  /** joystick velocity in m/s, east/north */
  setVelocity: (vx: number, vy: number) => void;
  requestPermission: () => Promise<boolean>;
  /** location services failed even though permission is granted */
  locError: boolean;
  retry: () => void;
};

const LocCtx = createContext<Ctx | null>(null);
const R = 6371000;
const deg = (r: number) => (r * 180) / Math.PI;

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { send, session, room } = useGame();
  // Only share location while a game is being set up or played
  const live = !!session && (!room || room.phase !== 'ended');
  const liveRef = useRef(live);
  liveRef.current = live;
  const [fix, setFix] = useState<Fix | null>(null);
  const [permission, setPermission] = useState<Ctx['permission']>('unknown');
  const [demo, setDemoState] = useState(false);
  const [locError, setLocError] = useState(false);
  const [watchKey, setWatchKey] = useState(0);
  const vel = useRef({ x: 0, y: 0 });
  const simPos = useRef<{ lat: number; lng: number } | null>(null);
  const lastSent = useRef(0);
  const fixRef = useRef<Fix | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const push = useCallback(
    (f: Fix, sim: boolean) => {
      fixRef.current = f;
      setFix(f);
      const now = Date.now();
      if (sessionRef.current && liveRef.current && now - lastSent.current > 900) {
        lastSent.current = now;
        send({ t: 'pos', lat: f.lat, lng: f.lng, acc: f.acc, sim, age: Math.max(0, now - f.at) });
      }
    },
    [send],
  );

  const requestPermission = useCallback(async () => {
    try {
      const r = await Location.requestForegroundPermissionsAsync();
      const ok = r.status === 'granted';
      setPermission(ok ? 'granted' : 'denied');
      return ok;
    } catch {
      setPermission('denied');
      return false;
    }
  }, []);

  // Demo mode and the simulated position survive an app relaunch (a restored session resumes where it was)
  useEffect(() => {
    AsyncStorage.getItem('squall.demo').then((v) => {
      if (!v) return;
      try {
        const d = JSON.parse(v);
        if (d.on) {
          simPos.current = d.pos ?? { ...DEMO_ORIGIN };
          setDemoState(true);
        }
      } catch {}
    });
  }, []);
  useEffect(() => {
    if (!demo) return;
    const id = setInterval(() => AsyncStorage.setItem('squall.demo', JSON.stringify({ on: true, pos: simPos.current })), 3000);
    return () => clearInterval(id);
  }, [demo]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setWatchKey((k) => k + 1); // restart the watcher after the app was backgrounded
      if (st === 'active')
        Location.getForegroundPermissionsAsync()
          .then((r) => setPermission(r.status === 'granted' ? 'granted' : r.canAskAgain ? 'unknown' : 'denied'))
          .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((r) => setPermission(r.status === 'granted' ? 'granted' : r.canAskAgain ? 'unknown' : 'denied'))
      .catch(() => {});
  }, []);

  // Real GPS
  useEffect(() => {
    if (demo || permission !== 'granted' || !live) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (l) => {
        setLocError(false);
        push({ lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy ?? 30, at: l.timestamp, heading: l.coords.heading ?? null }, false);
      },
      () => setLocError(true),
    )
      .then((s) => (cancelled ? s.remove() : (sub = s)))
      .catch(() => setLocError(true));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [demo, permission, push, live, watchKey]);

  // Simulated movement (demo mode): integrate joystick velocity at 5 Hz, send at ~1 Hz
  useEffect(() => {
    if (!demo) return;
    if (!simPos.current) simPos.current = fixRef.current ? { lat: fixRef.current.lat, lng: fixRef.current.lng } : { ...DEMO_ORIGIN };
    const id = setInterval(() => {
      const p = simPos.current!;
      const dt = 0.2;
      const { x, y } = vel.current;
      p.lat += deg((y * dt) / R);
      p.lng += deg((x * dt) / (R * Math.cos((p.lat * Math.PI) / 180)));
      push({ lat: p.lat, lng: p.lng, acc: 5, at: Date.now(), heading: null }, true);
    }, 200);
    return () => clearInterval(id);
  }, [demo, push]);

  // Send our last fix (with its true age) as soon as we join a room, so the lobby knows where we are
  const sessionKey = session ? `${session.code}:${session.playerId}` : '';
  useEffect(() => {
    if (sessionKey && fixRef.current) {
      lastSent.current = 0;
      push(fixRef.current, demo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const setDemo = useCallback((on: boolean) => {
    // Everyone in demo mode starts near the same spot (a few metres apart), so squads overlap on the map
    if (on) simPos.current = { lat: DEMO_ORIGIN.lat + (Math.random() - 0.5) * 0.00012, lng: DEMO_ORIGIN.lng + (Math.random() - 0.5) * 0.00016 };
    AsyncStorage.setItem('squall.demo', JSON.stringify({ on, pos: on ? simPos.current : null }));
    vel.current = { x: 0, y: 0 };
    if (!on) {
      fixRef.current = null; // never let a simulated fix stand in for real GPS
      setFix(null);
    }
    setDemoState(on);
  }, []);

  const setVelocity = useCallback((x: number, y: number) => {
    vel.current = { x, y };
  }, []);

  return (
    <LocCtx.Provider value={{ fix, permission: Platform.OS === 'web' && demo ? 'granted' : permission, demo, setDemo, setVelocity, requestPermission, locError, retry: () => setWatchKey((k) => k + 1) }}>
      {children}
    </LocCtx.Provider>
  );
}

export function useLoc() {
  const c = useContext(LocCtx);
  if (!c) throw new Error('useLoc outside LocationProvider');
  return c;
}
