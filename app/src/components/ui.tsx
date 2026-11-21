import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { haptic } from '../game/coach';
import { C, F, R } from '../theme';

export type IconName = React.ComponentProps<typeof Feather>['name'];

export function T({ style, children, ...rest }: React.ComponentProps<typeof Text>) {
  return (
    <Text style={[{ color: C.ink, fontFamily: F.body, fontSize: 17, lineHeight: 23 }, style]} {...rest}>
      {children}
    </Text>
  );
}

/** Display type for the big words. */
export function H({ style, children, size = 32, ...rest }: { style?: TextStyle | TextStyle[]; children: React.ReactNode; size?: number } & React.ComponentProps<typeof Text>) {
  return (
    <Text style={[{ color: C.ink, fontFamily: F.display, fontSize: size, lineHeight: Math.round(size * 1.12), letterSpacing: -size * 0.03 }, style as TextStyle]} {...rest}>
      {children}
    </Text>
  );
}

/** Real numbers only: metres, seconds, codes. */
export function Num({ style, children, ...rest }: React.ComponentProps<typeof Text>) {
  return (
    <Text style={[{ color: C.inkSoft, fontFamily: F.mono, fontSize: 15, fontVariant: ['tabular-nums'] }, style]} {...rest}>
      {children}
    </Text>
  );
}

type BtnProps = {
  title: string;
  onPress?: () => void;
  kind?: 'ink' | 'outline' | 'quiet';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  icon?: IconName;
};

/** A pill that presses down like a key. */
export function Button({ title, onPress, kind = 'ink', disabled, loading, style, icon }: BtnProps) {
  const fg = kind === 'ink' ? C.white : C.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled || loading}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        s.btn,
        kind === 'ink' && { backgroundColor: C.ink, boxShadow: `0px ${pressed ? 1 : 5}px 0px #6F7F8B` },
        kind === 'outline' && { backgroundColor: C.surface, borderWidth: 2, borderColor: C.ink, boxShadow: `0px ${pressed ? 1 : 4}px 0px ${C.line}` },
        kind === 'quiet' && { height: 48, backgroundColor: 'transparent' },
        pressed && kind !== 'quiet' && { transform: [{ translateY: 4 }] },
        pressed && kind === 'quiet' && { opacity: 0.55 },
        disabled && { opacity: 0.38 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Feather name={icon} size={20} color={fg} />}
          <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: kind === 'quiet' ? C.inkSoft : fg }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [s.icon, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={20} color={C.ink} />
    </Pressable>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[s.panel, style as ViewStyle]}>{children}</View>;
}

export function Segmented<V extends string | number>({ value, options, onChange, disabled }: { value: V; options: Array<{ value: V; label: string }>; onChange: (v: V) => void; disabled?: boolean }) {
  return (
    <View style={s.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              haptic.tap();
              onChange(o.value);
            }}
            style={[s.segItem, on && s.segOn, disabled && !on && { opacity: 0.6 }]}
          >
            <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: on ? C.white : C.ink }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Three lives as dots. The last one turns red. */
export function Lives({ hp, max = 3, size = 12 }: { hp: number; max?: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 5 }} accessibilityLabel={`${hp} of ${max} lives`}>
      {Array.from({ length: max }, (_, i) => (
        <View key={i} style={{ width: size, height: size, borderRadius: size, backgroundColor: i < hp ? (hp === 1 ? C.dbz[3] : C.ink) : 'transparent', borderWidth: 2, borderColor: i < hp ? (hp === 1 ? C.dbz[3] : C.ink) : C.line }} />
      ))}
    </View>
  );
}

export function Dot({ color, size = 12 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />;
}

/** Faint isobars across the ground: the storm chart this all sits on. */
export function Isobars() {
  const { width, height } = useWindowDimensions();
  const w = width;
  const h = height;
  const lines = [0.12, 0.27, 0.43, 0.6, 0.78, 0.94].map((f, i) => {
    const y = h * f;
    const a = (i % 2 ? 1 : -1) * h * 0.05;
    return `M${-20},${y} C${w * 0.25},${y + a} ${w * 0.55},${y - a * 1.6} ${w + 20},${y + a * 0.6}`;
  });
  return (
    <Svg pointerEvents="none" width={w} height={h} style={StyleSheet.absoluteFill}>
      {lines.map((d, i) => (
        <Path key={i} d={d} stroke={C.isobar} strokeWidth={1.5} fill="none" />
      ))}
    </Svg>
  );
}

export const fmtClock = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

const s = StyleSheet.create({
  btn: { height: 60, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  icon: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 2px 0px ${C.line}` },
  panel: { backgroundColor: C.surface, borderRadius: R.lg, padding: 18, boxShadow: `0px 2px 0px ${C.line}` },
  seg: { flexDirection: 'row', backgroundColor: C.skyDeep, borderRadius: R.pill, padding: 4 },
  segItem: { flex: 1, height: 46, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.ink },
});
