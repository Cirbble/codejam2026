import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'rarefind-store-'));
const store = await import('./store.js');
const { scoreFind } = await import('./rarity.js');
const { Lru } = await import('./lru.js');

test('crowd counts: once per (device, prompt, label) and once per image per prompt', () => {
  const a = store.countFind('o-red', 'fire hydrant', 'devA', 'img1');
  assert.deepEqual(a, { sameCount: 1, totalCount: 1, counted: true, firstEver: true });
  // same device, same label, new photo: card still gets counts, crowd stats unchanged, and no first-ever bonus
  const again = store.countFind('o-red', 'fire hydrant', 'devA', 'img2');
  assert.deepEqual(again, { sameCount: 1, totalCount: 1, counted: false, firstEver: false });
  assert.equal(scoreFind(90, again.sameCount, again.totalCount, again.firstEver).points, 85, 'repeat is epic, not One of One');
  assert.equal(scoreFind(90, a.sameCount, a.totalCount, a.firstEver).points, 100);
  // another device re-using the same photo
  const reused = store.countFind('o-red', 'fire hydrant', 'devB', 'img1');
  assert.equal(reused.counted, false);
  assert.equal(reused.firstEver, false);
  // a genuinely new find counts
  const b = store.countFind('o-red', 'fire hydrant', 'devB', 'img3');
  assert.deepEqual(b, { sameCount: 2, totalCount: 2, counted: true, firstEver: false });
  const c = store.countFind('o-red', 'red cardinal', 'devA', 'img4');
  assert.deepEqual(c, { sameCount: 1, totalCount: 3, counted: true, firstEver: true });
  // a different prompt is separate
  assert.equal(store.countFind('o-round', 'fire hydrant', 'devA', 'img1').counted, true);
});

test('flushFind writes counts, cards, devices and daily to disk synchronously', () => {
  store.daily.data['2026-11-21'] = { devA: { cards: {}, tries: { 'o-red': 1 }, subs: {} } };
  store.daily.dirty();
  store.flushFind();
  const dir = process.env.DATA_DIR!;
  assert.equal(JSON.parse(readFileSync(join(dir, 'counts.json'), 'utf8'))['o-red']['fire hydrant'], 2);
  assert.equal(JSON.parse(readFileSync(join(dir, 'daily.json'), 'utf8'))['2026-11-21'].devA.tries['o-red'], 1);
  assert.ok(JSON.parse(readFileSync(join(dir, 'counted.json'), 'utf8'))['d|o-red|devA|fire hydrant']);
});

test('submission LRU is bounded and refreshes on hit', () => {
  const l = new Lru<number>(3, 60_000);
  l.set('a', 1);
  l.set('b', 2);
  l.set('c', 3);
  assert.equal(l.get('a'), 1); // a is now newest
  l.set('d', 4);
  assert.equal(l.size, 3);
  assert.equal(l.get('b'), undefined, 'oldest evicted');
  assert.equal(l.get('a'), 1);
});
