import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextProps, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, Zone } from '../theme';
import { Sky } from './Sky';

export function T({ style, ...p }: TextProps) {
  return <Text {...p} style={[{ fontFamily: F.body, color: C.ink, fontSize: 16, lineHeight: 22 }, style]} />;
}

export function H({ size = 28, style, ...p }: TextProps & { size?: number }) {
  return <Text {...p} style={[{ fontFamily: F.display, color: C.ink, fontSize: size, lineHeight: Math.round(size * 1.05), letterSpacing: -size * 0.005 }, style]} />;
}

/** Small uppercase label for section heads and card meta. */
export function Label({ style, ...p }: TextProps) {
  return <Text {...p} style={[{ fontFamily: F.bodyBold, color: C.inkSoft, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase' }, style]} />;
}

/** Inscription-style caps in Cinzel, for altitude names and the wordmark. */
export function Caps({ style, ...p }: TextProps) {
  return <Text {...p} style={[{ fontFamily: F.caps, color: C.blaze, fontSize: 13, letterSpacing: 2.6, textTransform: 'uppercase' }, style]} />;
}

export function Mono({ style, ...p }: TextProps) {
  return <Text {...p} style={[{ fontFamily: F.mono, color: C.inkSoft, fontSize: 14, fontVariant: ['tabular-nums'] }, style]} />;
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

/** blaze: the one gold main action. ink: night blue. line: frosted pearl. quiet: a soft pill for secondary actions. */
export function Button({ title, onPress, kind = 'blaze', icon, disabled, busy, style }: BtnProps) {
  const fg = kind === 'ink' ? C.white : C.ink;
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
        kind === 'ink' && { backgroundColor: C.ink, borderColor: 'rgba(232,200,114,0.45)' },
        kind === 'blaze' && { borderColor: '#FFF6DA', overflow: 'hidden' },
        kind === 'line' && { backgroundColor: C.glass, borderColor: 'rgba(255,255,255,0.95)' },
        kind === 'quiet' && { backgroundColor: 'rgba(255,255,255,0.55)', borderColor: 'transparent', height: 48 },
        kind === 'ink' && { boxShadow: `0px ${pressed ? 1 : 4}px 0px ${C.gold}` },
        kind === 'blaze' && { boxShadow: `0px ${pressed ? 2 : 8}px ${pressed ? 10 : 24}px rgba(184,137,42,0.38)` },
        pressed && { transform: [{ translateY: 3 }] },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {kind === 'blaze' && <LinearGradient colors={['#FFE9A8', '#D9A53C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
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
      style={({ pressed }) => [styles.icon, tone === 'light' && { backgroundColor: 'rgba(16,20,82,0.5)', borderColor: 'rgba(255,224,138,0.5)' }, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={20} color={tone === 'light' ? C.white : C.ink} />
    </Pressable>
  );
}

/** Page on its altitude's sky, with safe-area padding. */
export function Screen({ children, style, pad = true, zone = 'ridge' }: { children: React.ReactNode; style?: ViewStyle; pad?: boolean; zone?: Zone }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }, pad && { paddingHorizontal: 20 }, style]}>
      <Sky zone={zone} />
      <View style={{ flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' }}>{children}</View>
    </View>
  );
}

/** Frosted pearl panel that floats on the sky. */
export function Glass({ children, style }: { children?: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[styles.glass, style]}>{children}</View>;
}

/** Top bar: back button, title, optional right element. `light` for night skies. */
export function Bar({ onBack, title, right, light }: { onBack?: () => void; title?: string; right?: React.ReactNode; light?: boolean }) {
  return (
    <View style={styles.bar}>
      {onBack ? <IconButton icon="arrow-left" label="Back" onPress={onBack} tone={light ? 'light' : 'ink'} /> : <View style={{ width: 44 }} />}
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontFamily: F.display, fontSize: 26, color: light ? C.white : C.ink }}>
        {title}
      </Text>
      {right ?? <View style={{ width: 44 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 58,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 22,
  },
  icon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center', backgroundColor: C.glass },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  glass: { backgroundColor: C.glass, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', boxShadow: '0px 12px 30px rgba(20,30,70,0.16)' },
});
