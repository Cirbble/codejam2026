import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { C, F } from '../theme';

const RAD = Math.PI / 180;
export type XY = { x: number; y: number };

function sector(c: number, r: number, a0: number, a1: number) {
  const p = (a: number) => `${c + r * Math.sin(a * RAD)},${c - r * Math.cos(a * RAD)}`;
  return `M${c},${c} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z`;
}

/** A slow sweep with a soft afterglow. */
export function Sweep({ size, periodMs = 5000 }: { size: number; periodMs?: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: periodMs, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [spin, periodMs]);
  const c = size / 2;
  const slices = 12;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      <Svg width={size} height={size}>
        {Array.from({ length: slices }, (_, i) => (
          <Path key={i} d={sector(c, c - 2, -(i + 1) * 3, -i * 3)} fill={C.ink} fillOpacity={0.035 * (1 - i / slices) ** 1.5} />
        ))}
        <Line x1={c} y1={c} x2={c} y2={2} stroke={C.ink} strokeOpacity={0.22} strokeWidth={1.5} />
      </Svg>
    </Animated.View>
  );
}

/**
 * The scope: pale glass, range rings, bearing ticks and N. `heading` rotates the world so up is the way you face.
 * Children draw in scope pixels and are clipped to the disc.
 */
export function Scope({ size, spanM, heading = 0, sweep = true, labels = true, children }: { size: number; spanM: number; heading?: number | null; sweep?: boolean; labels?: boolean; children?: React.ReactNode }) {
  const c = size / 2;
  const r = c - 2;
  const scale = r / spanM;
  const step = spanM > 120 ? 50 : 25;
  const rings: number[] = [];
  for (let m = step; m < spanM; m += step) rings.push(m);
  const h = heading ?? 0;
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, boxShadow: `0px 3px 0px ${C.line}` }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="glass" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#F6F8FA" />
            <Stop offset="1" stopColor={C.surface} />
          </RadialGradient>
          <ClipPath id="disc">
            <Circle cx={c} cy={c} r={r} />
          </ClipPath>
        </Defs>
        <Circle cx={c} cy={c} r={r} fill="url(#glass)" />
        <G clipPath="url(#disc)">
          {rings.map((m) => (
            <Circle key={m} cx={c} cy={c} r={m * scale} fill="none" stroke={C.line} strokeWidth={1.2} />
          ))}
          <Line x1={c} y1={0} x2={c} y2={size} stroke={C.line} strokeOpacity={0.6} />
          <Line x1={0} y1={c} x2={size} y2={c} stroke={C.line} strokeOpacity={0.6} />
          {children}
        </G>
        <G transform={`rotate(${-h} ${c} ${c})`}>
          {ticks.map((a) => {
            const long = a % 90 === 0;
            const r0 = r - (long ? 11 : 6);
            return <Line key={a} x1={c + r0 * Math.sin(a * RAD)} y1={c - r0 * Math.cos(a * RAD)} x2={c + r * Math.sin(a * RAD)} y2={c - r * Math.cos(a * RAD)} stroke={C.ink} strokeOpacity={a === 0 ? 1 : long ? 0.5 : 0.22} strokeWidth={a === 0 ? 3 : 1.5} />;
          })}
          <SvgText x={c} y={28} fill={C.ink} fontSize={13} fontFamily={F.bodyBold} textAnchor="middle" transform={`rotate(${h} ${c} 24)`}>
            N
          </SvgText>
        </G>
        <Circle cx={c} cy={c} r={r} fill="none" stroke={C.ink} strokeOpacity={0.18} strokeWidth={1.5} />
        {labels && rings.map((m) => (
          <SvgText key={m} x={c + m * scale * 0.7071 + 4} y={c - m * scale * 0.7071 - 4} fill={C.faint} fontSize={10} fontFamily={F.mono}>
            {`${m} m`}
          </SvgText>
        ))}
      </Svg>
      {sweep && <Sweep size={size} />}
    </View>
  );
}

/**
 * A storm cell as reflectivity: rings from green (light rain) to magenta (hail core).
 * `k` (0..1) is how close it is to landing; the hot core grows as it nears.
 */
export function Cell({ x, y, r, k, mega }: { x: number; y: number; r: number; k: number; mega?: boolean }) {
  const bands = C.dbz.length;
  const reach = 1 + Math.floor(k * (bands - 1) + 0.0001);
  return (
    <G>
      {C.dbz.slice(0, reach).map((col, i) => (
        <Circle key={col} cx={x} cy={y} r={r * (1 - i / (bands + 0.6))} fill={col} fillOpacity={i === 0 ? 0.55 : 0.8} />
      ))}
      <Circle cx={x} cy={y} r={r} fill="none" stroke={C.dbz[reach - 1]} strokeWidth={mega ? 3 : 2} strokeDasharray={mega ? '7 5' : undefined} />
    </G>
  );
}

/** Seconds until a cell lands, in a small ink tag on its rim. */
export function CellTag({ x, y, sec }: XY & { sec: number }) {
  const w = sec >= 10 ? 30 : 22;
  return (
    <G>
      <Rect x={x - w / 2} y={y - 11} width={w} height={20} rx={10} fill={C.ink} />
      <SvgText x={x} y={y + 4} fill={C.white} fontSize={12} fontFamily={F.monoBold} textAnchor="middle">
        {String(sec)}
      </SvgText>
    </G>
  );
}

export function Probe({ x, y }: XY) {
  const r = 7;
  return <Path d={`M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`} fill={C.surface} stroke={C.ink} strokeWidth={2} />;
}

export function Kit({ x, y }: XY) {
  return (
    <G>
      <Circle cx={x} cy={y} r={9} fill={C.surface} stroke={C.ink} strokeWidth={2} />
      <Rect x={x - 1.5} y={y - 5} width={3} height={10} fill={C.ink} />
      <Rect x={x - 5} y={y - 1.5} width={10} height={3} fill={C.ink} />
    </G>
  );
}

/** You: an ink dot with a heading notch (up is where you face). */
export function Me({ x, y, downed }: XY & { downed?: boolean }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={22} fill={C.ink} fillOpacity={0.08} />
      <Circle cx={x} cy={y} r={11} fill={downed ? C.surface : C.ink} stroke={downed ? C.ink : C.white} strokeWidth={3} strokeDasharray={downed ? '3 3' : undefined} />
      {!downed && <Path d={`M${x},${y - 20} L${x + 6},${y - 12} L${x - 6},${y - 12} Z`} fill={C.ink} />}
    </G>
  );
}
