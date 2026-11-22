import React, { useId, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { Zone } from '../theme';
import { STAR5 } from './GameCard';

// One painted scene per altitude. The mountains sink lower in the frame as you climb,
// so the rarer the find, the higher the screen feels.

type Scene = {
  sky: [number, string][];
  glow: string;
  glowOp: number;
  ray: string;
  rayOp: number;
  far: string;
  mid: string;
  near: string;
  snow: string;
  cloud: string;
  cloudOp: number;
  sea: boolean;
  stars: number;
  gold: boolean;
  trees: string | null;
  off: number;
  vig: string;
  vigOp: number;
  haze: number;
};

const SCENES: Record<Zone, Scene> = {
  foothill: {
    sky: [[0, '#A9BBDA'], [0.34, '#CFC4D8'], [0.62, '#F2CDB6'], [1, '#F8E1CC']],
    glow: '#FFE4C0', glowOp: 0.85, ray: '#FFEED2', rayOp: 0.26,
    far: '#B4A9BE', mid: '#8B7F86', near: '#52493F', snow: '#FBEFE6', cloud: '#FFF1E4', cloudOp: 0.6,
    sea: false, stars: 0, gold: false, trees: '#3E372F', off: 0, vig: '#3C281E', vigOp: 0.18, haze: 0.72,
  },
  ridge: {
    sky: [[0, '#9CBBEE'], [0.38, '#B9D0F4'], [0.68, '#E1ECFA'], [1, '#F5F9FE']],
    glow: '#FFFAE8', glowOp: 0.95, ray: '#FFFFFF', rayOp: 0.28,
    far: '#AFC3E2', mid: '#6F8DBA', near: '#2F4A63', snow: '#FFFFFF', cloud: '#FFFFFF', cloudOp: 0.75,
    sea: false, stars: 0, gold: false, trees: '#233A4E', off: 70, vig: '#142850', vigOp: 0.16, haze: 0.72,
  },
  cloudline: {
    sky: [[0, '#6E98E4'], [0.42, '#A2C2F4'], [0.72, '#D9E7FB'], [1, '#FFFFFF']],
    glow: '#FFFFFF', glowOp: 0.95, ray: '#FFFFFF', rayOp: 0.3,
    far: '#C2D3EF', mid: '#93ACD8', near: '#6683B6', snow: '#FFFFFF', cloud: '#FFFFFF', cloudOp: 0.9,
    sea: true, stars: 0, gold: false, trees: null, off: 190, vig: '#14285A', vigOp: 0.18, haze: 0.55,
  },
  summit: {
    sky: [[0, '#17164A'], [0.3, '#3B3287'], [0.6, '#8762B8'], [0.84, '#E8A0B4'], [1, '#F7CBC2']],
    glow: '#FFCDDC', glowOp: 0.55, ray: '#FFD6E8', rayOp: 0.14,
    far: '#A07FC6', mid: '#5E4898', near: '#2C2363', snow: '#FFE8F0', cloud: '#F7CAD8', cloudOp: 0.5,
    sea: false, stars: 0.75, gold: false, trees: null, off: 150, vig: '#0A0828', vigOp: 0.4, haze: 0,
  },
  brillion: {
    sky: [[0, '#04061A'], [0.34, '#101452'], [0.64, '#2A2378'], [1, '#4B3A8E']],
    glow: '#FFD678', glowOp: 0.8, ray: '#FFD682', rayOp: 0.2,
    far: '#3C3582', mid: '#2A2468', near: '#1C1852', snow: '#EADFFF', cloud: '#BDB3F0', cloudOp: 0.5,
    sea: true, stars: 1, gold: true, trees: null, off: 300, vig: '#020312', vigOp: 0.5, haze: 0,
  },
};

// star field in a 390 × 420 box, scaled to the screen
const STARS: [number, number, number][] = [
  [22, 40, 1.1], [64, 96, 0.8], [98, 22, 1.3], [140, 70, 0.7], [176, 130, 1], [214, 34, 0.8], [250, 88, 1.2], [292, 20, 0.9], [330, 64, 1.4], [368, 120, 0.8],
  [38, 170, 0.9], [118, 200, 1.1], [200, 230, 0.7], [286, 180, 1], [352, 240, 0.9], [80, 280, 0.7], [160, 300, 0.8], [240, 310, 0.6], [320, 320, 0.8], [12, 320, 0.6],
];
// small gold five-point stars on the top sky, each in a soft halo
const SPARKS: [number, number, number][] = [[60, 148, 8], [318, 180, 10], [262, 57, 5], [128, 255, 5]];

const FAR = 'M0 300 L40 270 L80 285 L130 210 L165 240 L210 170 L250 215 L290 190 L340 240 L390 220 L390 560 L0 560 Z';
const FAR_SNOW = 'M210 170 L226 190 L216 186 L210 196 L203 186 L192 192 Z M130 210 L143 226 L135 223 L130 230 L124 223 L116 228 Z M290 190 L302 205 L295 202 L290 208 L284 202 L277 206 Z';
const MID = 'M0 380 L50 330 L95 360 L150 290 L190 330 L240 300 L290 350 L340 310 L390 350 L390 560 L0 560 Z';
const MID_SNOW = 'M150 290 L168 312 L158 308 L150 318 L142 308 L131 313 Z M340 310 L354 327 L346 324 L340 332 L333 324 L324 328 Z M240 300 L252 314 L245 312 L240 318 L234 312 L227 315 Z';
const NEAR = 'M0 450 L60 420 L120 440 L190 400 L260 435 L330 410 L390 430 L390 560 L0 560 Z';
const TREES =
  'M14 448 l7 -20 l7 20 z M30 442 l8 -24 l8 24 z M48 434 l6 -18 l6 18 z M84 432 l7 -20 l7 20 z M104 438 l6 -17 l6 17 z M160 418 l7 -22 l7 22 z M178 410 l8 -26 l8 26 z M198 412 l6 -18 l6 18 z M286 424 l7 -20 l7 20 z M304 418 l8 -24 l8 24 z M342 418 l6 -18 l6 18 z M360 424 l7 -21 l7 21 z';

export function Sky({ zone = 'ridge', style }: { zone?: Zone; style?: object }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const s = SCENES[zone];
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || box.w !== width || box.h !== height) setBox({ w: width, h: height });
  };
  const id = (n: string) => `${n}${uid}`;
  const w = box?.w ?? 0;
  const h = box?.h ?? 0;
  // mountains are drawn for a 390-wide phone; wider screens scale them a little and repeat them.
  // The range starts and ends at different heights, so every other copy is mirrored: each copy then
  // ends exactly where the next begins, with no seam. The centre copy stays unmirrored behind the content.
  const k = Math.min(Math.max(w / 390, 1), 1.35);
  const tile = 390 * k;
  const centreX = (w - tile) / 2;
  const side = Math.max(0, Math.ceil(centreX / tile));
  const copies = Array.from({ length: side * 2 + 1 }, (_, j) => j - side);
  // each copy is stretched 1 px past both edges so neighbours overlap instead of leaving an anti-aliased hairline
  const bleed = 1;
  const sx = (k * (tile + bleed * 2)) / tile;
  const copyAt = (i: number) =>
    i % 2 ? `translate(${centreX + (i + 1) * tile + bleed} ${top}) scale(${-sx} ${k})` : `translate(${centreX + i * tile - bleed} ${top}) scale(${sx} ${k})`;
  const top = h - 560 * k + s.off * k;
  const starK = w / 390;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: s.sky[0][1] }, style]} onLayout={onLayout}>
      {box && (
        <Svg width={w} height={h}>
          <Defs>
            <LinearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
              {s.sky.map(([o, c]) => (
                <Stop key={o} offset={o} stopColor={c} />
              ))}
            </LinearGradient>
            <RadialGradient id={id('glow')} cx="0.5" cy="-0.04" rx="0.75" ry="0.42" fx="0.5" fy="-0.04">
              <Stop offset="0" stopColor={s.glow} stopOpacity={s.glowOp} />
              <Stop offset="0.72" stopColor={s.glow} stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id={id('ray')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={s.ray} stopOpacity={s.rayOp} />
              <Stop offset="1" stopColor={s.ray} stopOpacity={0} />
            </LinearGradient>
            <RadialGradient id={id('cloud')} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
              <Stop offset="0" stopColor={s.cloud} stopOpacity={1} />
              <Stop offset="0.6" stopColor={s.cloud} stopOpacity={0.7} />
              <Stop offset="1" stopColor={s.cloud} stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id={id('hazeM')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.35} />
            </LinearGradient>
            <LinearGradient id={id('haze')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={s.haze} />
            </LinearGradient>
            <RadialGradient id={id('vig')} cx="0.5" cy="0.45" rx="0.9" ry="0.7">
              <Stop offset="0.55" stopColor={s.vig} stopOpacity={0} />
              <Stop offset="1" stopColor={s.vig} stopOpacity={s.vigOp} />
            </RadialGradient>
          </Defs>

          <Rect x={0} y={0} width={w} height={h} fill={`url(#${id('sky')})`} />
          <Rect x={0} y={0} width={w} height={h} fill={`url(#${id('glow')})`} />
          <Polygon points={`${w * 0.3},0 ${w * 0.43},0 ${w * 0.12},${h * 0.7} ${w * -0.02},${h * 0.7}`} fill={`url(#${id('ray')})`} />
          <Polygon points={`${w * 0.52},0 ${w * 0.6},0 ${w * 0.46},${h * 0.75} ${w * 0.36},${h * 0.75}`} fill={`url(#${id('ray')})`} />
          <Polygon points={`${w * 0.66},0 ${w * 0.74},0 ${w * 0.92},${h * 0.6} ${w * 0.8},${h * 0.6}`} fill={`url(#${id('ray')})`} />

          {s.stars > 0 && (
            <G opacity={s.stars}>
              {STARS.map(([x, y, r], i) => (
                <Circle key={i} cx={x * starK} cy={y * starK} r={r} fill="#FFFFFF" />
              ))}
            </G>
          )}
          {s.gold && (
            <G fill="#FFE08A">
              {SPARKS.map(([x, y, r], i) => (
                <G key={i}>
                  <Circle cx={x * starK} cy={y * starK} r={r * 1.1} opacity={0.18} />
                  <Path d={STAR5} transform={`translate(${x * starK - (50 * r) / 46} ${y * starK - (52 * r) / 46}) scale(${r / 46})`} />
                </G>
              ))}
            </G>
          )}

          {/* each layer is drawn across every copy before the next layer, so copies overlap only where colours match */}
          {copies.map((i) => (
            <G key={`f${i}`} transform={copyAt(i)}>
              <Path d={FAR} fill={s.far} />
              <Path d={FAR_SNOW} fill={s.snow} opacity={0.9} />
            </G>
          ))}
          <G opacity={s.cloudOp}>
            {copies.map((i) => (
              <G key={`c${i}`} transform={copyAt(i)}>
                <Ellipse cx={60} cy={300} rx={100} ry={20} fill={`url(#${id('cloud')})`} />
                <Ellipse cx={230} cy={290} rx={130} ry={18} fill={`url(#${id('cloud')})`} />
                <Ellipse cx={370} cy={310} rx={80} ry={16} fill={`url(#${id('cloud')})`} />
              </G>
            ))}
          </G>
          {copies.map((i) => (
            <G key={`m${i}`} transform={copyAt(i)}>
              <Path d={MID} fill={s.mid} />
              <Path d={MID_SNOW} fill={s.snow} />
            </G>
          ))}
          <Rect x={0} y={top + 300 * k} width={w} height={260 * k} fill={`url(#${id('hazeM')})`} />
          {copies.map((i) => (
            <G key={`n${i}`} transform={copyAt(i)}>
              <Path d={NEAR} fill={s.near} />
              {s.trees && <Path d={TREES} fill={s.trees} />}
            </G>
          ))}

          {s.sea && (
            <G>
              {[0.1, 0.5, 0.92].map((x, i) => (
                <Ellipse key={i} cx={w * x} cy={h - 96} rx={Math.max(140, w * 0.38)} ry={56} fill={`url(#${id('cloud')})`} opacity={0.85} />
              ))}
              {[0.28, 0.82].map((x, i) => (
                <Ellipse key={`b${i}`} cx={w * x} cy={h - 26} rx={Math.max(200, w * 0.5)} ry={74} fill={`url(#${id('cloud')})`} />
              ))}
            </G>
          )}

          {s.haze > 0 && <Rect x={0} y={h * 0.55} width={w} height={h * 0.45} fill={`url(#${id('haze')})`} />}
          <Rect x={0} y={0} width={w} height={h} fill={`url(#${id('vig')})`} />
        </Svg>
      )}
    </View>
  );
}
