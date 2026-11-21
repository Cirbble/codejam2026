import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextProps, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F } from '../theme';

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
  return <Text {...p} style={[{ fontFamily: F.mono, color: C.inkSoft, fontSize: 13, fontVariant: ['tabular-nums'] }, style]} />;
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
  const fg = kind === 'ink' || kind === 'blaze' ? C.white : C.ink;
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
        kind === 'line' && { backgroundColor: 'transparent', borderColor: C.ink },
        kind === 'quiet' && { backgroundColor: 'transparent', borderColor: 'transparent', height: 48 },
        (kind === 'ink' || kind === 'blaze') && { boxShadow: `0px ${pressed ? 1 : 4}px 0px ${kind === 'ink' ? '#5B6355' : C.ink}` },
        pressed && { transform: [{ translateY: 3 }] },
        disabled && { opacity: 0.4 },
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
      style={({ pressed }) => [styles.icon, tone === 'light' && { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.5)' }, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={20} color={tone === 'light' ? C.white : C.ink} />
    </Pressable>
  );
}

/** Page with the binder background and safe-area padding. */
export function Screen({ children, style, pad = true }: { children: React.ReactNode; style?: ViewStyle; pad?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: C.paper, paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }, pad && { paddingHorizontal: 20 }, style]}>
      <View style={{ flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' }}>{children}</View>
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
});
