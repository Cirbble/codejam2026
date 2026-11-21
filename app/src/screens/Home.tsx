import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { cap, Daily, fetchDaily, loadCachedDaily, MAX_TRIES, peekDaily } from '../api';
import { CardBack, GameCard, Wordmark } from '../components/GameCard';
import { Button, H, Label, Mono, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { useSquad } from '../squad';
import { C, F } from '../theme';

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

  return (
    <Screen>
      <View style={styles.top}>
        <Wordmark size={36} />
        <Button title="Cards" icon="layers" kind="line" onPress={() => nav.push({ name: 'collection' })} style={{ height: 44, paddingHorizontal: 14, borderRadius: 13 }} />
      </View>
      <Mono style={{ marginTop: 6 }}>{daily ? fmtDay(daily.day) : new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</Mono>

      <View style={{ flex: 1, justifyContent: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Today's prompts" onPress={() => daily && nav.push({ name: 'daily' })} style={[styles.stage, { flex: 1, justifyContent: 'center' }]}>
        {/* today's five, fanned like a hand of cards */}
        <View style={{ width: fanW, height: cw * 1.4 + 40, alignItems: 'center', justifyContent: 'center' }}>
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
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 22 }}>
          <H size={44} style={{ fontVariant: ['tabular-nums'] }}>
            {daily?.score ?? 0}
          </H>
          <T style={{ fontFamily: F.bodyBold, color: C.inkSoft }}>pts · {found} of {total} today</T>
        </View>
      </Pressable>

      <View style={{ gap: 12 }}>
        {failed && (
          <T style={{ textAlign: 'center', color: C.blaze, fontFamily: F.bodyBold }} onPress={reload}>
            Can't reach the server. Tap to retry.
          </T>
        )}
        {next ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Photograph ${next.text}`}
            onPress={() => {
              tap('medium');
              nav.push({ name: 'shoot', promptId: next.id, promptText: next.text, examples: next.examples, mode: 'daily' });
            }}
            style={({ pressed }) => [styles.next, pressed && { transform: [{ translateY: 3 }, { rotate: '-1deg' }] }]}
          >
            <View style={{ flex: 1, gap: 6 }}>
              <Label style={{ color: '#A9B1A2' }}>Next up</Label>
              <H size={28} style={{ color: C.paper }}>
                {cap(next.text)}
              </H>
            </View>
            <View style={styles.shoot}>
              <Feather name="camera" size={26} color={C.white} />
            </View>
          </Pressable>
        ) : !daily ? (
          <View style={styles.next} accessibilityLabel="Loading today's prompts">
            <View style={{ flex: 1, gap: 10 }}>
              <Label style={{ color: '#A9B1A2' }}>Next up</Label>
              <View style={{ height: 22, width: '70%', borderRadius: 6, backgroundColor: '#2A3025' }} />
            </View>
            <View style={[styles.shoot, { backgroundColor: '#2A3025', borderColor: '#2A3025' }]} />
          </View>
        ) : (
          <View style={[styles.next, { backgroundColor: C.card, borderWidth: 2, borderColor: C.ink }]}>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>{done ? 'All five found' : "That's today's hunt"}</Label>
              <H size={24}>New prompts at midnight</H>
            </View>
          </View>
        )}
      </View>
      </View>
      <View style={{ gap: 12, marginTop: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Quick play" icon="zap" kind="ink" onPress={() => nav.push({ name: 'solo' })} style={{ flex: 1.4, paddingHorizontal: 8 }} />
          <Button title="Squad" kind="line" onPress={() => nav.push({ name: 'squad' })} style={{ flex: 1, paddingHorizontal: 8 }} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stage: { alignItems: 'center', paddingBottom: 22 },
  next: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 22, backgroundColor: C.ink, transform: [{ rotate: '-1deg' }], boxShadow: `0px 5px 0px ${C.blaze}` },
  shoot: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.blaze, borderWidth: 2, borderColor: C.paper, alignItems: 'center', justifyContent: 'center' },
});
