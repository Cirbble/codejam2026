import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useId, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Card, photoUrl } from '../api';
import { C, F, HOLO, Tier, TIERS } from '../theme';

// Cards are drawn on a 300 × 420 board and scaled. The arch over the photo climbs in architecture
// as it climbs in rarity: a roped stone arch, a pine lancet, a cloud trefoil, a crowned summit arch,
// and a gilded cathedral arch with a rose window.

const RATIO = 1.4;
const native = Platform.OS !== 'web';
// ornaments reach above and beside the 300 × 420 board, so the drawing gets a margin
const PAD_X = 24;
const PAD_TOP = 30;
const VB = `${-PAD_X} ${-PAD_TOP} ${300 + PAD_X * 2} ${420 + PAD_TOP}`;

type Look = 'back' | Tier;
const BASE = 'L300 402 Q300 420 282 420 L18 420 Q0 420 0 402 Z';
const ROUND = 'M0 150 A150 150 0 0 1 300 150 ' + BASE;
const ROUND_WIN = 'M22 150 A128 128 0 0 1 278 150 L278 272 L22 272 Z';

const LOOK: Record<Look, { outer: string; win: string; g1: string; g2: string; rim: string; ribbon: string; plate: string; ink: string }> = {
  common: { outer: ROUND, win: ROUND_WIN, g1: '#D2AE90', g2: '#7A5A45', rim: '#5A3F2E', ribbon: '#8A6A55', plate: '#FFFDF9', ink: '#8A6A55' },
  uncommon: { outer: 'M0 196 Q0 72 150 0 Q300 72 300 196 ' + BASE, win: 'M22 200 Q24 96 150 30 Q276 96 278 200 L278 272 L22 272 Z', g1: '#86CDA0', g2: '#245C40', rim: '#1C4A33', ribbon: '#2F7350', plate: '#FBFFFC', ink: '#2F7350' },
  rare: { outer: 'M0 165 A150 150 0 0 1 300 165 ' + BASE, win: 'M22 272 L22 178 A52 52 0 0 1 78 121 A72 72 0 0 1 222 121 A52 52 0 0 1 278 178 L278 272 Z', g1: '#EAF2FF', g2: '#6E95E2', rim: '#3E66B8', ribbon: '#2F62C8', plate: '#FBFDFF', ink: '#2F62C8' },
  epic: { outer: 'M0 205 Q0 85 150 14 Q300 85 300 205 ' + BASE, win: 'M22 208 Q26 108 150 44 Q274 108 278 208 L278 272 L22 272 Z', g1: '#D4BEFB', g2: '#4A3096', rim: '#2E1E6E', ribbon: '#6340C0', plate: '#FDFBFF', ink: '#6340C0' },
  one: { outer: 'M0 160 A150 150 0 0 1 300 160 ' + BASE, win: 'M22 166 A128 128 0 0 1 278 166 L278 272 L22 272 Z', g1: '#FFF4D2', g2: '#C08F2C', rim: '#8C6310', ribbon: '#8C6310', plate: '#FFFDF6', ink: '#8C6310' },
  back: { outer: ROUND, win: ROUND_WIN, g1: '#2A2F7A', g2: '#0E1240', rim: '#B8892A', ribbon: '#8C6310', plate: '#141A4A', ink: '#E8C872' },
};

/** Five-point star with straight sides, centred on (50, 52) in a 100 × 100 box. */
export const STAR5 = 'M50 6 L61.17 36.63 L93.75 37.79 L68.07 57.87 L77.04 89.21 L50 71 L22.96 89.21 L31.93 57.87 L6.25 37.79 L38.83 36.63 Z';
// the peak constellation: stars joined into a mountain outline, the brightest one at the summit
const PEAK_LINE = 'M10 80 L28 54 L40 64 L56 22 L72 46 L90 80';
const PEAK_DOTS: [number, number, number][] = [[10, 80, 3.2], [28, 54, 4], [40, 64, 3], [72, 46, 4], [90, 80, 3.2]];

/** The Brillion mark: the peak constellation. `small` uses heavier lines and dots so it stays readable next to the wordmark. */
function Gem({ ink, small, transform }: { ink?: boolean; small?: boolean; transform?: string }) {
  const gold = ink ? C.ink : small ? '#B8892A' : '#E8C872';
  const star = ink ? C.ink : small ? '#F3C863' : '#FFE08A';
  const edge = ink ? C.white : '#8C6310';
  const k = small ? 1.75 : 1; // dot size
  return (
    <G transform={transform}>
      <Path d={PEAK_LINE} fill="none" stroke={gold} strokeWidth={small ? 3 : 1.4} strokeLinejoin="round" strokeLinecap="round" opacity={small ? 1 : 0.85} />
      {!small && <Path d="M40 64 L72 46" fill="none" stroke={gold} strokeWidth={1} strokeDasharray="1.5 3" opacity={0.6} />}
      {!small && <Circle cx={56} cy={22} r={13} fill="#FFE08A" opacity={0.2} />}
      {PEAK_DOTS.map(([x, y, r], i) => (
        <Circle key={i} cx={x} cy={y} r={r * k} fill={small ? gold : '#FFE08A'} stroke={small ? undefined : edge} strokeWidth={0.8} />
      ))}
      <Path d={STAR5} fill={star} stroke={edge} strokeWidth={small ? 8 : 5} strokeLinejoin="round" transform={`translate(56 22) scale(${small ? 0.3 : 0.2}) translate(-50 -52)`} />
    </G>
  );
}

function Ornaments({ look, uid }: { look: Look; uid: string }) {
  switch (look) {
    case 'common':
      return (
        <G>
          <Path d="M6 230 Q10 300 6 380 M294 210 Q290 290 294 370 M18 200 Q22 260 18 300" fill="none" stroke="rgba(60,40,30,0.28)" strokeWidth={1.2} />
          <Path d="M11 402 L11 150 A139 139 0 0 1 289 150 L289 402" fill="none" stroke="#EAD3B0" strokeWidth={6} />
          <Path d="M11 402 L11 150 A139 139 0 0 1 289 150 L289 402" fill="none" stroke="#6E5240" strokeWidth={6} strokeDasharray="3 5" />
          <Path d="M136 0 L164 0 L159 22 L141 22 Z" fill="#E8D2C2" stroke="#5A3F2E" strokeWidth={1.5} />
          <Path d="M144 6 L156 6" stroke="#5A3F2E" strokeWidth={1} />
        </G>
      );
    case 'uncommon':
      return (
        <G>
          <Path d="M11 214 l-8 16 h16 z M11 224 l-9 18 h18 z M11 236 l-10 20 h20 z M289 214 l-8 16 h16 z M289 224 l-9 18 h18 z M289 236 l-10 20 h20 z" fill="#163E2A" />
          <Rect x={10} y={256} width={2} height={8} fill="#163E2A" />
          <Rect x={288} y={256} width={2} height={8} fill="#163E2A" />
          <Path d="M136 14 L150 0 L164 14 Z" fill="#FFFFFF" stroke="#1C4A33" strokeWidth={1.5} />
          <Path d="M30 110 Q60 52 150 10 Q240 52 270 110" fill="none" stroke="#BFE3C8" strokeWidth={1.2} strokeDasharray="1 6" strokeLinecap="round" />
        </G>
      );
    case 'rare': {
      const puffs: [number, number, number][] = [[20, 118, 20], [46, 63, 26], [99, 28, 30], [150, 19, 34], [201, 28, 30], [254, 63, 26], [280, 118, 20], [14, 254, 14], [286, 254, 14], [16, 404, 16], [284, 404, 16]]; // kept inside the card's edges so scroll views don't clip them
      return (
        <G>
          {puffs.map(([x, y, r], i) => (
            <Circle key={`s${i}`} cx={x} cy={y} r={r} fill="#BCD1F6" />
          ))}
          {puffs.map(([x, y, r], i) => (
            <Circle key={`w${i}`} cx={x} cy={y - 4} r={r} fill="#FFFFFF" />
          ))}
          <Path d="M118 12 Q150 -6 182 12" fill="none" stroke="#9DBBF0" strokeWidth={1.5} strokeLinecap="round" />
        </G>
      );
    }
    case 'epic':
      return (
        <G>
          <Path d="M80 80 L110 44 L124 58 L150 -6 L176 58 L190 44 L220 80 Z" fill="#5A3FB0" stroke="#2E1E6E" strokeWidth={1.5} strokeLinejoin="round" />
          <Path d="M150 -6 L162 22 L155 18 L150 27 L145 18 L138 22 Z M110 44 L117 53 L110 51 L104 54 Z M190 44 L196 54 L190 51 L183 53 Z" fill="#FFFFFF" />
          <G stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round">
            <Path d="M11 232 v16 M4 236 l14 8 M4 244 l14 -8 M289 232 v16 M282 236 l14 8 M282 244 l14 -8" />
            <Path d="M11 320 v10 M6.5 322.5 l9 5 M6.5 327.5 l9 -5 M289 320 v10 M284.5 322.5 l9 5 M284.5 327.5 l9 -5" />
          </G>
        </G>
      );
    case 'one': {
      const beads: [number, number][] = [[15.7, 124], [29.6, 90.5], [51.7, 61.7], [80.5, 39.6], [114, 25.7], [186, 25.7], [219.5, 39.6], [248.3, 61.7], [270.4, 90.5], [284.3, 124], [11, 270], [11, 310], [11, 350], [11, 390], [289, 270], [289, 310], [289, 350], [289, 390]];
      const panes = ['#E0457B', '#7DEAFF', '#C2A8FF', '#FFE08A'];
      return (
        <G>
          <Path d={`${LOOK.one.outer} ${LOOK.one.win}`} fillRule="evenodd" fill={`url(#holo${uid})`} opacity={0.35} />
          <Path d="M11 410 L11 162 A139 139 0 0 1 289 162 L289 410" fill="none" stroke="#FFF8E1" strokeWidth={1.6} />
          {beads.map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={3} fill="#FFFDF4" stroke="#B8892A" strokeWidth={0.8} />
          ))}
          {[11, 289].map((x, i) => (
            <G key={x} transform={`translate(${x} 222)`}>
              <Circle r={9} fill="#FFF4D2" stroke="#8C6310" strokeWidth={1} />
              <Path d="M0 -9 V9 M-9 0 H9 M-6.4 -6.4 L6.4 6.4 M-6.4 6.4 L6.4 -6.4" stroke="#B8892A" strokeWidth={0.9} />
              <Circle r={2.5} fill={i ? '#5CE6C8' : '#E0457B'} />
            </G>
          ))}
          <G transform="translate(150 20)">
            <Circle r={27} fill="#F3C863" stroke="#8C6310" strokeWidth={1.5} />
            <Circle r={21} fill="#1A2140" />
            {Array.from({ length: 8 }).map((_, i) => {
              const a0 = (i * Math.PI) / 4 - Math.PI / 2;
              const a1 = a0 + Math.PI / 4;
              return <Path key={i} d={`M0 0 L${20 * Math.cos(a0)} ${20 * Math.sin(a0)} A20 20 0 0 1 ${20 * Math.cos(a1)} ${20 * Math.sin(a1)} Z`} fill={panes[i % 4]} />;
            })}
            <Path d="M0 -20 V20 M-20 0 H20 M-14.1 -14.1 L14.1 14.1 M-14.1 14.1 L14.1 -14.1" stroke="#8C6310" strokeWidth={1.4} />
            <Circle r={20.5} fill="none" stroke="#8C6310" strokeWidth={1.2} />
            <Circle r={7} fill="#FFF4D2" stroke="#8C6310" strokeWidth={1.2} />
            <Circle r={3} fill="#B8892A" />
          </G>
        </G>
      );
    }
    case 'back':
      return (
        <G>
          <Path d="M11 410 L11 150 A139 139 0 0 1 289 150 L289 410" fill="none" stroke="#E8C872" strokeWidth={1.2} strokeDasharray="1 5" strokeLinecap="round" />
          <Path d="M136 0 L164 0 L159 22 L141 22 Z" fill="#E8C872" stroke="#8C6310" strokeWidth={1} />
        </G>
      );
  }
}

/** The whole frame: halo, arch, ornaments, photo (or starburst for a back), window rim and plate. */
function Frame({ look, width, uri, halo }: { look: Look; width: number; uri?: string; halo?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const L = LOOK[look];
  const k = width / 300;
  return (
    <>
      {halo && (
        <Svg pointerEvents="none" width={width * 1.4} height={width * 1.4} style={{ position: 'absolute', left: -width * 0.2, top: -width * 0.26 }} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={`halo${uid}`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
              <Stop offset="0" stopColor="#FFECAA" stopOpacity={0.75} />
              <Stop offset="0.45" stopColor="#FFD678" stopOpacity={0.3} />
              <Stop offset="1" stopColor="#FFD678" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={50} cy={50} r={50} fill={`url(#halo${uid})`} />
        </Svg>
      )}
      <Svg
        pointerEvents="none"
        width={width * ((300 + PAD_X * 2) / 300)}
        height={width * ((420 + PAD_TOP) / 300)}
        viewBox={VB}
        style={{ position: 'absolute', left: -PAD_X * k, top: -PAD_TOP * k }}
      >
        <Defs>
          <SvgGradient id={`cf${uid}`} x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor={L.g1} />
            <Stop offset="1" stopColor={L.g2} />
          </SvgGradient>
          <SvgGradient id={`holo${uid}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={HOLO[0]} stopOpacity={0} />
            <Stop offset="0.35" stopColor={HOLO[0]} stopOpacity={0.45} />
            <Stop offset="0.5" stopColor={HOLO[2]} stopOpacity={0.45} />
            <Stop offset="0.65" stopColor={HOLO[3]} stopOpacity={0.45} />
            <Stop offset="1" stopColor={HOLO[3]} stopOpacity={0} />
          </SvgGradient>
          <RadialGradient id={`back${uid}`} cx="0.5" cy="0.4" rx="0.6" ry="0.6">
            <Stop offset="0" stopColor="#2A2F7A" />
            <Stop offset="1" stopColor="#0E1240" />
          </RadialGradient>
          <ClipPath id={`win${uid}`}>
            <Path d={L.win} />
          </ClipPath>
        </Defs>
        <Path d={L.outer} fill={`url(#cf${uid})`} stroke={L.rim} strokeWidth={2} />
        <Path d={L.outer} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.2} transform="translate(7 8) scale(0.953 0.962)" />
        <G clipPath={`url(#win${uid})`}>
          {look === 'back' ? (
            <>
              <Rect x={0} y={0} width={300} height={280} fill={`url(#back${uid})`} />
              {Array.from({ length: 24 }).map((_, i) => {
                const a = (i * Math.PI * 2) / 24;
                return <Path key={i} d={`M150 160 L${150 + 220 * Math.cos(a)} ${160 + 220 * Math.sin(a)} L${150 + 220 * Math.cos(a + 0.07)} ${160 + 220 * Math.sin(a + 0.07)} Z`} fill="rgba(232,200,114,0.2)" />;
              })}
              <Gem transform="translate(58 58) scale(1.85)" />
            </>
          ) : (
            <>
              <Rect x={0} y={0} width={300} height={280} fill={C.paperDeep} />
              {uri ? <SvgImage href={uri} x={22} y={0} width={256} height={272} preserveAspectRatio="xMidYMid slice" /> : null}
            </>
          )}
        </G>
        <Path d={L.win} fill="none" stroke={L.rim} strokeWidth={2.5} />
        <Ornaments look={look} uid={uid} />
        <Rect x={14} y={282} width={272} height={124} rx={12} fill={L.plate} stroke={L.rim} strokeWidth={1.5} />
      </Svg>
    </>
  );
}

/** Diagonal light band that sweeps across rare-and-up cards, like light catching gold leaf. */
function Sheen({ w, h, strong }: { w: number; h: number; strong?: boolean }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(x, { toValue: 1, duration: strong ? 1600 : 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.delay(strong ? 700 : 2400),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [x, strong]);
  const tx = x.interpolate({ inputRange: [0, 1], outputRange: [-w * 1.2, w * 1.2] });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: tx }, { rotate: '18deg' }], alignItems: 'center' }]}>
      <LinearGradient
        colors={['rgba(255,255,255,0)', strong ? 'rgba(255,246,214,0.55)' : 'rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ width: w * 0.45, height: h * 1.6, marginTop: -h * 0.3 }}
      />
    </Animated.View>
  );
}

function Ribbon({ text, color, s }: { text: string; color: string; s: number }) {
  const h = 28 * s;
  const notch = 10 * s;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 259 * s, alignItems: 'center' }}>
      <View style={{ height: h, flexDirection: 'row' }}>
        <Svg width={notch + 1} height={h} viewBox="0 0 10 28" preserveAspectRatio="none">
          <Path d="M0 0 H10.5 V28 H0 L10 14 Z" fill={color} />
        </Svg>
        <View style={{ height: h, backgroundColor: color, justifyContent: 'center', paddingHorizontal: 14 * s, marginHorizontal: -0.5 }}>
          <Text numberOfLines={1} style={{ fontFamily: F.caps, color: C.white, fontSize: Math.max(9, 12 * s), letterSpacing: 1.8 * s + 0.4 }}>
            {text}
          </Text>
        </View>
        <Svg width={notch + 1} height={h} viewBox="0 0 10 28" preserveAspectRatio="none">
          <Path d="M-0.5 0 H10 L0 14 L10 28 H-0.5 Z" fill={color} />
        </Svg>
      </View>
    </View>
  );
}

export function GameCard({ card, width, onPress, style, live = true, flat }: { card: Card; width: number; onPress?: () => void; style?: ViewStyle; live?: boolean; flat?: boolean }) {
  const t = TIERS[card.tier];
  const L = LOOK[card.tier];
  const h = width * RATIO;
  const s = width / 300;
  const compact = width < 150;
  const thumb = !compact && width < 220; // grids: photo, ribbon, title and points
  const shiny = card.tier === 'rare' || card.tier === 'epic' || card.tier === 'one';
  const body = (
    <View style={[{ width, height: h }, style]}>
      <Frame look={card.tier} width={width} uri={photoUrl(card, width < 220)} halo={card.tier === 'one' && !flat && !compact} />
      {!compact && <Ribbon text={card.tier === 'one' && thumb ? 'BRILLION' : t.name.toUpperCase()} color={L.ribbon} s={Math.max(s, 0.55)} />}
      {compact ? (
        <View style={{ position: 'absolute', left: 14 * s, top: 282 * s, width: 272 * s, height: 124 * s, alignItems: 'center', justifyContent: 'center' }}>
          {width >= 60 && (
            <Text numberOfLines={1} style={{ fontFamily: F.caps, color: L.ink, fontSize: Math.max(8, 36 * s), letterSpacing: 0.6 }}>
              {t.short.toUpperCase()}
            </Text>
          )}
        </View>
      ) : thumb ? (
        <View style={{ position: 'absolute', left: 14 * s, top: 296 * s, width: 272 * s, height: 106 * s, paddingHorizontal: 12, justifyContent: 'center', gap: 4 }}>
          <Text numberOfLines={2} style={{ fontFamily: F.display, fontSize: 18, lineHeight: 19, color: C.ink }}>
            {card.title}
          </Text>
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.inkSoft }}>+{card.points}</Text>
        </View>
      ) : (
        <View style={{ position: 'absolute', left: 14 * s, top: 292 * s, width: 272 * s, height: 112 * s, paddingHorizontal: 16 * s, paddingTop: 6 * s, gap: 6 * s, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 10 * s + 1, letterSpacing: 1.4 * s, textTransform: 'uppercase', color: C.inkSoft }}>
              {card.promptText}
            </Text>
            <Text style={{ fontFamily: F.mono, fontSize: 13 * s + 1, color: C.ink }}>{card.points}</Text>
          </View>
          <Text numberOfLines={2} style={{ fontFamily: F.display, fontSize: 28 * s, lineHeight: 29 * s, color: C.ink }}>
            {card.title}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 11 * s + 1, color: C.inkSoft }}>
            {card.solo ? `Rarity ${card.rarity}` : card.sameCount <= 1 ? 'Only find' : `${card.sameCount} of ${card.totalCount} finds`}
          </Text>
        </View>
      )}
      {shiny && live && !compact && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 22 * s, right: 22 * s, top: 0, height: 272 * s, overflow: 'hidden', borderTopLeftRadius: 128 * s, borderTopRightRadius: 128 * s }}>
          <Sheen w={width} h={h} strong={card.tier === 'one'} />
        </View>
      )}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${card.title}, ${t.name}`} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      {body}
    </Pressable>
  );
}

/** Face-down card: night blue, gold keystone, starburst. */
export function CardBack({ width, style, children }: { width: number; style?: ViewStyle; children?: React.ReactNode }) {
  const s = width / 300;
  return (
    <View style={[{ width, height: width * RATIO }, style]}>
      <Frame look="back" width={width} />
      <View style={{ position: 'absolute', left: 14 * s, top: 282 * s, width: 272 * s, height: 124 * s, alignItems: 'center', justifyContent: 'center' }}>
        {width >= 90 && <Text style={{ fontFamily: F.caps, color: C.goldLight, fontSize: Math.max(8, 22 * s), letterSpacing: 6 * s + 0.5 }}>BRILLION</Text>}
      </View>
      {children ? <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 272 * s, alignItems: 'center', justifyContent: 'center' }}>{children}</View> : null}
    </View>
  );
}

/** The Brillion mark (the peak constellation) at any size. */
export function Sparkle({ size, ink }: { size: number; ink?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="2 4 96 92">
      <Gem ink={ink} small={size < 40} />
    </Svg>
  );
}

/** Empty slot: a dashed arch waiting for a card. */
export function EmptySlot({ width, label, style }: { width: number; label?: string; style?: ViewStyle }) {
  const h = width * RATIO;
  const s = width / 300;
  return (
    <View style={[{ width, height: h, alignItems: 'center', justifyContent: 'center', gap: 6 }, style]}>
      <Svg width={width} height={h} viewBox="0 0 300 420" style={StyleSheet.absoluteFill}>
        <Path d={ROUND} fill="rgba(255,255,255,0.6)" stroke={C.faint} strokeWidth={Math.max(3, 2 / s)} strokeDasharray={`${Math.max(8, 6 / s)} ${Math.max(7, 5 / s)}`} />
      </Svg>
      <Feather name="camera" size={Math.max(16, 40 * s)} color={C.faint} />
      {label && width >= 120 && <Text style={{ fontFamily: F.bodyBold, color: C.faint, fontSize: 13 }}>{label}</Text>}
    </View>
  );
}

/** "BRILLION" in Cinzel with the gold star. */
export function Wordmark({ size = 34, color = C.ink }: { size?: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.24 }}>
      <Sparkle size={size * 1.05} />
      <Text style={{ fontFamily: F.caps, fontSize: size * 0.78, lineHeight: size, color, letterSpacing: size * 0.08 }}>BRILLION</Text>
    </View>
  );
}

export const CARD_RATIO = RATIO;
