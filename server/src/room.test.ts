import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTDOWN_MS, HUNT_MS, MAX_TRIES, QUICK_HUNT_MS, REVEAL_MAX_MS as REVEAL_MS, Room, LOBBY_IDLE_MS, revealMsFor } from './room.js';
import { scoreFind, tierFor, normalizeLabel, canonicalLabel } from './rarity.js';
import { INDOOR, OUTDOOR, dailyPrompts, squadPrompts, seeded, torontoDay, nextTorontoMidnight, QUICK_OPENER } from './prompts.js';
import type { Card, PromptDef } from './types.js';

// ---------- fake clock ----------
function setup(quick = false, n = 2) {
  const clock = { t: 1_800_000_000_000 };
  const now = () => clock.t;
  const room = new Room('ABCD', quick, now, (q) => squadPrompts(q, seeded('test')));
  const ps = Array.from({ length: n }, (_, i) => room.addPlayer(`P${i}`, `device${i}`.padEnd(32, '0')));
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      clock.t += step;
      room.tick();
    }
  };
  return { room, ps, clock, advance, now };
}

let seq = 0;
function card(label: string, playerName: string, points = 10, rarity = 20, playerId?: string): Card {
  const id = `card${++seq}`.padEnd(24, '0');
  return { id, promptId: 'x', promptText: 'x', label, title: label, tier: tierFor(rarity), points, rarity, sameCount: 1, totalCount: 1, verdict: 'ok', photo: `/p/${id}.jpg`, mode: 'squad', playerName, playerId, at: seq };
}

function find(room: Room, playerId: string, sub: string, label: string | null, pts = 10, rarity = 20) {
  const pre = room.precheck(playerId, sub);
  if (pre.kind !== 'ok') return pre.reply;
  const name = room.players.get(playerId)!.name;
  return room.settle(playerId, sub, pre.round, label ? { accepted: true } : { accepted: false, reason: 'no_match', verdict: 'Not quite.' }, () => card(label!, name, pts, rarity, playerId));
}

// ---------- phase flow ----------
test('phase flow: lobby -> countdown(3s) -> hunting -> reveal(8s) -> ... -> ended', () => {
  const { room, ps, advance, now } = setup();
  assert.equal(room.phase, 'lobby');
  assert.equal(room.view().round, 0);
  assert.equal(room.start(ps[1].id), false, 'only the host starts');
  assert.equal(room.start(ps[0].id), true);
  assert.equal(room.phase, 'countdown');
  assert.equal(room.endsAt, now() + COUNTDOWN_MS);
  advance(COUNTDOWN_MS - 250);
  assert.equal(room.phase, 'countdown');
  advance(250);
  assert.equal(room.phase, 'hunting');
  assert.equal(room.round, 1);
  assert.equal(room.endsAt, now() + HUNT_MS);
  for (let r = 1; r <= 5; r++) {
    assert.equal(room.phase, 'hunting', `round ${r} hunting`);
    assert.equal(room.view().round, r);
    assert.ok(room.view().prompt);
    advance(HUNT_MS);
    assert.equal(room.phase, 'reveal', `round ${r} reveal`);
    assert.deepEqual(room.view().reveal, []);
    assert.equal(room.view().rounds.length, r);
    assert.equal(room.view().revealMs, revealMsFor(0));
    advance(revealMsFor(0));
  }
  assert.equal(room.phase, 'ended');
  assert.equal(room.view().rounds.length, 5);
  assert.equal(room.view().prompt, null);
  assert.equal(room.view().endsAt, null);
  // again -> lobby with the same players
  assert.equal(room.again(ps[1].id), false);
  assert.equal(room.again(ps[0].id), true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.size, 2);
  assert.deepEqual(room.view().rounds, []);
});

test('five prompts per game, never two from one category; quick uses the indoor set and opens with something red', () => {
  const { room, ps } = setup(true);
  room.start(ps[0].id);
  assert.equal(room.prompts.length, 5);
  assert.equal(room.prompts[0].id, QUICK_OPENER);
  assert.equal(room.prompts[0].text, 'something red');
  assert.ok(room.prompts.every((p) => INDOOR.includes(p)));
  assert.equal(new Set(room.prompts.map((p) => p.cat)).size, 5);
  const out = squadPrompts(false, seeded('x'));
  assert.ok(out.every((p) => OUTDOOR.includes(p)));
  assert.equal(new Set(out.map((p) => p.cat)).size, 5);
});

test('settings: host toggles quick in the lobby only; prompt view carries examples', () => {
  const { room, ps, advance } = setup(false);
  assert.equal(room.setQuick(ps[1].id, true), false);
  assert.equal(room.setQuick(ps[0].id, true), true);
  assert.equal(room.view().quick, true);
  room.start(ps[0].id);
  assert.equal(room.setQuick(ps[0].id, false), false, 'not after start');
  advance(COUNTDOWN_MS);
  assert.equal(room.view().prompt!.id, QUICK_OPENER);
  assert.ok(room.view().prompt!.examples);
  assert.equal((room.view().prompt as any).cat, undefined, 'internal fields stay private');
});

test('quick hunt lasts 60 s; host skip ends the prompt now', () => {
  const { room, ps, advance, now } = setup(true);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  assert.equal(room.endsAt, now() + QUICK_HUNT_MS);
  assert.equal(room.skip(ps[1].id), false);
  assert.equal(room.skip(ps[0].id), true);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.skip(ps[0].id), true, 'skip during reveal moves on');
  assert.equal(room.phase, 'hunting');
  assert.equal(room.round, 2);
});

test('early end when everyone has found something; reveal sorted rarest first', () => {
  const { room, ps, advance } = setup(false, 3);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  find(room, ps[0].id, 's1', 'fire hydrant', 10, 12);
  assert.equal(room.view().players.find((p) => p.id === ps[0].id)!.found, true);
  assert.equal(room.view().players.find((p) => p.id === ps[1].id)!.found, false);
  find(room, ps[1].id, 's2', 'red cardinal', 85, 90);
  assert.equal(room.phase, 'hunting', 'still waiting for P2');
  assert.equal(room.view().reveal, null, 'no cards visible while hunting');
  find(room, ps[2].id, 's3', 'stop sign', 30, 50);
  assert.equal(room.phase, 'reveal');
  const rev = room.view().reveal!;
  assert.deepEqual(rev.map((c) => c.label), ['red cardinal', 'stop sign', 'fire hydrant']);
  assert.equal(room.players.get(ps[1].id)!.score, 85);
});

test('a disconnected (pocketed) player still counts toward "everyone found"; an explicit leave does not', () => {
  const { room, ps, advance } = setup(false, 3);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  room.setConnected(ps[1].id, false);
  find(room, ps[0].id, 's1', 'fire hydrant');
  assert.equal(room.phase, 'hunting', 'P1 is offline but still playing');
  find(room, ps[1].id, 's2', 'stop sign');
  assert.equal(room.phase, 'hunting');
  room.removePlayer(ps[2].id);
  assert.equal(room.phase, 'reveal', 'the last one left, everyone remaining has a find');
});

test('reveal holds for a photo sent before the deadline until its verdict lands (bounded at 20 s)', () => {
  const { room, ps, advance, now } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  advance(HUNT_MS - 1000);
  const pre = room.precheck(ps[0].id, 'slow'); // 1 s before expiry
  assert.equal(pre.kind, 'ok');
  advance(1000);
  assert.equal(room.phase, 'reveal');
  advance(9000); // 9 s verdict
  assert.equal(room.phase, 'reveal', 'held for the in-flight verdict');
  assert.equal(room.round, 1);
  const r = room.settle(ps[0].id, 'slow', 1, { accepted: true }, () => card('pigeon', 'P0', 30, 50, ps[0].id));
  assert.equal((r.body as any).accepted, true);
  assert.equal(room.view().reveal!.length, 1, 'the late card is in the reveal');
  assert.ok(room.endsAt! - now() >= 3000, 'and stays on screen a moment');
  advance(5000);
  assert.equal(room.phase, 'hunting');
  assert.equal(room.round, 2);
  assert.equal(room.view().rounds[0].cards.length, 1);
  // a verdict that never lands stops holding after the grace window
  const pre2 = room.precheck(ps[1].id, 'lost');
  assert.equal(pre2.kind, 'ok');
  room.skip(ps[0].id);
  room.skip(ps[0].id);
  assert.equal(room.phase, 'reveal', 'host skip waits for the verdict too');
  advance(21_000);
  assert.equal(room.round, 3, 'bounded hold');
});

test('host away for 30 s in the lobby or after the game: role passes to a connected player', () => {
  const { room, ps, advance } = setup(false, 3);
  room.setConnected(ps[0].id, false);
  advance(29_000);
  assert.equal(room.hostId, ps[0].id);
  advance(1500);
  assert.equal(room.hostId, ps[1].id);
  // not mid-game
  room.start(ps[1].id);
  room.setConnected(ps[1].id, false);
  advance(COUNTDOWN_MS + 40_000);
  assert.equal(room.hostId, ps[1].id);
  // came back in time: keeps it
  room.setConnected(ps[1].id, true);
  room.skip(ps[1].id);
  assert.ok(room.phase === 'reveal');
});

test('results: best card per player and round winners', () => {
  const { room, ps, advance } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const a1 = find(room, ps[0].id, 'a1', 'fire hydrant', 10, 12);
  const b1 = find(room, ps[1].id, 'b1', 'red cardinal', 85, 90);
  room.skip(ps[0].id);
  const a2 = find(room, ps[0].id, 'a2', 'old millstone', 100, 98);
  room.skip(ps[0].id); // reveal 2
  room.skip(ps[0].id); // hunting 3
  room.skip(ps[0].id); // reveal 3, nobody found anything
  const v = room.view();
  const id = (r: any) => r.body.card.id;
  assert.deepEqual(v.best, { [ps[0].id]: id(a2), [ps[1].id]: id(b1) });
  assert.deepEqual(v.roundWinners, [ps[1].id, ps[0].id, null]);
  assert.equal(v.rounds[0].cards.find((c) => c.playerId === ps[0].id)!.id, id(a1));
  assert.deepEqual(v.winners, [], 'winners only once the game has ended');
  while (room.phase !== 'ended') room.skip(ps[0].id);
  assert.deepEqual(room.view().winners, [ps[0].id], 'P0 110 vs P1 85');
});

test('winners: ties list everyone on the top score; nobody when all are 0', () => {
  const { room, ps } = setup(false, 3);
  room.start(ps[0].id);
  room.skip(ps[0].id); // countdown -> hunting
  find(room, ps[0].id, 'a', 'bench', 30, 50);
  find(room, ps[1].id, 'b', 'stop sign', 30, 50);
  while (room.phase !== 'ended') room.skip(ps[0].id);
  assert.deepEqual(room.view().winners, [ps[0].id, ps[1].id]);
  const z = setup(false, 2);
  z.room.start(z.ps[0].id);
  while (z.room.phase !== 'ended') z.room.skip(z.ps[0].id);
  assert.deepEqual(z.room.view().winners, []);
});

// ---------- rarity ----------
test('rarity math: AI decides at first, crowd takes over', () => {
  // first find ever: w = 0 -> ai
  assert.deepEqual(scoreFind(42, 1, 1, true), { rarity: 42, tier: 'uncommon', points: 30 });
  // first-ever find of a label with ai >= 80 -> One of One
  assert.equal(scoreFind(80, 1, 1, true).tier, 'one');
  assert.equal(scoreFind(80, 1, 1, true).points, 100);
  assert.equal(scoreFind(79, 1, 1, true).tier, 'rare');
  // total 26 -> w = 1, pure crowd: 100*(1-13/26) = 50
  assert.equal(scoreFind(0, 13, 26, false).rarity, 50);
  // total 11 -> w = 0.4; crowd = 100*(1-5/11) = 54.5; 0.4*54.5 + 0.6*90 = 75.8 -> 76
  assert.equal(scoreFind(90, 5, 11, false).rarity, 76);
  // 3 of 412: crowd 99.27 -> 99 -> one
  assert.deepEqual(scoreFind(10, 3, 412, false), { rarity: 99, tier: 'one', points: 100 });
  // fire hydrant everybody finds
  assert.equal(scoreFind(20, 300, 412, false).tier, 'common');
});

test('tiers and points at every boundary', () => {
  const cases: [number, string, number][] = [
    [0, 'common', 10], [39, 'common', 10], [40, 'uncommon', 30], [64, 'uncommon', 30], [65, 'rare', 60],
    [84, 'rare', 60], [85, 'epic', 85], [96, 'epic', 85], [97, 'one', 100], [100, 'one', 100],
  ];
  for (const [r, tier] of cases) assert.equal(tierFor(r), tier, `rarity ${r}`);
  // a big crowd with sameCount 1 and high ai is still One of One (first ever of that label)
  assert.equal(scoreFind(85, 1, 500, true).tier, 'one');
  assert.equal(scoreFind(50, 1, 500, false).rarity, 100);
  // a deduplicated find (re-submitted photo / same device) never gets the first-ever bonus, even with sameCount 1
  assert.equal(scoreFind(85, 1, 1, false).tier, 'epic');
  assert.equal(scoreFind(85, 1, 1, false).points, 85);
});

test('label normalization', () => {
  assert.equal(normalizeLabel('  The Red  Cardinal. '), 'red cardinal');
  assert.equal(normalizeLabel('A fire hydrant'), 'fire hydrant');
  assert.equal(normalizeLabel('an old rusty iron gate post thing'), 'old rusty iron gate');
  assert.equal(canonicalLabel('fire hydrants', { 'fire hydrant': 3 }), 'fire hydrant');
  assert.equal(canonicalLabel('bus', { bench: 1 }), 'bus');
});

// ---------- submissions ----------
test('idempotent submissionId: the same submission returns the same reply and scores once', () => {
  const { room, ps, advance } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  let minted = 0;
  const go = () => {
    const pre = room.precheck(ps[0].id, 'same-sub');
    if (pre.kind !== 'ok') return pre.reply;
    return room.settle(ps[0].id, 'same-sub', pre.round, { accepted: true }, () => (minted++, card('bench', 'P0', 30, 50)));
  };
  const a = go();
  const b = go();
  assert.deepEqual(a, b);
  assert.equal(minted, 1);
  assert.equal(room.players.get(ps[0].id)!.score, 0, 'no points shown while the hunt runs');
  // a new submission after locking is refused
  const c = find(room, ps[0].id, 'other', 'bench');
  assert.equal((c.body as any).error, 'locked');
  // settle called twice for the same id returns the stored reply too
  const d = room.settle(ps[0].id, 'same-sub', 1, { accepted: true }, () => (minted++, card('x', 'P0')));
  assert.deepEqual(d, a);
  assert.equal(minted, 1);
});

test('tries cap: six judged tries per round, then locked; AI failures cost nothing', () => {
  const { room, ps, advance } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const pre = room.precheck(ps[0].id, 'fail');
  assert.equal(pre.kind, 'ok');
  room.abort(ps[0].id, 'fail');
  for (let i = 1; i <= MAX_TRIES; i++) {
    const r = find(room, ps[0].id, `t${i}`, null);
    assert.equal((r.body as any).accepted, false);
    assert.equal((r.body as any).triesLeft, MAX_TRIES - i);
  }
  const over = find(room, ps[0].id, 't7', 'bench');
  assert.equal(over.status, 409);
  assert.equal((over.body as any).error, 'locked');
  // next round resets tries
  room.skip(ps[0].id);
  room.skip(ps[0].id);
  assert.equal((find(room, ps[0].id, 'r2', 'bench').body as any).accepted, true);
});

test('one photo at a time per player; closed outside hunting; late verdicts within grace still count', () => {
  const { room, ps, advance } = setup(false, 2);
  assert.equal((room.precheck(ps[0].id, 'early').kind), 'error');
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const pre = room.precheck(ps[0].id, 'slow');
  assert.equal(pre.kind, 'ok');
  const dup = room.precheck(ps[0].id, 'second');
  assert.equal(dup.kind, 'error');
  assert.equal((dup as any).reply.body.error, 'rate');
  // the hunt times out while the AI is thinking
  advance(HUNT_MS);
  assert.equal(room.phase, 'reveal');
  const late = room.settle(ps[0].id, 'slow', 1, { accepted: true }, () => card('pigeon', 'P0', 30, 50));
  assert.equal((late.body as any).accepted, true);
  assert.equal(room.view().reveal!.length, 1, 'late card joins the reveal');
  // received after the hunt ended -> closed
  const after = room.precheck(ps[1].id, 'after');
  assert.equal(after.kind, 'error');
  assert.equal((after as any).reply.body.error, 'closed');
  // a verdict landing after the next round started is closed
  advance(REVEAL_MS);
  const p2 = room.precheck(ps[1].id, 'r2');
  assert.equal(p2.kind, 'ok');
  room.skip(ps[0].id);
  room.skip(ps[0].id);
  assert.equal(room.phase, 'reveal', 'held for the in-flight verdict');
  advance(21_000); // the verdict never came back within the grace window
  assert.equal(room.round, 3);
  const stale = room.settle(ps[1].id, 'r2', 2, { accepted: true }, () => card('x', 'P1'));
  assert.equal((stale.body as any).error, 'closed');
});

test('"same as" inside a room: matching labels in a round name each other', () => {
  const { room, ps, advance } = setup(false, 3);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  find(room, ps[0].id, 'a', 'fire hydrant');
  find(room, ps[1].id, 'b', 'fire hydrant');
  find(room, ps[2].id, 'c', 'red door');
  const rev = room.view().reveal!;
  const byName = Object.fromEntries(rev.map((c) => [c.playerName, c]));
  assert.deepEqual(byName.P0.sameAs, ['P1']);
  assert.deepEqual(byName.P1.sameAs, ['P0']);
  assert.equal(byName.P2.sameAs, undefined);
  assert.deepEqual(room.view().rounds[0].cards.find((c) => c.playerName === 'P0')!.sameAs, ['P1']);
});

// ---------- persistence ----------
test('resume after a snapshot restore: same phase, timers paused for the downtime, finds and replies kept', () => {
  const { room, ps, advance, clock, now } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  advance(10_000);
  const r1 = find(room, ps[0].id, 'keep', 'fire hydrant', 60, 70);
  const left = room.endsAt! - now();
  const snap = JSON.parse(JSON.stringify(room.snapshot()));
  clock.t += 45_000; // redeploy downtime
  const back = Room.restore(snap, now, (q) => squadPrompts(q, seeded('test')));
  assert.equal(back.phase, 'hunting');
  assert.equal(back.round, 1);
  assert.equal(back.endsAt! - now(), left, 'no hunting time lost to the redeploy');
  assert.ok(back.view().players.every((p) => !p.connected), 'everyone reconnects via resume');
  assert.ok(back.auth(ps[0].id, ps[0].secret), 'resume works with the old secret');
  assert.equal(back.auth(ps[0].id, 'wrong'), undefined);
  back.setConnected(ps[0].id, true);
  back.setConnected(ps[1].id, true);
  assert.equal(back.view().players.find((p) => p.id === ps[0].id)!.found, true);
  assert.equal(back.players.get(ps[0].id)!.score, 0, 'points land at the reveal');
  // the same submission id after restore gets the same answer
  const again = back.precheck(ps[0].id, 'keep');
  assert.equal(again.kind, 'prior');
  assert.deepEqual((again as any).reply, r1);
  // and the game continues to the end
  find(back, ps[1].id, 'b', 'stop sign');
  assert.equal(back.players.get(ps[0].id)!.score, 60);
  assert.equal(back.phase, 'reveal');
  for (let i = 0; i < 5 * 4 * (HUNT_MS + REVEAL_MS) && back.phase !== 'ended'; i += 1000) {
    clock.t += 1000;
    back.tick();
  }
  assert.equal(back.phase, 'ended');
  assert.equal(back.view().rounds.length, 5);
});

test('lobby with nobody connected for 30 minutes expires; host passes on leave; kick only in lobby', () => {
  const { room, ps, clock } = setup(false, 3);
  assert.equal(room.kick(ps[1].id, ps[2].id), false);
  assert.equal(room.kick(ps[0].id, ps[2].id), true);
  assert.equal(room.players.size, 2);
  room.removePlayer(ps[0].id);
  assert.equal(room.hostId, ps[1].id);
  room.setConnected(ps[1].id, false);
  clock.t += LOBBY_IDLE_MS - 1000;
  assert.equal(room.expired(), false);
  clock.t += 2000;
  assert.equal(room.expired(), true);
});

test('join rules: lobby only, 12 players max', () => {
  const { room, ps } = setup(false, 1);
  for (let i = 1; i < 12; i++) room.addPlayer(`X${i}`, 'd');
  assert.equal(room.canJoin(), 'full');
  const r2 = setup(false, 1);
  r2.room.start(r2.ps[0].id);
  assert.equal(r2.room.canJoin(), 'in_progress');
  assert.ok(ps);
});

// ---------- daily ----------
test('daily: 5 prompts, deterministic by date, no repeated category, Toronto day boundary', () => {
  const a = dailyPrompts('2026-11-21');
  const b = dailyPrompts('2026-11-21');
  assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
  assert.equal(a.length, 5);
  for (let d = 1; d <= 60; d++) {
    const day = `2026-${String(1 + (d % 12)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}`;
    const ps: PromptDef[] = dailyPrompts(day);
    assert.equal(ps.length, 5);
    assert.equal(new Set(ps.map((p) => p.cat)).size, 5, day);
  }
  assert.notDeepEqual(dailyPrompts('2026-11-22').map((p) => p.id), a.map((p) => p.id));
  // 04:30 UTC on Nov 22 is still Nov 21 in Toronto (UTC-5)
  const t = Date.UTC(2026, 10, 22, 4, 30);
  assert.equal(torontoDay(t), '2026-11-21');
  assert.equal(nextTorontoMidnight(t), Date.UTC(2026, 10, 22, 5, 0));
  // DST start: Mar 8 2026 -> next midnight Mar 9 is 04:00 UTC
  assert.equal(nextTorontoMidnight(Date.UTC(2026, 2, 8, 12)), Date.UTC(2026, 2, 9, 4, 0));
  assert.ok(OUTDOOR.length >= 55 && INDOOR.length >= 14);
  assert.ok([...OUTDOOR, ...INDOOR].every((p) => p.examples && p.text === p.text.toLowerCase().replace(/^./, (c) => c)));
  assert.equal(new Set([...OUTDOOR, ...INDOOR].map((p) => p.id)).size, OUTDOOR.length + INDOOR.length);
});

test('ranking: points first, then rarity, then the earlier find (best card, round winner, reveal order)', () => {
  const { room, ps, advance } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const one = find(room, ps[0].id, 'a', 'golden retriever', 100, 80); // first-ever One of One at rarity 80
  const epic = find(room, ps[1].id, 'b', 'red cardinal', 85, 90);
  const v = room.view();
  assert.deepEqual(v.reveal!.map((c) => c.points), [100, 85]);
  assert.deepEqual(v.roundWinners, [ps[0].id]);
  room.skip(ps[0].id);
  find(room, ps[0].id, 'c', 'stop sign', 85, 95);
  while (room.phase !== 'ended') room.skip(ps[0].id);
  assert.equal(room.view().best[ps[0].id], (one.body as any).card.id, '100 pts at rarity 80 beats 85 pts at rarity 95');
  assert.equal(room.view().best[ps[1].id], (epic.body as any).card.id);
});

test('scores stay at completed-round totals during countdown and hunting', () => {
  const { room, ps, advance } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  find(room, ps[0].id, 'a', 'bench', 60, 70);
  assert.deepEqual(room.view().players.map((p) => p.score), [0, 0]);
  room.skip(ps[0].id);
  assert.deepEqual(room.view().players.map((p) => p.score), [60, 0], 'applied at the reveal');
  room.skip(ps[0].id);
  find(room, ps[1].id, 'b', 'pigeon', 30, 45);
  assert.deepEqual(room.view().players.map((p) => p.score), [60, 0], 'round 2 hidden while hunting');
  room.skip(ps[0].id);
  assert.deepEqual(room.view().players.map((p) => p.score), [60, 30]);
});

test('a failed save keeps the submission retryable: no try used, nothing stored', () => {
  const { room, ps, advance } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const pre = room.precheck(ps[0].id, 'disk');
  assert.equal(pre.kind, 'ok');
  assert.throws(() => room.settle(ps[0].id, 'disk', 1, { accepted: true }, () => { throw new Error('ENOSPC'); }));
  assert.equal(room.triesLeft(ps[0].id), MAX_TRIES);
  assert.equal(room.found.has(ps[0].id), false);
  const again = find(room, ps[0].id, 'disk', 'bench');
  assert.equal((again.body as any).accepted, true, 'same submissionId succeeds on retry');
});

test('reveal length: 6 s plus 3 s per card, capped at 20 s; host skip still works', () => {
  assert.equal(revealMsFor(0), 6000);
  assert.equal(revealMsFor(2), 12000);
  assert.equal(revealMsFor(5), 20000);
  assert.equal(revealMsFor(12), 20000);
  const { room, ps, advance, now } = setup(false, 3);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  find(room, ps[0].id, 'a', 'bench');
  find(room, ps[1].id, 'b', 'pigeon');
  find(room, ps[2].id, 'c', 'stop sign');
  assert.equal(room.phase, 'reveal');
  assert.equal(room.view().revealMs, 15000);
  assert.equal(room.view().endsAt, now() + 15000);
  advance(14_000);
  assert.equal(room.phase, 'reveal');
  room.skip(ps[0].id);
  assert.equal(room.phase, 'hunting');
  assert.equal(room.view().revealMs, null);
});

test('unsettle takes back an accepted find whose room snapshot failed; the same submission works again', () => {
  const { room, ps, advance } = setup(false, 3);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const r = find(room, ps[0].id, 'a', 'bench', 60, 70);
  room.unsettle(ps[0].id, 'a', (r.body as any).card);
  assert.equal(room.view().players[0].found, false);
  assert.equal(room.triesLeft(ps[0].id), MAX_TRIES);
  assert.equal((find(room, ps[0].id, 'a', 'bench', 60, 70).body as any).accepted, true, 'no stored reply: the retry goes through');
  // after the reveal applied the points, unsettle takes them back too
  find(room, ps[1].id, 'b', 'pigeon', 30, 45);
  const c = find(room, ps[2].id, 'c', 'stop sign', 10, 20);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.players.get(ps[2].id)!.score, 10);
  room.unsettle(ps[2].id, 'c', (c.body as any).card);
  assert.equal(room.players.get(ps[2].id)!.score, 0);
  assert.equal(room.view().reveal!.length, 2);
});

test('solo run: auto-start flow, 3 quick rounds, opener + no repeats, 4 s reveal, early end, join full, board hook once', () => {
  const clock = { t: 1_800_000_000_000 };
  const now = () => clock.t;
  const ended: Room[] = [];
  const room = new Room('SOLO', false, now, (q) => squadPrompts(q, seeded('solo')), {
    solo: true,
    team: 'Team Rocket',
    onEnd: (r) => {
      ended.push(r);
      r.board = { rank: 2, best: 90 };
    },
  });
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      clock.t += 250;
      room.tick();
    }
  };
  const p = room.addPlayer('Ava', 'd'.repeat(32));
  assert.equal(room.quick, true, 'solo is always quick');
  assert.equal(room.start(p.id), true);
  assert.equal(room.canJoin(), 'full');
  const v0 = room.view();
  assert.equal(v0.solo, true);
  assert.equal(v0.team, 'Team Rocket');
  assert.equal(v0.totalRounds, 3);
  assert.equal(v0.phase, 'countdown');
  assert.equal(room.prompts.length, 3);
  assert.equal(room.prompts[0].id, QUICK_OPENER);
  assert.equal(new Set(room.prompts.map((x) => x.id)).size, 3, 'never repeated');
  assert.ok(room.prompts.every((x) => INDOOR.includes(x)));
  advance(COUNTDOWN_MS);
  assert.equal(room.phase, 'hunting');
  assert.equal(room.endsAt, now() + QUICK_HUNT_MS);
  // round 1: find -> early end, 4 s reveal
  find(room, p.id, 's1', 'red mug', 60, 70);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.view().revealMs, 4000);
  advance(4000);
  assert.equal(room.phase, 'hunting');
  assert.equal(room.round, 2);
  // round 2 times out after 60 s
  advance(QUICK_HUNT_MS);
  assert.equal(room.phase, 'reveal');
  advance(4000);
  find(room, p.id, 's3', 'blue pen', 30, 45);
  assert.equal(room.view().boardRank, null, 'no board fields before the end');
  advance(4000);
  assert.equal(room.phase, 'ended');
  assert.equal(ended.length, 1);
  assert.equal(room.players.get(p.id)!.score, 90);
  const v = room.view();
  assert.equal(v.boardRank, 2);
  assert.equal(v.boardBest, 90);
  assert.equal(v.rounds.length, 3);
  assert.equal(room.again(p.id), false, 'a solo run is one-shot');
  // survives a restore without recording twice, and expires 10 minutes after the end
  const back = Room.restore(JSON.parse(JSON.stringify(room.snapshot())), now, undefined, () => ended.push(back));
  assert.equal(back.solo, true);
  assert.equal(back.view().boardRank, 2);
  assert.equal(back.canJoin(), 'full');
  clock.t += 9 * 60_000;
  assert.equal(room.expired(), false);
  clock.t += 61_000;
  assert.equal(room.expired(), true);
  assert.equal(ended.length, 1);
});
