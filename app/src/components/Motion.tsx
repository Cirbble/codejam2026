import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { HOLO } from '../theme';

const native = Platform.OS !== 'web';

/** True when the player asked the OS for less motion: every effect below then shows its end state at once. */
let reduceCached = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((r) => (reduceCached = r))
  .catch(() => {});

export function useReduceMotion() {
  const [reduce, setReduce] = useState(reduceCached);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** Rises and fades in on mount. */
export function FadeIn({ children, delay = 0, dy = 14, dx = 0, style, duration = 380, from = 0 }: { children: React.ReactNode; delay?: number; dy?: number; dx?: number; style?: ViewStyle; duration?: number; from?: number }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [v, delay, reduce, duration]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: from ? v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) : v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }, { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

let lastCount: number | null = null;
/** A number that counts up to its value (from the last value it showed, so it doesn't restart on every visit). */
export function CountUp({ value, style }: { value: number; style?: TextStyle | TextStyle[] }) {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(reduce || lastCount == null ? value : lastCount);
  const from = useRef(lastCount ?? value);
  useEffect(() => {
    if (reduce || lastCount == null || value <= from.current) {
      setShown(value);
      from.current = value;
      lastCount = value;
      return;
    }
    const start = Date.now();
    const a = from.current;
    const span = value - a;
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / 700);
      const e = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(a + span * e));
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        from.current = value;
        lastCount = value;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);
  return <Text style={style}>{shown}</Text>;
}

/** Sparkles that burst out from the centre once (rare finds and up). */
export function Burst({ color, holo, size = 300, count = 16, delay = 0 }: { color: string; holo?: boolean; size?: number; count?: number; delay?: number }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  const bits = useRef(
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = size * (0.38 + Math.random() * 0.25);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: 8 + Math.random() * 10, rot: Math.random() * 180, c: holo ? HOLO[i % HOLO.length] : color };
    }),
  ).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(v, { toValue: 1, duration: 900, delay, easing: Easing.out(Easing.quad), useNativeDriver: native }).start();
  }, [v, reduce, delay]);
  if (reduce) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      {bits.map((b, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: b.s,
            height: b.s,
            backgroundColor: b.c,
            borderRadius: 2,
            opacity: v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, b.x] }) },
              { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, b.y] }) },
              { rotate: `${b.rot + 45}deg` },
              { scale: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1, 0.5] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

/** Slow up-and-down drift, for idle elements. */
export function Float({ children, amp = 5, period = 3200, style }: { children: React.ReactNode; amp?: number; period?: number; style?: ViewStyle }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, reduce, period]);
  return <Animated.View style={[style, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -amp] }) }] }]}>{children}</Animated.View>;
}
