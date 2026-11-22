import React, { useMemo } from 'react';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

// One mountain, climbed. The five tiers are five altitudes on it, and five times of day:
//   0 Foothill   (Common)      base camp at sunrise
//   1 Ridge      (Uncommon)    the pine ridge, 1,200 m, clear morning
//   2 Cloudline  (Rare)        3,000 m, bare rock above a sea of cloud
//   3 Summit     (Epic)        8,000 m, the peak in alpenglow at dusk
//   4 Brillion   (One of One)  beyond the sky: night, the summit and its flag far below
// The land is one continuous world: every layer is the same mountain at a different height, so climbing moves
// the camera up it. Nearer ground falls away below, the next band comes down to meet you, the sky turns with
// the hour. Everything comes from seeded noise, so it is identical on every device and fits any window.

export const SKY_COUNT = 5;

function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function noise(seed: number) {
  const r = rng(seed);
  const g = Array.from({ length: 512 }, () => r() * 2 - 1);
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const t = f * f * (3 - 2 * f);
    const a = g[((i % 512) + 512) % 512];
    const b = g[(((i + 1) % 512) + 512) % 512];
    return a + (b - a) * t;
  };
}

type RidgeOpts = { seed: number; base: number; amp: number; scale: number; oct?: number; peaky?: boolean; step?: number; env?: (u: number) => number; bottom: number };
type Ridge = { d: string; pts: [number, number][]; faces?: string };

/** a hill or mountain line across the width, filled down to `bottom`. base and amp are in px. */
function ridge(w: number, o: RidgeOpts): Ridge {
  const n = noise(o.seed);
  const oct = o.oct ?? 4;
  const step = o.step ?? 4;
  const pts: [number, number][] = [];
  for (let x = -step; x <= w + step; x += step) {
    let s = 0;
    let a = 1;
    let f = 1;
    let norm = 0;
    for (let k = 0; k < oct; k++) {
      const v = n((x / o.scale) * f + k * 17.3);
      s += (o.peaky ? 1 - Math.abs(v) * 1.6 : v * 0.5 + 0.5) * a;
      norm += a;
      a *= 0.5;
      f *= 2.07;
    }
    let v = Math.max(0, Math.min(1, s / norm));
    if (o.peaky) v = Math.pow(v, 1.5);
    if (o.env) v *= o.env(x / w);
    pts.push([x, o.base - o.amp * v]);
  }
  let d = `M${-step} ${o.bottom} `;
  for (const [x, y] of pts) d += `L${x.toFixed(1)} ${y.toFixed(1)} `;
  d += `L${w + step} ${o.bottom} Z`;
  return { d, pts };
}

type PeakOpts = { seed: number; base: number; peaks: number; hMin: number; hMax: number; slope: [number, number]; rough: number; bottom: number; main?: { u: number; h: number } };

/**
 * a mountain range drawn like a poster: a handful of clear triangular peaks, each with its own height and
 * steepness (steeper on one side), roughened a little by noise so the edges read as rock.
 */
function peaksRidge(w: number, o: PeakOpts): Ridge {
  const rand = rng(o.seed);
  const n = noise(o.seed + 5);
  const list: { x: number; h: number; l: number; r: number }[] = [];
  const count = Math.max(2, Math.round(o.peaks));
  for (let j = 0; j < count; j++) {
    const s = o.slope[0] + rand() * (o.slope[1] - o.slope[0]);
    list.push({ x: (j + 0.2 + rand() * 0.6) * (w / count), h: o.hMin + rand() * (o.hMax - o.hMin), l: s * (0.8 + rand() * 0.5), r: s * (0.8 + rand() * 0.5) });
  }
  if (o.main) list.push({ x: o.main.u * w, h: o.main.h, l: o.slope[0] * 0.95, r: o.slope[0] * 1.15 });
  const step = 3;
  const pts: [number, number][] = [];
  for (let x = -step; x <= w + step; x += step) {
    let hgt = 0;
    for (const p of list) {
      const dx = x - p.x;
      const v = p.h - Math.abs(dx) * (dx < 0 ? p.l : p.r);
      if (v > hgt) hgt = v;
    }
    const jag = (n(x / 7) * 0.55 + n(x / 19) * 0.45) * o.rough * Math.min(1, hgt / (o.rough * 4));
    pts.push([x, o.base - hgt - jag]);
  }
  let d = `M${-step} ${o.bottom} `;
  for (const [x, y] of pts) d += `L${x.toFixed(1)} ${y.toFixed(1)} `;
  d += `L${w + step} ${o.bottom} Z`;
  // shaded faces, poster style: for every peak that reaches the skyline, the side away from the light is a
  // triangle from the apex down its right slope, split from the lit side by a line running down from the apex
  let faces = '';
  for (const p of list) {
    const covered = list.some((q) => q !== p && q.h - Math.abs(p.x - q.x) * (p.x < q.x ? q.l : q.r) > p.h);
    if (covered) continue;
    const ax = p.x;
    const ay = o.base - p.h;
    const foot = o.base + p.h * 0.6; // run the face well below the base; the layer's clip keeps it inside the rock
    faces += `M${ax.toFixed(1)} ${ay.toFixed(1)} L${(ax + (foot - ay) / p.r).toFixed(1)} ${foot.toFixed(1)} L${(ax + (foot - ay) * 0.22).toFixed(1)} ${foot.toFixed(1)} Z `;
  }
  return { d, pts, faces };
}

function heightAt(r: Ridge, x: number) {
  const i = Math.max(0, Math.min(r.pts.length - 2, Math.floor((x - r.pts[0][0]) / (r.pts[1][0] - r.pts[0][0]))));
  const [x0, y0] = r.pts[i];
  const [x1, y1] = r.pts[i + 1];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
}

/** firs along a ridge, gathered in stands (`grove` 0..1 is how much of the ridge is wooded) */
function pines(r: Ridge, seed: number, gap: number, minH: number, maxH: number, grove = 1, clear: [number, number] = [0, 0]) {
  const rand = rng(seed);
  const stand = noise(seed + 991);
  let d = '';
  const end = r.pts[r.pts.length - 1][0];
  for (let x = r.pts[0][0] + rand() * gap; x < end; x += gap * (0.55 + rand() * 0.9)) {
    const s = stand(x / 120) * 0.5 + 0.5;
    if (s > grove || (x > clear[0] && x < clear[1])) continue;
    const th = (minH + rand() * (maxH - minH)) * (0.7 + 0.3 * Math.min(1, (grove - s) * 4));
    const tw = th * (0.32 + rand() * 0.08);
    const y = heightAt(r, x) + 3;
    d += `M${(x - tw / 2).toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${(y - th * 0.62).toFixed(1)} L${(x + tw / 2).toFixed(1)} ${y.toFixed(1)} Z `;
    d += `M${(x - tw * 0.38).toFixed(1)} ${(y - th * 0.42).toFixed(1)} L${x.toFixed(1)} ${(y - th).toFixed(1)} L${(x + tw * 0.38).toFixed(1)} ${(y - th * 0.42).toFixed(1)} Z `;
  }
  return d;
}

/** broadleaf groves: clumps of 3 to 6 overlapping round crowns, with open meadow between them */
function groves(r: Ridge, seed: number, minR: number, maxR: number, every: number, clear: [number, number] = [0, 0]) {
  const rand = rng(seed);
  let d = '';
  const end = r.pts[r.pts.length - 1][0];
  for (let x = r.pts[0][0] + rand() * every; x < end; x += every * (0.7 + rand() * 0.8)) {
    if (x > clear[0] - maxR * 4 && x < clear[1]) continue;
    const n = 3 + Math.floor(rand() * 4);
    let cx = x;
    for (let j = 0; j < n; j++) {
      const rr = (minR + rand() * (maxR - minR)) * (j === Math.floor(n / 2) ? 1.25 : 1);
      const y = heightAt(r, cx) + rr * 0.3;
      d += `M${(cx - rr).toFixed(1)} ${y.toFixed(1)} a${rr.toFixed(1)} ${(rr * 0.92).toFixed(1)} 0 1 1 ${(rr * 2).toFixed(1)} 0 Z `;
      cx += rr * (1.0 + rand() * 0.5);
    }
  }
  return d;
}

/** snow that follows the rock down to a ragged snowline, deeper on high ground */
function snowCap(r: Ridge, snowY: number, seed: number, jag: number) {
  const n = noise(seed);
  const top = r.pts;
  let d = `M${top[0][0]} ${top[0][1]} `;
  for (const [x, y] of top) d += `L${x.toFixed(1)} ${y.toFixed(1)} `;
  for (let i = top.length - 1; i >= 0; i--) {
    const [x, y] = top[i];
    const above = snowY - y;
    const by = above <= 0 ? y : Math.min(snowY + jag * 0.5, y + above * 0.8 + (n(x / 9) * 0.6 + n(x / 23) * 0.4) * jag);
    d += `L${x.toFixed(1)} ${by.toFixed(1)} `;
  }
  return d + 'Z';
}

/** the shaded side of every peak: columns under each descending segment, clipped to the mountain */
function shade(r: Ridge, bottom: number) {
  // light comes from the left: each run of slope falling to the right is one shaded face (one polygon, no seams)
  let d = '';
  const p = r.pts;
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 2) {
      d += `M${run.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} L${run[run.length - 1][0].toFixed(1)} ${bottom} L${run[0][0].toFixed(1)} ${bottom} Z `;
    }
    run = [];
  };
  for (let i = 1; i < p.length; i++) {
    const falling = p[i][1] > p[i - 1][1] - 0.5;
    if (falling) {
      if (!run.length) run.push(p[i - 1]);
      run.push(p[i]);
    } else flush();
  }
  flush();
  return d;
}

function puffs(w: number, y: number, seed: number, rMin: number, rMax: number) {
  const rand = rng(seed);
  const out: [number, number, number][] = [];
  for (let x = -rMax; x < w + rMax; x += (rMin + rand() * (rMax - rMin)) * 1.25) {
    const r = rMin + rand() * (rMax - rMin);
    out.push([x, y - rand() * r * 0.5, r]);
  }
  return out;
}

function starField(w: number, h: number, seed: number, count: number, top: number) {
  const rand = rng(seed);
  return Array.from({ length: count }, () => {
    const b = rand();
    return [rand() * w, rand() * rand() * h * top, 0.35 + b * b * 1.4, 0.35 + rand() * 0.65] as [number, number, number, number];
  });
}

// ---------------------------------------------------------------- the world

/** layers back to front. k is the altitude (in tiers) at which the layer is the ground under your feet.
 *  `hours` layers are painted once per time of day and cross-faded as the sky turns; `veil` layers fade into haze with distance. */
export type Layer = { k: number; veil: string | null; hours: boolean };
export const LAYERS: Layer[] = [
  { k: 3, veil: null, hours: true }, //        the summit massif, lit by each hour
  { k: 2, veil: '#D9E3F0', hours: false }, //  bare rock at the cloudline
  { k: 2.3, veil: null, hours: true }, //      the sea of cloud, lit by each hour
  { k: 1, veil: '#C9D9CF', hours: false }, //  the pine ridge
  { k: 0, veil: null, hours: false }, //       the meadow at base camp
];
/** how far one tier of climbing moves the land, as a fraction of the window height */
export const TIER_DROP = 0.16;
/** land is drawn this many window heights tall, so it can rise a long way without showing an edge */
export const LAND_TALL = 2;
/** dawn, day, dusk, night */
export const HOURS = 4;

const GROUND = 0.86; // where a layer's foot sits on screen when it is the ground under you

// the summit and the clouds in each light: rock lit / rock in shade / snow lit / snow in shade / rim light on the skyline
const SUMMIT = [
  { rock: ['#C4B6CA', '#B3A6C0'], shadow: '#9586AA', snow: '#FFE7D6', snowShade: '#CDBFD9', rim: '#FFD9A8' }, // dawn: far off, peach light
  { rock: ['#93A3C2', '#7385A8'], shadow: '#56668C', snow: '#FFFFFF', snowShade: '#C9D5EA', rim: '#FFFFFF' }, //  day
  { rock: ['#6E4C8E', '#4A3470'], shadow: '#2D1E50', snow: '#FFC2CC', snowShade: '#9C79B4', rim: '#FFB08A' }, //  dusk: alpenglow
  { rock: ['#2B2D66', '#1B1C4A'], shadow: '#0F1034', snow: '#C9D4F4', snowShade: '#6A76AC', rim: '#E8EEFF' }, //  night: moonlit
];
const CLOUD = [
  { lit: '#FFEADB', mid: '#F4D8D0', shade: '#DCC4CF', haze: '#D8DED0' },
  { lit: '#FFFFFF', mid: '#EEF3FA', shade: '#D4DFEE', haze: '#E6EEF6' },
  { lit: '#FFD3C6', mid: '#E7AFB8', shade: '#9D7EAF', haze: '#C79AB0' },
  { lit: '#B9C2EA', mid: '#8B95CB', shade: '#4E568E', haze: '#3E4580' },
];

function useLand(i: number, w: number, h: number) {
  return useMemo(() => {
    const vk = Math.min(1, 900 / h); // laptop windows should not get giant hills
    const bottom = h * LAND_TALL;
    const g = h * GROUND;
    // the reveal's tier line and meter sit in the middle: keep trees out of a clearing there
    const half = Math.min(w * 0.36, 280);
    const clear: [number, number] = [w / 2 - half, w / 2 + half];
    switch (i) {
      case 0: {
        // the summit: one massif, its highest point off-centre, a gold flag on top
        const mh = h * 0.27 * vk;
        const m = peaksRidge(w, { seed: 457, base: g, peaks: w / 150, hMin: mh * 0.3, hMax: mh * 0.62, slope: [0.95, 1.35], rough: 7, bottom, main: { u: 0.64, h: mh } });
        let top = m.pts[0];
        for (const p of m.pts) if (p[1] < top[1]) top = p;
        const snow = snowCap(m, g - mh * 0.66, 461, 10);
        const rim = m.pts.map(([x, y]) => `${x.toFixed(1)} ${(y + 1).toFixed(1)}`).join(' L');
        return { kind: 'summit' as const, m, top, snow, faces: m.faces ?? '', rim: `M${rim}`, vk, mh };
      }
      case 1: {
        const bh = h * 0.2 * vk;
        const fh = h * 0.15 * vk;
        const back = peaksRidge(w, { seed: 211, base: g - h * 0.02, peaks: w / 75, hMin: bh * 0.4, hMax: bh, slope: [1.1, 1.6], rough: 5, bottom });
        const front = peaksRidge(w, { seed: 223, base: g + h * 0.02, peaks: w / 105, hMin: fh * 0.4, hMax: fh, slope: [1.0, 1.4], rough: 5, bottom });
        return {
          kind: 'rock' as const,
          back,
          front,
          backSnow: snowCap(back, g - h * 0.02 - bh * 0.55, 227, 8),
          frontSnow: snowCap(front, g + h * 0.02 - fh * 0.6, 229, 8),
        };
      }
      case 2: {
        // a sea of cloud: big soft masses with a lit top and a shaded belly, rock shoulders breaking its edge
        const k = vk;
        const rand = rng(31);
        const masses: [number, number, number][] = [];
        const groups = Math.max(4, Math.round(w / 95));
        for (let q = 0; q < groups; q++) {
          const cx = ((q + 0.5) / groups) * w + (rand() - 0.5) * (w / groups) * 0.5;
          const size = (18 + rand() * 22) * k + 6; // groups differ a lot in size
          const lobes = 4 + Math.floor(rand() * 4);
          for (let j = 0; j < lobes; j++) {
            const t = (j + 0.5) / lobes - 0.5; // -0.5..0.5 across the group
            const r = size * (1 - Math.abs(t) * 1.1) * (0.75 + rand() * 0.35);
            masses.push([cx + t * size * 3.4, g - h * 0.004 - r * 0.55 + (rand() - 0.5) * 6, Math.max(6, r)]);
          }
        }
        const front: [number, number, number][] = [];
        for (let x = -40; x < w + 40; x += 34 + rand() * 50) front.push([x, g + h * 0.032 + rand() * h * 0.012, (10 + rand() * 14) * k + 6]);
        return { kind: 'sea' as const, masses, front, top: g + h * 0.01, bottom };
      }
      case 3: {
        const side = (u: number) => 0.35 + 0.65 * Math.min(1, Math.pow(Math.abs(u - 0.5) * 2, 1.4) * 1.3);
        const back = ridge(w, { seed: 113, base: g - h * 0.03, amp: h * 0.13 * vk, scale: 190, bottom, env: side });
        const front = ridge(w, { seed: 131, base: g + h * 0.1, amp: h * 0.05 * vk, scale: 150, bottom, env: side });
        return {
          kind: 'ridge' as const,
          back,
          front,
          p1: pines(back, 3, 7, 10 * vk, 20 * vk, 0.55, [w / 2 - Math.min(w * 0.3, 240), w / 2 + Math.min(w * 0.3, 240)]),
          p2: pines(front, 6, 10, 16 * vk, 26 * vk, 0.5, clear),
          // tall firs framing the edges of the screen, close to you
          big: pines(front, 8, 13, 46 * vk, 92 * vk, 0.95, [Math.min(w * 0.2, 160), w - Math.min(w * 0.2, 160)]),
        };
      }
      default: {
        const back = ridge(w, { seed: 23, base: g - h * 0.17, amp: h * 0.035 * vk, scale: 280, bottom });
        const front = ridge(w, { seed: 41, base: g + h * 0.11, amp: h * 0.03 * vk, scale: 200, bottom });
        // a trail climbing out of the meadow on the left, toward a gap in the trees
        const tw = (t: number) => Math.min(Math.max(w * 0.09, 34), 90) * Math.pow(1 - t, 1.3) + 2 * t;
        const tx = (t: number) => Math.min(w * 0.15, 230) * (1 - 0.75 * t) + Math.sin(t * Math.PI * 2) * Math.min(w * 0.04, 40);
        const ty = (t: number) => h * (1.14 - 0.48 * t);
        const L: string[] = [];
        const R: string[] = [];
        for (let s = 0; s <= 24; s++) {
          const t = s / 24;
          L.push(`${(tx(t) - tw(t) / 2).toFixed(1)} ${ty(t).toFixed(1)}`);
          R.unshift(`${(tx(t) + tw(t) / 2).toFixed(1)} ${ty(t).toFixed(1)}`);
        }
        return {
          kind: 'meadow' as const,
          back,
          front,
          trees: groves(back, 5, 6 * vk, 11 * vk, 210, clear),
          frontPines: pines(front, 13, 9, 14 * vk, 26 * vk, 0.32, clear),
          trail: `M${L.join(' L')} L${R.join(' L')} Z`,
          tent: (() => {
            const s = Math.max(20, Math.min(w, h) * 0.06);
            const x = w * 0.88;
            const y = g + h * 0.1;
            return {
              lit: `M${x - s * 0.9} ${y} L${x} ${y - s} L${x + s * 0.1} ${y} Z`,
              shade: `M${x} ${y - s} L${x + s * 0.9} ${y} L${x + s * 0.1} ${y} Z`,
              door: `M${x - s * 0.22} ${y} L${x} ${y - s * 0.55} L${x + s * 0.2} ${y} Z`,
              pole: `M${x} ${y - s} L${x - s * 0.08} ${y - s * 1.25}`,
            };
          })(),
        };
      }
    }
  }, [i, w, h]);
}

/** one land layer, drawn LAND_TALL window heights tall. `hour` picks the light for layers painted per hour;
 *  `veil` draws the silhouette again in haze colour (for distance). */
export function LandLayer({ i, w, h, veil, hour = 1 }: { i: number; w: number; h: number; veil?: boolean; hour?: number }) {
  const L = useLand(i, w, h);
  const id = `land${i}h${hour}${veil ? 'v' : ''}`;
  const tall = h * LAND_TALL;
  const vc = LAYERS[i].veil ?? '#FFFFFF';
  let body: React.ReactNode = null;
  if (L.kind === 'summit') {
    const P = SUMMIT[hour];
    const [fx, fy] = L.top;
    const pole = 24 * L.vk + 10;
    body = (
      <>
        <Defs>
          <ClipPath id={`${id}c`}>
            <Path d={L.m.d} />
          </ClipPath>
          <ClipPath id={`${id}s`}>
            <Path d={L.snow} />
          </ClipPath>
          <LinearGradient id={`${id}rock`} gradientUnits="userSpaceOnUse" x1="0" y1={fy} x2="0" y2={h * GROUND}>
            <Stop offset="0" stopColor={P.rock[0]} />
            <Stop offset="1" stopColor={P.rock[1]} />
          </LinearGradient>
        </Defs>
        <Path d={L.m.d} fill={`url(#${id}rock)`} />
        <Path d={L.faces} fill={P.shadow} opacity={0.75} clipPath={`url(#${id}c)`} />
        <Path d={L.snow} fill={P.snow} />
        <Path d={L.faces} fill={P.snowShade} clipPath={`url(#${id}s)`} />
        <Path d={L.rim} fill="none" stroke={P.rim} strokeWidth={1.6} opacity={hour === 1 ? 0.5 : 0.85} />
        <Rect x={fx - 1.1} y={fy - pole} width={2.2} height={pole + 2} fill="#FFE7A8" />
        <Path d={`M${fx + 1.1} ${fy - pole} L${fx + 1.1 + pole * 0.62} ${fy - pole + pole * 0.2} L${fx + 1.1} ${fy - pole + pole * 0.42} Z`} fill="#FFC94D" />
      </>
    );
  } else if (L.kind === 'rock') {
    body = veil ? (
      <>
        <Path d={L.back.d} fill={vc} />
        <Path d={L.front.d} fill={vc} />
      </>
    ) : (
      <>
        <Defs>
          <ClipPath id={`${id}cb`}>
            <Path d={L.back.d} />
          </ClipPath>
          <ClipPath id={`${id}cf`}>
            <Path d={L.front.d} />
          </ClipPath>
        </Defs>
        <Path d={L.back.d} fill="#8FA0BE" />
        <Path d={L.back.faces ?? ''} fill="#62729A" opacity={0.7} clipPath={`url(#${id}cb)`} />
        <Path d={L.backSnow} fill="#F6F9FD" />
        <Path d={L.front.d} fill="#6D80A2" />
        <Path d={L.front.faces ?? ''} fill="#46557C" opacity={0.75} clipPath={`url(#${id}cf)`} />
        <Path d={L.frontSnow} fill="#FFFFFF" />
      </>
    );
  } else if (L.kind === 'sea') {
    const P = CLOUD[hour];
    body = (
      <>
        {/* back masses: shaded belly, lit crown */}
        <G fill={P.shade}>
          {L.masses.map(([x, y, r], j) => (
            <Ellipse key={j} cx={x} cy={y + r * 0.2} rx={r * 1.6} ry={r * 0.9} />
          ))}
        </G>
        <G fill={P.mid}>
          {L.masses.map(([x, y, r], j) => (
            <Ellipse key={j} cx={x - r * 0.15} cy={y} rx={r * 1.4} ry={r * 0.78} />
          ))}
        </G>
        <G fill={P.lit}>
          {L.masses.map(([x, y, r], j) => (
            <Ellipse key={j} cx={x - r * 0.3} cy={y - r * 0.18} rx={r * 0.95} ry={r * 0.5} />
          ))}
        </G>
        <Rect x={-48} y={L.top} width={w + 96} height={L.bottom - L.top} fill={P.mid} />
        <Defs>
          <LinearGradient id={`${id}body`} gradientUnits="userSpaceOnUse" x1="0" y1={L.top} x2="0" y2={L.top + h * 0.12}>
            <Stop offset="0" stopColor={P.mid} stopOpacity={0} />
            <Stop offset="1" stopColor={P.haze} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x={-48} y={L.top} width={w + 96} height={L.bottom - L.top} fill={`url(#${id}body)`} />
      </>
    );
  } else if (L.kind === 'ridge') {
    body = veil ? (
      <>
        <Path d={L.back.d} fill={vc} />
        <Path d={L.p1} fill={vc} />
        <Path d={L.front.d} fill={vc} />
        <Path d={L.p2} fill={vc} />
        <Path d={L.big} fill={vc} />
      </>
    ) : (
      <>
        <Path d={L.back.d} fill="#6A977F" />
        <Path d={L.p1} fill="#55836D" />
        <Path d={L.front.d} fill="#3F6E5C" />
        <Path d={L.p2} fill="#3F6E5C" />
        <Path d={L.big} fill="#2B5244" />
      </>
    );
  } else if (L.kind === 'meadow') {
    body = (
      <>
        <Path d={L.back.d} fill="#BBC79F" />
        <Path d={L.trees} fill="#7F9C74" />
        <Path d={L.front.d} fill="#8EA477" />
        <Path d={L.trail} fill="#DCCB95" />
        <Path d={L.frontPines} fill="#5E8069" />
        <Path d={L.tent.lit} fill="#D99A55" />
        <Path d={L.tent.shade} fill="#B0743A" />
        <Path d={L.tent.door} fill="#5B3B22" />
        <Path d={L.tent.pole} stroke="#5B3B22" strokeWidth={1.6} strokeLinecap="round" />
      </>
    );
  }
  return (
    <Svg width={w} height={tall}>
      {body}
    </Svg>
  );
}

// ---------------------------------------------------------------- the skies, one per altitude (opaque, cross-faded)

type Part = { w: number; h: number; id: string };

/** a sun: a white-hot core, a warm bloom and a wide soft halo, with light rays fanning out from it */
function Sun({ x, y, r, core, bloom, halo, rays, rayOp, rayLen, from, to, id }: { x: number; y: number; r: number; core: string; bloom: string; halo: string; rays: number; rayOp: number; rayLen: number; from: number; to: number; id: string }) {
  const wedges = useMemo(() => {
    const rand = rng(Math.round(x * 7 + y * 13));
    const out: string[] = [];
    for (let j = 0; j < rays; j++) {
      const t = (j + 0.5) / rays;
      const a = from + (to - from) * t + (rand() - 0.5) * 0.08;
      const d = 0.025 + rand() * 0.035;
      const L = rayLen * (0.7 + rand() * 0.3);
      out.push(`M${x} ${y} L${x + Math.cos(a - d) * L} ${y + Math.sin(a - d) * L} L${x + Math.cos(a + d) * L} ${y + Math.sin(a + d) * L} Z`);
    }
    return out.join(' ');
  }, [x, y, rays, rayLen, from, to]);
  return (
    <>
      <Defs>
        <RadialGradient id={`${id}halo`} gradientUnits="userSpaceOnUse" cx={x} cy={y} r={r * 6} fx={x} fy={y}>
          <Stop offset="0" stopColor={halo} stopOpacity={0.55} />
          <Stop offset="0.35" stopColor={halo} stopOpacity={0.18} />
          <Stop offset="1" stopColor={halo} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}bloom`} gradientUnits="userSpaceOnUse" cx={x} cy={y} r={r * 2.6} fx={x} fy={y}>
          <Stop offset="0" stopColor={bloom} stopOpacity={0.95} />
          <Stop offset="0.45" stopColor={bloom} stopOpacity={0.45} />
          <Stop offset="1" stopColor={bloom} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}ray`} gradientUnits="userSpaceOnUse" cx={x} cy={y} r={rayLen} fx={x} fy={y}>
          <Stop offset="0" stopColor={halo} stopOpacity={rayOp} />
          <Stop offset="0.6" stopColor={halo} stopOpacity={rayOp * 0.35} />
          <Stop offset="1" stopColor={halo} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Path d={wedges} fill={`url(#${id}ray)`} />
      <Circle cx={x} cy={y} r={r * 6} fill={`url(#${id}halo)`} />
      <Circle cx={x} cy={y} r={r * 2.6} fill={`url(#${id}bloom)`} />
      <Circle cx={x} cy={y} r={r} fill={core} />
    </>
  );
}

function Birds({ w, h, seed, n, x, y, color }: { w: number; h: number; seed: number; n: number; x: number; y: number; color: string }) {
  const d = useMemo(() => {
    const rand = rng(seed);
    let out = '';
    const u = Math.max(5, Math.min(w, h) * 0.014);
    for (let j = 0; j < n; j++) {
      const bx = w * x + (rand() - 0.3) * w * 0.22;
      const by = h * y + (rand() - 0.5) * h * 0.08;
      const k = u * (0.7 + rand() * 0.6);
      out += `M${bx - k} ${by - k * 0.35} Q${bx - k * 0.45} ${by - k * 0.6} ${bx} ${by} Q${bx + k * 0.45} ${by - k * 0.6} ${bx + k} ${by - k * 0.35} `;
    }
    return out;
  }, [w, h, seed, n, x, y]);
  return <Path d={d} fill="none" stroke={color} strokeWidth={Math.max(1.4, Math.min(w, h) * 0.0035)} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />;
}

function DawnSky({ w, h, id }: Part) {
  const r = Math.max(15, Math.min(w, h) * 0.045);
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6FA9D6" />
          <Stop offset="0.24" stopColor="#B9CFD8" />
          <Stop offset="0.4" stopColor="#FFD9A0" />
          <Stop offset="0.55" stopColor="#FFB27A" />
          <Stop offset="1" stopColor="#FFC98F" />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${id}g)`} />
      {/* the sun is just clearing the mountain's left shoulder: rays fan up and out across the sky */}
      <Birds w={w} h={h} seed={3} n={7} x={0.55} y={0.2} color="#6B4B54" />
      <Sun x={w * 0.14} y={h * 0.27} r={r} core="#FFF8E6" bloom="#FFE3A3" halo="#FFC97A" rays={0} rayOp={0} rayLen={Math.max(w, h) * 0.9} from={-Math.PI * 0.98} to={-Math.PI * 0.02} id={`${id}sun`} />
    </>
  );
}

function MorningSky({ w, h, id }: Part) {
  const r = Math.max(13, Math.min(w, h) * 0.036);
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1F8E9C" />
          <Stop offset="0.38" stopColor="#5FC2B8" />
          <Stop offset="0.7" stopColor="#BDE8D2" />
          <Stop offset="1" stopColor="#F4F1C8" />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${id}g)`} />
      <Birds w={w} h={h} seed={9} n={3} x={0.68} y={0.26} color="#154B4F" />
      <Sun x={w * 0.42} y={h * 0.1} r={r} core="#FFFFFF" bloom="#FFF6D8" halo="#FFF0C2" rays={0} rayOp={0} rayLen={Math.max(w, h) * 0.85} from={Math.PI * 0.45} to={Math.PI * 1.05} id={`${id}sun`} />
    </>
  );
}

function HighSky({ w, h, id }: Part) {
  const r = Math.max(13, Math.min(w, h) * 0.034);
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0A2A86" />
          <Stop offset="0.38" stopColor="#1F5FD0" />
          <Stop offset="0.7" stopColor="#8BBEF0" />
          <Stop offset="1" stopColor="#E4F0FC" />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${id}g)`} />
      <Sun x={w * 0.74} y={h * 0.08} r={r} core="#FFFFFF" bloom="#FFFFFF" halo="#DDEBFF" rays={0} rayOp={0} rayLen={Math.max(w, h)} from={Math.PI * 0.05} to={Math.PI * 0.7} id={`${id}sun`} />
    </>
  );
}

function DuskSky({ w, h, id }: Part) {
  const stars = useMemo(() => starField(w, h, 307, Math.round((w * h) / 7000), 0.42), [w, h]);
  const r = Math.max(26, Math.min(w, h) * 0.08);
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#14113F" />
          <Stop offset="0.28" stopColor="#38287A" />
          <Stop offset="0.5" stopColor="#7A3F8E" />
          <Stop offset="0.68" stopColor="#D2617A" />
          <Stop offset="0.82" stopColor="#F48A5E" />
          <Stop offset="1" stopColor="#FFC36E" />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${id}g)`} />
      <G fill="#FFFFFF">
        {stars.map(([x, y, rr, o], j) => (
          <Circle key={j} cx={x} cy={y} r={rr * 0.75} opacity={o * (1 - y / (h * 0.42))} />
        ))}
      </G>
      {/* a huge low sun setting into the cloud sea beside the summit */}
      <Sun x={w * 0.86} y={h * 0.8} r={r} core="#FFE9B8" bloom="#FFB067" halo="#FF8A5C" rays={0} rayOp={0} rayLen={Math.max(w, h)} from={-Math.PI * 0.95} to={-Math.PI * 0.2} id={`${id}sun`} />
    </>
  );
}

function NightSky({ w, h, id }: Part) {
  const S = useMemo(() => {
    const stars = starField(w, h, 401, Math.round((w * h) / 2400), 0.95);
    // the milky way: soft clouds of light along a diagonal, thick with faint stars
    const rand = rng(409);
    const band: [number, number, number][] = [];
    for (let j = 0; j < Math.round((w * h) / 1800); j++) {
      const t = rand();
      const off = (rand() - 0.5) * (rand() + rand()) * Math.min(w, h) * 0.16;
      band.push([w * (0.95 - t * 1.0) + off * 0.6, h * (0.05 + t * 0.5) + off, 0.25 + rand() * 0.75]);
    }
    const glows = Array.from({ length: 7 }, (_, j) => {
      const t = (j + 0.5) / 7;
      return [w * (0.95 - t * 1.0), h * (0.05 + t * 0.5), Math.min(w, h) * (0.12 + rand() * 0.1), j % 3] as [number, number, number, number];
    });
    // aurora curtains: a sharp bright lower edge that folds across the sky, with streaks of light rising from it and fading out
    const aur = [0, 1].map((j) => {
      const n = noise(431 + j * 7);
      const m = noise(491 + j * 5);
      const step = Math.max(2.5, w / 260);
      const cols: [number, number, number, number][] = []; // x, bottom y, height, strength
      for (let x = -step; x <= w + step; x += step) {
        const u = x / w;
        // the fold: the edge sweeps down from upper right toward the left, with an S in it
        const by = h * (j ? 0.2 : 0.3) - u * h * (j ? 0.06 : 0.14) + Math.sin(u * Math.PI * 2.2 + j) * h * 0.035 + n(x / 140) * h * 0.012;
        const ht = h * (j ? 0.12 : 0.2) * (0.55 + 0.45 * (0.5 + 0.5 * m(x / 26)));
        const fade = Math.min(1, Math.min(u + 0.15, 1.15 - u) * 3.5);
        cols.push([x, by, ht, Math.max(0, fade) * (0.55 + 0.45 * (0.5 + 0.5 * m(x / 9 + 3)))]);
      }
      let edge = '';
      for (const [x, by] of cols) edge += `${edge ? 'L' : 'M'}${x.toFixed(1)} ${by.toFixed(1)} `;
      return { cols, edge, step };
    });
    return { stars, band, glows, aur };
  }, [w, h]);
  const bright = S.stars.filter(([, , r]) => r > 1.45);
  const R = Math.max(w, h) * 1.6; // the curve of the earth, far below
  const tint = ['#8E7CFF', '#4FD3C4', '#FF8FC8'];
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#02031A" />
          <Stop offset="0.5" stopColor="#0B1142" />
          <Stop offset="0.82" stopColor="#1E2368" />
          <Stop offset="1" stopColor="#2F2C7C" />
        </LinearGradient>
        {tint.map((c, j) => (
          <RadialGradient key={j} id={`${id}neb${j}`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
            <Stop offset="0" stopColor={c} stopOpacity={0.22} />
            <Stop offset="1" stopColor={c} stopOpacity={0} />
          </RadialGradient>
        ))}
        <LinearGradient id={`${id}aur`} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#8DFFC4" stopOpacity={0.9} />
          <Stop offset="0.06" stopColor="#3DF5A0" stopOpacity={0.62} />
          <Stop offset="0.4" stopColor="#25C99A" stopOpacity={0.26} />
          <Stop offset="0.72" stopColor="#7A63FF" stopOpacity={0.14} />
          <Stop offset="1" stopColor="#C35CFF" stopOpacity={0} />
        </LinearGradient>
        <RadialGradient id={`${id}limb`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
          <Stop offset="0.955" stopColor="#5D7CFF" stopOpacity={0} />
          <Stop offset="0.982" stopColor="#8FB0FF" stopOpacity={0.6} />
          <Stop offset="0.994" stopColor="#FFE3A0" stopOpacity={0.85} />
          <Stop offset="1" stopColor="#FFE3A0" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}moon`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
          <Stop offset="0" stopColor="#FFF0C8" stopOpacity={0.5} />
          <Stop offset="1" stopColor="#FFF0C8" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={`${id}shoot`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.9} />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${id}g)`} />
      {S.glows.map(([x, y, r, c], j) => (
        <Circle key={j} cx={x} cy={y} r={r} fill={`url(#${id}neb${c})`} />
      ))}
      {S.aur.map((c, j) => (
        <G key={j} opacity={j ? 0.55 : 1}>
          {c.cols.map(([x, by, ht, o], q) => (
            <Rect key={q} x={x} y={by - ht} width={c.step + 0.6} height={ht + 2} fill={`url(#${id}aur)`} opacity={o} />
          ))}
          <Path d={c.edge} fill="none" stroke="#6BFFB8" strokeWidth={Math.max(8, h * 0.012)} strokeLinecap="round" opacity={0.18} />
          <Path d={c.edge} fill="none" stroke="#B8FFD8" strokeWidth={1.4} strokeLinecap="round" opacity={0.55} />
        </G>
      ))}
      <G fill="#E4E0FF">
        {S.band.map(([x, y, o], j) => (
          <Circle key={j} cx={x} cy={y} r={0.55} opacity={o * 0.8} />
        ))}
      </G>
      <G fill="#FFFFFF">
        {S.stars.map(([x, y, r, o], j) => (
          <Circle key={j} cx={x} cy={y} r={r * 0.75} opacity={o} />
        ))}
      </G>
      <G fill="#FFE9B0">
        {bright.map(([x, y, r], j) => (
          <Circle key={j} cx={x} cy={y} r={r * 2.8} opacity={0.14} />
        ))}
      </G>
      <Path d={`M${w * 0.18} ${h * 0.08} L${w * 0.42} ${h * 0.15}`} stroke={`url(#${id}shoot)`} strokeWidth={1.6} strokeLinecap="round" />
      <Circle cx={w * 0.82} cy={h * 0.1} r={Math.min(w, h) * 0.17} fill={`url(#${id}moon)`} />
      <Circle cx={w * 0.82} cy={h * 0.1} r={Math.min(w, h) * 0.042} fill="#FFF1CC" />
      <Circle cx={w / 2} cy={h * 0.93 + R} r={R} fill={`url(#${id}limb)`} />
    </>
  );
}

const SKIES = [DawnSky, MorningSky, HighSky, DuskSky, NightSky];

export function SkyLayer({ i, w, h }: { i: number; w: number; h: number }) {
  const C = SKIES[i];
  return (
    <Svg width={w} height={h}>
      <C w={w} h={h} id={`sky${i}`} />
    </Svg>
  );
}

// ---------------------------------------------------------------- moving light, for the Backdrop to animate

/** each sky's sun and its rays: position (fractions of the window), ray count, strength, colour and the arc they fan across */
export const RAYS = [
  { x: 0.14, y: 0.27, n: 7, op: 0.1, color: '#FFE4AC', len: 0.9, from: -Math.PI * 0.95, to: -Math.PI * 0.05 },
  { x: 0.42, y: 0.1, n: 8, op: 0.12, color: '#FFF0C2', len: 0.9, from: Math.PI * 0.12, to: Math.PI * 0.88 },
  { x: 0.74, y: 0.08, n: 9, op: 0.12, color: '#DDEBFF', len: 1, from: Math.PI * 0.3, to: Math.PI * 0.95 },
  { x: 0.86, y: 0.8, n: 9, op: 0.2, color: '#FF8A5C', len: 1, from: -Math.PI * 0.8, to: -Math.PI * 0.05 },
];

/** light rays fanning out from a sun, drawn in a square of side 2L centred on it (so the square can be rotated about the sun) */
export function Rays({ i, w, h }: { i: number; w: number; h: number }) {
  const R = RAYS[i];
  const L = Math.max(w, h) * R.len;
  const d = useMemo(() => {
    const rand = rng(97 + i * 11);
    const out: string[] = [];
    for (let j = 0; j < R.n; j++) {
      const t = (j + 0.5) / R.n;
      const a = R.from + (R.to - R.from) * t + (rand() - 0.5) * 0.1;
      const dd = 0.022 + rand() * 0.04;
      const len = L * (0.65 + rand() * 0.35);
      out.push(`M${L} ${L} L${L + Math.cos(a - dd) * len} ${L + Math.sin(a - dd) * len} L${L + Math.cos(a + dd) * len} ${L + Math.sin(a + dd) * len} Z`);
    }
    return out.join(' ');
  }, [i, L]);
  const id = `rays${i}`;
  return (
    <Svg width={L * 2} height={L * 2}>
      <Defs>
        <RadialGradient id={id} gradientUnits="userSpaceOnUse" cx={L} cy={L} r={L} fx={L} fy={L}>
          <Stop offset="0" stopColor={R.color} stopOpacity={R.op} />
          <Stop offset="0.55" stopColor={R.color} stopOpacity={R.op * 0.4} />
          <Stop offset="1" stopColor={R.color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Path d={d} fill={`url(#${id})`} />
    </Svg>
  );
}

/** the brightest stars of the night sky, in three groups that twinkle out of step */
export function Twinkle({ group, w, h }: { group: number; w: number; h: number }) {
  const stars = useMemo(() => starField(w, h, 401, Math.round((w * h) / 2400), 0.95).filter(([, , r], j) => r > 1.05 && j % 3 === group), [w, h, group]);
  return (
    <Svg width={w} height={h}>
      <G fill="#FFFFFF">
        {stars.map(([x, y, r], j) => (
          <Circle key={j} cx={x} cy={y} r={r * 1.05} />
        ))}
      </G>
      <G fill="#FFF0C0">
        {stars.map(([x, y, r], j) => (
          <Circle key={j} cx={x} cy={y} r={r * 3.2} opacity={0.16} />
        ))}
      </G>
    </Svg>
  );
}

/** a wall of cloud the camera flies up through when it crosses the cloudline */
export function CloudWall({ w, h }: { w: number; h: number }) {
  const P = useMemo(() => {
    const rand = rng(777);
    const out: [number, number, number][] = [];
    for (let y = 0; y < h * 0.9; y += 34) for (let x = -40; x < w + 60; x += 44 + rand() * 50) out.push([x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30, 40 + rand() * 60]);
    return out;
  }, [w, h]);
  return (
    <Svg width={w} height={h}>
      <G fill="#E4ECF8">
        {P.map(([x, y, r], j) => (
          <Ellipse key={j} cx={x} cy={y + r * 0.25} rx={r * 1.5} ry={r} />
        ))}
      </G>
      <G fill="#FFFFFF">
        {P.map(([x, y, r], j) => (
          <Ellipse key={j} cx={x - r * 0.2} cy={y} rx={r * 1.25} ry={r * 0.8} />
        ))}
      </G>
    </Svg>
  );
}
