import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, PixelRatio, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
import { Card, photoUrl, crowdShown } from '../api';
import { C, F, HOLO, TIERS } from '../theme';

const RATIO = 1.4;
const native = Platform.OS !== 'web';

/** Diagonal light band that sweeps across rare-and-up cards, like foil catching the sun.
 * It runs over the frame only, behind the white panel, so the photo and the card's name stay clear. */
function useSheen(on: boolean, strong: boolean) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(x, { toValue: 1, duration: strong ? 1600 : 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.delay(strong ? 700 : 2400),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [x, on, strong]);
  return x;
}

function Sheen({ x, w, h, strong }: { x: Animated.Value; w: number; h: number; strong?: boolean }) {
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

/** Sizes and hairlines on whole device pixels: a fractional edge antialiases into a light seam beside the border. */
const px = (n: number) => PixelRatio.roundToNearestPixel(n);
const HAIR = px(1.5);

/**
 * `localPhoto` (the shot still on the phone) shows until the server copy arrives, so a fresh reveal never flips to a
 * blank face.
 */
export function GameCard({ card, width: rawWidth, onPress, style, live = true, flat, localPhoto }: { card: Card; width: number; onPress?: () => void; style?: ViewStyle; live?: boolean; flat?: boolean; localPhoto?: string }) {
  const t = TIERS[card.tier];
  const width = px(rawWidth);
  const h = px(width * RATIO);
  const s = width / 300;
  const compact = width < 150;
  const thumb = !compact && width < 220; // grids: photo, name and tier only
  const r = 20 * s + 2;
  const shiny = card.tier === 'rare' || card.tier === 'epic' || card.tier === 'one';
  const sheen = useSheen(shiny && live, card.tier === 'one');
  // the frame colour sits on the bordered view itself, so no gap can open between the border and the fill
  const frame =
    card.tier === 'one' ? (
      <View style={[StyleSheet.absoluteFill, { borderRadius: r - 2, overflow: 'hidden' }]}>
        <LinearGradient colors={HOLO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </View>
    ) : null;
  const body = (
    <View
      style={[
        { width, height: h, borderRadius: r, borderWidth: 2, borderColor: C.ink, backgroundColor: card.tier === 'one' ? HOLO[0] : t.frame, padding: px(Math.max(4, 12 * s)) },
        !flat && { boxShadow: `0px ${Math.max(2, Math.round(6 * s))}px 0px ${C.ink}` },
        style,
      ]}
    >
      {frame}
      {shiny && live && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
          <Sheen x={sheen} w={width} h={h} strong={card.tier === 'one'} />
        </View>
      )}
      <View style={[styles.inner, { borderRadius: Math.max(6, 12 * s) }, compact && { backgroundColor: C.ink }]}>
        {!compact && !thumb && (
          <View style={[styles.head, { paddingHorizontal: 12 * s, height: 34 * s }]}>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodyBold, fontSize: thumb ? 10 : 11 * s + 1, letterSpacing: thumb ? 0.6 : 1, textTransform: 'uppercase', color: C.inkSoft }}>
              {card.promptText}
            </Text>
            {!thumb && <Text style={{ fontFamily: F.mono, fontSize: 14 * s + 1, color: C.ink }}>{card.points}</Text>}
          </View>
        )}
        <View style={[styles.photo, compact ? { margin: 0, borderWidth: 0, borderRadius: 0 } : { marginHorizontal: px(10 * s), borderRadius: 8 * s }]}>
          {/* no fade-in: expo-image replays it on every mount (web even from cache), which reads as a flicker between
              screens; a big card shows the cached thumbnail (or the local shot) until the full photo lands */}
          {/* web: a plain <img> underneath paints a preloaded photo on the very first frame; expo-image lands a frame later */}
          {Platform.OS === 'web' &&
            React.createElement('img', {
              src: localPhoto ?? photoUrl(card, true),
              alt: '',
              draggable: false,
              style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
            })}
          <Image
            source={{ uri: photoUrl(card, width < 220) }}
            placeholder={localPhoto ? { uri: localPhoto } : width >= 220 ? { uri: photoUrl(card, true) } : undefined}
            placeholderContentFit="cover"
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={card.id}
          />
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
              {!thumb && crowdShown(card) && (
                <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.mono, fontSize: 12 * s + 1, color: C.inkSoft }}>
                  {card.sameCount <= 1 ? 'Only find' : `${card.sameCount} of ${card.totalCount}`}
                </Text>
              )}
              {thumb && <Text style={{ fontFamily: F.display, fontSize: 16, color: C.ink }}>{card.points}</Text>}
            </View>
          </View>
        )}
      </View>
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
  // exact sizes (a percentage can resolve to the SVG default box on native, leaving part of the card bare) and an id
  // per card (on web every card shares one document, so a shared id would size every pattern from the first card)
  const pid = 'dia' + React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const tile = 18 * s + 6;
  return (
    <View style={[{ width, height: h, borderRadius: r, backgroundColor: C.ink, borderWidth: 2, borderColor: C.ink, overflow: 'hidden' }, style]}>
      <Svg width={width} height={h} style={{ position: 'absolute', left: -2, top: -2 }}>
        <Defs>
          <Pattern id={pid} width={tile} height={tile} patternUnits="userSpaceOnUse">
            <Path d={`M ${tile / 2} 0 L ${tile} ${tile / 2} L ${tile / 2} ${tile} L 0 ${tile / 2} Z`} fill="none" stroke="#2C3327" strokeWidth={1.2} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={width} height={h} fill={`url(#${pid})`} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { margin: Math.max(5, 12 * s), borderRadius: Math.max(6, 12 * s), borderWidth: 1.5, borderColor: '#5A6352', alignItems: 'center', justifyContent: 'center' }]}>
        <Sparkle size={Math.max(0, width * 0.34)} />
        {children}
      </View>
    </View>
  );
}

/** Four-point holo sparkle: the Brillion mark. */
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

/** "brillion" set in the display face with a foil dot. */
export function Wordmark({ size = 34, color = C.ink }: { size?: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Text style={{ fontFamily: F.display, fontSize: size, lineHeight: size * 1.05, color, letterSpacing: -size * 0.04 }}>brillion</Text>
      <LinearGradient colors={HOLO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size * 0.26, height: size * 0.26, borderRadius: size, marginLeft: size * 0.06, marginBottom: size * 0.16 }} />
    </View>
  );
}

export const CARD_RATIO = RATIO;

const styles = StyleSheet.create({
  inner: { flex: 1, backgroundColor: C.card, borderWidth: HAIR, borderColor: C.ink, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photo: { flex: 1, overflow: 'hidden', borderWidth: HAIR, borderColor: C.ink, backgroundColor: C.paperDeep },
  chip: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
