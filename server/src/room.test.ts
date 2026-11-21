import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPOSTOR_FOOL_BONUS, IMPOSTOR_RESULT_MS, IMPOSTOR_SPOT_BONUS, IMPOSTOR_VOTE_MS, BINGO_FIRST_BONUS, BINGO_HUNT_MS, BINGO_LINE_BONUS, BINGO_QUICK_HUNT_MS, BINGO_REVEAL_MS, COUNTDOWN_MS, HUNT_MS, MAX_TRIES, QUICK_HUNT_MS, REVEAL_MAX_MS as REVEAL_MS, Room, LOBBY_IDLE_MS, revealMsFor } from './room.js';
import { scoreFind, scoreSolo, tierFor, normalizeLabel, canonicalLabel } from './rarity.js';
import { TWINS, INDOOR, OUTDOOR, dailyPrompts, soloPrompts, squadPrompts, seeded, torontoDay, nextTorontoMidnight, QUICK_OPENER } from './prompts.js';
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
test('rarity math: AI decides at first, the crowd weighs in up to half', () => {
  // first find ever: w = 0 -> ai
  assert.deepEqual(scoreFind(42, 1, 1, true), { rarity: 42, tier: 'uncommon', points: 30 });
  // first-ever find of a label with ai >= 80 -> One of One
  assert.equal(scoreFind(80, 1, 1, true).tier, 'one');
  assert.equal(scoreFind(80, 1, 1, true).points, 100);
  assert.equal(scoreFind(79, 1, 1, true).tier, 'rare');
  // total 11 -> w = 0.4; crowd = 100*(1-5/11) = 54.5; 0.4*54.5 + 0.6*90 = 75.8 -> 76
  assert.equal(scoreFind(90, 5, 11, false).rarity, 76);
  // crowd weight is capped at 0.5: total 26, crowd 50, ai 0 -> 25 (not 50)
  assert.equal(scoreFind(0, 13, 26, false).rarity, 25);
  // 3 of 412 but the AI calls it ordinary: 0.5*99.3 + 0.5*10 = 55 -> uncommon, not One of One
  assert.deepEqual(scoreFind(10, 3, 412, false), { rarity: 55, tier: 'uncommon', points: 30 });
  // a rare find the AI also rates highly: 0.5*99.3 + 0.5*96 = 97.6 -> 98 -> one
  assert.deepEqual(scoreFind(96, 3, 412, false), { rarity: 98, tier: 'one', points: 100 });
  // fire hydrant everybody finds
  assert.equal(scoreFind(20, 300, 412, false).tier, 'common');
});

test('tiers and points at every boundary; One of One needs aiRarity >= 60', () => {
  const cases: [number, string, number][] = [
    [0, 'common', 10], [39, 'common', 10], [40, 'uncommon', 30], [64, 'uncommon', 30], [65, 'rare', 60],
    [84, 'rare', 60], [85, 'epic', 85], [96, 'epic', 85], [97, 'one', 100], [100, 'one', 100],
  ];
  for (const [r, tier] of cases) assert.equal(tierFor(r), tier, `rarity ${r}`);
  assert.equal(tierFor(98, false, 59), 'epic', 'high rarity, low AI rarity: not One of One');
  assert.equal(tierFor(98, false, 60), 'one');
  assert.equal(tierFor(50, true, 59), 'uncommon', 'first-ever needs the AI to agree too');
  // a big crowd with sameCount 1 and high ai is still One of One (first ever of that label)
  assert.equal(scoreFind(85, 1, 500, true).tier, 'one');
  assert.equal(scoreFind(50, 1, 500, false).rarity, 75);
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
  assert.equal(room.phase, 'hunting', 'its early reveal is rolled back too');
  assert.deepEqual(room.view().players.map((p) => p.found), [true, true, false]);
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

test('solo: same 3 prompts per day for every team; unique runId; a failed board save retries until it sticks', () => {
  const a = soloPrompts('2026-11-22');
  const b = soloPrompts('2026-11-22');
  assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
  assert.equal(a.length, 3);
  assert.equal(a[0].id, QUICK_OPENER);
  assert.equal(new Set(a.map((p) => p.id)).size, 3);
  assert.ok(a.every((p) => INDOOR.includes(p)));
  const clock = { t: 1_800_000_000_000 };
  const now = () => clock.t;
  let fails = 2;
  let recorded = 0;
  const room = new Room('RTRY', true, now, () => soloPrompts('2026-11-22'), {
    solo: true,
    team: 'Echo',
    onEnd: (r) => {
      if (fails-- > 0) throw new Error('disk full');
      recorded++;
      r.board = { rank: 1, best: 0 };
    },
  });
  const p = room.addPlayer('E', 'e'.repeat(32));
  room.start(p.id);
  assert.match(room.runId!, /^RTRY-[a-f0-9]{16}$/);
  assert.deepEqual(room.prompts.map((x) => x.id), a.map((x) => x.id));
  while (room.phase !== 'ended') room.skip(p.id);
  assert.equal(room.boardRecorded, false, 'first save failed');
  for (let i = 0; i < 12 * 4; i++) {
    clock.t += 250;
    room.tick();
  }
  assert.equal(room.boardRecorded, true, 'retried after the failures');
  assert.equal(recorded, 1);
  assert.equal(room.view().boardRank, 1);
  const squad = new Room('SQD1', false, now, (q) => squadPrompts(q, seeded('x')));
  squad.start(squad.addPlayer('S', 's'.repeat(32)).id);
  assert.equal(squad.runId, null, 'only solo runs get a runId');
});

test('a failed save of the find that triggered the early reveal rolls the reveal back; Send again works', () => {
  const { room, ps, advance, now } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  advance(10_000);
  const deadline = room.endsAt!;
  find(room, ps[1].id, 'b', 'pigeon', 30, 45);
  const last = find(room, ps[0].id, 'a', 'bench', 60, 70);
  assert.equal(room.phase, 'reveal', 'last find ended the round early');
  assert.equal(room.players.get(ps[1].id)!.score, 30);
  room.unsettle(ps[0].id, 'a', (last.body as any).card);
  assert.equal(room.phase, 'hunting', 'back to the open hunt');
  assert.equal(room.endsAt, deadline, 'original deadline restored');
  assert.equal(room.view().rounds.length, 0);
  assert.equal(room.view().revealMs, null);
  assert.deepEqual(room.view().players.map((p) => p.score), [0, 0], 'reveal points taken back');
  assert.equal(room.view().players.find((p) => p.id === ps[1].id)!.found, true, 'the other find stays');
  const retry = find(room, ps[0].id, 'a', 'bench', 60, 70);
  assert.equal((retry.body as any).accepted, true, 'same submissionId is accepted on retry');
  assert.equal(room.phase, 'reveal');
  assert.deepEqual(room.view().players.map((p) => p.score), [60, 30]);
  assert.ok(now() < deadline);
});

test('startup reconciliation: restoreCredit credits an open round, refuses a closed one', () => {
  const { room, ps, advance } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const c = card('lost glove', 'P0', 30, 50, ps[0].id);
  assert.equal(room.restoreCredit(ps[0].id, 'crash-sub', 1, c), true);
  assert.equal(room.found.get(ps[0].id)?.id, c.id);
  assert.equal(room.precheck(ps[0].id, 'crash-sub').kind, 'prior', 'the retry gets the original answer');
  assert.equal(room.restoreCredit(ps[0].id, 'crash-sub', 1, c), true, 'idempotent');
  room.skip(ps[0].id);
  room.skip(ps[0].id);
  assert.equal(room.restoreCredit(ps[1].id, 'old', 1, card('x', 'P1', 10, 20, ps[1].id)), false, 'round 1 is closed');
});

test('ended solo view says whether the run counted and how many counted runs are left', () => {
  const clock = { t: 1_800_000_000_000 };
  const room = new Room('PRAC', true, () => clock.t, () => soloPrompts('2026-11-22'), {
    solo: true,
    team: 'Golf',
    onEnd: (r) => (r.board = { rank: 3, best: 85, counted: false, runsLeft: 0 }),
  });
  const p = room.addPlayer('G', 'g'.repeat(32));
  room.start(p.id);
  assert.equal(room.view().counted, null);
  while (room.phase !== 'ended') room.skip(p.id);
  const v = room.view();
  assert.deepEqual([v.counted, v.runsLeft, v.boardRank, v.boardBest], [false, 0, 3, 85]);
});

test('solo scoring uses aiRarity alone: same find, same points at any table', () => {
  assert.deepEqual(scoreSolo(42), { rarity: 42, tier: 'uncommon', points: 30 });
  assert.deepEqual(scoreSolo(39), { rarity: 39, tier: 'common', points: 10 });
  assert.deepEqual(scoreSolo(65), { rarity: 65, tier: 'rare', points: 60 });
  assert.deepEqual(scoreSolo(96), { rarity: 96, tier: 'epic', points: 85 });
  assert.deepEqual(scoreSolo(97), { rarity: 97, tier: 'one', points: 100 });
  assert.equal(scoreSolo(85).points, 85, 'no first-ever bonus (scoreFind would give 100 for a first find at 85)');
  assert.equal(scoreFind(85, 1, 1, true).points, 100);
});

test('upload grace: a shutter press before the buzzer lets the upload land up to 25 s late', () => {
  const { room, ps, advance, now } = setup(false, 3);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const pid = room.prompt!.id;
  assert.equal(room.markShooting(ps[0].id, 'wrong-prompt'), false);
  advance(HUNT_MS - 2000);
  assert.equal(room.markShooting(ps[0].id, pid), true, 'pressed 2 s before the buzzer');
  advance(2000);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.markShooting(ps[1].id, pid), false, 'too late to announce');
  advance(22_000); // slow upload: arrives 22 s after the deadline, reveal held meanwhile
  assert.equal(room.phase, 'reveal');
  assert.equal(room.round, 1);
  const pre = room.precheck(ps[0].id, 'slow-upload');
  assert.equal(pre.kind, 'ok', 'announced upload accepted after the deadline');
  assert.equal(room.precheck(ps[1].id, 'no-shot').kind, 'error', 'no announcement -> closed');
  advance(10_000); // judging takes 10 s more (32 s after the deadline)
  const r = room.settle(ps[0].id, 'slow-upload', 1, { accepted: true }, () => card('bench', 'P0', 30, 50, ps[0].id));
  assert.equal((r.body as any).accepted, true);
  assert.equal(room.view().reveal!.length, 1);
  advance(REVEAL_MS);
  assert.equal(room.round, 2, 'moves on once the upload is in');
  // a press that is never followed by an upload holds the reveal at most 25 s
  const p2 = room.prompt!.id;
  advance(QUICK_HUNT_MS); // (not quick) still hunting
  room.markShooting(ps[1].id, p2);
  room.skip(ps[0].id);
  assert.equal(room.phase, 'reveal');
  const t0 = now();
  while (room.phase === 'reveal' && now() - t0 < 60_000) advance(250);
  assert.ok(now() - t0 >= 25_000 && now() - t0 < 27_000, `held ${now() - t0} ms`);
});

// ---------- unique only ----------
test('unique only: a find someone else matched that round scores 0; the round goes to the best unique card', () => {
  const { room, ps, advance } = setup(false, 3);
  assert.equal(room.setUnique(ps[1].id, true), false, 'only the host');
  assert.equal(room.setUnique(ps[0].id, true), true);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  find(room, ps[0].id, 'a', 'fire hydrant', 85, 90);
  find(room, ps[1].id, 'b', 'fire hydrant', 85, 90);
  find(room, ps[2].id, 'c', 'red cardinal', 30, 50);
  assert.equal(room.phase, 'reveal', 'everyone found');
  const score = (i: number) => room.players.get(ps[i].id)!.score;
  assert.deepEqual([score(0), score(1), score(2)], [0, 0, 30]);
  assert.equal(room.view().reveal!.find((c) => c.label === 'fire hydrant')!.sameAs!.length, 1, 'the duplicate is marked');
  assert.equal(room.view().roundWinners[0], ps[2].id, 'the unique card wins the round');
  assert.equal(room.view().unique, true);
});

test('unique only: a late duplicate in the reveal cancels the earlier card too', () => {
  const { room, ps, advance } = setup(false, 2);
  room.setUnique(ps[0].id, true);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  find(room, ps[0].id, 'a', 'bench', 60, 70);
  advance(HUNT_MS - 1000);
  const pre = room.precheck(ps[1].id, 'late');
  assert.equal(pre.kind, 'ok');
  advance(1000);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.players.get(ps[0].id)!.score, 60);
  room.settle(ps[1].id, 'late', 1, { accepted: true }, () => card('bench', 'P1', 60, 70, ps[1].id));
  assert.equal(room.players.get(ps[0].id)!.score, 0, 'now a duplicate');
  assert.equal(room.players.get(ps[1].id)!.score, 0);
});

test('unique only and bingo are separate modes; unique survives a restore', () => {
  const { room, ps, now } = setup(false, 1);
  room.setUnique(ps[0].id, true);
  room.setBingo(ps[0].id, true);
  assert.deepEqual([room.unique, room.bingo], [false, true], 'bingo turns unique off');
  room.setUnique(ps[0].id, true);
  assert.deepEqual([room.unique, room.bingo], [true, false], 'and the other way round');
  const back = Room.restore(JSON.parse(JSON.stringify(room.snapshot())), now, (q) => squadPrompts(q, seeded('test')));
  assert.equal(back.unique, true);
  const solo = new Room('SOLU', true, () => 0, () => [], { solo: true, team: 'T', unique: true });
  assert.equal(solo.unique, false, 'solo runs are never unique');
});

// ---------- impostor ----------
function setupImpostor(n = 3, rand = () => 0) {
  const clock = { t: 1_800_000_000_000 };
  const now = () => clock.t;
  const room = new Room('IMPO', false, now, (q, count, twins) => squadPrompts(q, seeded('imp'), count, twins), { rand });
  const ps = Array.from({ length: n }, (_, i) => room.addPlayer(`P${i}`, `device${i}`.padEnd(32, '0')));
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      clock.t += step;
      room.tick();
    }
  };
  assert.equal(room.setImpostor(ps[0].id, true), true);
  return { room, ps, clock, advance, now };
}

test('impostor: needs 3 players; only twin-able prompts; one player per round sees the twin, nobody else learns who', () => {
  const small = setupImpostor(2);
  assert.equal(small.room.start(small.ps[0].id), false, 'two players is too few');
  const { room, ps, advance } = setupImpostor(3, () => 0.99);
  assert.equal(room.start(ps[0].id), true);
  assert.ok(room.prompts.every((p) => TWINS[p.id]), 'every round prompt has a twin');
  advance(COUNTDOWN_MS);
  const imp = room.impostorId!;
  assert.ok(imp);
  const views = ps.map((p) => room.view(p.id));
  const real = room.prompts[0];
  for (const [i, v] of views.entries()) {
    if (ps[i].id === imp) {
      assert.equal(v.prompt!.id, TWINS[real.id].id, 'the impostor sees the twin');
      assert.equal(v.impostor!.you, true);
      assert.equal(v.impostor!.crewPrompt!.id, real.id, 'and the real prompt, to blend in');
    } else {
      assert.equal(v.prompt!.id, real.id);
      assert.equal(v.impostor!.you, false);
      assert.equal(v.impostor!.crewPrompt, null);
    }
  }
  assert.equal(JSON.stringify(room.view()).includes(TWINS[real.id].text), false, 'the shared view never carries the twin');
  // the impostor's find is judged against the twin
  const pre = room.precheck(imp, 'imp-find');
  assert.equal(pre.kind === 'ok' && pre.prompt.id, TWINS[real.id].id);
});

test('impostor: vote, scoring and a masked reveal; the impostor rotates', () => {
  const { room, ps, advance } = setupImpostor(4);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const imp = room.impostorId!;
  const crew = ps.filter((p) => p.id !== imp);
  for (const p of ps) find(room, p.id, `f-${p.id}`, `thing ${p.name}`, 30, 50);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.voteOpen, true);
  const real = room.prompts[0];
  const rv = room.view(crew[0].id);
  assert.ok(rv.reveal!.every((c) => c.promptId === real.id && c.verdict === ''), 'every card wears the real prompt during the vote');
  assert.equal(JSON.stringify(rv).includes(TWINS[real.id].text), false);
  assert.equal(room.players.get(crew[0].id)!.score, 0, 'points wait for the vote');
  assert.equal(room.vote(crew[0].id, crew[0].id), false, 'no self votes');
  // two crew spot the impostor, one is fooled; the impostor votes for a crew member
  room.vote(crew[0].id, imp);
  room.vote(crew[1].id, imp);
  room.vote(crew[2].id, crew[0].id);
  assert.equal(room.voteOpen, true);
  assert.deepEqual(room.view(crew[0].id).impostor!.voted.sort(), [crew[0].id, crew[1].id, crew[2].id].sort());
  room.vote(imp, crew[0].id); // everyone has voted: closes
  assert.equal(room.voteOpen, false);
  const res = room.view(crew[2].id).impostor!.rounds[0]!;
  assert.equal(res.impostorId, imp);
  assert.equal(res.caught, false, 'a 2-2 tie lets the impostor slip away');
  assert.equal(res.twin.id, TWINS[real.id].id);
  assert.equal(room.players.get(crew[0].id)!.score, 30 + IMPOSTOR_SPOT_BONUS);
  assert.equal(room.players.get(crew[2].id)!.score, 30);
  assert.equal(room.players.get(imp)!.score, 30 + IMPOSTOR_FOOL_BONUS);
  assert.equal(room.view().reveal!.find((c) => c.playerId === imp)!.promptId, 'x', 'unmasked after the vote (the test card keeps its own promptId)');
  advance(IMPOSTOR_RESULT_MS);
  assert.equal(room.phase, 'hunting');
  assert.equal(room.round, 2);
  assert.notEqual(room.impostorId, imp, 'a different impostor next round');
});

test('impostor: caught when they alone get the most votes; the vote closes on its timer', () => {
  const { room, ps, advance } = setupImpostor(3);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const imp = room.impostorId!;
  const crew = ps.filter((p) => p.id !== imp);
  room.skip(ps[0].id); // nobody found anything: straight to the vote
  room.vote(crew[0].id, imp);
  room.vote(crew[1].id, imp);
  advance(IMPOSTOR_VOTE_MS);
  assert.equal(room.voteOpen, false, 'closed by the clock');
  assert.equal(room.impostorResult(0).caught, true);
  assert.equal(room.players.get(imp)!.score, 0);
  assert.equal(room.players.get(crew[0].id)!.score, IMPOSTOR_SPOT_BONUS);
  // host skip closes the vote early too
  advance(IMPOSTOR_RESULT_MS);
  room.skip(ps[0].id);
  assert.equal(room.voteOpen, true);
  room.skip(ps[0].id);
  assert.equal(room.voteOpen, false);
});

test('impostor: survives a restore mid-vote; modes stay exclusive', () => {
  const { room, ps, advance, now } = setupImpostor(3);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const imp = room.impostorId!;
  room.skip(ps[0].id);
  room.vote(ps.find((p) => p.id !== imp)!.id, imp);
  const back = Room.restore(JSON.parse(JSON.stringify(room.snapshot())), now, (q, n, t) => squadPrompts(q, seeded('imp'), n, t));
  assert.equal(back.impostor, true);
  assert.equal(back.voteOpen, true);
  assert.equal(back.impostorId, imp);
  assert.equal(Object.keys(back.votes[0]).length, 1);
  const m = setupImpostor(3).room;
  const host = [...m.players.keys()][0];
  m.setBingo(host, true);
  assert.deepEqual([m.bingo, m.unique, m.impostor], [true, false, false]);
  m.setImpostor(host, true);
  assert.deepEqual([m.bingo, m.unique, m.impostor], [false, false, true]);
});

// ---------- bingo ----------
function setupBingo(quick = false, n = 2) {
  const clock = { t: 1_800_000_000_000 };
  const now = () => clock.t;
  const room = new Room('BNGO', quick, now, (q, count) => squadPrompts(q, seeded('bingo'), count));
  const ps = Array.from({ length: n }, (_, i) => room.addPlayer(`P${i}`, `device${i}`.padEnd(32, '0')));
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      clock.t += step;
      room.tick();
    }
  };
  assert.equal(room.setBingo(ps[0].id, true), true);
  return { room, ps, clock, advance, now };
}

function bingoFind(room: Room, playerId: string, sub: string, promptId: string | undefined, label: string | null, pts = 10) {
  const pre = room.precheck(playerId, sub, undefined, promptId);
  if (pre.kind !== 'ok') return pre.reply;
  const name = room.players.get(playerId)!.name;
  return room.settle(
    playerId,
    sub,
    pre.round,
    label ? { accepted: true } : { accepted: false, reason: 'no_match', verdict: 'Not quite.' },
    () => ({ ...card(label!, name, pts, 20, playerId), promptId: pre.prompt.id, promptText: pre.prompt.text }),
    pre.prompt.id,
  );
}

test('bingo: host-only lobby setting; one round on a 3x3 grid of distinct categories, 5 min clock', () => {
  const { room, ps, advance, now } = setupBingo();
  assert.equal(room.setBingo(ps[1].id, false), false, 'only the host');
  assert.equal(room.view().grid, null, 'no grid in the lobby');
  assert.equal(room.start(ps[0].id), true);
  advance(COUNTDOWN_MS);
  assert.equal(room.phase, 'hunting');
  assert.equal(room.endsAt, now() + BINGO_HUNT_MS);
  const v = room.view();
  assert.equal(v.bingo, true);
  assert.equal(v.totalRounds, 1);
  assert.equal(v.prompt, null, 'no single prompt: the whole grid is open');
  assert.equal(v.grid!.length, 9);
  assert.equal(new Set(room.prompts.map((p) => p.cat)).size, 9, 'every square is a different category');
  assert.equal(room.setBingo(ps[0].id, false), false, 'locked once started');
  advance(BINGO_HUNT_MS);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.view().rounds.length, 9, 'one finished entry per square');
  advance(BINGO_REVEAL_MS);
  assert.equal(room.phase, 'ended');
});

test('bingo: quick mode uses the indoor pool and a 3 min clock; solo rooms cannot be bingo', () => {
  const { room, ps, advance, now } = setupBingo(true);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  assert.equal(room.endsAt, now() + BINGO_QUICK_HUNT_MS);
  assert.ok(room.prompts.every((p) => INDOOR.includes(p)));
  const solo = new Room('SOLB', true, () => 0, () => [], { solo: true, team: 'T', bingo: true });
  assert.equal(solo.bingo, false);
  assert.equal(solo.setBingo(solo.addPlayer('A', 'd'.repeat(32)).id, true), false);
});

test('bingo: one find per square, tries per square, the square must be on the card', () => {
  const { room, ps, advance } = setupBingo();
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const [a, b] = room.prompts;
  assert.equal(room.precheck(ps[0].id, 's0').kind, 'error', 'bingo needs a square');
  assert.equal(room.precheck(ps[0].id, 's1', undefined, 'not-on-card').kind, 'error');
  assert.equal((bingoFind(room, ps[0].id, 's2', a.id, 'apple').body as any).accepted, true);
  assert.equal((bingoFind(room, ps[0].id, 's3', a.id, 'brick').body as any).error, 'locked', 'square already marked');
  assert.equal((bingoFind(room, ps[0].id, 's4', b.id, 'bench').body as any).accepted, true, 'another square is open');
  for (let i = 0; i < MAX_TRIES; i++) bingoFind(room, ps[1].id, `miss${i}`, a.id, null);
  assert.equal(room.triesLeft(ps[1].id, a.id), 0);
  assert.equal(room.triesLeft(ps[1].id, b.id), MAX_TRIES, 'tries are per square');
  assert.equal((bingoFind(room, ps[1].id, 'x', b.id, 'bench').body as any).accepted, true);
  const v = room.view();
  assert.deepEqual(v.bingoBoard!.marks[ps[0].id], [a.id, b.id]);
  assert.equal(v.reveal, null, 'no cards mid-hunt');
  assert.equal(v.players.find((p) => p.id === ps[0].id)!.found, false, 'found means the whole card is done');
});

test('bingo: lines score a bonus and the first line gets the first-bingo bonus', () => {
  const { room, ps, advance } = setupBingo();
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const g = room.prompts.map((p) => p.id);
  // P1 marks the left column (0,3,6) first; P0 then finishes the top row (0,1,2) and the diagonal (0,4,8)
  bingoFind(room, ps[1].id, 'b0', g[0], 'x', 10);
  bingoFind(room, ps[1].id, 'b3', g[3], 'x', 10);
  bingoFind(room, ps[1].id, 'b6', g[6], 'x', 10);
  bingoFind(room, ps[1].id, 'b8', g[8], 'epic', 85); // on no completed line of P1's: scores nothing
  for (const i of [0, 1, 2, 4, 8]) bingoFind(room, ps[0].id, `a${i}`, g[i], 'y', 30);
  const v = room.view().bingoBoard!;
  assert.equal(v.lines[ps[1].id], 1);
  assert.equal(v.lines[ps[0].id], 2);
  assert.equal(v.first, ps[1].id, 'P1 closed a line first');
  assert.equal(room.players.get(ps[0].id)!.score, 0, 'totals stay hidden until the reveal');
  room.skip(ps[0].id);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.players.get(ps[0].id)!.score, 5 * 30 + 2 * BINGO_LINE_BONUS);
  assert.equal(room.players.get(ps[1].id)!.score, 3 * 10 + BINGO_LINE_BONUS + BINGO_FIRST_BONUS, 'the epic off the line adds nothing');
  assert.equal(room.view().reveal!.length, 9, 'the reveal shows every card');
  advance(BINGO_REVEAL_MS);
  assert.equal(room.phase, 'ended');
  assert.deepEqual(room.view().winners, [ps[0].id], 'P0 250 beats P1 180');
});

test('bingo: the hunt ends early once every player has filled the whole card', () => {
  const { room, ps, advance } = setupBingo(false, 1);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const g = room.prompts.map((p) => p.id);
  for (let i = 0; i < 8; i++) bingoFind(room, ps[0].id, `f${i}`, g[i], 'z');
  assert.equal(room.phase, 'hunting');
  bingoFind(room, ps[0].id, 'f8', g[8], 'z');
  assert.equal(room.phase, 'reveal');
  assert.equal(room.view().bingoBoard!.lines[ps[0].id], 8, 'a full card is all 8 lines');
  assert.equal(room.players.get(ps[0].id)!.score, 9 * 10 + 8 * BINGO_LINE_BONUS + BINGO_FIRST_BONUS);
});

test('bingo: a late upload announced before the buzzer counts for the square it was shot for', () => {
  const { room, ps, advance } = setupBingo();
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const g = room.prompts.map((p) => p.id);
  bingoFind(room, ps[0].id, 'm3', g[3], 'cup', 10);
  bingoFind(room, ps[0].id, 'm5', g[5], 'mug', 10);
  advance(BINGO_HUNT_MS - 1000);
  assert.equal(room.markShooting(ps[0].id, g[4]), true);
  assert.equal(room.markShooting(ps[0].id, 'nope'), false);
  advance(1000);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.precheck(ps[0].id, 'wrong-square', undefined, g[5]).kind, 'error', 'only the announced square');
  assert.equal(room.players.get(ps[0].id)!.score, 0, 'two squares, no line yet: nothing scores');
  assert.equal((bingoFind(room, ps[0].id, 'late', g[4], 'lamp', 60).body as any).accepted, true);
  assert.equal(room.players.get(ps[0].id)!.score, 10 + 10 + 60 + BINGO_LINE_BONUS + BINGO_FIRST_BONUS, 'the late card completed the middle row');
});

test('bingo: snapshot and restore keep the mode and the marked squares; again() keeps bingo on', () => {
  const { room, ps, advance, now } = setupBingo();
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const g = room.prompts.map((p) => p.id);
  bingoFind(room, ps[0].id, 'r0', g[0], 'kept');
  const back = Room.restore(JSON.parse(JSON.stringify(room.snapshot())), now, (q, n) => squadPrompts(q, seeded('bingo'), n));
  assert.equal(back.bingo, true);
  assert.deepEqual(back.view().bingoBoard!.marks[ps[0].id], [g[0]]);
  assert.equal((bingoFind(back, ps[0].id, 'r1', g[0], 'again').body as any).error, 'locked');
  room.skip(ps[0].id);
  advance(BINGO_REVEAL_MS);
  assert.equal(room.phase, 'ended');
  assert.deepEqual(room.view().bingoBoard!.marks[ps[0].id], [g[0]], 'the card survives into the results');
  room.again(ps[0].id);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.bingo, true, 'still bingo for the next game');
  assert.equal(room.found.size, 0);
});

test('bingo: a save failure on the find that ended the hunt reopens the hunt', () => {
  const { room, ps, advance } = setupBingo(false, 1);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const g = room.prompts.map((p) => p.id);
  for (let i = 0; i < 8; i++) bingoFind(room, ps[0].id, `f${i}`, g[i], 'z');
  const last = bingoFind(room, ps[0].id, 'f8', g[8], 'z');
  assert.equal(room.phase, 'reveal');
  room.unsettle(ps[0].id, 'f8', (last.body as any).card);
  assert.equal(room.phase, 'hunting');
  assert.equal(room.rounds.length, 0);
  assert.equal(room.players.get(ps[0].id)!.score, 0);
  assert.equal(room.view().bingoBoard!.marks[ps[0].id].length, 8);
  assert.equal((bingoFind(room, ps[0].id, 'f8', g[8], 'z').body as any).accepted, true, 'the same submission can be sent again');
});

// ---------- ghost race ----------
test('ghost: a solo room carries the run to race; its own splits record when each find landed', () => {
  const clock = { t: 1_800_000_000_000 };
  const now = () => clock.t;
  const ghost = { team: 'Nova', score: 90, splits: [{ ms: 20_000, points: 30 }, null, { ms: 41_000, points: 60 }] };
  const room = new Room('GHST', true, now, (q) => squadPrompts(q, seeded('solo')), { solo: true, team: 'Rocket', ghost });
  const squad = new Room('SQDG', false, now, (q) => squadPrompts(q, seeded('x')), { ghost });
  assert.equal(squad.view().ghost, null, 'squads never race a ghost');
  const p = room.addPlayer('Ava', 'a'.repeat(32));
  room.start(p.id);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      clock.t += 250;
      room.tick();
    }
  };
  step(COUNTDOWN_MS);
  assert.deepEqual(room.view().ghost, ghost);
  step(12_000);
  const pre = room.precheck(p.id, 'r1');
  room.settle(p.id, 'r1', pre.kind === 'ok' ? pre.round : 0, { accepted: true }, () => ({ ...card('mug', 'Ava', 30, 50, p.id), at: now() }));
  step(3_000); // the solo reveal
  while (room.phase !== 'hunting') step(250);
  step(60_000); // round 2: no find
  while (room.phase !== 'hunting') step(250);
  step(5_000);
  const pre3 = room.precheck(p.id, 'r3');
  room.settle(p.id, 'r3', pre3.kind === 'ok' ? pre3.round : 0, { accepted: true }, () => ({ ...card('lamp', 'Ava', 60, 70, p.id), at: now() }));
  const s = room.splits();
  assert.equal(s.length, 3);
  assert.deepEqual(s[0], { ms: 12_000, points: 30 });
  assert.equal(s[1], null, 'a miss');
  assert.deepEqual(s[2], { ms: 5_000, points: 60 });
  const back = Room.restore(JSON.parse(JSON.stringify(room.snapshot())), now);
  assert.deepEqual(back.view().ghost, ghost, 'the ghost survives a restore');
  assert.deepEqual(back.huntStarts, room.huntStarts);
});

test('shooting: a press followed by a rejected find leaves no hold; early presses earn no grace', () => {
  const { room, ps, advance, now } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const pid = room.prompt!.id;
  // press, rejected photo during the hunt, then the host skips: the reveal runs its normal length
  room.markShooting(ps[0].id, pid);
  const r = find(room, ps[0].id, 'rej', null);
  assert.equal((r.body as any).accepted, false);
  assert.equal(room.shots.has(ps[0].id), false, 'the press is used up by the upload');
  room.skip(ps[0].id);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.latePending(), false);
  const t0 = now();
  while (room.phase === 'reveal') advance(250);
  assert.equal(now() - t0, revealMsFor(0), 'normal reveal length');
  // a press 15 s before the buzzer earns nothing: the late upload is closed, the reveal is not held
  const p2 = room.prompt!.id;
  advance(HUNT_MS - 15_000);
  room.markShooting(ps[1].id, p2);
  advance(15_000);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.latePending(), false, 'early press: no hold');
  advance(1000);
  assert.equal(room.precheck(ps[1].id, 'late').kind, 'error', 'early press: late upload closed');
  // AI failure (abort) releases the press too
  while (room.phase !== 'hunting') advance(250);
  const p3 = room.prompt!.id;
  advance(HUNT_MS - 3000);
  room.markShooting(ps[0].id, p3);
  advance(3000);
  const late = room.precheck(ps[0].id, 'one-late');
  assert.equal(late.kind, 'ok', 'press 3 s before the buzzer: one late upload');
  room.abort(ps[0].id, 'one-late'); // transient refusal (rate / busy / AI down)
  assert.equal(room.precheck(ps[0].id, 'second-late').kind, 'error', 'only one late upload per press');
  assert.equal(room.latePending(), true, 'the admitted upload keeps the reveal open for its retry');
});

test('a late upload refused for a transient reason can retry with the same submissionId and photo until the grace deadline', () => {
  const { room, ps, advance } = setup(false, 2);
  room.start(ps[0].id);
  advance(COUNTDOWN_MS);
  const pid = room.prompt!.id;
  advance(HUNT_MS - 3000);
  room.markShooting(ps[0].id, pid);
  advance(3000);
  advance(5000);
  assert.equal(room.precheck(ps[0].id, 'sub', 'hashA').kind, 'ok');
  room.abort(ps[0].id, 'sub'); // e.g. 429 busy
  advance(4000);
  assert.equal(room.precheck(ps[0].id, 'sub', 'hashB').kind, 'error', 'a different photo is not the same submission');
  const again = room.precheck(ps[0].id, 'sub', 'hashA');
  assert.equal(again.kind, 'ok', 'same submission + photo is re-admitted');
  assert.ok((again as any).receivedAt <= room.huntEndedAt!, 'still counts as received at the press');
  advance(15_000); // judging finished 27 s after the deadline
  const r = room.settle(ps[0].id, 'sub', 1, { accepted: true }, () => card('bench', 'P0', 30, 50, ps[0].id));
  assert.equal((r.body as any).accepted, true);
  assert.equal(room.lateAdmit.size, 0);
  // past the grace deadline a retry is closed
  const { room: r2, ps: q, advance: adv2 } = setup(false, 2);
  r2.start(q[0].id);
  adv2(COUNTDOWN_MS);
  const p2 = r2.prompt!.id;
  adv2(HUNT_MS - 2000);
  r2.markShooting(q[0].id, p2);
  adv2(2000);
  assert.equal(r2.precheck(q[0].id, 's', 'h').kind, 'ok');
  r2.abort(q[0].id, 's');
  adv2(27_000);
  assert.equal(r2.round, 2, 'grace over: the reveal let go and the next prompt started');
  assert.equal(r2.lateAdmit.size, 0);
});
