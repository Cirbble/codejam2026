import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETS, setProgress, setsCompletedBy } from './sets.js';
import { promptById } from './prompts.js';
import { tierFor } from './rarity.js';
import type { Card, Tier } from './types.js';

let seq = 0;
function card(promptId: string, tier: Tier = 'common', points = 10): Card {
  const id = `c${++seq}`.padEnd(24, '0');
  return { id, promptId, promptText: promptId, label: `thing ${seq}`, title: `Thing ${seq}`, tier, points, rarity: 20, sameCount: 1, totalCount: 1, verdict: 'ok', photo: `/p/${id}.jpg`, mode: 'daily', at: seq };
}

test('sets: every prompt a set names exists, ids are unique, every slot has a way to fill it', () => {
  assert.equal(new Set(SETS.map((s) => s.id)).size, SETS.length);
  for (const s of SETS)
    for (const slot of s.slots) {
      assert.ok(slot.tier || slot.prompts?.length, `${s.id}/${slot.name} has no prompts or tier`);
      for (const id of slot.prompts ?? []) assert.ok(promptById(id), `${s.id}/${slot.name}: unknown prompt ${id}`);
    }
});

test('sets: progress counts slots, indoor and outdoor versions fill the same slot, best card shown', () => {
  const low = card('o-red', 'common', 10);
  const high = card('i-red', 'rare', 60);
  const rainbow = setProgress([low, high, card('o-blue')]).find((s) => s.id === 'rainbow')!;
  assert.equal(rainbow.have, 2, 'two reds fill one slot');
  assert.equal(rainbow.done, false);
  assert.equal(rainbow.slots[0].card?.id, high.id, 'the better card fills the slot');
  assert.equal(rainbow.slots[1].card, null);
});

test('sets: the find that fills the last slot reports the set; later finds do not repeat it', () => {
  const have = [card('o-wheels'), card('o-ride')];
  const last = card('o-parked');
  assert.deepEqual(setsCompletedBy(have, last), [{ id: 'wheels', name: 'On wheels' }]);
  assert.deepEqual(setsCompletedBy([...have, last], card('o-parked')), [], 'already complete');
  assert.deepEqual(setsCompletedBy(have, card('o-red')), []);
});

test('sets: Full spectrum needs one card of each tier', () => {
  const tiers: Tier[] = ['common', 'uncommon', 'rare', 'epic'];
  const cards = tiers.map((t) => card('o-red', t));
  assert.equal(setProgress(cards).find((s) => s.id === 'tiers')!.have, 4);
  assert.deepEqual(setsCompletedBy(cards, card('o-blue', tierFor(99), 100)).map((s) => s.id), ['tiers']);
});
