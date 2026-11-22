import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import type { Card } from '../api';
import { C, F, TIERS } from '../theme';
import { CardBack, GameCard, CARD_RATIO } from './GameCard';
import { Burst, useReduceMotion } from './Motion';
import { RarityMeter, SkyText } from './RarityMeter';
import { Cinema } from './Cinema';

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
/** Flips a face-down card over, then lands its tier and points underneath. */
export function FlipReveal({ card, width, localPhoto }: { card: Card; width: number; localPhoto?: string }) {
  const f = useRef(new Animated.Value(0)).current;
  const stamp = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    const big = card.tier === 'epic' || card.tier === 'one';
    if (reduce) {
      f.setValue(1);
      stamp.setValue(1);
      buzz(card.tier);
      return;
    }
    Animated.sequence([
      Animated.delay(big ? 650 : 250), // the rarer the card, the longer the beat before it turns
      Animated.timing(f, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      Animated.spring(stamp, { toValue: 1, friction: 5, tension: 140, useNativeDriver: native }),
    ]).start();
    const t = setTimeout(() => buzz(card.tier), (big ? 650 : 250) + 520);
    return () => clearTimeout(t);
  }, [card.tier, f, stamp, fade, reduce]);
  const backX = f.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] });
  const frontX = f.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const lift = f.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -18, 0] });
  const st = stamp.interpolate({ inputRange: [0, 1], outputRange: [1.6, 1] });
  const t = TIERS[card.tier];
  return (
    <View style={{ width, height: width * CARD_RATIO + 70 + 104 + 24, alignItems: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ translateY: lift }, { scaleX: backX }] }]}>
        <CardBack width={width} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ translateY: lift }, { scaleX: frontX }] }]}>
        <GameCard card={card} width={width} localPhoto={localPhoto} />
      </Animated.View>
      {(card.tier === 'rare' || card.tier === 'epic' || card.tier === 'one') && (
        <Burst color={TIERS[card.tier].color} holo={card.tier === 'one'} size={width * 1.2} count={card.tier === 'rare' ? 12 : 20} delay={(card.tier === 'rare' ? 250 : 650) + 480} />
      )}
      <Animated.View style={{ position: 'absolute', top: width * CARD_RATIO + 22, alignSelf: 'center', alignItems: 'center', opacity: stamp, transform: [{ scale: st }] }}>
        <SkyText style={{ fontFamily: F.display, fontSize: 32, letterSpacing: -0.5, textAlign: 'center' }} dayColor={t.text} nightColor={t.frame}>
          {t.name} · +{card.points}
        </SkyText>
      </Animated.View>
      <View style={{ position: 'absolute', top: width * CARD_RATIO + 70, alignSelf: 'center' }}>
        <RarityMeter card={card} width={Math.min(width, 300)} delay={(card.tier === 'epic' || card.tier === 'one' ? 650 : 250) + 700} climb />
      </View>
      {card.tier === 'one' && <Cinema delay={3600} reduce={reduce} />}
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
