import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, warnMsFor, QUICK_SEC, LEVELS } from './game.js';
import { distanceM, escapeExit, offsetM } from './geo.js';
import type { GameEvent } from './types.js';

// Fast-forward clock
let clock = 1_700_000_000_000;
const realNow = Date.now;
Date.now = () => clock;
const advance = (ms: number, room: Room, step = 250) => {
  for (let t = 0; t < ms; t += step) {
    clock += step;
    room.tick();
  }
};

const MCGILL = { lat: 45.5048, lng: -73.5772 };

function setup(humans = 2, durationSec = 600, autoAck = true) {
  const events: Array<[string, GameEvent]> = [];
  // phones ack every warning they receive (like the app does)
  const room: Room = new Room('TEST', (id, ev) => {
    events.push([id, ev]);
    if (autoAck && ev.kind === 'warn') room.ack(id, ev.strikeId);
  });
  const ps = Array.from({ length: humans }, (_, i) => room.addPlayer(`P${i}`));
  ps.forEach((p, i) => room.updatePosition(p.id, ...(Object.values(offsetM(MCGILL, i * 10, 0)) as [number, number]), 5, false));
  room.updateSettings({ durationSec });
  return { room, ps, events };
}

/** Keep every human's fix fresh where they stand. */
const hold = (room: Room) => {
  for (const p of room.humans()) if (p.lat != null) room.updatePosition(p.id, p.lat, p.lng!, 5, p.sim);
};

test('warning time always lets a walker escape', () => {
  for (const r of [9, 12, 15, 24]) {
    const ms = warnMsFor(r, 0, false);
    const walkable = (ms / 1000 - 3) * 1.3; // metres walkable after reaction time
    assert.ok(walkable >= r + 2, `r=${r} warn=${ms}`);
  }
});

test('the storm spawns cells, warns players with a direction, and its level rises', () => {
  const { room, events } = setup(2);
  room.start();
  for (let i = 0; i < 4 * 300; i++) {
    hold(room);
    for (const p of room.humans()) Object.assign(p, { hp: 3, status: 'alive' }); // they keep playing
    advance(250, room);
  }
  assert.ok(events.some(([, e]) => e.kind === 'warn' && !!e.moveDir && e.moveM > 0), 'players were warned with a direction');
  assert.ok(room.level >= 3, `level ${room.level} after half the game`);
  const levels = events.filter(([, e]) => e.kind === 'level').map(([, e]) => (e as any).level);
  assert.deepEqual([...new Set(levels)], [...Array(room.level - 1)].map((_, i) => i + 2), 'one announcement per level');
});

test('stale or weak GPS is never penalised', () => {
  const { room, ps } = setup(1);
  room.start();
  advance(5250, room);
  const p = ps[0];
  room.strikes = [];
  room.nextStrikeAt = Infinity;
  p.acc = 60; // weak fix
  room.strikes.push({ id: 's', lat: p.lat!, lng: p.lng!, r: 12, warnAt: clock, hitAt: clock + 100, kind: 'strike' });
  advance(500, room);
  assert.equal(p.hp, 3);
  p.acc = 5;
  p.lastFixAt = clock - 10_000; // stale
  room.strikes.push({ id: 's2', lat: p.lat!, lng: p.lng!, r: 12, warnAt: clock, hitAt: clock + 100, kind: 'strike' });
  advance(500, room);
  assert.equal(p.hp, 3);
  room.updatePosition(p.id, p.lat!, p.lng!, 5, false);
  room.strikes.push({ id: 's3', lat: p.lat!, lng: p.lng!, r: 12, warnAt: clock, hitAt: clock + 100, kind: 'strike' });
  advance(500, room);
  assert.equal(p.hp, 3, 'a strike you were never warned about (e.g. reconnecting inside it) cannot hit you');
  room.updatePosition(p.id, p.lat!, p.lng!, 5, false);
  p.warned.add('s4');
  p.warnedAt['s4'] = clock - 3000;
  p.warnedNeed['s4'] = 2000;
  room.strikes.push({ id: 's4', lat: p.lat!, lng: p.lng!, r: 12, warnAt: clock - 3000, hitAt: clock + 100, kind: 'strike' });
  advance(500, room);
  assert.equal(p.hp, 2, 'warned in time, fresh accurate fix inside the zone: hit');
});

test('walking out of a warned cell is a dodge', () => {
  const { room, ps, events } = setup(1);
  room.start();
  advance(5250, room);
  const p = ps[0];
  room.strikes = [];
  room.nextStrikeAt = Infinity;
  const s = { id: 'd1', lat: p.lat!, lng: p.lng!, r: 10, warnAt: clock, hitAt: clock + 12_000, kind: 'strike' as const };
  room.strikes.push(s);
  advance(250, room); // warned on entry
  const out = offsetM(s, 16, 0);
  for (let i = 0; i < 60; i++) {
    room.updatePosition(p.id, out.lat, out.lng, 5, false);
    advance(250, room);
  }
  assert.equal(p.hp, 3);
  assert.equal(p.dodges, 1);
  assert.ok(events.some(([, e]) => e.kind === 'dodge'));
});

test('walking to a downed teammate revives them', () => {
  const { room, ps } = setup(2);
  room.start();
  advance(5250, room);
  const [a, b] = ps;
  b.hp = 0;
  b.status = 'downed';
  const near = offsetM({ lat: b.lat!, lng: b.lng! }, 3, 0);
  for (let i = 0; i < 16; i++) {
    room.updatePosition(a.id, near.lat, near.lng, 5, false);
    room.updatePosition(b.id, b.lat!, b.lng!, 5, false);
    advance(250, room);
  }
  assert.equal(b.status, 'alive');
  assert.equal(a.revives, 1);
});

test('bots survive a game without crashing the engine', () => {
  const { room } = setup(1);
  room.setBots(4);
  room.start();
  advance(120_000, room);
  assert.ok(['playing', 'ended'].includes(room.phase));
  for (const p of room.players.values()) assert.ok(distanceM(room.center!, { lat: p.lat!, lng: p.lng! }) < 200);
});

test('rooms survive a snapshot/restore (redeploy)', () => {
  const { room, ps } = setup(2);
  room.start();
  advance(8000, room);
  const json = JSON.parse(JSON.stringify(room.snapshot()));
  const back = Room.restore(json, () => {});
  assert.equal(back.code, room.code);
  assert.equal(back.watchToken, room.watchToken);
  assert.equal(back.players.get(ps[0].id)!.secret, ps[0].secret);
  assert.equal(back.endsAt, room.endsAt);
  advance(1000, back);
  assert.equal(back.phase, 'playing');
});

test('a snapshot from the old photo game restores cleanly', () => {
  const { room } = setup(1);
  const old = { ...JSON.parse(JSON.stringify(room.snapshot())), prompt: { id: 'x' }, boss: { hp: 3, maxHp: 3 }, photos: [], usedPrompts: [], rounds: [], settings: { mode: 'siege', durationSec: 900, radiusM: 100, showPhotos: true, quick: false } };
  old.players = old.players.map((p: any) => ({ ...p, photos: 2, pocketMs: 10, pocketOn: false, dropped: false }));
  const back = Room.restore(old, () => {});
  const v = back.view() as any;
  assert.equal(v.prompt, undefined);
  assert.equal(v.boss, undefined);
  assert.deepEqual(Object.keys(back.settings).sort(), ['durationSec', 'quick', 'radiusM']);
  assert.equal('photos' in v.players[0], false);
});

test('disconnected or stale players cannot revive; jumps are quarantined; old fixes are ignored', () => {
  const { room, ps } = setup(2);
  room.start();
  advance(5250, room);
  const [a, b] = ps;
  b.hp = 0;
  b.status = 'downed';
  const near = offsetM({ lat: b.lat!, lng: b.lng! }, 3, 0);
  room.updatePosition(a.id, near.lat, near.lng, 5, false);
  room.setConnected(a.id, false);
  advance(5000, room);
  assert.equal(b.status, 'downed', 'a disconnected helper does not revive');
  room.setConnected(a.id, true);
  // implausible 500 m jump in one second is ignored
  const far = offsetM({ lat: a.lat!, lng: a.lng! }, 500, 0);
  clock += 1000;
  room.updatePosition(a.id, far.lat, far.lng, 5, false);
  assert.ok(distanceM({ lat: a.lat!, lng: a.lng! }, near) < 1, 'jump quarantined');
  // an old fix re-sent with a large age does not refresh the timestamp
  const before = a.lastFixAt;
  room.updatePosition(a.id, a.lat!, a.lng!, 5, false, 60_000);
  assert.equal(a.lastFixAt, before);
});

test('distance accumulates slow walking against an anchor', () => {
  const { room, ps } = setup(1);
  room.start();
  advance(5250, room);
  const p = ps[0];
  let pos = { lat: p.lat!, lng: p.lng! };
  for (let i = 0; i < 60; i++) {
    pos = offsetM(pos, 1.3, 0); // 1.3 m/s walk
    clock += 1000;
    room.updatePosition(p.id, pos.lat, pos.lng, 5, false);
  }
  assert.ok(p.distanceM > 65 && p.distanceM < 85, `walked ${p.distanceM}`);
});

test('demo preset: a short storm with a cell on a human within seconds', () => {
  const { room, ps, events } = setup(1);
  room.setBots(2);
  room.updateSettings({ quick: true });
  room.start();
  assert.equal(room.endsAt! - room.startsAt!, QUICK_SEC * 1000);
  for (let i = 0; i < 4 * 12; i++) {
    hold(room);
    advance(250, room);
  }
  assert.ok(events.some(([id, e]) => id === ps[0].id && e.kind === 'warn'), 'the first cell lands on the human');
});

test('surviving to the end wins; everyone down loses', () => {
  const a = setup(1, 60);
  a.room.start();
  a.room.nextStrikeAt = Infinity;
  for (let i = 0; i < 4 * 70 && a.room.phase !== 'ended'; i++) {
    a.room.nextStrikeAt = Infinity;
    hold(a.room);
    advance(250, a.room);
  }
  assert.equal(a.room.outcome, 'won');
  assert.equal(a.room.results!.ranking[0].survived, true);
  assert.equal(a.room.results!.team.peakLevel, LEVELS);

  const b = setup(1, 600);
  b.room.start();
  advance(5250, b.room);
  b.ps[0].hp = 0;
  b.ps[0].status = 'downed';
  advance(500, b.room);
  assert.equal(b.room.outcome, 'lost');
});

test('after a restore, an absent host hands over to a connected player', () => {
  const { room, ps } = setup(2);
  const back = Room.restore(JSON.parse(JSON.stringify(room.snapshot())), () => {});
  back.setConnected(ps[1].id, true);
  advance(50_000, back);
  assert.equal(back.hostId, ps[1].id);
});

test('no safe band at the arena edge: a player parked there still gets hit', () => {
  const { room, ps } = setup(1);
  room.updateSettings({ radiusM: 60, durationSec: 600 });
  room.start();
  advance(5250, room);
  const edge = offsetM(room.center!, 56, 0); // just inside the boundary
  for (let i = 0; i < 240 * 4 && ps[0].status === 'alive'; i++) {
    room.updatePosition(ps[0].id, edge.lat, edge.lng, 5, false);
    advance(250, room);
  }
  assert.ok(ps[0].hits > 0, `edge camper took ${ps[0].hits} hits`);
});

test('escape directions never point out of the arena', () => {
  const center = MCGILL;
  const zone = { ...offsetM(center, 55, 0), r: 12 };
  const player = offsetM(center, 60, 0); // outer side of a zone sitting on the edge
  const e = escapeExit(zone, player, center, 60);
  assert.ok(distanceM(center, e.exit) <= 65, 'exit stays inside the arena');
});

test('edge zone: the escape goes around the side, not back through the zone', () => {
  const center = { lat: 45.5, lng: -73.57 };
  const zone = { ...offsetM(center, 0, 55), r: 12 }; // zone touching the arena edge (radius 60)
  const player = offsetM(zone, 0, 8); // on the outer side of the zone
  const e = escapeExit(zone, player, center, 60);
  assert.ok(distanceM(center, e.exit) <= 65, 'exit stays in the arena');
  assert.ok(distanceM(zone, e.exit) >= zone.r, 'exit is out of the zone');
  assert.ok(e.m <= 14, `short route (${e.m} m), not the 23 m trip back through the zone`);
});

test('a warning the phone never acknowledged cannot hit', () => {
  const { room, ps } = setup(1, 600, false);
  room.start();
  advance(5250, room);
  room.strikes = [];
  room.nextStrikeAt = Infinity;
  const p = ps[0];
  room.strikes.push({ id: 'n1', lat: p.lat!, lng: p.lng!, r: 12, warnAt: clock, hitAt: clock + 9000, kind: 'strike' });
  for (let i = 0; i < 44; i++) {
    hold(room);
    advance(250, room);
  }
  assert.equal(p.hp, 3, 'never acked: no hit');
  room.strikes.push({ id: 'n2', lat: p.lat!, lng: p.lng!, r: 12, warnAt: clock, hitAt: clock + 20_000, kind: 'strike' });
  hold(room);
  advance(250, room);
  room.ack(p.id, 'n2');
  for (let i = 0; i < 84; i++) {
    hold(room);
    advance(250, room);
  }
  assert.equal(p.hp, 2, 'acked in time: hit');
});

test('a 30 m fix does not make normal cells harmless', () => {
  const { room, ps } = setup(1);
  room.start();
  advance(5250, room);
  room.strikes = [];
  room.nextStrikeAt = Infinity;
  const p = ps[0];
  const s = { id: 'a1', lat: p.lat!, lng: p.lng!, r: 10, warnAt: clock, hitAt: clock + 18_000, kind: 'strike' as const };
  room.strikes.push(s);
  for (let i = 0; i < 76; i++) {
    room.updatePosition(p.id, s.lat, s.lng, 30, false);
    advance(250, room);
  }
  assert.equal(p.hp, 2, 'standing in the middle with a 30 m fix still gets hit');
});

test('out of bounds: no points, and no win after the grace period', () => {
  const { room, ps } = setup(1, 60);
  room.updateSettings({ radiusM: 60 });
  room.start();
  advance(5250, room);
  const far = offsetM(room.center!, 120, 0);
  const before = ps[0].score;
  for (let i = 0; i < 4 * 70 && room.phase !== 'ended'; i++) {
    room.nextStrikeAt = Infinity;
    clock += 0;
    room.updatePosition(ps[0].id, far.lat, far.lng, 5, false);
    advance(250, room);
  }
  assert.ok(ps[0].score - before < 1, 'no survival points outside the zone');
  assert.equal(room.outcome, 'lost', 'parked outside the zone does not win');
});

test('a backgrounded phone cannot be hit, and the clock stops when everyone is away', () => {
  const { room, ps } = setup(1);
  room.start();
  advance(5250, room);
  room.strikes = [];
  room.nextStrikeAt = Infinity;
  const p = ps[0];
  room.strikes.push({ id: 'b1', lat: p.lat!, lng: p.lng!, r: 12, warnAt: clock, hitAt: clock + 9000, kind: 'strike' });
  hold(room);
  advance(250, room);
  room.setActive(p.id, false);
  const ends = room.endsAt!;
  for (let i = 0; i < 60; i++) advance(250, room);
  assert.equal(room.paused, 'away');
  assert.ok(room.endsAt! - ends >= 14_000, 'deadline moved with the pause');
  assert.equal(p.hp, 3);
  room.setActive(p.id, true);
  advance(500, room);
  assert.equal(room.paused, null);
});

test('host pause is penalty-free; bots only in practice rooms', () => {
  const { room, ps } = setup(1);
  room.setBots(3);
  assert.equal([...room.players.values()].filter((p) => p.bot).length, 0, 'no bots in a real game');
  room.updateSettings({ quick: true });
  room.setBots(2);
  assert.equal([...room.players.values()].filter((p) => p.bot).length, 2);
  room.start();
  advance(5250, room);
  room.strikes = [{ id: 'h1', lat: ps[0].lat!, lng: ps[0].lng!, r: 12, warnAt: clock, hitAt: clock + 6000, kind: 'strike' }];
  room.nextStrikeAt = Infinity;
  hold(room);
  advance(250, room);
  room.setPaused(true);
  for (let i = 0; i < 80; i++) advance(250, room);
  assert.equal(ps[0].hp, 3, 'nothing lands while paused');
  assert.ok(room.strikes.length === 1);
  room.setPaused(false);
  room.updateSettings({ quick: false });
});

test('after a redeploy the downtime does not count, and the clock waits for the crew', () => {
  const { room, ps } = setup(1);
  room.start();
  advance(6000, room);
  const ends = room.endsAt!;
  const snap = JSON.parse(JSON.stringify(room.snapshot()));
  clock += 30_000; // server down for 30 s
  const back = Room.restore(snap, () => {});
  assert.equal(back.endsAt, ends + 30_000);
  advance(5000, back);
  assert.equal(back.paused, 'reconnect');
  back.setConnected(ps[0].id, true);
  back.updatePosition(ps[0].id, ps[0].lat!, ps[0].lng!, 5, false);
  advance(500, back);
  assert.equal(back.paused, null);
});

test('nothing is scheduled to land after the storm passes', () => {
  const { room } = setup(2, 60);
  room.start();
  for (let i = 0; i < 4 * 70 && room.phase !== 'ended'; i++) {
    hold(room);
    for (const s of room.strikes) assert.ok(s.hitAt <= room.endsAt!, 'cell lands before the end');
    advance(250, room);
  }
  assert.equal(room.phase, 'ended');
  assert.equal(room.strikes.length, 0);
  Date.now = realNow;
});
