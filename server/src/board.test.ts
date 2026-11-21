import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'rarefind-board-'));
const board = await import('./board.js');

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
  assert.deepEqual(beta, { rank: 2, best: 90 }, 'same score, later -> behind');
  board.recordRun({ runId: 'r5', team: 'Alpha', playerName: 'a2', score: 90, bestCardId: null, at: 300 }); // tie keeps the earlier
  assert.equal(board.boardView().teams[0].at, 100);
  const gamma = board.recordRun({ runId: 'r6', team: 'Gamma', playerName: 'g', score: 130, bestCardId: null, at: 400 });
  assert.deepEqual(gamma, { rank: 1, best: 130 });
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
  assert.deepEqual(board.recordRun({ runId: 'later', team: 'Echo', playerName: 'e', score: 30, bestCardId: null, at: 5 }), { rank: 1, best: 30 });
  assert.equal(board.boardView().teams[0].plays, 1);
});
