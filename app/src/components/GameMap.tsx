import React from 'react';
import { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { C, F } from '../theme';
import type { MapProps } from './mapTypes';
import { Cell, CellTag, Kit, Me, Probe, Scope } from './Radar';

/** The game radar: centred on you, rotated so up is the way you face. Same on every platform. */
export default function GameMap({ room, meId, myFix, now, escape, heading, size }: MapProps & { size: number }) {
  const me = room.players.find((p) => p.id === meId);
  const origin = myFix ?? (me?.lat != null ? { lat: me.lat, lng: me.lng! } : room.center) ?? { lat: 0, lng: 0 };
  const spanM = Math.max(45, Math.min(room.settings.radiusM * 0.8, 90)); // metres from you to the scope edge
  const c = size / 2;
  const scale = (c - 2) / spanM;
  const h = ((heading ?? 0) * Math.PI) / 180;
  const toXY = (lat: number, lng: number) => {
    const x = (((lng - origin.lng) * Math.PI) / 180) * 6371000 * Math.cos((origin.lat * Math.PI) / 180);
    const y = (((lat - origin.lat) * Math.PI) / 180) * 6371000;
    const rx = x * Math.cos(h) - y * Math.sin(h);
    const ry = x * Math.sin(h) + y * Math.cos(h);
    return { x: c + rx * scale, y: c - ry * scale };
  };

  const cells = room.strikes.map((s) => {
    const p = toXY(s.lat, s.lng);
    return { s, p, r: s.r * scale, k: Math.min(1, Math.max(0, (now - s.warnAt) / (s.hitAt - s.warnAt))), sec: Math.ceil((s.hitAt - now) / 1000) };
  });

  // names go above, below, right or left of each dot: wherever they hit no other name, dot or cell tag
  const others = room.players.filter((p) => p.id !== meId && p.lat != null);
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [
    { x: c, y: c, w: 22, h: 22 },
    ...others.map((p) => ({ ...toXY(p.lat!, p.lng!), w: 11, h: 11 })),
    ...cells.map(({ p, r }) => ({ x: p.x, y: p.y - r, w: 16, h: 11 })),
  ];
  const hits = (b: { x: number; y: number; w: number; h: number }) => boxes.some((o) => Math.abs(o.x - b.x) < o.w + b.w && Math.abs(o.y - b.y) < o.h + b.h);

  return (
    <Scope size={size} spanM={spanM} heading={heading} labels={false}>
      {room.center &&
        (() => {
          const a = toXY(room.center.lat, room.center.lng);
          return <Circle cx={a.x} cy={a.y} r={room.settings.radiusM * scale} fill="none" stroke={C.ink} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="2 7" strokeLinecap="round" />;
        })()}
      {cells.map(({ s, p, r, k }) => (
        <Cell key={s.id} x={p.x} y={p.y} r={r} k={k} mega={s.kind === 'mega'} />
      ))}
      {room.orbs.map((o) => {
        const p = toXY(o.lat, o.lng);
        return o.kind === 'kit' ? <Kit key={o.id} x={p.x} y={p.y} /> : <Probe key={o.id} x={p.x} y={p.y} />;
      })}
      {escape &&
        (() => {
          const e = toXY(escape.lat, escape.lng);
          const ang = Math.atan2(e.y - c, e.x - c);
          const len = Math.max(Math.hypot(e.x - c, e.y - c) + 14, 64);
          const b = { x: c + len * Math.cos(ang), y: c + len * Math.sin(ang) };
          const s0 = { x: c + 26 * Math.cos(ang), y: c + 26 * Math.sin(ang) };
          const wing = (dx: number) => `${b.x - 18 * Math.cos(ang - dx)},${b.y - 18 * Math.sin(ang - dx)}`;
          const tip = { x: b.x + 4 * Math.cos(ang), y: b.y + 4 * Math.sin(ang) };
          return (
            <G>
              <Line x1={s0.x} y1={s0.y} x2={b.x} y2={b.y} stroke={C.white} strokeWidth={11} strokeLinecap="round" />
              <Line x1={s0.x} y1={s0.y} x2={b.x} y2={b.y} stroke={C.ink} strokeWidth={6} strokeLinecap="round" />
              <Path d={`M${tip.x},${tip.y} L${wing(0.55)} L${wing(-0.55)} Z`} fill={C.ink} stroke={C.white} strokeWidth={2} strokeLinejoin="round" />
            </G>
          );
        })()}
      {others.map((p) => {
        const q = toXY(p.lat!, p.lng!);
        const downed = p.status === 'downed';
        const name = p.name;
        const hw = name.length * 3.7 + 4;
        const spots = [
          { x: q.x, y: q.y - 15, a: 'middle' as const, cx: q.x },
          { x: q.x, y: q.y + 24, a: 'middle' as const, cx: q.x },
          { x: q.x + 14, y: q.y + 5, a: 'start' as const, cx: q.x + 14 + hw },
          { x: q.x - 14, y: q.y + 5, a: 'end' as const, cx: q.x - 14 - hw },
        ];
        const spot = spots.find((s) => !hits({ x: s.cx, y: s.y - 4, w: hw, h: 8 })) ?? (p.bot ? null : spots[0]);
        if (spot) boxes.push({ x: spot.cx, y: spot.y - 4, w: hw, h: 8 });
        return (
          <G key={p.id}>
            {downed && <Circle cx={q.x} cy={q.y} r={12 * scale} fill="none" stroke={C.ink} strokeDasharray="3 5" strokeWidth={1.5} />}
            <Circle cx={q.x} cy={q.y} r={7.5} fill={downed ? C.surface : p.color} stroke={downed ? C.ink : C.white} strokeWidth={2.5} />
            {spot && (
              <G>
                <SvgText x={spot.x} y={spot.y} fill={C.surface} fontSize={12} textAnchor={spot.a} fontFamily={F.bodyBold} stroke={C.surface} strokeWidth={4} strokeLinejoin="round">
                  {downed ? `${name} is down` : name}
                </SvgText>
                <SvgText x={spot.x} y={spot.y} fill={C.ink} fontSize={12} textAnchor={spot.a} fontFamily={F.bodyBold}>
                  {downed ? `${name} is down` : name}
                </SvgText>
              </G>
            )}
          </G>
        );
      })}
      {/* your own cell's countdown is on the instruction panel; tag the others */}
      {cells.map(({ s, p, r, sec }) => (sec > 0 && Math.hypot(p.x - c, p.y - c) > r ? <CellTag key={`t${s.id}`} x={p.x} y={p.y - r} sec={sec} /> : null))}
      <Me x={c} y={c} downed={me?.status === 'downed'} />
    </Scope>
  );
}
