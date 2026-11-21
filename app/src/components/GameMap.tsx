import React from 'react';
import { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { C, F } from '../theme';
import type { MapProps } from './mapTypes';
import { Cell, Kit, Me, Probe, Scope } from './Radar';

/** The game radar: centred on you, rotated so up is the way you face. Same on every platform. */
export default function GameMap({ room, meId, myFix, now, escape, heading, size }: MapProps & { size: number }) {
  const me = room.players.find((p) => p.id === meId);
  const origin = myFix ?? (me?.lat != null ? { lat: me.lat, lng: me.lng! } : room.center) ?? { lat: 0, lng: 0 };
  const spanM = Math.max(50, Math.min(room.settings.radiusM * 0.9, 110)); // metres from you to the scope edge
  const c = size / 2;
  const scale = (c - 1) / spanM;
  const h = ((heading ?? 0) * Math.PI) / 180;
  const toXY = (lat: number, lng: number) => {
    const x = (((lng - origin.lng) * Math.PI) / 180) * 6371000 * Math.cos((origin.lat * Math.PI) / 180);
    const y = (((lat - origin.lat) * Math.PI) / 180) * 6371000;
    const rx = x * Math.cos(h) - y * Math.sin(h);
    const ry = x * Math.sin(h) + y * Math.cos(h);
    return { x: c + rx * scale, y: c - ry * scale };
  };

  // labels: above, below, right or left of each dot, wherever they hit no other label or dot
  const others = room.players.filter((p) => p.id !== meId && p.lat != null);
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [
    { x: c, y: c, w: 18, h: 18 },
    ...others.map((p) => ({ ...toXY(p.lat!, p.lng!), w: 10, h: 10 })),
    // each cell's countdown sits near its top: names keep clear of it
    ...room.strikes.map((s) => {
      const q = toXY(s.lat, s.lng);
      return { x: q.x, y: q.y - s.r * scale * 0.6, w: 10, h: 9 };
    }),
  ];
  const hits = (b: { x: number; y: number; w: number; h: number }) => boxes.some((o) => Math.abs(o.x - b.x) < o.w + b.w && Math.abs(o.y - b.y) < o.h + b.h);

  return (
    <Scope size={size} spanM={spanM} heading={heading}>
      {room.center &&
        (() => {
          const a = toXY(room.center.lat, room.center.lng);
          return <Circle cx={a.x} cy={a.y} r={room.settings.radiusM * scale} fill="none" stroke={C.amber} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="10 6" />;
        })()}
      {room.strikes.map((s) => {
        const p = toXY(s.lat, s.lng);
        const k = Math.min(1, Math.max(0, (now - s.warnAt) / (s.hitAt - s.warnAt)));
        return <Cell key={s.id} x={p.x} y={p.y} r={s.r * scale} k={k} mega={s.kind === 'mega'} sec={Math.ceil((s.hitAt - now) / 1000)} />;
      })}
      {room.orbs.map((o) => {
        const p = toXY(o.lat, o.lng);
        return o.kind === 'kit' ? <Kit key={o.id} x={p.x} y={p.y} /> : <Probe key={o.id} x={p.x} y={p.y} />;
      })}
      {escape &&
        (() => {
          const e = toXY(escape.lat, escape.lng);
          const ang = Math.atan2(e.y - c, e.x - c);
          const len = Math.max(Math.hypot(e.x - c, e.y - c) + 10, 56); // always long enough to read
          const b = { x: c + len * Math.cos(ang), y: c + len * Math.sin(ang) };
          const tip = { x: b.x + 4 * Math.cos(ang), y: b.y + 4 * Math.sin(ang) };
          const s0 = { x: c + 22 * Math.cos(ang), y: c + 22 * Math.sin(ang) }; // start clear of your marker
          const wing = (dx: number) => `${b.x - 16 * Math.cos(ang - dx)},${b.y - 16 * Math.sin(ang - dx)}`;
          return (
            <G>
              <Line x1={s0.x} y1={s0.y} x2={b.x} y2={b.y} stroke={C.bg} strokeWidth={10} strokeLinecap="round" />
              <Line x1={s0.x} y1={s0.y} x2={b.x} y2={b.y} stroke={C.ink} strokeWidth={5} strokeLinecap="round" />
              <Path d={`M${tip.x},${tip.y} L${wing(0.55)} L${wing(-0.55)} Z`} fill={C.ink} stroke={C.bg} strokeWidth={1.5} />
            </G>
          );
        })()}
      {others.map((p) => {
        const q = toXY(p.lat!, p.lng!);
        const downed = p.status === 'downed';
        const name = p.bot ? `${p.name}` : p.name;
        const hw = name.length * 3.4 + 4;
        const spots = [
          { x: q.x, y: q.y - 14, a: 'middle' as const, cx: q.x },
          { x: q.x, y: q.y + 22, a: 'middle' as const, cx: q.x },
          { x: q.x + 13, y: q.y + 4, a: 'start' as const, cx: q.x + 13 + hw },
          { x: q.x - 13, y: q.y + 4, a: 'end' as const, cx: q.x - 13 - hw },
        ];
        const spot = spots.find((s) => !hits({ x: s.cx, y: s.y - 4, w: hw, h: 7 })) ?? (p.bot ? null : spots[0]);
        if (spot) boxes.push({ x: spot.cx, y: spot.y - 4, w: hw, h: 7 });
        return (
          <G key={p.id}>
            {downed && <Circle cx={q.x} cy={q.y} r={12 * scale} fill="none" stroke={C.amber} strokeDasharray="4 4" strokeWidth={1.5} />}
            <Circle cx={q.x} cy={q.y} r={6.5} fill={downed ? C.bg : p.color} stroke={downed ? C.amber : C.bg} strokeWidth={2} />
            {spot && (
              <SvgText x={spot.x} y={spot.y} fill={downed ? C.amber : C.ink} fillOpacity={p.bot ? 0.7 : 1} fontSize={11} textAnchor={spot.a} fontFamily={F.mono}>
                {downed ? `${name} DOWN` : name}
              </SvgText>
            )}
          </G>
        );
      })}
      <Me x={c} y={c} downed={me?.status === 'downed'} />
    </Scope>
  );
}
