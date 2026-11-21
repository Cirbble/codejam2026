import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'rarefind-board-'));
const board = await import('./board.js');
const rb = (r: any) => ({ rank: r.rank, best: r.best });

test('team key: trimmed, whitespace collapsed, lowercased, 24 chars; first spelling is kept for display', () => {
  assert.equal(board.teamKey('  Team   Rocket  '), 'team rocket');
  assert.equal(board.teamKey('A'.repeat(30)), 'a'.repeat(24));
  board.recordRun({ runId: 'r1', team: '  Team   Rocket ', playerName: 'Ava', score: 60, bestCardId: null, at: 1000 });
  board.recordRun({ runId: 'r2', team: 'TEAM ROCKET', playerName: 'Ben', score: 30, bestCardId: null, at: 2000 });
  const row = board.boardView().teams.find((t) => t.team === 'Team Rocket')!;
  assert.ok(row, 'first display spelling');
  assert.equal(row.plays, 2);
  assert.equal(row.best, 60);
  assert.equal(row.at, 1000);
});

test('best run wins, ties go to the earlier run; sorted by best then earlier; rank and reset', () => {
  board.resetBoard(0);
  board.recordRun({ runId: 'r3', team: 'Alpha', playerName: 'a', score: 90, bestCardId: null, at: 100 });
  const beta = board.recordRun({ runId: 'r4', team: 'Beta', playerName: 'b', score: 90, bestCardId: null, at: 200 });
  assert.deepEqual(rb(beta), { rank: 2, best: 90 }, 'same score, later -> behind');
  board.recordRun({ runId: 'r5', team: 'Alpha', playerName: 'a2', score: 90, bestCardId: null, at: 300 }); // tie keeps the earlier
  assert.equal(board.boardView().teams[0].at, 100);
  const gamma = board.recordRun({ runId: 'r6', team: 'Gamma', playerName: 'g', score: 130, bestCardId: null, at: 400 });
  assert.deepEqual(rb(gamma), { rank: 1, best: 130 });
  const v = board.boardView();
  assert.deepEqual(v.teams.map((t) => [t.team, t.best, t.plays]), [['Gamma', 130, 1], ['Alpha', 90, 2], ['Beta', 90, 1]]);
  assert.equal(v.updatedAt, 400);
  assert.equal(v.teams[0].bestCard, null);
  // persisted on the volume
  const disk = JSON.parse(readFileSync(join(process.env.DATA_DIR!, 'board.json'), 'utf8'));
  assert.equal(Object.keys(disk.teams).length, 3);
  assert.equal(disk.runs.length, 4);
  for (let i = 0; i < 60; i++) board.recordRun({ runId: `loop${i}`, team: `T${i}`, playerName: 'x', score: i, bestCardId: null, at: 500 + i });
  assert.equal(board.boardView().teams.length, 50, 'top 50');
  board.resetBoard();
  assert.deepEqual(board.boardView().teams, []);
});

test('runs are idempotent by runId; unsafe team names are plain keys', () => {
  board.resetBoard(0);
  const a = board.recordRun({ runId: 'same', team: 'Delta', playerName: 'd', score: 60, bestCardId: null, at: 10 });
  const b = board.recordRun({ runId: 'same', team: 'Delta', playerName: 'd', score: 60, bestCardId: null, at: 10 });
  assert.deepEqual(a, b);
  assert.equal(board.boardView().teams[0].plays, 1, 'recorded once');
  for (const [i, t] of ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].entries())
    board.recordRun({ runId: `u${i}`, team: t, playerName: 'x', score: 10 + i, bestCardId: null, at: 20 + i });
  const names = board.boardView().teams.map((t) => t.team);
  for (const t of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.ok(names.includes(t), t);
  assert.equal(({} as any).plays, undefined, 'Object.prototype untouched');
  assert.deepEqual(board.standing('__proto__'), { rank: 5, best: 10 });
});

test('a board write failure throws and rolls back, so the same run can be recorded later', () => {
  board.resetBoard(0);
  const file = join(process.env.DATA_DIR!, 'board.json');
  rmSync(file, { force: true });
  mkdirSync(file); // the atomic rename onto a directory fails
  assert.throws(() => board.recordRun({ runId: 'later', team: 'Echo', playerName: 'e', score: 30, bestCardId: null, at: 5 }));
  assert.deepEqual(board.boardView().teams, []);
  rmSync(file, { recursive: true });
  assert.deepEqual(rb(board.recordRun({ runId: 'later', team: 'Echo', playerName: 'e', score: 30, bestCardId: null, at: 5 })), { rank: 1, best: 30 });
  assert.equal(board.boardView().teams[0].plays, 1);
});

test('only the best of a team\'s first 3 runs counts; later runs are saved but ignored', () => {
  board.resetBoard(0);
  for (const [i, score] of [30, 60, 45, 100, 130].entries()) board.recordRun({ runId: `g${i}`, team: 'Grinders', playerName: 'g', score, bestCardId: null, at: 10 + i });
  const row = board.boardView().teams[0];
  assert.equal(row.best, 60, 'runs 4 and 5 (100, 130) do not count');
  assert.equal(row.plays, 5);
  const disk = JSON.parse(readFileSync(join(process.env.DATA_DIR!, 'board.json'), 'utf8'));
  assert.equal(disk.runs.length, 5, 'all runs kept');
});

test('moderation: hidden teams and "E2E " test teams are off the board; runs stay', () => {
  board.resetBoard(0);
  board.recordRun({ runId: 'h1', team: 'Spam Team', playerName: 's', score: 300, bestCardId: null, at: 1 });
  board.recordRun({ runId: 'h2', team: 'Real Team', playerName: 'r', score: 60, bestCardId: null, at: 2 });
  assert.equal(board.recordRun({ runId: 'h3', team: 'E2E Test ab12', playerName: 'e', score: 999, bestCardId: null, at: 3 }).rank, null, 'test team has no standing');
  assert.deepEqual(board.boardView().teams.map((t) => t.team), ['Spam Team', 'Real Team']);
  assert.equal(board.hideTeam('  spam   TEAM '), true);
  assert.deepEqual(board.boardView().teams.map((t) => t.team), ['Real Team']);
  assert.deepEqual(board.standing('real team'), { rank: 1, best: 60 });
  assert.equal(board.hideTeam('nobody'), false);
  board.hideTeam('Spam Team', false);
  assert.equal(board.boardView().teams.length, 2, 'shown again');
  const disk = JSON.parse(readFileSync(join(process.env.DATA_DIR!, 'board.json'), 'utf8'));
  assert.equal(disk.runs.length, 3);
});

test('counted runs are per (team, device): a rival phone cannot burn a team\'s runs; best is across devices', () => {
  board.resetBoard(0);
  const run = (id: string, device: string, score: number, at: number) => board.recordRun({ runId: id, team: 'Foxtrot', playerName: 'f', score, bestCardId: null, at, device });
  // a rival burns 3 runs on their own phone with low scores
  for (let i = 0; i < 3; i++) assert.equal(run(`rv${i}`, 'rival-phone', 10, i).counted, true);
  const prac = run('rv3', 'rival-phone', 300, 3);
  assert.deepEqual([prac.counted, prac.runsLeft], [false, 0], 'the rival\'s 4th run is practice');
  assert.equal(board.boardView().teams[0].best, 10);
  // the real team still has its 3 counted runs on its own phone
  const t1 = run('t1', 'team-phone', 60, 10);
  assert.deepEqual([t1.counted, t1.runsLeft, t1.best], [true, 2, 60]);
  run('t2', 'team-phone', 85, 11);
  const t3 = run('t3', 'team-phone', 40, 12);
  assert.deepEqual([t3.counted, t3.runsLeft, t3.best], [true, 0, 85]);
  const t4 = run('t4', 'team-phone', 200, 13);
  assert.deepEqual([t4.counted, t4.runsLeft, t4.best], [false, 0, 85]);
  const row = board.boardView().teams[0];
  assert.deepEqual([row.best, row.plays], [85, 8]);
  // idempotent replay returns the same counted info
  assert.deepEqual(run('t1', 'team-phone', 60, 10), { ...t1, best: 85, rank: 1 });
  const disk = readFileSync(join(process.env.DATA_DIR!, 'board.json'), 'utf8');
  assert.ok(!disk.includes('team-phone'), 'device ids are stored hashed');
});

test('lastRun features the most recent visible run', () => {
  board.resetBoard(0);
  assert.equal(board.boardView().lastRun, null);
  board.recordRun({ runId: 'l1', team: 'Hotel', playerName: 'h', score: 60, bestCardId: null, at: 1 });
  board.recordRun({ runId: 'l2', team: 'India  Team', playerName: 'i', score: 30, bestCardId: null, at: 2 });
  board.recordRun({ runId: 'l3', team: 'E2E Test zz', playerName: 'e', score: 99, bestCardId: null, at: 3 });
  assert.deepEqual(board.boardView().lastRun, { team: 'India Team', score: 30, at: 2 }, 'test teams skipped');
  board.hideTeam('India Team');
  assert.deepEqual(board.boardView().lastRun, { team: 'Hotel', score: 60, at: 1 }, 'hidden teams skipped');
});

test('ghost: the day best counted run with splits; other days, practice, hidden and test teams are skipped', () => {
  board.resetBoard(0);
  const day = Date.UTC(2026, 10, 21, 17); // noon in Toronto
  const sp = (a: number, b: number) => [{ ms: a, points: 30 }, null, { ms: b, points: 60 }];
  board.recordRun({ runId: 'g1', team: 'Nova', playerName: 'n', score: 90, bestCardId: null, at: day, device: 'd1', splits: sp(20_000, 41_000) });
  board.recordRun({ runId: 'g2', team: 'Orbit', playerName: 'o', score: 200, bestCardId: null, at: day - 86_400_000, device: 'd2', splits: sp(1, 2) });
  board.recordRun({ runId: 'g3', team: 'E2E bot', playerName: 'e', score: 300, bestCardId: null, at: day, device: 'd3', splits: sp(1, 2) });
  board.recordRun({ runId: 'g4', team: 'Pulse', playerName: 'p', score: 150, bestCardId: null, at: day, device: 'd4' }); // no splits (older run)
  const g = board.ghostFor('2026-11-21');
  assert.equal(g?.team, 'Nova');
  assert.equal(g?.score, 90);
  assert.deepEqual(g?.splits, sp(20_000, 41_000));
  board.hideTeam('Nova');
  assert.equal(board.ghostFor('2026-11-21'), null, 'hidden teams are not raced');
  assert.equal(board.ghostFor('2026-11-22'), null, 'nobody yet today');
});

test('board view carries the server clock', () => {
  const t = Date.now();
  const v = board.boardView();
  assert.ok(v.now >= t && v.now <= Date.now());
});

test('a counted slot is reserved when a run starts: abandoning bad starts does not give it back', () => {
  board.resetBoard(0);
  const dev = 'juliet-phone';
  // start a run: slot 1 reserved; the team is not on the board until a run finishes
  assert.deepEqual(board.reserveRun('j1', 'Juliet', dev, 1), { counted: true, runsLeft: 2 });
  assert.deepEqual(board.reserveRun('j1', 'Juliet', dev, 1), { counted: true, runsLeft: 2 }, 'idempotent');
  assert.deepEqual(board.boardView().teams, [], 'reserved only: not shown');
  // abandoned at 0 points, finalized with what it earned
  const a = board.recordRun({ runId: 'j1', team: 'Juliet', playerName: 'j', score: 0, bestCardId: null, at: 2, device: dev });
  assert.deepEqual([a.counted, a.runsLeft, a.best], [true, 2, 0]);
  board.reserveRun('j2', 'Juliet', dev, 3);
  board.recordRun({ runId: 'j2', team: 'Juliet', playerName: 'j', score: 30, bestCardId: null, at: 4, device: dev });
  board.reserveRun('j3', 'Juliet', dev, 5); // started, then the server restarts / player leaves
  board.recordRun({ runId: 'j3', team: 'Juliet', playerName: 'j', score: 10, bestCardId: null, at: 6, device: dev });
  // a 4th start is practice from the moment it starts
  assert.deepEqual(board.reserveRun('j4', 'Juliet', dev, 7), { counted: false, runsLeft: 0 });
  const r4 = board.recordRun({ runId: 'j4', team: 'Juliet', playerName: 'j', score: 200, bestCardId: null, at: 8, device: dev });
  assert.deepEqual([r4.counted, r4.best], [false, 30]);
  const row = board.boardView().teams[0];
  assert.deepEqual([row.team, row.best, row.plays], ['Juliet', 30, 4]);
});
