import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, TextInputProps, TextProps, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F } from '../theme';
import { CountUp } from './Motion';

export function T({ style, ...p }: TextProps) {
  return <Text {...p} style={[{ fontFamily: F.body, color: C.ink, fontSize: 16, lineHeight: 22 }, style]} />;
}

export function H({ size = 28, style, ...p }: TextProps & { size?: number }) {
  return <Text {...p} style={[{ fontFamily: F.display, color: C.ink, fontSize: size, lineHeight: Math.round(size * 1.08), letterSpacing: -size * 0.02 }, style]} />;
}

/** Small uppercase label for section heads and card meta. */
export function Label({ style, ...p }: TextProps) {
  return <Text {...p} style={[{ fontFamily: F.bodyBold, color: C.inkSoft, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' }, style]} />;
}

export function Mono({ style, ...p }: TextProps) {
  return <Text {...p} style={[{ fontFamily: F.mono, color: C.inkSoft, fontSize: 14, fontVariant: ['tabular-nums'] }, style]} />;
}

/** Text field: one font, size, spacing and padding for every name and code input, placeholder included. */
export function Field({ style, ...p }: TextInputProps) {
  return <TextInput placeholderTextColor={C.faint} {...p} style={[styles.field, style]} />;
}

export const tap = (kind: 'light' | 'medium' = 'light') => {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(kind === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};

type BtnProps = {
  title: string;
  onPress?: () => void;
  kind?: 'ink' | 'line' | 'blaze' | 'quiet';
  icon?: React.ComponentProps<typeof Feather>['name'];
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
};

export function Button({ title, onPress, kind = 'blaze', icon, disabled, busy, style }: BtnProps) {
  // disabled reads as unavailable (an outline with muted text), not as a faded primary
  const off = !!disabled && !busy && kind !== 'quiet';
  const fg = off ? C.faint : kind === 'ink' || kind === 'blaze' ? C.white : C.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled || busy}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        kind === 'ink' && { backgroundColor: C.ink },
        kind === 'blaze' && { backgroundColor: C.blaze, borderColor: C.ink },
        kind === 'line' && { backgroundColor: C.card, borderColor: C.ink },
        kind === 'quiet' && { backgroundColor: 'transparent', borderColor: 'transparent', height: 48 },
        (kind === 'ink' || kind === 'blaze') && !off && { boxShadow: `0px ${pressed ? 1 : 4}px 0px ${kind === 'ink' ? '#5B6355' : C.ink}` },
        pressed && !off && { transform: [{ translateY: 3 }] },
        { borderStyle: off ? 'dashed' : 'solid' }, // set every render: Android keeps a removed borderStyle
        off && { backgroundColor: 'transparent', borderColor: C.line },
        disabled && kind === 'quiet' && { opacity: 0.4 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Feather name={icon} size={20} color={fg} />}
          <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: fg }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, tone = 'ink' }: { icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void; label: string; tone?: 'ink' | 'light' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.icon, tone === 'light' && { backgroundColor: 'rgba(18,21,15,0.6)', borderColor: 'rgba(255,255,255,0.7)' }, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={20} color={tone === 'light' ? C.white : C.ink} />
    </Pressable>
  );
}

/**
 * Today's score, always on one line: "40 pts · Today 2/5". Home shows it large with a chevron, Today shows it small.
 * `count` rolls the figure up from the last score shown.
 */
export function ScorePill({ score, found, total, size = 'sm', count, chevron }: { score: number; found: number; total: number; size?: 'sm' | 'lg'; count?: boolean; chevron?: boolean }) {
  const lg = size === 'lg';
  // includeFontPadding off: Android pads text for accents, which pushes it below the pill's centre
  const figure = { fontFamily: F.display, fontSize: lg ? 44 : 22, lineHeight: lg ? 48 : 26, color: C.ink, letterSpacing: lg ? -0.9 : -0.4, fontVariant: ['tabular-nums' as const], includeFontPadding: false };
  return (
    <View style={[styles.pill, lg ? { gap: 10, paddingVertical: 8, paddingHorizontal: 16 } : { gap: 6, height: 40, paddingHorizontal: 14 }]}>
      {/* the figure and its label share a baseline; the pair is centred in the pill */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: lg ? 10 : 6 }}>
        {count ? <CountUp value={score} style={figure} /> : <Text style={figure}>{score}</Text>}
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: lg ? 16 : 15, color: C.ink, flexShrink: 0, includeFontPadding: false }}>
          pts · Today {found}/{total}
        </Text>
      </View>
      {chevron && <Feather name="chevron-right" size={18} color={C.inkSoft} />}
    </View>
  );
}

/** Page with the binder background and safe-area padding. */
export function Screen({ children, style, pad = true }: { children: React.ReactNode; style?: ViewStyle; pad?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: 'transparent', paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }, pad && { paddingHorizontal: 20 }, style]}>
      <View style={{ flex: 1, width: '100%', maxWidth: 520, maxHeight: 900, alignSelf: 'center', marginVertical: 'auto' }}>{children}</View>
    </View>
  );
}

/** Top bar: back button, title, optional right element. */
export function Bar({ onBack, title, right }: { onBack?: () => void; title?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.bar}>
      {onBack ? <IconButton icon="arrow-left" label="Back" onPress={onBack} /> : <View style={{ width: 44 }} />}
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontFamily: F.displayMid, fontSize: 18, color: C.ink }}>
        {title}
      </Text>
      {right ?? <View style={{ width: 44 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 58,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: C.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 22,
  },
  icon: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  field: { height: 58, borderRadius: 16, borderWidth: 2, borderColor: C.ink, backgroundColor: C.card, paddingHorizontal: 18, fontFamily: F.bodyMid, fontSize: 18, letterSpacing: 0, color: C.ink },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: 999, borderWidth: 2, borderColor: C.line, backgroundColor: C.card },
});
