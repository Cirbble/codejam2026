import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';
import type { Card } from './api';

export type Route =
  | { name: 'home' }
  | { name: 'daily' }
  | { name: 'shoot'; promptId: string; promptText: string; examples?: string; mode: 'daily' | 'squad' }
  | { name: 'collection' }
  | { name: 'card'; card: Card }
  | { name: 'squad' };

type Nav = { route: Route; push: (r: Route) => void; back: () => void; reset: (r?: Route) => void; depth: number };
const Ctx = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(Ctx);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
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
