import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'rarefind-board-'));
const board = await import('./board.js');

test('team key: trimmed, whitespace collapsed, lowercased, 24 chars; first spelling is kept for display', () => {
  assert.equal(board.teamKey('  Team   Rocket  '), 'team rocket');
  assert.equal(board.teamKey('A'.repeat(30)), 'a'.repeat(24));
  board.recordRun({ team: '  Team   Rocket ', playerName: 'Ava', score: 60, bestCardId: null, at: 1000 });
  board.recordRun({ team: 'TEAM ROCKET', playerName: 'Ben', score: 30, bestCardId: null, at: 2000 });
  const row = board.boardView().teams.find((t) => t.team === 'Team Rocket')!;
  assert.ok(row, 'first display spelling');
  assert.equal(row.plays, 2);
  assert.equal(row.best, 60);
  assert.equal(row.at, 1000);
});

test('best run wins, ties go to the earlier run; sorted by best then earlier; rank and reset', () => {
  board.resetBoard(0);
  board.recordRun({ team: 'Alpha', playerName: 'a', score: 90, bestCardId: null, at: 100 });
  const beta = board.recordRun({ team: 'Beta', playerName: 'b', score: 90, bestCardId: null, at: 200 });
  assert.deepEqual(beta, { rank: 2, best: 90 }, 'same score, later -> behind');
  board.recordRun({ team: 'Alpha', playerName: 'a2', score: 90, bestCardId: null, at: 300 }); // tie keeps the earlier
  assert.equal(board.boardView().teams[0].at, 100);
  const gamma = board.recordRun({ team: 'Gamma', playerName: 'g', score: 130, bestCardId: null, at: 400 });
  assert.deepEqual(gamma, { rank: 1, best: 130 });
  const v = board.boardView();
  assert.deepEqual(v.teams.map((t) => [t.team, t.best, t.plays]), [['Gamma', 130, 1], ['Alpha', 90, 2], ['Beta', 90, 1]]);
  assert.equal(v.updatedAt, 400);
  assert.equal(v.teams[0].bestCard, null);
  // persisted on the volume
  const disk = JSON.parse(readFileSync(join(process.env.DATA_DIR!, 'board.json'), 'utf8'));
  assert.equal(Object.keys(disk.teams).length, 3);
  assert.equal(disk.runs.length, 4);
  for (let i = 0; i < 60; i++) board.recordRun({ team: `T${i}`, playerName: 'x', score: i, bestCardId: null, at: 500 + i });
  assert.equal(board.boardView().teams.length, 50, 'top 50');
  board.resetBoard();
  assert.deepEqual(board.boardView().teams, []);
});
