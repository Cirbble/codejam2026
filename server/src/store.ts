import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, Reply } from './types.js';

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
export const PHOTO_DIR = join(DATA_DIR, 'p');
mkdirSync(PHOTO_DIR, { recursive: true });

export function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** A JSON document on the volume: loaded once, written atomically, debounced. */
export class JsonFile<T extends object> {
  data: T;
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private name: string,
    init: () => T,
    private debounceMs = 750,
  ) {
    const file = this.file;
    let loaded: T | null = null;
    try {
      if (existsSync(file)) loaded = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.warn(`[store] ${name} unreadable, starting empty:`, (e as Error).message);
    }
    this.data = loaded ?? init();
    all.add(this);
  }
  get file() {
    return join(DATA_DIR, `${this.name}.json`);
  }
  dirty() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
    this.timer.unref?.();
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      writeAtomic(this.file, JSON.stringify(this.data));
    } catch (e) {
      console.warn(`[store] ${this.name} save failed:`, (e as Error).message);
    }
  }
}
const all = new Set<JsonFile<any>>();
export function flushAll() {
  for (const f of all) f.flush();
}

// ---------------- documents ----------------
/** promptId -> label -> count */
export const counts = new JsonFile<Record<string, Record<string, number>>>('counts', () => ({}));
export const cards = new JsonFile<Record<string, Card>>('cards', () => ({}));
/** device -> card ids, oldest first */
export const byDevice = new JsonFile<Record<string, string[]>>('devices', () => ({}));
/** crowd-count dedup keys: `d|<prompt>|<device>|<label>` and `i|<prompt>|<imageHash>` */
export const counted = new JsonFile<Record<string, 1>>('counted', () => ({}));
export type DailyEntry = { cards: Record<string, string>; tries: Record<string, number>; subs?: Record<string, Reply> };
/** day -> device -> progress */
export const daily = new JsonFile<Record<string, Record<string, DailyEntry>>>('daily', () => ({}));

export function promptTotals(promptId: string) {
  const m = counts.data[promptId] ?? {};
  let total = 0;
  for (const n of Object.values(m)) total += n;
  return { map: m, total };
}

export function topLabels(promptId: string, n: number): { label: string; count: number }[] {
  return Object.entries(counts.data[promptId] ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

/**
 * Count a find in the crowd stats at most once per (device, prompt, label) and once per image per prompt,
 * so re-submitting cannot farm rarity. Returns the counts at that moment, including this find.
 */
export function countFind(promptId: string, label: string, device: string, imageHash: string) {
  const m = (counts.data[promptId] ??= {});
  const kd = `d|${promptId}|${device}|${label}`;
  const ki = `i|${promptId}|${imageHash}`;
  const fresh = !counted.data[kd] && !counted.data[ki];
  const firstEver = fresh && !m[label]; // decided before incrementing
  if (fresh) {
    m[label] = (m[label] ?? 0) + 1;
    counted.data[kd] = counted.data[ki] = 1;
    counts.dirty();
    counted.dirty();
  }
  const { total } = promptTotals(promptId);
  return { sameCount: Math.max(1, m[label] ?? 0), totalCount: Math.max(1, total), counted: fresh, firstEver };
}

/** Write everything an accepted find touches before replying. */
export function flushFind() {
  for (const f of [counts, counted, cards, byDevice, daily]) f.flush();
}

export function saveCard(card: Card, device: string, jpeg: Buffer) {
  writeFileSync(join(PHOTO_DIR, `${card.id}.jpg`), jpeg);
  cards.data[card.id] = card;
  cards.dirty();
  (byDevice.data[device] ??= []).push(card.id);
  byDevice.dirty();
}

export function dailyEntry(day: string, device: string): DailyEntry {
  return daily.data[day]?.[device] ?? { cards: {}, tries: {} };
}

export function dailyEntryMut(day: string, device: string): DailyEntry {
  const d = (daily.data[day] ??= {});
  return (d[device] ??= { cards: {}, tries: {} });
}
