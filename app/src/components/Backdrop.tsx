import React, { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C } from '../theme';
import { HOURS, LAND_TALL, LandLayer, LAYERS, SKY_COUNT, SkyLayer, TIER_DROP, Twinkle } from './Sky';

// Behind every screen: paper with faint topographic contours, like a hiking map.
// When you earn (or open) a card, the paper gives way to the mountain: the sky climbs through the tiers
// in step with the meter's flag and stops at the card's tier, then the paper comes back when you leave.

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function ring(cx: number, cy: number, r: number, wob: number[], steps = 56) {
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const k = 1 + wob[0] * Math.sin(2 * t + wob[1]) + wob[2] * Math.sin(3 * t + wob[3]) + wob[4] * Math.sin(5 * t + wob[5]);
    pts.push([cx + Math.cos(t) * r * k, cy + Math.sin(t) * r * k * 0.82]);
  }
  // smooth closed curve through midpoints
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % pts.length];
    const m = mid(p, n);
    d += i === 0 ? `M ${mid(pts[pts.length - 1], p).join(' ')} ` : '';
    d += `Q ${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)} `;
  }
  return d + 'Z';
}

const native = Platform.OS !== 'web';
const ease = Easing.bezier(0.45, 0.05, 0.25, 1);

/** 0..100 altitude. Each tier owns a band of 20: 20 Common, 40 Uncommon, 60 Rare, 80 Epic, 100 One of One. */
export const altitude = new Animated.Value(0);
/** 0 = paper, 1 = the mountain is showing */
const presence = new Animated.Value(0);

// dev only: /play/?sky=N pins scene N (0..4) so each scene can be reviewed on its own
let pinned = false;
if (__DEV__ && Platform.OS === 'web' && typeof window !== 'undefined') {
  const m = /[?&]sky=(\d)/.exec(window.location.search);
  if (m) {
    pinned = true;
    altitude.setValue((+m[1] + 1) * 20);
    presence.setValue(1);
  }
}

let shown = false;
/** the mountain at base camp: shown while a photo is being graded, so the reveal climbs from where you already stand */
export function showBase(duration = 360) {
  if (pinned) return;
  if (!shown) altitude.setValue(20);
  shown = true;
  if (duration <= 0) presence.setValue(1);
  else Animated.timing(presence, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: native }).start();
}
/** climb to an altitude in step with the meter's flag, starting from base camp */
export function climbTo(alt: number, duration = 1200) {
  if (pinned) return;
  if (!shown) {
    altitude.setValue(20);
    presence.setValue(1);
    shown = true;
  }
  Animated.timing(altitude, { toValue: alt, duration, easing: ease, useNativeDriver: native }).start();
}
/** back to the paper */
export function settle(duration = 320) {
  if (pinned) return;
  shown = false;
  altitude.stopAnimation();
  Animated.timing(presence, { toValue: 0, duration, easing: Easing.in(Easing.quad), useNativeDriver: native }).start(({ finished }) => {
    if (finished) altitude.setValue(0);
  });
}
/** 0 on paper and by day, 1 under the Epic and One of One night skies: text drawn on the sky cross-fades to its light version */
export const nightness = Animated.multiply(altitude.interpolate({ inputRange: [68, 74], outputRange: [0, 1], extrapolate: 'clamp' }), presence);

const LAYER_HINT = (Platform.OS === 'web' ? { willChange: 'transform' } : {}) as object;
const OVER = 0.16;
const BLEED = 24; // the contour map is drawn larger than the window so drifting never shows an edge

export default function Backdrop() {
  const win = useWindowDimensions();
  const width = Math.round(win.width * (1 + OVER * 2));
  const height = Math.round(win.height * (1 + OVER * 2));
  // a slow, endless drift: the map never sits perfectly still
  const drift = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current; // 0..1..0 every 14 s: rays swing, clouds drift
  const tw = useRef([0, 1, 2].map(() => new Animated.Value(0))).current; // star twinkle phases
  const motes = useRef(Array.from({ length: 16 }, () => new Animated.Value(0))).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (reduce) return;
        loop = Animated.parallel([
          Animated.loop(Animated.timing(drift, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: native })),
          Animated.loop(
            Animated.sequence([
              Animated.timing(sway, { toValue: 1, duration: 7000, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
              Animated.timing(sway, { toValue: 0, duration: 7000, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
            ]),
          ),
          ...tw.map((v, j) =>
            Animated.loop(
              Animated.sequence([
                Animated.delay(j * 700),
                Animated.timing(v, { toValue: 1, duration: 1300 + j * 400, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
                Animated.timing(v, { toValue: 0, duration: 1300 + j * 400, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
              ]),
            ),
          ),
          ...motes.map((v, j) =>
            Animated.loop(
              Animated.sequence([
                Animated.delay((j * 530) % 5000),
                Animated.timing(v, { toValue: 1, duration: 5200 + ((j * 977) % 3000), easing: Easing.linear, useNativeDriver: native }),
                Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: native }),
              ]),
            ),
          ),
        ]);
        loop.start();
      })
      .catch(() => {});
    return () => loop?.stop();
  }, [drift, sway, tw, motes]);
  const k = Array.from({ length: 9 }, (_, i) => i / 8);
  const dx = drift.interpolate({ inputRange: k, outputRange: k.map((t) => Math.sin(t * Math.PI * 2) * win.width * 0.05) });
  const dy = drift.interpolate({ inputRange: k, outputRange: k.map((t) => Math.sin(t * Math.PI * 4 + 1) * win.height * 0.025) });
  const rot = drift.interpolate({ inputRange: k, outputRange: k.map((t) => `${Math.sin(t * Math.PI * 2 + 2) * 1.2}deg`) });
  const paths = useMemo(() => {
    const rand = rng(20261121);
    const span = Math.max(width, height);
    const hills = [
      { x: 0.08, y: 0.18, n: 9 },
      { x: 0.92, y: 0.36, n: 11 },
      { x: 0.22, y: 0.88, n: 10 },
      { x: 0.78, y: 0.95, n: 7 },
    ];
    const out: { d: string; major: boolean }[] = [];
    for (const h of hills) {
      const wob = [0.05 + rand() * 0.05, rand() * 6, 0.04 + rand() * 0.04, rand() * 6, 0.02 + rand() * 0.02, rand() * 6];
      const gap = span * (0.028 + rand() * 0.01);
      for (let k = 1; k <= h.n; k++) {
        // the wobble drifts a little ring to ring, like real terrain
        const w = wob.map((v, i) => (i % 2 === 0 ? v * (1 + k * 0.04) : v + k * 0.05));
        out.push({ d: ring(h.x * width, h.y * height, gap * k, w), major: k % 4 === 0 });
      }
    }
    return out;
  }, [width, height]);
  const W = Math.round(win.width);
  const H = Math.round(win.height);
  // altitude -> camera height in tiers. Rest (0) starts a little below base camp so even a Common find rises;
  // Brillion goes well past the summit, leaving it and its flag far below.
  const IN = [0, 20, 40, 60, 80, 100];
  const CAM = [-0.8, -0.25, 1, 2, 3, 5.4];
  const drop = TIER_DROP * H;
  const PARALLAX: Record<number, number> = { 3: 0.8, 2: 1, 2.3: 1.05, 1: 1.25, 0: 1.5 };
  // per-layer nudges at each altitude stop (fractions of the window height), so the text under the card sits on calm ground
  const NUDGE: Record<number, number[]> = {
    2.3: [0, 0, 0, -0.115, 0, 0],
    2: [0, 0, 0, 0, 0.12, 0],
    1: [0, 0, 0, 0.14, 0, 0],
    0: [0, 0, -0.08, 0.14, 0, 0],
  };
  // on a phone the card covers the middle, so the summit also sits higher on the lower slopes to show its crown above the card
  const NUDGE_PHONE: Record<number, number[]> = { ...NUDGE, 3: [-0.1, -0.1, -0.09, -0.06, -0.08, 0.1] };
  // the skies are opaque and stack: each later hour fades in over the one before
  const skies = Array.from({ length: SKY_COUNT }, (_, i) =>
    i === 0 ? 1 : altitude.interpolate({ inputRange: [i * 20, (i + 1) * 20], outputRange: [0, 1], extrapolate: 'clamp' }),
  );
  // every land layer is part of one mountain: it sits higher (and hazier) the further above you it is,
  // and falls away below once you have climbed past it
  const lands = LAYERS.map((l) => ({
    // on a phone the card covers the middle, so on the lower slopes the summit sits higher to show its crown above the card
    ty: altitude.interpolate({ inputRange: IN, outputRange: CAM.map((c, j) => (c - l.k) * drop * PARALLAX[l.k] + ((W < 700 ? NUDGE_PHONE : NUDGE)[l.k]?.[j] ?? 0) * H) }),
    veil: l.veil ? altitude.interpolate({ inputRange: IN, outputRange: CAM.map((c) => Math.max(0, Math.min(0.8, (l.k - c) * 0.32))) }) : null,
  }));
  // the hour turns as you climb: dawn at base camp, day on the ridge and at the cloudline, dusk at the summit, night beyond.
  // Layers painted per hour stack their later lights over the earlier ones.
  const HOUR_IN: [number, number][] = [[0, 0], [25, 37], [65, 76], [84, 91]];
  const hours = Array.from({ length: HOURS }, (_, hI) =>
    hI === 0 ? 1 : altitude.interpolate({ inputRange: HOUR_IN[hI], outputRange: [0, 1], extrapolate: 'clamp' }),
  );
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.paper, overflow: 'hidden' }]}>
      <Animated.View style={{ position: 'absolute', left: -win.width * OVER, top: -win.height * OVER, width, height, opacity: 0.42, transform: [{ translateX: dx }, { translateY: dy }, { rotate: rot }] }}>
        <Svg width={width} height={height}>
          {paths.map((p, i) => (
            <Path key={i} d={p.d} fill="none" stroke={C.ink} strokeOpacity={p.major ? 0.11 : 0.06} strokeWidth={p.major ? 1.3 : 1} />
          ))}
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: presence }]}>
        {skies.map((op, i) => (
          <Animated.View key={`s${i}`} style={[StyleSheet.absoluteFill, LAYER_HINT, { opacity: op }]}>
            <SkyLayer i={i} w={W} h={H} />
            {i === SKY_COUNT - 1 &&
              tw.map((v, j) => (
                <Animated.View key={j} style={[StyleSheet.absoluteFill, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }]}>
                  <Twinkle group={j} w={W} h={H} />
                </Animated.View>
              ))}
          </Animated.View>
        ))}
        {lands.map((l, i) => (
          <Animated.View
            key={`l${i}`}
            style={{
              position: 'absolute',
              left: -BLEED,
              top: 0,
              width: W + BLEED * 2,
              height: H * LAND_TALL,
              ...LAYER_HINT,
              // the sea of cloud drifts slowly on the wind
              transform: [{ translateY: l.ty }, { translateX: LAYERS[i].k === 2.3 ? sway.interpolate({ inputRange: [0, 1], outputRange: [-16, 16] }) : 0 }],
            }}
          >
            {LAYERS[i].hours ? (
              hours.map((op, hI) => (
                <Animated.View key={hI} style={[StyleSheet.absoluteFill, { opacity: op }]}>
                  <LandLayer i={i} w={W + BLEED * 2} h={H} hour={hI} />
                </Animated.View>
              ))
            ) : (
              <LandLayer i={i} w={W + BLEED * 2} h={H} />
            )}
            {l.veil && (
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: l.veil }]}>
                <LandLayer i={i} w={W + BLEED * 2} h={H} veil />
              </Animated.View>
            )}
          </Animated.View>
        ))}
        {/* beyond the sky, motes of gold drift up past you */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: altitude.interpolate({ inputRange: [86, 96], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
          {motes.map((v, j) => {
            const x = ((j * 0.618034) % 1) * W;
            const s = 2 + (j % 3) * 1.5;
            return (
              <Animated.View
                key={j}
                style={{
                  position: 'absolute',
                  left: x,
                  top: 0,
                  width: s,
                  height: s,
                  borderRadius: s,
                  backgroundColor: j % 4 ? '#FFE3A0' : '#FFFFFF',
                  opacity: v.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 0.9, 0.7, 0] }),
                  transform: [
                    { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [H * (0.75 + (j % 5) * 0.05), H * (0.05 + (j % 4) * 0.08)] }) },
                    { translateX: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, (j % 2 ? 1 : -1) * 14, 0] }) },
                  ],
                }}
              />
            );
          })}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
