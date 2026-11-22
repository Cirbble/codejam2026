import React, { useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { crowdShown, type Card } from '../api';
import { C, F, TIERS, type Tier } from '../theme';
import { climbTo, nightness, settle, showBase } from './Backdrop';

const day = nightness.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
import { useReduceMotion } from './Motion';

// Rarity as altitude. The five tiers are the slopes of one ridge, from Common foothills to the One of One summit.
// On reveal a flag climbs the ridge to this card's rarity, the slope colours in behind it, the score counts up, and
// the whole contour map behind the app zooms in as if you were gaining height. One of One plants the flag on the peak.
const BANDS: { tier: Tier; lo: number; hi: number; w: number }[] = [
  { tier: 'common', lo: 0, hi: 38, w: 30 },
  { tier: 'uncommon', lo: 38, hi: 62, w: 24 },
  { tier: 'rare', lo: 62, hi: 78, w: 19 },
  { tier: 'epic', lo: 78, hi: 84, w: 15 },
  { tier: 'one', lo: 84, hi: 100, w: 12 },
];
const H = 96; // drawing height
const PAD = 18; // room for the flag at the summit
const SAMPLES = 28;

type MeterCard = Pick<Card, 'tier' | 'rarity' | 'sameCount' | 'totalCount' | 'solo'>;

/** ridge height (0 = foot, 1 = summit) at u in [0, 1]: a steepening climb with a few shoulders */
const ridge = (u: number) => Math.min(1, 0.1 + 0.9 * Math.pow(u, 1.7) + 0.035 * Math.sin(u * 19) * (1 - u));

function geometry(card: MeterCard, width: number) {
  const W = width - PAD;
  const total = BANDS.reduce((a, b) => a + b.w, 0);
  const X = (u: number) => u * W;
  const Y = (u: number) => H - 3 - ridge(u) * (H - 36);
  let acc = 0;
  let target = 0;
  const bands = BANDS.map((b) => {
    const u0 = acc / total;
    acc += b.w;
    const u1 = acc / total;
    if (b.tier === card.tier) target = b.tier === 'one' ? 1 : (u0 + u1) / 2;
    // area under the ridge for this band
    let d = `M ${X(u0).toFixed(1)} ${H} `;
    for (let i = 0; i <= 12; i++) {
      const u = u0 + ((u1 - u0) * i) / 12;
      d += `L ${X(u).toFixed(1)} ${Y(u).toFixed(1)} `;
    }
    d += `L ${X(u1).toFixed(1)} ${H} Z`;
    return { ...b, d };
  });
  let line = '';
  for (let i = 0; i <= 80; i++) line += `${i ? 'L' : 'M'} ${X(i / 80).toFixed(1)} ${Y(i / 80).toFixed(1)} `;
  // the flag follows the ridge: sampled path for interpolation
  const input: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const k = i / SAMPLES;
    input.push(k);
    xs.push(X(target * k));
    ys.push(Y(target * k));
  }
  return { W, bands, line, target, input, xs, ys, endX: X(target) };
}

/** a soft pool of quiet sky behind the result: paper by day, deep night blue under the night skies, so the meter never competes with the mountains */
function Pool({ width }: { width: number }) {
  const w = width + 140;
  const h = H + 24 + 64;
  const pool = (id: string, color: string, op: number) => (
    <Svg width={w} height={h}>
      <Defs>
        <RadialGradient id={id} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
          <Stop offset="0" stopColor={color} stopOpacity={op} />
          <Stop offset="0.6" stopColor={color} stopOpacity={op * 0.75} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={w} height={h} fill={`url(#${id})`} />
    </Svg>
  );
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: -70, top: -24, width: w, height: h }}>
      <Animated.View style={{ position: 'absolute', opacity: day }}>{pool('poolDay', C.paper, 0.72)}</Animated.View>
      <Animated.View style={{ position: 'absolute', opacity: nightness }}>{pool('poolNight', '#151332', 0.55)}</Animated.View>
    </View>
  );
}

export function RarityMeter({ card, width, delay = 0, animate = true, climb = false, quick = false }: { card: MeterCard; width: number; delay?: number; animate?: boolean; climb?: boolean; quick?: boolean }) {
  const reduce = useReduceMotion();
  const still = reduce || !animate;
  const g = useMemo(() => geometry(card, width), [card.tier, card.rarity, width]);
  const p = useRef(new Animated.Value(still ? 1 : 0)).current; // 0..1 of the climb
  const plant = useRef(new Animated.Value(still ? 1 : 0)).current;
  const appear = useRef(new Animated.Value(still ? 1 : 0)).current;

  useEffect(() => {
    if (still) {
      p.setValue(1);
      plant.setValue(1);
      appear.setValue(1);
      // reduced motion still shows the tier's sky, just without the climb
      if (climb) climbTo((TIERS[card.tier].rank + 1) * 20, 0);
      return;
    }
    const rank = TIERS[card.tier].rank; // 0 (Common) .. 4 (One of One)
    // the higher the tier, the longer the climb; reopening a card you already own climbs faster than earning it
    const dur = quick ? 600 + rank * 130 : 800 + rank * 260;
    const t = setTimeout(() => climb && climbTo((rank + 1) * 20, dur), delay);
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(appear, { toValue: 1, duration: 220, useNativeDriver: false }),
        Animated.timing(p, { toValue: 1, duration: dur, easing: Easing.bezier(0.45, 0.05, 0.25, 1), useNativeDriver: false }),
      ]),
      Animated.spring(plant, { toValue: 1, friction: 4, tension: 170, useNativeDriver: false }),
    ]);
    anim.start();
    return () => {
      anim.stop();
      clearTimeout(t);
    };
  }, [still, card.tier, delay, climb, quick, p, plant, appear]);

  // the mountain is up before the screen's first frame paints, so the card never opens on paper
  useLayoutEffect(() => {
    if (climb) showBase(0);
  }, [climb]);
  useEffect(() => () => (climb ? settle() : undefined), [climb]);

  const fillW = p.interpolate({ inputRange: [0, 1], outputRange: [0, g.endX + 1] });
  const fx = p.interpolate({ inputRange: g.input, outputRange: g.xs });
  const fy = p.interpolate({ inputRange: g.input, outputRange: g.ys });
  const crowd = crowdShown(card) ? (card.sameCount <= 1 ? `Only find of ${card.totalCount}` : `${card.sameCount} of ${card.totalCount} found this`) : null;
  const t = TIERS[card.tier];
  return (
    <Animated.View style={{ width, gap: 6, opacity: appear }} accessibilityLabel={`Rarity ${card.rarity} of 100${crowd ? ', ' + crowd : ''}`}>
      <View style={{ width, height: H }}>
        {/* the ridge, pale */}
        <Svg width={width} height={H} style={{ position: 'absolute' }}>
          {g.bands.map((b) => (
            <Path key={b.tier} d={b.d} fill={TIERS[b.tier].frame} />
          ))}
        </Svg>
        {/* colour fills in behind the climber */}
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, height: H, width: fillW, overflow: 'hidden' }}>
          <Svg width={width} height={H}>
            {g.bands.map((b) => (
              <Path key={b.tier} d={b.d} fill={TIERS[b.tier].color} opacity={b.tier === card.tier ? 1 : 0.5} />
            ))}
          </Svg>
        </Animated.View>
        {/* the earned band, whole, once the flag lands */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, opacity: plant.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) }}>
          <Svg width={width} height={H}>
            {g.bands
              .filter((b) => b.tier === card.tier)
              .map((b) => (
                <Path key={b.tier} d={b.d} fill={TIERS[b.tier].color} />
              ))}
          </Svg>
        </Animated.View>
        {/* ridge line */}
        {(climb ? [C.ink, C.paper] : [C.ink]).map((col, i) => (
          <Animated.View key={col} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, opacity: climb ? (i ? nightness : day) : 1 }}>
            <Svg width={width} height={H}>
              <Path d={g.line} fill="none" stroke={col} strokeWidth={2.5} strokeLinejoin="round" />
            </Svg>
          </Animated.View>
        ))}
        {/* the flag */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -1,
            top: -33,
            width: 20,
            height: 35,
            transform: [{ translateX: fx }, { translateY: fy }, { scale: plant.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.35, 1] }) }],
          }}
        >
          <View style={{ position: 'absolute', left: 0, top: 0, width: 3, height: 35, borderRadius: 1.5, backgroundColor: C.ink }} />
          {climb && <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: 3, height: 35, borderRadius: 1.5, backgroundColor: C.paper, opacity: nightness }} />}
          <View style={{ position: 'absolute', left: 3, top: 1, width: 0, height: 0, borderTopWidth: 8, borderBottomWidth: 8, borderLeftWidth: 17, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: t.color }} />
        </Animated.View>
      </View>
      {crowd && <SkyText style={{ textAlign: 'center', fontFamily: F.mono, fontSize: 14 }} on={climb}>{crowd}</SkyText>}
    </Animated.View>
  );
}

/** text that sits straight on the sky: ink by day, cross-fading to paper under the night skies when `on` */
export function SkyText({ children, style, on = true, dayColor = C.ink, nightColor = "#FFF9F0" }: { children: React.ReactNode; style?: object; on?: boolean; dayColor?: string; nightColor?: string }) {
  if (!on) return <Text numberOfLines={1} style={[style, { color: dayColor }]}>{children}</Text>;
  return (
    <View>
      <Animated.Text numberOfLines={1} style={[style, { color: dayColor, opacity: day }]}>{children}</Animated.Text>
      <Animated.Text numberOfLines={1} style={[style, { color: nightColor, opacity: nightness, textShadowColor: "rgba(12,10,40,0.9)", textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 }, position: "absolute", left: 0, right: 0, top: 0 }]}>{children}</Animated.Text>
    </View>
  );
}
