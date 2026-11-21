import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DATA_DIR, cards, writeAtomic } from './store.js';
import { dict, toDict, type Dict } from './dict.js';
import type { Card } from './types.js';

/** People's Choice leaderboard: one solo run per table visit, aggregated per team. Persisted in DATA_DIR/board.json. */
/** device: the phone that played (stored only as a short hash; device ids are bearer secrets). */
export type Run = { runId: string; team: string; playerName: string; score: number; bestCardId: string | null; at: number; device?: string };
/** What a recorded run means for the team: its standing (null for hidden/test teams) and whether this run counted. */
export type RunResult = { rank: number | null; best: number | null; counted: boolean; runsLeft: number };
type StoredRun = Omit<Run, 'device'> & { dev?: string; counted?: boolean };
/** plays: every run; countedBy: counted runs per device hash (first COUNTED_RUNS per device); best is the best counted run. */
type TeamRow = { team: string; best: number; plays: number; countedBy?: Dict<number>; bestCardId: string | null; at: number };
type RunMemo = { counted: boolean; runsLeft: number };
type BoardDoc = { teams: Dict<TeamRow>; runs: StoredRun[]; runIds: Dict<RunMemo | 1>; hidden: Dict<1>; updatedAt: number };

export const BOARD_TOP = 50;
/**
 * Only the first 3 runs per (team, device) count toward the team's best (no grinding, and a rival typing a team's
 * name on another phone can't burn that team's runs). Later runs are saved but ignored (practice).
 */
export const COUNTED_RUNS = 3;
const devHash = (device: string | undefined) => (device ? createHash('sha1').update(device).digest('hex').slice(0, 16) : 'unknown');
/** Test teams (the e2e uses "E2E ..." names) never show on the board. */
const isTestTeam = (display: string) => /^e2e /i.test(display);
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

const emptyDoc = (now = 0): BoardDoc => ({ teams: dict(), runs: [], runIds: dict(), hidden: dict(), updatedAt: now });

function load(): BoardDoc {
  try {
    if (existsSync(FILE)) {
      const raw = JSON.parse(readFileSync(FILE, 'utf8'));
      const runs: StoredRun[] = Array.isArray(raw.runs) ? raw.runs : [];
      const runIds = toDict<RunMemo | 1>(raw.runIds);
      for (const r of runs) if (r.runId && !runIds[r.runId]) runIds[r.runId] = 1;
      const teams = toDict<TeamRow>(raw.teams, (t) => ({ ...t, countedBy: toDict<number>(t?.countedBy) }));
      return { teams, runs, runIds, hidden: toDict<1>(raw.hidden), updatedAt: Number(raw.updatedAt) || 0 };
    }
  } catch (e) {
    console.warn('[board] unreadable, starting empty:', (e as Error).message);
  }
  return emptyDoc();
}
let doc = load();

/** Visible teams, sorted: best desc, then the earlier best run. Hidden and test teams are left out. */
function sorted(): [string, TeamRow][] {
  return Object.entries(doc.teams)
    .filter(([k, r]) => !doc.hidden[k] && !isTestTeam(r.team))
    .sort((a, b) => b[1].best - a[1].best || a[1].at - b[1].at);
}

/**
 * Record a finished solo run, idempotently by runId. The board is written to disk before this returns;
 * a write failure rolls the in-memory change back and throws, so the caller can retry later.
 */
export function recordRun(run: Run): RunResult {
  const key = teamKey(run.team);
  const seen = doc.runIds[run.runId];
  if (seen) {
    const s = standing(key);
    const memo: RunMemo = seen === 1 ? { counted: true, runsLeft: 0 } : seen;
    return { rank: s?.rank ?? null, best: s?.best ?? null, ...memo };
  }
  const prevRow = doc.teams[key] ? { ...doc.teams[key], countedBy: toDict<number>(doc.teams[key].countedBy) } : null;
  const prevUpdated = doc.updatedAt;
  const dev = devHash(run.device);
  const isNew = !doc.teams[key];
  const row = (doc.teams[key] ??= { team: displayTeam(run.team), best: 0, plays: 0, countedBy: dict(), bestCardId: run.bestCardId, at: run.at });
  const by = (row.countedBy ??= dict());
  row.plays++;
  const used = by[dev] ?? 0;
  const counted = used < COUNTED_RUNS;
  if (counted) {
    by[dev] = used + 1;
    // strictly higher only: a tie keeps the earlier run
    if (isNew || run.score > row.best) {
      row.best = run.score;
      row.bestCardId = run.bestCardId;
      row.at = run.at;
    }
  }
  const memo: RunMemo = { counted, runsLeft: Math.max(0, COUNTED_RUNS - (by[dev] ?? 0)) };
  const { device: _omit, ...rest } = run;
  doc.runs.push({ ...rest, team: row.team, dev, counted });
  doc.runIds[run.runId] = memo;
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
  const s = standing(key);
  return { rank: s?.rank ?? null, best: s?.best ?? null, ...memo };
}

/** Hide (or show again) a team on the board; its runs stay saved. Returns false for an unknown team. */
export function hideTeam(name: string, hidden = true): boolean {
  const key = teamKey(name);
  if (!doc.teams[key]) return false;
  const prev = doc.hidden[key];
  if (hidden) doc.hidden[key] = 1;
  else delete doc.hidden[key];
  try {
    writeAtomic(FILE, JSON.stringify(doc));
  } catch (e) {
    if (prev) doc.hidden[key] = prev;
    else delete doc.hidden[key];
    throw e;
  }
  return true;
}

/** The team's current 1-based rank and best score. */
export function standing(key: string): { rank: number; best: number } | null {
  const i = sorted().findIndex(([k]) => k === key);
  return i < 0 ? null : { rank: i + 1, best: doc.teams[key].best };
}

export function boardView(): {
  teams: { team: string; best: number; plays: number; bestCard: Card | null; at: number }[];
  lastRun: { team: string; score: number; at: number } | null;
  updatedAt: number;
} {
  return {
    teams: sorted()
      .slice(0, BOARD_TOP)
      .map(([, r]) => ({ team: r.team, best: r.best, plays: r.plays, bestCard: (r.bestCardId && cards.data[r.bestCardId]) || null, at: r.at })),
    lastRun: lastVisibleRun(),
    updatedAt: doc.updatedAt,
  };
}

/** The most recent run of a visible team (for the projector to feature whoever just played). */
function lastVisibleRun(): { team: string; score: number; at: number } | null {
  for (let i = doc.runs.length - 1; i >= 0; i--) {
    const r = doc.runs[i];
    const key = teamKey(r.team);
    if (!doc.hidden[key] && !isTestTeam(r.team)) return { team: doc.teams[key]?.team ?? r.team, score: r.score, at: r.at };
  }
  return null;
}

export function resetBoard(now = Date.now()) {
  const next = emptyDoc(now);
  writeAtomic(FILE, JSON.stringify(next));
  doc = next;
}
