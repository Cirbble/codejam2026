import React, { useCallback, useEffect, useState } from 'react';
import { Animated, AppState, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { cap, Daily, fetchCollection, fetchDaily, loadCachedDaily, MAX_TRIES, peekDaily } from '../api';
import { CardBack, GameCard, Wordmark } from '../components/GameCard';
import { Button, H, Label, Mono, ScorePill, Screen, T, tap } from '../components/ui';
import { Float, useReduceMotion } from '../components/Motion';
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
    fetchCollection().catch(() => {});
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

/** invite (?join=) and event (?solo=1) links open their screen once per app run, not on every return to Home */
const linkHandled: { solo: boolean; join: string | null } = { solo: false, join: null };

export default function Home() {
  const nav = useNav();
  const squad = useSquad();
  const { daily, failed, reload } = useDaily();
  useEffect(() => {
    // the event QR code opens Quick play straight away (?solo=1)
    const loc = (globalThis as any).location as Location | undefined;
    if (!linkHandled.solo && loc?.search && /[?&]solo=1/.test(loc.search)) {
      linkHandled.solo = true;
      try {
        (globalThis as any).history?.replaceState(null, '', loc.pathname); // consume it: Back must reach Home
      } catch {}
      nav.push({ name: 'solo' });
      return;
    }
    if (squad.pendingJoin && !squad.session && linkHandled.join !== squad.pendingJoin) {
      // once per app run: Home remounts every time it is back on top, and Back from Squad must stay on Home
      linkHandled.join = squad.pendingJoin;
      try {
        if (loc?.search && /[?&]join=/.test(loc.search)) (globalThis as any).history?.replaceState(null, '', loc.pathname);
      } catch {}
      nav.push({ name: 'squad' });
    }
  }, [squad.pendingJoin, squad.session, nav]);
  const { width } = useWindowDimensions();
  const fanW = Math.max(0, Math.min(width, 520) - 40); // web can report 0 for a frame
  // the hand fills the space it has: as tall as the stage allows, then the fan tightens so it still fits the width
  const [stageH, setStageH] = useState(0);
  const byHeight = stageH ? (stageH - 150) / 1.75 : 140;
  const cw = Math.max(80, Math.min(fanW * 0.44, 175, byHeight));
  const spread = Math.min(0.44, Math.max(0.2, (fanW - cw * 1.1) / (4 * cw)));
  // hover (web) or press-and-hold (touch) on a card lifts that one into focus
  const [focus, setFocus] = useState<number | null>(null);
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

      <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 12 }} onLayout={(e) => setStageH(e.nativeEvent.layout.height)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Today's prompts"
        onPress={() => daily && nav.push({ name: 'daily' })}
        style={styles.stage}
      >
        {/* today's five, fanned like a hand of cards */}
        <Float amp={4} period={4200} style={{ width: fanW, height: cw * 1.4 + 40, alignItems: 'center', justifyContent: 'center' }}>
          {Array.from({ length: total }).map((_, i) => {
            const p = daily?.prompts[i];
            const card = p ? daily?.cards[p.id] : undefined;
            const mid = (total - 1) / 2;
            const off = i - mid;
            return (
              <Deal key={i} index={i} total={total} off={off} cw={cw} step={cw * spread} focus={focus} setFocus={setFocus} onPress={() => daily && nav.push({ name: 'daily' })}>
                {card ? <GameCard card={card} width={cw} flat live={false} /> : <CardBack width={cw} />}
              </Deal>
            );
          })}
        </Float>
        <View style={{ marginTop: 22 }}>
          <ScorePill size="lg" score={daily?.score ?? 0} found={found} total={total} count chevron />
        </View>
      </Pressable>
      </View>

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
              <Label style={{ color: '#A9B1A2' }}>Daily · next up</Label>
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
              <Label style={{ color: '#A9B1A2' }}>Daily · next up</Label>
              <View style={{ height: 22, width: '70%', borderRadius: 6, backgroundColor: '#2A3025' }} />
            </View>
            <View style={[styles.shoot, { backgroundColor: '#2A3025', borderColor: '#2A3025' }]} />
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => nav.push({ name: 'daily' })} style={[styles.next, { backgroundColor: C.card, borderWidth: 2, borderColor: C.ink }]}>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>{done ? 'All five found' : `${found} found · ${total - found} missed`}</Label>
              <H size={24}>New prompts at midnight</H>
            </View>
            <Feather name="chevron-right" size={24} color={C.ink} />
          </Pressable>
        )}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
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

/**
 * One card of today's hand, dealt in from below with a little stagger. The first card sits on top of the stack.
 * Holding a card (touch) or hovering it (web) brings it into focus: it lifts, straightens, grows a little and comes to
 * the front, while its neighbours ease aside and dim.
 */
let dealt = false;
const FOCUS_SCALE = 1.14;
function Deal({ children, index, total, off, cw, step, focus, setFocus, onPress }: { children: React.ReactNode; index: number; total: number; off: number; cw: number; step: number; focus: number | null; setFocus: (i: number | null) => void; onPress: () => void }) {
  const reduce = useReduceMotion();
  const skip = reduce || dealt;
  const nd = Platform.OS !== 'web';
  const v = React.useRef(new Animated.Value(skip ? 1 : 0)).current;
  const f = React.useRef(new Animated.Value(0)).current; // this card in focus
  const push = React.useRef(new Animated.Value(0)).current; // sideways, away from the focused card
  const dim = React.useRef(new Animated.Value(0)).current; // a paper wash over the cards out of focus
  React.useEffect(() => {
    if (index === total - 1) setTimeout(() => (dealt = true), 900);
    if (skip) return v.setValue(1);
    Animated.spring(v, { toValue: 1, delay: 80 + index * 70, friction: 7, tension: 60, useNativeDriver: nd }).start();
  }, [v, index, total, skip, nd]);
  const mine = focus === index;
  const away = focus == null || mine ? 0 : Math.sign(index - focus) * cw * (Math.abs(index - focus) === 1 ? 0.22 : 0.12);
  React.useEffect(() => {
    const to = (val: Animated.Value, x: number) => (reduce ? val.setValue(x) : Animated.spring(val, { toValue: x, friction: 8, tension: 120, useNativeDriver: nd }).start());
    to(f, mine ? 1 : 0);
    to(push, away);
    to(dim, focus == null || mine ? 0 : 0.5);
  }, [mine, away, focus, reduce, f, push, dim, nd]);
  const tilt = off * 6;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        zIndex: mine ? 50 : total - index,
        opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
        transform: [
          { translateX: Animated.add(Animated.multiply(v, off * step), push) },
          { translateY: Animated.add(Animated.add(v.interpolate({ inputRange: [0, 1], outputRange: [cw * 0.9, 0] }), off * off * 5), f.interpolate({ inputRange: [0, 1], outputRange: [0, -cw * 0.16] })) },
          { rotate: Animated.multiply(Animated.multiply(v, f.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })), tilt).interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] }) },
          { scale: f.interpolate({ inputRange: [0, 1], outputRange: [1, FOCUS_SCALE] }) },
        ],
      }}
    >
      <Pressable
        accessible={false}
        onPress={onPress}
        onHoverIn={() => setFocus(index)}
        onHoverOut={() => setFocus(null)}
        onLongPress={() => {
          tap();
          setFocus(index);
        }}
        delayLongPress={260}
        onPressOut={() => Platform.OS !== 'web' && setFocus(null)}
        style={mine ? { boxShadow: '0px 14px 24px rgba(18,21,15,0.35)', borderRadius: 18 } : undefined}
      >
        {children}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: (20 * cw) / 300 + 2, backgroundColor: C.paper, opacity: dim }]} />
      </Pressable>
    </Animated.View>
  );
}
