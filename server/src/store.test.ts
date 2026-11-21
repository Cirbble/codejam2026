import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'rarefind-store-'));
const store = await import('./store.js');
const { scoreFind } = await import('./rarity.js');
const { Lru } = await import('./lru.js');
const plain = ({ undo, ...rest }: any) => rest;

test('crowd counts: once per (device, prompt, label) and once per image per prompt', () => {
  const a = store.countFind('o-red', 'fire hydrant', 'devA', 'img1');
  assert.deepEqual(plain(a), { sameCount: 1, totalCount: 1, counted: true, firstEver: true });
  // same device, same label, new photo: card still gets counts, crowd stats unchanged, and no first-ever bonus
  const again = store.countFind('o-red', 'fire hydrant', 'devA', 'img2');
  assert.deepEqual(plain(again), { sameCount: 1, totalCount: 1, counted: false, firstEver: false });
  assert.equal(scoreFind(90, again.sameCount, again.totalCount, again.firstEver).points, 85, 'repeat is epic, not One of One');
  assert.equal(scoreFind(90, a.sameCount, a.totalCount, a.firstEver).points, 100);
  // another device re-using the same photo
  const reused = store.countFind('o-red', 'fire hydrant', 'devB', 'img1');
  assert.equal(reused.counted, false);
  assert.equal(reused.firstEver, false);
  // a genuinely new find counts
  const b = store.countFind('o-red', 'fire hydrant', 'devB', 'img3');
  assert.deepEqual(plain(b), { sameCount: 2, totalCount: 2, counted: true, firstEver: false });
  const c = store.countFind('o-red', 'red cardinal', 'devA', 'img4');
  assert.deepEqual(plain(c), { sameCount: 1, totalCount: 3, counted: true, firstEver: true });
  // a different prompt is separate
  assert.equal(store.countFind('o-round', 'fire hydrant', 'devA', 'img1').counted, true);
});

test('commitFinds writes counts, marks, cards, devices and daily as one document', () => {
  store.daily.data['2026-11-21'] = { devA: { cards: {}, tries: { 'o-red': 1 }, subs: {} } };
  store.commitFinds();
  const doc = JSON.parse(readFileSync(join(process.env.DATA_DIR!, 'finds.json'), 'utf8'));
  assert.equal(doc.counts['o-red']['fire hydrant'], 2);
  assert.equal(doc.daily['2026-11-21'].devA.tries['o-red'], 1);
  assert.ok(doc.counted['d|o-red|devA|fire hydrant']);
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

test('accepted-find commit is atomic on disk: a failed write leaves the old document, no photo, and memory rolled back', () => {
  const card = (id: string): any => ({ id, promptId: 'o-blue', promptText: 'x', label: 'mailbox', title: 'Mailbox', tier: 'common', points: 10, rarity: 20, sameCount: 1, totalCount: 1, verdict: 'ok', photo: `/p/${id}.jpg`, mode: 'daily', at: 1 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const dir = process.env.DATA_DIR!;
  const file = join(dir, 'finds.json');
  const before = readFileSync(file, 'utf8');
  // a directory where finds.json goes makes the atomic rename fail
  rmSync(file, { force: true });
  mkdirSync(file);
  const cnt = store.countFind('o-blue', 'mailbox', 'devZ', 'hz');
  const undo = store.saveCard(card('aaaaaaaaaaaaaaaaaaaaaaaa'), 'devZ', jpeg, 'hz');
  assert.ok(existsSync(join(store.PHOTO_DIR, 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg')), 'photo is written first');
  assert.throws(() => store.commitFinds());
  undo();
  cnt.undo();
  assert.equal(existsSync(join(store.PHOTO_DIR, 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg')), false, 'photo deleted after the failed commit');
  assert.equal(store.cards.data['aaaaaaaaaaaaaaaaaaaaaaaa'], undefined);
  assert.equal(store.usedPhoto('o-blue', 'devZ', 'hz'), false);
  assert.equal(store.promptTotals('o-blue').total, 0, 'crowd count undone');
  assert.deepEqual(store.byDevice.data['devZ'] ?? [], []);
  rmSync(file, { recursive: true });
  writeFileSync(file, before);
  // retry succeeds and the photo is now marked used for this device and prompt only
  const again = store.countFind('o-blue', 'mailbox', 'devZ', 'hz');
  assert.equal(again.firstEver, true, 'the retry is still the first-ever find');
  store.saveCard(card('bbbbbbbbbbbbbbbbbbbbbbbb'), 'devZ', jpeg, 'hz');
  store.commitFinds();
  assert.equal(store.usedPhoto('o-blue', 'devZ', 'hz'), true);
  assert.equal(store.usedPhoto('o-blue', 'devY', 'hz'), false);
  assert.equal(store.usedPhoto('o-red', 'devZ', 'hz'), false);
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).cards['bbbbbbbbbbbbbbbbbbbbbbbb']);
});

test('startup check drops cards whose photo is missing, with their references', () => {
  const day = '2026-11-21';
  const e = store.dailyEntryMut(day, 'devZ');
  e.cards['o-blue'] = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  e.subs = { s1: { status: 200, body: { accepted: true, card: store.cards.data['bbbbbbbbbbbbbbbbbbbbbbbb'] } } };
  store.commitFinds();
  rmSync(join(store.PHOTO_DIR, 'bbbbbbbbbbbbbbbbbbbbbbbb.jpg'));
  assert.equal(store.dropCardsWithoutPhotos(), 1);
  assert.equal(store.cards.data['bbbbbbbbbbbbbbbbbbbbbbbb'], undefined);
  assert.deepEqual(store.byDevice.data['devZ'], []);
  assert.equal(store.dailyEntry(day, 'devZ').cards['o-blue'], undefined);
  assert.equal(store.dailyEntry(day, 'devZ').subs!.s1, undefined);
  assert.equal(store.usedPhoto('o-blue', 'devZ', 'hz'), false, 'photo mark freed');
  assert.equal(store.dropCardsWithoutPhotos(), 0);
});
