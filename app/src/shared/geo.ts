// Copied from server/src/geo.ts.
export type LatLng = { lat: number; lng: number };

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Haversine distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Offset a point by metres east (dx) and north (dy). Accurate at arena scale. */
export function offsetM(p: LatLng, dx: number, dy: number): LatLng {
  return {
    lat: p.lat + toDeg(dy / R),
    lng: p.lng + toDeg(dx / (R * Math.cos(toRad(p.lat)))),
  };
}

/** Local metres (east, north) of p relative to origin. */
export function toLocal(origin: LatLng, p: LatLng): { x: number; y: number } {
  return {
    x: toRad(p.lng - origin.lng) * R * Math.cos(toRad(origin.lat)),
    y: toRad(p.lat - origin.lat) * R,
  };
}

/** Compass bearing in degrees from a to b (0 = north). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const { x, y } = toLocal(a, b);
  return (toDeg(Math.atan2(x, y)) + 360) % 360;
}

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function compass(deg: number): string {
  return DIRS[Math.round(deg / 45) % 8];
}

/**
 * Where a player standing at `pos` should walk to leave zone `s`: straight out from the zone's centre,
 * unless that would leave the arena, in which case through the side facing the arena centre.
 * Shared by the server (warning time) and the app (arrow + voice), so they always agree.
 */
export function escapeExit(s: LatLng & { r: number }, pos: LatLng, center: LatLng | null, arenaR: number) {
  const v = toLocal(s, pos);
  const d = Math.hypot(v.x, v.y);
  const toCenter = center ? toLocal(s, center) : null;
  const cn = toCenter ? Math.hypot(toCenter.x, toCenter.y) : 0;
  let ux = 0;
  let uy = 1;
  if (d >= 1.5) {
    ux = v.x / d;
    uy = v.y / d;
  } else if (toCenter && cn > 3) {
    ux = toCenter.x / cn;
    uy = toCenter.y / cn;
  }
  const ring = s.r + 3;
  const inside = (p: LatLng) => !center || distanceM(center, p) <= arenaR + 5;
  let exit = offsetM(s, ux * ring, uy * ring);
  if (!inside(exit)) {
    // straight out leaves the arena: take the nearest point of the zone's edge that stays inside it
    let best = Infinity;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * 2 * Math.PI;
      const p = offsetM(s, Math.sin(a) * ring, Math.cos(a) * ring);
      const dd = distanceM(pos, p);
      if (inside(p) && dd < best) {
        best = dd;
        exit = p;
      }
    }
  }
  return { exit, m: Math.max(1, Math.ceil(distanceM(pos, exit))), deg: bearingDeg(pos, exit) };
}
