import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, Reply } from './types.js';
import { dict, toDict } from './dict.js';

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
export const PHOTO_DIR = join(DATA_DIR, 'p');
mkdirSync(PHOTO_DIR, { recursive: true });

/** temp file + rename: the target is either the old or the new document, never half-written. */
export function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export type DailyEntry = { cards: Record<string, string>; tries: Record<string, number>; subs?: Record<string, Reply> };

/**
 * Every piece of find metadata lives in ONE document (finds.json), so an accepted find is committed to disk
 * atomically: counts, dedup and used-photo marks, cards, device lists, daily progress and replies.
 */
type FindsDoc = {
  /** promptId -> label -> count */
  counts: Record<string, Record<string, number>>;
  /** crowd-count dedup keys `d|<prompt>|<device>|<label>`, `i|<prompt>|<imageHash>`; used photos `u|<prompt>|<device>|<imageHash>` */
  counted: Record<string, 1>;
  cards: Record<string, Card>;
  /** device -> card ids, oldest first */
  devices: Record<string, string[]>;
  /** day -> device -> progress */
  daily: Record<string, Record<string, DailyEntry>>;
  /** cardId -> its used-photo key, so a dropped card frees its photo mark */
  photoMark: Record<string, string>;
  /** squad/solo cards committed but not yet confirmed in a room snapshot (crash-window journal) */
  pendingSquad: Record<string, PendingSquad>;
};
export type PendingSquad = { code: string; playerId: string; submissionId: string; round: number };
const FINDS_FILE = join(DATA_DIR, 'finds.json');
const empty = (): FindsDoc => ({ counts: dict(), counted: dict(), cards: dict(), devices: dict(), daily: dict(), photoMark: dict(), pendingSquad: dict() });

/** Rebuild a loaded document with null-prototype dictionaries at every level keyed by user strings. */
function normalize(raw: any): FindsDoc {
  const entry = (e: any): DailyEntry => ({ cards: toDict(e?.cards), tries: toDict(e?.tries), ...(e?.subs ? { subs: toDict(e.subs) } : {}) });
  return {
    counts: toDict(raw?.counts, (m) => toDict<number>(m)),
    counted: toDict(raw?.counted),
    cards: toDict(raw?.cards),
    devices: toDict(raw?.devices, (l) => (Array.isArray(l) ? l : [])),
    daily: toDict(raw?.daily, (byDev) => toDict(byDev, entry)),
    photoMark: toDict(raw?.photoMark),
    pendingSquad: toDict(raw?.pendingSquad),
  };
}

function readJson(file: string): any {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  } catch (e) {
    console.warn(`[store] ${file} unreadable:`, (e as Error).message);
    return undefined;
  }
}

function loadDoc(): FindsDoc {
  const doc = readJson(FINDS_FILE);
  if (doc) return normalize(doc);
  // one-time migration from the earlier one-file-per-collection layout
  const legacy = (n: string) => readJson(join(DATA_DIR, `${n}.json`)) ?? {};
  const d: FindsDoc = normalize({ counts: legacy('counts'), counted: legacy('counted'), cards: legacy('cards'), devices: legacy('devices'), daily: legacy('daily') });
  if (Object.keys(d.cards).length || Object.keys(d.counts).length) console.log('[store] migrated legacy files into finds.json');
  return d;
}

const doc: FindsDoc = loadDoc();
let timer: NodeJS.Timeout | null = null;

/** Write the whole find document now. strict: rethrow (an accepted find is only acknowledged once it is on disk). */
export function commitFinds(strict = true) {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    writeAtomic(FINDS_FILE, JSON.stringify(doc));
  } catch (e) {
    console.warn('[store] finds save failed:', (e as Error).message);
    if (strict) throw e;
  }
}
function dirty() {
  if (timer) return;
  timer = setTimeout(() => commitFinds(false), 750);
  timer.unref?.();
}
export function flushAll() {
  commitFinds(false);
}

/** A view of one collection inside the single document. */
class Section<K extends keyof FindsDoc> {
  constructor(private key: K) {}
  get data(): FindsDoc[K] {
    return doc[this.key];
  }
  dirty() {
    dirty();
  }
  flush(strict = false) {
    commitFinds(strict);
  }
}
export const counts = new Section('counts');
export const counted = new Section('counted');
export const cards = new Section('cards');
export const byDevice = new Section('devices');
export const daily = new Section('daily');

export function promptTotals(promptId: string) {
  const m = doc.counts[promptId] ?? dict<number>();
  let total = 0;
  for (const n of Object.values(m)) total += n;
  return { map: m, total };
}

export function topLabels(promptId: string, n: number): { label: string; count: number }[] {
  return Object.entries(doc.counts[promptId] ?? dict<number>())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

/**
 * Count a find in the crowd stats at most once per (device, prompt, label) and once per image per prompt,
 * so re-submitting cannot farm rarity. Returns the counts at that moment, including this find.
 * In memory only: the caller commits.
 */
export function countFind(promptId: string, label: string, crowdKey: string, imageHash: string) {
  const m = (doc.counts[promptId] ??= dict<number>());
  const kd = `d|${promptId}|${crowdKey}|${label}`; // crowdKey: the device, or device + team for solo runs
  const ki = `i|${promptId}|${imageHash}`;
  const fresh = !doc.counted[kd] && !doc.counted[ki];
  const firstEver = fresh && !m[label]; // decided before incrementing
  if (fresh) {
    m[label] = (m[label] ?? 0) + 1;
    doc.counted[kd] = doc.counted[ki] = 1;
  }
  const { total } = promptTotals(promptId);
  const undo = () => {
    if (!fresh) return;
    if ((m[label] = (m[label] ?? 1) - 1) <= 0) delete m[label];
    delete doc.counted[kd];
    delete doc.counted[ki];
  };
  return { sameCount: Math.max(1, m[label] ?? 0), totalCount: Math.max(1, total), counted: fresh, firstEver, undo };
}

/** Journal a squad/solo card in the same atomic commit as the card itself; cleared once the room snapshot has it. */
export function markPendingSquad(cardId: string, p: PendingSquad) {
  doc.pendingSquad[cardId] = p;
}
export function clearPendingSquad(cardId: string) {
  if (!doc.pendingSquad[cardId]) return;
  delete doc.pendingSquad[cardId];
  dirty();
}
export function pendingSquads(): [string, PendingSquad][] {
  return Object.entries(doc.pendingSquad);
}
/** Let the same photo be sent again (its card got no room credit). */
export function releaseUsedPhoto(cardId: string) {
  const uk = doc.photoMark[cardId];
  if (uk) delete doc.counted[uk];
}

/** Counts as they'd be for this find, without recording anything (test traffic). */
export function peekCounts(promptId: string, label: string) {
  const m = doc.counts[promptId] ?? dict<number>();
  const { total } = promptTotals(promptId);
  return { sameCount: (m[label] ?? 0) + 1, totalCount: total + 1, counted: false, firstEver: false, undo: () => {} };
}

/** Moderation: zero one prompt's crowd counts (and its dedup marks, so new finds count again). Used-photo marks stay. */
export function resetPromptCounts(promptId: string): number {
  const { total } = promptTotals(promptId);
  doc.counts[promptId] = dict<number>();
  for (const k of Object.keys(doc.counted)) if (k.startsWith(`d|${promptId}|`) || k.startsWith(`i|${promptId}|`)) delete doc.counted[k];
  commitFinds();
  return total;
}

const usedKey = (promptId: string, device: string, imageHash: string) => `u|${promptId}|${device}|${imageHash}`;
/** This device already had this exact photo accepted for this prompt. */
export function usedPhoto(promptId: string, device: string, imageHash: string): boolean {
  return !!doc.counted[usedKey(promptId, device, imageHash)];
}

/**
 * Stage an accepted card: the photo file is written first (throws before touching metadata), then the card,
 * device list and used-photo mark go into memory. The caller commits with commitFinds(); on failure it calls
 * the returned undo, which also deletes the photo.
 */
export function saveCard(card: Card, device: string, jpeg: Buffer, imageHash: string): () => void {
  const photo = join(PHOTO_DIR, `${card.id}.jpg`);
  writeFileSync(photo, jpeg);
  const uk = usedKey(card.promptId, device, imageHash);
  doc.cards[card.id] = card;
  (doc.devices[device] ??= []).push(card.id);
  doc.counted[uk] = 1;
  doc.photoMark[card.id] = uk;
  return () => {
    delete doc.cards[card.id];
    delete doc.photoMark[card.id];
    const list = doc.devices[device];
    if (list) {
      const i = list.lastIndexOf(card.id);
      if (i >= 0) list.splice(i, 1);
    }
    delete doc.counted[uk];
    try {
      rmSync(photo, { force: true });
    } catch {}
  };
}

export function dailyEntry(day: string, device: string): DailyEntry {
  return doc.daily[day]?.[device] ?? { cards: dict(), tries: dict() };
}

export function dailyEntryMut(day: string, device: string): DailyEntry {
  const d = (doc.daily[day] ??= dict());
  return (d[device] ??= { cards: dict(), tries: dict() });
}

/** Startup integrity check: drop cards whose photo file is missing (and every reference to them). */
export function dropCardsWithoutPhotos(): number {
  const gone = new Set<string>();
  for (const id of Object.keys(doc.cards)) if (!existsSync(join(PHOTO_DIR, `${id}.jpg`))) gone.add(id);
  if (!gone.size) return 0;
  for (const id of gone) {
    delete doc.cards[id];
    const uk = doc.photoMark[id];
    if (uk) delete doc.counted[uk];
    delete doc.photoMark[id];
  }
  for (const [dev, list] of Object.entries(doc.devices)) doc.devices[dev] = list.filter((id) => !gone.has(id));
  for (const byDev of Object.values(doc.daily))
    for (const e of Object.values(byDev)) {
      for (const [pid, cid] of Object.entries(e.cards)) if (gone.has(cid)) delete e.cards[pid];
      for (const [sub, r] of Object.entries(e.subs ?? {})) if ((r.body as any)?.card && gone.has((r.body as any).card.id)) delete e.subs![sub];
    }
  commitFinds(false);
  return gone.size;
}
