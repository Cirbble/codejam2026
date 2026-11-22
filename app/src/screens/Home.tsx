import React, { useCallback, useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { AppState, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { cap, Daily, fetchDaily, loadCachedDaily, MAX_TRIES, peekDaily } from '../api';
import { CardBack, GameCard, Wordmark } from '../components/GameCard';
import { Button, Caps, Glass, H, Label, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { useSquad } from '../squad';
import { altitude, C, F, isNight, zoneForPoints } from '../theme';

export function useDaily() {
  const [daily, setDaily] = useState<Daily | null>(peekDaily);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    fetchDaily()
      .then((d) => {
        setDaily(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    if (!peekDaily()) loadCachedDaily().then((d) => d && setDaily((cur) => cur ?? d));
    load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => sub.remove();
  }, [load]);
  // a new day's prompts arrive at midnight even if the screen stays open
  const resetsAt = daily?.resetsAt;
  useEffect(() => {
    if (!resetsAt) return;
    const t = setTimeout(load, Math.min(2 ** 31 - 1, Math.max(1000, resetsAt - Date.now() + 2000)));
    return () => clearTimeout(t);
  }, [resetsAt, load]);
  return { daily, failed, reload: load };
}

const fmtDay = (day: string) => {
  const d = new Date(day + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
};

export default function Home() {
  const nav = useNav();
  const squad = useSquad();
  const { daily, failed, reload } = useDaily();
  const opened = React.useRef(false);
  useEffect(() => {
    // the event QR code opens Quick play straight away (?solo=1)
    const loc = (globalThis as any).location as Location | undefined;
    if (!opened.current && loc?.search && /[?&]solo=1/.test(loc.search)) {
      opened.current = true;
      try {
        (globalThis as any).history?.replaceState(null, '', loc.pathname); // consume it: Back must reach Home
      } catch {}
      nav.push({ name: 'solo' });
      return;
    }
    if (squad.pendingJoin && !squad.session && !opened.current) {
      opened.current = true;
      nav.push({ name: 'squad' });
    }
  }, [squad.pendingJoin, squad.session, nav]);
  const { width } = useWindowDimensions();
  const fanW = Math.min(width, 520) - 40;
  const cw = Math.min(140, fanW * 0.31);
  const found = daily ? daily.prompts.filter((p) => daily.cards[p.id]).length : 0;
  const total = daily?.prompts.length ?? 5;
  const done = daily != null && found === total;
  const next = daily?.prompts.find((p) => !daily.cards[p.id] && (daily.tries[p.id] ?? 0) < MAX_TRIES);

  const zone = zoneForPoints(daily?.score ?? 0);
  const night = isNight(zone);
  const archW = Math.min(width, 520) - 40;
  const archH = cw * 1.4 + 170;

  return (
    <Screen zone={zone}>
      <View style={styles.top}>
        <Wordmark size={34} color={night ? C.white : C.ink} />
        <Button title="Cards" icon="layers" kind="line" onPress={() => nav.push({ name: 'collection' })} style={{ height: 44, paddingHorizontal: 16 }} />
      </View>
      <Label style={{ marginTop: 6, color: night ? '#E6E1FA' : '#2E3A66' }}>{daily ? fmtDay(daily.day) : new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</Label>

      <View style={{ flex: 1, justifyContent: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Today's prompts" onPress={() => daily && nav.push({ name: 'daily' })} style={[styles.stage, { flex: 1, justifyContent: 'center' }]}>
        {/* today's five, fanned like a hand of cards inside a cathedral window */}
        <View style={[styles.arch, { width: archW, height: archH, borderTopLeftRadius: archW / 2, borderTopRightRadius: archW / 2 }]}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { margin: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.75)', borderTopLeftRadius: archW / 2 - 8, borderTopRightRadius: archW / 2 - 8, borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }]} />
          <Caps style={{ marginTop: archW * 0.11, fontSize: 12 }}>Today's ascent</Caps>
          <View style={{ width: fanW, height: cw * 1.4 + 40, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
            {Array.from({ length: total }).map((_, i) => {
              const p = daily?.prompts[i];
              const card = p ? daily?.cards[p.id] : undefined;
              const mid = (total - 1) / 2;
              const off = i - mid;
              return (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    transform: [{ translateX: off * cw * 0.44 }, { translateY: off * off * 5 }, { rotate: `${off * 6}deg` }],
                    zIndex: card ? 10 + i : i,
                  }}
                >
                  {card ? <GameCard card={card} width={cw} flat live={false} /> : <CardBack width={cw} />}
                </View>
              );
            })}
          </View>
          <View style={styles.altitude}>
            <H size={40} style={{ fontVariant: ['tabular-nums'] }}>
              {altitude(daily?.score ?? 0)}
            </H>
            <T style={{ fontFamily: F.bodyBold, color: C.ink, fontSize: 14 }}>Today {found}/{total}</T>
            <Feather name="chevron-right" size={18} color={C.inkSoft} style={{ alignSelf: 'center' }} />
          </View>
        </View>
      </Pressable>

      <View style={{ gap: 12 }}>
        {failed && (
          <Glass style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
            <T style={{ textAlign: 'center', color: C.blaze, fontFamily: F.bodyBold }} onPress={reload}>
              Can't reach the server. Tap to retry.
            </T>
          </Glass>
        )}
        {next ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Photograph ${next.text}`}
            onPress={() => {
              tap('medium');
              nav.push({ name: 'shoot', promptId: next.id, promptText: next.text, examples: next.examples, mode: 'daily' });
            }}
            style={({ pressed }) => [styles.next, pressed && { transform: [{ translateY: 3 }] }]}
          >
            <LinearGradient colors={['#141A4A', '#1A2140', '#2A2470']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} />
            <View style={{ flex: 1, gap: 6 }}>
              <Label style={{ color: C.goldPale }}>Daily · next up</Label>
              <H size={30} style={{ color: C.white }}>
                {cap(next.text)}
              </H>
            </View>
            <View style={styles.shoot}>
              <LinearGradient colors={['#FFE9A8', '#D9A53C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 30 }]} />
              <Feather name="camera" size={26} color={C.ink} />
            </View>
          </Pressable>
        ) : !daily ? (
          <View style={[styles.next, { backgroundColor: C.ink }]} accessibilityLabel="Loading today's prompts">
            <View style={{ flex: 1, gap: 10 }}>
              <Label style={{ color: C.goldPale }}>Daily · next up</Label>
              <View style={{ height: 22, width: '70%', borderRadius: 6, backgroundColor: '#2A3060' }} />
            </View>
            <View style={[styles.shoot, { backgroundColor: '#2A3060', borderColor: '#2A3060' }]} />
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => nav.push({ name: 'daily' })} style={[styles.next, { backgroundColor: C.glass, borderColor: 'rgba(255,255,255,0.95)', boxShadow: '0px 12px 30px rgba(20,30,70,0.16)' }]}>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>{done ? 'All five found' : `${found} found · ${total - found} missed`}</Label>
              <H size={26}>New climb at midnight</H>
            </View>
            <Feather name="chevron-right" size={24} color={C.ink} />
          </Pressable>
        )}
      </View>
      </View>
      <View style={{ gap: 12, marginTop: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Quick play" icon="zap" kind="line" onPress={() => nav.push({ name: 'solo' })} style={{ flex: 1.4, paddingHorizontal: 8 }} />
          <Button title="Squad" icon="users" kind="line" onPress={() => nav.push({ name: 'squad' })} style={{ flex: 1, paddingHorizontal: 8 }} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stage: { alignItems: 'center', paddingBottom: 18 },
  arch: { alignItems: 'center', borderWidth: 1, borderColor: 'rgba(232,200,114,0.95)', borderBottomLeftRadius: 26, borderBottomRightRadius: 26, backgroundColor: 'rgba(255,255,255,0.3)', boxShadow: '0px 30px 60px rgba(20,30,70,0.2)' },
  altitude: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 10, paddingVertical: 6, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(232,200,114,0.95)', backgroundColor: 'rgba(255,255,255,0.9)', boxShadow: '0px 8px 24px rgba(20,30,70,0.2)' },
  next: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(232,200,114,0.45)', boxShadow: '0px 5px 0px #B8892A' },
  shoot: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: '#FFF6DA', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0px 0px 24px rgba(255,214,120,0.6)' },
});
