import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { C, F } from '../theme';

const RAD = Math.PI / 180;
export type XY = { x: number; y: number };

/** Sector path from the centre, between two compass angles (degrees, 0 = up). */
function sector(c: number, r: number, a0: number, a1: number) {
  const p = (a: number) => `${c + r * Math.sin(a * RAD)},${c - r * Math.cos(a * RAD)}`;
  return `M${c},${c} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z`;
}

/** The rotating sweep: a fading wedge, like a real scope's afterglow. */
export function Sweep({ size, periodMs = 4200 }: { size: number; periodMs?: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: periodMs, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [spin, periodMs]);
  const c = size / 2;
  const slices = 14;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      <Svg width={size} height={size}>
        {Array.from({ length: slices }, (_, i) => (
          <Path key={i} d={sector(c, c - 1, -(i + 1) * 3, -i * 3)} fill={C.safe} fillOpacity={0.16 * (1 - i / slices) ** 1.6} />
        ))}
        <Line x1={c} y1={c} x2={c} y2={1} stroke={C.safe} strokeOpacity={0.55} strokeWidth={1.5} />
      </Svg>
    </Animated.View>
  );
}

/**
 * The scope: glass, range rings with metre labels, bearing ticks and the N marker.
 * `heading` rotates the world so up is the way you face. `children` draws in scope pixels.
 */
export function Scope({ size, spanM, heading = 0, sweep = true, ringStepM, children }: { size: number; spanM: number; heading?: number | null; sweep?: boolean; ringStepM?: number; children?: React.ReactNode }) {
  const c = size / 2;
  const r = c - 1;
  const scale = r / spanM;
  const step = ringStepM ?? (spanM > 120 ? 50 : 25);
  const rings: number[] = [];
  for (let m = step; m < spanM; m += step) rings.push(m);
  const h = heading ?? 0;
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="glass" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#0F2329" />
            <Stop offset="1" stopColor={C.bg} />
          </RadialGradient>
          <ClipPath id="disc">
            <Circle cx={c} cy={c} r={r} />
          </ClipPath>
        </Defs>
        <Circle cx={c} cy={c} r={r} fill="url(#glass)" stroke={C.ring} strokeWidth={1} />
        <G clipPath="url(#disc)">
          {rings.map((m) => (
            <Circle key={m} cx={c} cy={c} r={m * scale} fill="none" stroke={C.ring} strokeWidth={1} strokeDasharray={m % (step * 2) === 0 ? undefined : '2 4'} />
          ))}
          <Line x1={c} y1={0} x2={c} y2={size} stroke={C.line} />
          <Line x1={0} y1={c} x2={size} y2={c} stroke={C.line} />
          {children}
        </G>
        {/* bearing ticks, rotated with the world */}
        <G transform={`rotate(${-h} ${c} ${c})`}>
          {ticks.map((a) => {
            const long = a % 30 === 0;
            const r0 = r - (long ? 10 : 5);
            return <Line key={a} x1={c + r0 * Math.sin(a * RAD)} y1={c - r0 * Math.cos(a * RAD)} x2={c + r * Math.sin(a * RAD)} y2={c - r * Math.cos(a * RAD)} stroke={a === 0 ? C.amber : C.ring} strokeWidth={a === 0 ? 2.5 : long ? 1.5 : 1} />;
          })}
          <SvgText x={c} y={22} fill={C.amber} fontSize={13} fontFamily={F.monoBold} textAnchor="middle" transform={`rotate(${h} ${c} 18)`}>
            N
          </SvgText>
        </G>
        {rings.map((m) => (
          <SvgText key={m} x={c + m * scale * 0.7071 + 3} y={c - m * scale * 0.7071 - 3} fill={C.faint} fontSize={9} fontFamily={F.mono}>
            {`${m}m`}
          </SvgText>
        ))}
      </Svg>
      {sweep && <Sweep size={size} />}
    </View>
  );
}

/**
 * A storm cell as radar reflectivity: concentric bands from light rain (green) to hail core (magenta).
 * `k` (0..1) is how close it is to landing; the hot core grows as it nears.
 */
export function Cell({ x, y, r, k, mega, sec }: { x: number; y: number; r: number; k: number; mega?: boolean; sec?: number }) {
  const bands = C.dbz.length;
  const reach = 1 + Math.floor(k * (bands - 1) + 0.0001); // how many bands are lit
  return (
    <G>
      {C.dbz.slice(0, reach).map((col, i) => (
        <Circle key={col} cx={x} cy={y} r={r * (1 - i / bands)} fill={col} fillOpacity={i === 0 ? 0.32 : 0.5} />
      ))}
      <Circle cx={x} cy={y} r={r} fill="none" stroke={C.dbz[Math.min(bands - 1, reach)]} strokeOpacity={0.9} strokeWidth={mega ? 3 : 1.5} strokeDasharray={mega ? '6 4' : undefined} />
      {sec != null && sec > 0 && (
        <SvgText x={x} y={y - r * 0.6 + 5} fill="#fff" fontSize={r > 40 ? 16 : 12} fontFamily={F.monoBold} textAnchor="middle" stroke={C.bg} strokeWidth={0.6}>
          {String(sec)}
        </SvgText>
      )}
    </G>
  );
}

export function Probe({ x, y }: XY) {
  const r = 7;
  return (
    <G>
      <Path d={`M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`} fill="none" stroke={C.amber} strokeWidth={2} />
      <Circle cx={x} cy={y} r={2} fill={C.amber} />
    </G>
  );
}

export function Kit({ x, y }: XY) {
  return (
    <G>
      <Rect x={x - 8} y={y - 8} width={16} height={16} rx={3} fill={C.bg} stroke={C.safe} strokeWidth={1.5} />
      <Rect x={x - 1.6} y={y - 5} width={3.2} height={10} fill={C.safe} />
      <Rect x={x - 5} y={y - 1.6} width={10} height={3.2} fill={C.safe} />
    </G>
  );
}

/** You: a heading wedge (up is where you face). */
export function Me({ x, y, downed }: XY & { downed?: boolean }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={16} fill={downed ? 'none' : C.ink} fillOpacity={0.12} stroke={downed ? C.danger : C.ink} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray={downed ? '3 3' : undefined} />
      <Path d={`M${x},${y - 10} L${x + 7},${y + 7} L${x},${y + 3} L${x - 7},${y + 7} Z`} fill={downed ? C.faint : C.ink} stroke={C.bg} strokeWidth={1.5} />
    </G>
  );
}
