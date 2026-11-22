import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { C, F } from '../theme';

const AVATAR = ['#2F7350', '#2F62C8', '#6340C0', '#B8295E', '#8A6A55', '#0E7C86', '#8C6310', '#1A2140'];
const colorFor = (id: string) => AVATAR[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];

/** Server-time clock, ticking 4 times a second. */
export function useClock(skew: number) {
  const [now, setNow] = useState(Date.now() - skew);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() - skew), 250);
    return () => clearInterval(id);
  }, [skew]);
  return now;
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colorFor(id), borderWidth: 2, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.display, color: C.white, fontSize: size * 0.45 }}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}
