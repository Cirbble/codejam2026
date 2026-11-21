import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
import { Card, photoUrl } from '../api';
import { C, F, HOLO, TIERS } from '../theme';

const RATIO = 1.4;
const native = Platform.OS !== 'web';

/** Diagonal light band that sweeps across rare-and-up cards, like foil catching the sun. */
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
        colors={['rgba(255,255,255,0)', strong ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ width: w * 0.45, height: h * 1.6, marginTop: -h * 0.3 }}
      />
    </Animated.View>
  );
}

export function GameCard({ card, width, onPress, style, live = true, flat }: { card: Card; width: number; onPress?: () => void; style?: ViewStyle; live?: boolean; flat?: boolean }) {
  const t = TIERS[card.tier];
  const h = width * RATIO;
  const s = width / 300;
  const compact = width < 150;
  const thumb = !compact && width < 220; // grids: photo, name and tier only
  const r = 20 * s + 2;
  const shiny = card.tier === 'rare' || card.tier === 'epic' || card.tier === 'one';
  const frame = (
    <View style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
      {card.tier === 'one' ? (
        <LinearGradient colors={HOLO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: t.frame }]} />
      )}
    </View>
  );
  const body = (
    <View
      style={[
        { width, height: h, borderRadius: r, borderWidth: 2, borderColor: C.ink, padding: Math.max(4, 12 * s) },
        !flat && { boxShadow: `0px ${Math.max(2, Math.round(6 * s))}px 0px ${C.ink}` },
        style,
      ]}
    >
      {frame}
      <View style={[styles.inner, { borderRadius: Math.max(6, 12 * s) }]}>
        {!compact && !thumb && (
          <View style={[styles.head, { paddingHorizontal: 12 * s, height: 34 * s }]}>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodyBold, fontSize: thumb ? 10 : 11 * s + 1, letterSpacing: thumb ? 0.6 : 1, textTransform: 'uppercase', color: C.inkSoft }}>
              {card.promptText}
            </Text>
            {!thumb && <Text style={{ fontFamily: F.mono, fontSize: 14 * s + 1, color: C.ink }}>{card.points}</Text>}
          </View>
        )}
        <View style={[styles.photo, compact ? { margin: 0, borderWidth: 0, borderRadius: 0 } : { marginHorizontal: 10 * s, borderRadius: 8 * s }]}>
          <Image source={{ uri: photoUrl(card, width < 220) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} cachePolicy="memory-disk" recyclingKey={card.id} />
        </View>
        {compact ? (
          <View style={{ height: Math.max(14, width * 0.16), backgroundColor: t.color, alignItems: 'center', justifyContent: 'center' }}>
            {width >= 80 && (
              <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: Math.max(9, width * 0.085), color: C.white, letterSpacing: 0.5 }}>
                {t.name.toUpperCase()}
              </Text>
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 12 * s, paddingTop: 10 * s, paddingBottom: 12 * s, gap: 8 * s }}>
            <Text numberOfLines={2} style={{ fontFamily: F.display, fontSize: thumb ? 17 : 26 * s + 2, lineHeight: (thumb ? 17 : 26 * s + 2) * 1.05, color: C.ink, letterSpacing: -0.5 }}>
              {card.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={[styles.chip, { backgroundColor: t.color, paddingHorizontal: 10 * s, height: 24 * s + 4 }, thumb && { paddingHorizontal: 9, height: 22 }]}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: thumb ? 11 : 12 * s + 1, color: C.white, letterSpacing: 0.6 }}>{t.name.toUpperCase()}</Text>
              </View>
              {!thumb && <Text style={{ fontFamily: F.mono, fontSize: 12 * s + 1, color: C.inkSoft }}>
                {card.sameCount <= 1 ? 'Only find' : ''}
              </Text>}
              {thumb && <Text style={{ fontFamily: F.display, fontSize: 16, color: C.ink }}>{card.points}</Text>}
            </View>
          </View>
        )}
      </View>
      {shiny && live && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
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

/** Face-down card. */
export function CardBack({ width, style, children }: { width: number; style?: ViewStyle; children?: React.ReactNode }) {
  const h = width * RATIO;
  const s = width / 300;
  const r = 20 * s + 2;
  return (
    <View style={[{ width, height: h, borderRadius: r, backgroundColor: C.ink, borderWidth: 2, borderColor: C.ink, overflow: 'hidden' }, style]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id="dia" width={18 * s + 6} height={18 * s + 6} patternUnits="userSpaceOnUse">
            <Path d={`M ${(9 * s + 3)} 0 L ${18 * s + 6} ${9 * s + 3} L ${9 * s + 3} ${18 * s + 6} L 0 ${9 * s + 3} Z`} fill="none" stroke="#2C3327" strokeWidth={1.2} />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#dia)" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { margin: Math.max(5, 12 * s), borderRadius: Math.max(6, 12 * s), borderWidth: 1.5, borderColor: '#5A6352', alignItems: 'center', justifyContent: 'center' }]}>
        <Sparkle size={width * 0.34} />
        {children}
      </View>
    </View>
  );
}

/** Four-point holo sparkle: the Rarefind mark. */
export function Sparkle({ size, ink }: { size: number; ink?: boolean }) {
  const k = 22;
  const d = `M 50 0 C ${50 + k * 0.45} ${50 - k} ${50 + k * 0.45} ${50 - k} 100 50 C ${50 + k * 0.45} ${50 + k} ${50 + k * 0.45} ${50 + k} 50 100 C ${50 - k * 0.45} ${50 + k} ${50 - k * 0.45} ${50 + k} 0 50 C ${50 - k * 0.45} ${50 - k} ${50 - k * 0.45} ${50 - k} 50 0 Z`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <SvgGradient id="spk" x1="0" y1="0" x2="1" y2="1">
          {HOLO.map((c, i) => (
            <Stop key={c} offset={i / (HOLO.length - 1)} stopColor={c} />
          ))}
        </SvgGradient>
      </Defs>
      <Path d={d} fill={ink ? C.ink : 'url(#spk)'} />
    </Svg>
  );
}

/** Empty slot in the binder: dashed outline waiting for a card. */
export function EmptySlot({ width, label, style }: { width: number; label?: string; style?: ViewStyle }) {
  const h = width * RATIO;
  const s = width / 300;
  return (
    <View style={[{ width, height: h, borderRadius: 20 * s + 2, borderWidth: 2, borderStyle: 'dashed', borderColor: C.faint, backgroundColor: C.paperDeep, alignItems: 'center', justifyContent: 'center', gap: 6 }, style]}>
      <Feather name="camera" size={Math.max(16, 40 * s)} color={C.faint} />
      {label && width >= 120 && <Text style={{ fontFamily: F.bodyBold, color: C.faint, fontSize: 13 }}>{label}</Text>}
    </View>
  );
}

/** "rarefind" set in the display face with a foil dot. */
export function Wordmark({ size = 34, color = C.ink }: { size?: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Text style={{ fontFamily: F.display, fontSize: size, lineHeight: size * 1.05, color, letterSpacing: -size * 0.04 }}>rarefind</Text>
      <LinearGradient colors={HOLO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size * 0.26, height: size * 0.26, borderRadius: size, marginLeft: size * 0.06, marginBottom: size * 0.16 }} />
    </View>
  );
}

export const CARD_RATIO = RATIO;

const styles = StyleSheet.create({
  inner: { flex: 1, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.ink, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photo: { flex: 1, overflow: 'hidden', borderWidth: 1.5, borderColor: C.ink, backgroundColor: C.paperDeep },
  chip: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
