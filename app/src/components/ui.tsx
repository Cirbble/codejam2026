import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { haptic } from '../game/coach';
import { C, DBZ_LABELS, F, R } from '../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function T({ style, children, ...rest }: React.ComponentProps<typeof Text>) {
  return (
    <Text style={[{ color: C.ink, fontFamily: F.body, fontSize: 16 }, style]} {...rest}>
      {children}
    </Text>
  );
}

/** Condensed display type: names, headlines, big readouts. */
export function H({ style, children, size = 32, ...rest }: { style?: TextStyle | TextStyle[]; children: React.ReactNode; size?: number } & React.ComponentProps<typeof Text>) {
  return (
    <T style={[{ fontFamily: F.display, fontSize: size, lineHeight: size * 1.02, letterSpacing: 0.3, textTransform: 'uppercase' }, style as TextStyle]} {...rest}>
      {children}
    </T>
  );
}

/** Small instrument label: mono, uppercase, tracked. */
export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle | TextStyle[] }) {
  return <T style={[{ fontFamily: F.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: C.dim }, style as TextStyle]}>{children}</T>;
}

/** Mono number with a label under it. */
export function Readout({ value, label, color = C.ink, size = 22, align = 'flex-start' }: { value: string; label: string; color?: string; size?: number; align?: 'flex-start' | 'center' | 'flex-end' }) {
  return (
    <View style={{ alignItems: align, gap: 2 }}>
      <T style={{ fontFamily: F.monoBold, fontSize: size, color, fontVariant: ['tabular-nums'] }}>{value}</T>
      <Label>{label}</Label>
    </View>
  );
}

type BtnProps = {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'ghost' | 'quiet' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  big?: boolean;
  icon?: IconName;
};

export function Button({ title, onPress, kind = 'primary', disabled, loading, style, big, icon }: BtnProps) {
  const filled = kind === 'primary' || kind === 'danger';
  const fg = disabled && (kind === 'primary' || kind === 'danger') ? C.faint : kind === 'primary' ? C.amberInk : kind === 'danger' ? '#fff' : kind === 'quiet' ? C.dim : C.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || loading}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        s.btn,
        big && { paddingVertical: 19 },
        filled ? { backgroundColor: kind === 'danger' ? C.danger : C.amber } : kind === 'ghost' ? s.ghost : s.quiet,
        disabled && filled && { backgroundColor: C.panel2 },
        (disabled || loading) && !filled && { opacity: 0.45 },
        pressed && { opacity: 0.85, transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={big ? 22 : 19} color={fg} /> : null}
      <T style={[s.btnText, big && { fontSize: 22 }, { color: fg }]}>{title}</T>
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
            style={[s.segItem, on && s.segOn, disabled && { opacity: 0.5 }]}
          >
            <T style={[s.segText, on && { color: C.amberInk }]}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Lives as instrument segments. */
export function Lives({ hp, max = 3, width = 16 }: { hp: number; max?: number; width?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }} accessibilityLabel={`${hp} of ${max} lives`}>
      {Array.from({ length: max }, (_, i) => (
        <View key={i} style={{ width, height: 8, borderRadius: 2, backgroundColor: i < hp ? (hp === 1 ? C.danger : C.safe) : 'rgba(140,196,182,0.18)' }} />
      ))}
    </View>
  );
}

/** The reflectivity scale, the game's signature strip. */
export function DbzLegend({ height = 6, labels = false }: { height?: number; labels?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', height, borderRadius: 2, overflow: 'hidden' }}>
        {C.dbz.map((c) => (
          <View key={c} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </View>
      {labels && (
        <View style={{ flexDirection: 'row' }}>
          {DBZ_LABELS.map((l, i) => (
            <T key={l} style={{ flex: 1, fontFamily: F.mono, fontSize: 9, color: C.faint }}>
              {i === DBZ_LABELS.length - 1 ? `${l} DBZ` : l}
            </T>
          ))}
        </View>
      )}
    </View>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />;
}

export const fmtClock = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

/** 45.50480 N  73.57720 W */
export const fmtCoord = (lat: number, lng: number) => `${Math.abs(lat).toFixed(4)}${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(4)}${lng >= 0 ? 'E' : 'W'}`;

const s = StyleSheet.create({
  btn: { borderRadius: R.md, paddingVertical: 15, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  ghost: { borderWidth: 1, borderColor: C.ring, backgroundColor: 'rgba(140,196,182,0.05)' },
  quiet: { backgroundColor: 'transparent' },
  btnText: { fontFamily: F.display, fontSize: 19, letterSpacing: 1.2, textTransform: 'uppercase' },
  panel: { backgroundColor: C.panel, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: 16 },
  seg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: R.md, padding: 3, borderWidth: 1, borderColor: C.line },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: 7, alignItems: 'center' },
  segOn: { backgroundColor: C.amber },
  segText: { fontFamily: F.mono, fontSize: 14, color: C.dim },
});
