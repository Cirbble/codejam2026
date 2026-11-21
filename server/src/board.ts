import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, cards, writeAtomic } from './store.js';
import { dict, toDict, type Dict } from './dict.js';
import type { Card } from './types.js';

/** People's Choice leaderboard: one solo run per table visit, aggregated per team. Persisted in DATA_DIR/board.json. */
export type Run = { runId: string; team: string; playerName: string; score: number; bestCardId: string | null; at: number };
type TeamRow = { team: string; best: number; plays: number; bestCardId: string | null; at: number };
type BoardDoc = { teams: Dict<TeamRow>; runs: Run[]; runIds: Dict<1>; updatedAt: number };

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

const emptyDoc = (now = 0): BoardDoc => ({ teams: dict(), runs: [], runIds: dict(), updatedAt: now });

function load(): BoardDoc {
  try {
    if (existsSync(FILE)) {
      const raw = JSON.parse(readFileSync(FILE, 'utf8'));
      const runs: Run[] = Array.isArray(raw.runs) ? raw.runs : [];
      const runIds = toDict<1>(raw.runIds);
      for (const r of runs) if (r.runId) runIds[r.runId] = 1;
      return { teams: toDict<TeamRow>(raw.teams), runs, runIds, updatedAt: Number(raw.updatedAt) || 0 };
    }
  } catch (e) {
    console.warn('[board] unreadable, starting empty:', (e as Error).message);
  }
  return emptyDoc();
}
let doc = load();

/** Sorted: best desc, then the earlier best run. */
function sorted(): [string, TeamRow][] {
  return Object.entries(doc.teams).sort((a, b) => b[1].best - a[1].best || a[1].at - b[1].at);
}

/**
 * Record a finished solo run, idempotently by runId. The board is written to disk before this returns;
 * a write failure rolls the in-memory change back and throws, so the caller can retry later.
 */
export function recordRun(run: Run): { rank: number; best: number } {
  const key = teamKey(run.team);
  if (doc.runIds[run.runId]) return standing(key) ?? { rank: 0, best: run.score };
  const prevRow = doc.teams[key] ? { ...doc.teams[key] } : null;
  const prevUpdated = doc.updatedAt;
  const row = (doc.teams[key] ??= { team: displayTeam(run.team), best: run.score, plays: 0, bestCardId: run.bestCardId, at: run.at });
  row.plays++;
  if (run.score > row.best) {
    // strictly higher only: a tie keeps the earlier run
    row.best = run.score;
    row.bestCardId = run.bestCardId;
    row.at = run.at;
  }
  doc.runs.push({ ...run, team: row.team });
  doc.runIds[run.runId] = 1;
  const trimmed = doc.runs.length > MAX_RUNS_KEPT ? doc.runs.splice(0, doc.runs.length - MAX_RUNS_KEPT) : [];
  doc.updatedAt = run.at;
  try {
    writeAtomic(FILE, JSON.stringify(doc));
  } catch (e) {
    if (prevRow) doc.teams[key] = prevRow;
    else delete doc.teams[key];
    doc.runs.pop();
    doc.runs.unshift(...trimmed);
    delete doc.runIds[run.runId];
    doc.updatedAt = prevUpdated;
    throw e;
  }
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
  const next = emptyDoc(now);
  writeAtomic(FILE, JSON.stringify(next));
  doc = next;
}
