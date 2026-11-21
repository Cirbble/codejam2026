import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import type { Card } from '../api';
import { C, F, TIERS } from '../theme';
import { CardBack, GameCard, CARD_RATIO } from './GameCard';

const native = Platform.OS !== 'web';

function buzz(tier: Card['tier']) {
  if (Platform.OS === 'web') return;
  const H = Haptics;
  if (tier === 'one') {
    H.notificationAsync(H.NotificationFeedbackType.Success).catch(() => {});
    setTimeout(() => H.impactAsync(H.ImpactFeedbackStyle.Heavy).catch(() => {}), 180);
    setTimeout(() => H.impactAsync(H.ImpactFeedbackStyle.Heavy).catch(() => {}), 360);
  } else if (tier === 'epic') {
    H.impactAsync(H.ImpactFeedbackStyle.Heavy).catch(() => {});
    setTimeout(() => H.impactAsync(H.ImpactFeedbackStyle.Medium).catch(() => {}), 160);
  } else if (tier === 'rare') H.impactAsync(H.ImpactFeedbackStyle.Medium).catch(() => {});
  else H.impactAsync(H.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Face-down card that breathes while the judge thinks. */
export function Pending({ width }: { width: number }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(p, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(p, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [p]);
  const scale = p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  const rotate = p.interpolate({ inputRange: [0, 1], outputRange: ['-1.5deg', '1.5deg'] });
  return (
    <Animated.View style={{ transform: [{ scale }, { rotate }] }}>
      <CardBack width={width} />
    </Animated.View>
  );
}

/** Flips a face-down card over, then stamps its tier. */
export function FlipReveal({ card, width }: { card: Card; width: number }) {
  const f = useRef(new Animated.Value(0)).current;
  const stamp = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const big = card.tier === 'epic' || card.tier === 'one';
    Animated.sequence([
      Animated.delay(big ? 650 : 250), // the rarer the card, the longer the beat before it turns
      Animated.timing(f, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      Animated.spring(stamp, { toValue: 1, friction: 5, tension: 140, useNativeDriver: native }),
      Animated.delay(1300),
      Animated.timing(fade, { toValue: 0, duration: 400, useNativeDriver: native }), // lift the stamp off so the photo shows
    ]).start();
    const t = setTimeout(() => buzz(card.tier), (big ? 650 : 250) + 520);
    return () => clearTimeout(t);
  }, [card.tier, f, stamp, fade]);
  const backX = f.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] });
  const frontX = f.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const lift = f.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -18, 0] });
  const st = stamp.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] });
  const t = TIERS[card.tier];
  return (
    <View style={{ width, height: width * CARD_RATIO + 8, alignItems: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ translateY: lift }, { scaleX: backX }] }]}>
        <CardBack width={width} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ translateY: lift }, { scaleX: frontX }] }]}>
        <GameCard card={card} width={width} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.stamp, { borderColor: t.color, opacity: Animated.multiply(stamp, fade), transform: [{ scale: st }, { rotate: '-8deg' }] }]}
      >
        <Text style={{ fontFamily: F.display, fontSize: 26, color: t.color, letterSpacing: 1 }}>{t.name.toUpperCase()}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stamp: {
    position: 'absolute',
    top: '30%',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(250,251,247,0.92)',
    shadowColor: C.ink,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
