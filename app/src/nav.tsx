import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import type { Card } from './api';

export type Route =
  | { name: 'home' }
  | { name: 'daily' }
  | { name: 'shoot'; promptId: string; promptText: string; examples?: string; mode: 'daily' | 'squad' }
  | { name: 'collection' }
  | { name: 'card'; card: Card }
  | { name: 'squad' }
  | { name: 'solo' }
  | { name: 'board' };

type Nav = { route: Route; push: (r: Route) => void; back: () => void; reset: (r?: Route) => void; depth: number };
const Ctx = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(Ctx);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  // web: every screen is a browser history entry, so the browser's Back (or a swipe back) goes back one screen
  // instead of leaving the app; the app's own back buttons go through history too, so the two never drift apart
  const web = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.history;
  const push = useCallback(
    (r: Route) => {
      setStack((s) => [...s, r]);
      if (web) window.history.pushState({ brillion: true }, '');
    },
    [web],
  );
  const back = useCallback(() => {
    if (web && window.history.state?.brillion) window.history.back();
    else pop();
  }, [web, pop]);
  useEffect(() => {
    if (!web) return;
    const onPop = () => pop();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [web, pop]);
  const reset = useCallback((r: Route = { name: 'home' }) => setStack(r.name === 'home' ? [r] : [{ name: 'home' }, r]), []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, back]);
  const value = useMemo(() => ({ route: stack[stack.length - 1], push, back, reset, depth: stack.length }), [stack, push, back, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
