import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, cards, writeAtomic } from './store.js';
import type { Card } from './types.js';

/** People's Choice leaderboard: one solo run per table visit, aggregated per team. Persisted in DATA_DIR/board.json. */
export type Run = { team: string; playerName: string; score: number; bestCardId: string | null; at: number };
type TeamRow = { team: string; best: number; plays: number; bestCardId: string | null; at: number };
type BoardDoc = { teams: Record<string, TeamRow>; runs: Run[]; updatedAt: number };

export const BOARD_TOP = 50;
const MAX_RUNS_KEPT = 5000;
const FILE = join(DATA_DIR, 'board.json');

/** trim, collapse whitespace, lowercase, max 24 chars */
export function teamKey(name: unknown): string {
  return displayTeam(name).toLowerCase();
}
export function displayTeam(name: unknown): string {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .trim();
}

function load(): BoardDoc {
  try {
    if (existsSync(FILE)) return { teams: {}, runs: [], updatedAt: 0, ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch (e) {
    console.warn('[board] unreadable, starting empty:', (e as Error).message);
  }
  return { teams: {}, runs: [], updatedAt: 0 };
}
let doc = load();

function save() {
  try {
    writeAtomic(FILE, JSON.stringify(doc));
  } catch (e) {
    console.warn('[board] save failed:', (e as Error).message);
  }
}

/** Sorted: best desc, then the earlier best run. */
function sorted(): [string, TeamRow][] {
  return Object.entries(doc.teams).sort((a, b) => b[1].best - a[1].best || a[1].at - b[1].at);
}

export function recordRun(run: Run): { rank: number; best: number } {
  const key = teamKey(run.team);
  const row = (doc.teams[key] ??= { team: displayTeam(run.team), best: run.score, plays: 0, bestCardId: run.bestCardId, at: run.at });
  row.plays++;
  if (run.score > row.best) {
    // strictly higher only: a tie keeps the earlier run
    row.best = run.score;
    row.bestCardId = run.bestCardId;
    row.at = run.at;
  }
  doc.runs.push({ ...run, team: row.team });
  if (doc.runs.length > MAX_RUNS_KEPT) doc.runs.splice(0, doc.runs.length - MAX_RUNS_KEPT);
  doc.updatedAt = run.at;
  save();
  return standing(key)!;
}

/** The team's current 1-based rank and best score. */
export function standing(key: string): { rank: number; best: number } | null {
  const i = sorted().findIndex(([k]) => k === key);
  return i < 0 ? null : { rank: i + 1, best: doc.teams[key].best };
}

export function boardView(): { teams: { team: string; best: number; plays: number; bestCard: Card | null; at: number }[]; updatedAt: number } {
  return {
    teams: sorted()
      .slice(0, BOARD_TOP)
      .map(([, r]) => ({ team: r.team, best: r.best, plays: r.plays, bestCard: (r.bestCardId && cards.data[r.bestCardId]) || null, at: r.at })),
    updatedAt: doc.updatedAt,
  };
}

export function resetBoard(now = Date.now()) {
  doc = { teams: {}, runs: [], updatedAt: now };
  save();
}
