import type { Card, Tier } from './types.js';

/**
 * Collection sets: themed groups of prompts. A slot is filled by any card for one of its prompts (the outdoor and
 * indoor versions of a prompt count the same), or, for a tier slot, by any card of that tier.
 */
export type SetSlot = { name: string; prompts?: string[]; tier?: Tier };
export type SetDef = { id: string; name: string; blurb: string; slots: SetSlot[] };

const p = (name: string, ...prompts: string[]): SetSlot => ({ name, prompts });
const t = (name: string, tier: Tier): SetSlot => ({ name, tier });

export const SETS: SetDef[] = [
  { id: 'rainbow', name: 'Rainbow', blurb: 'Every colour on the list', slots: [p('Red', 'o-red', 'i-red'), p('Yellow', 'o-yellow'), p('Blue', 'o-blue', 'i-blue'), p('Three colours', 'o-many-colors')] },
  { id: 'shapes', name: 'Shapes', blurb: 'Round, pointy and in between', slots: [p('Round', 'o-round', 'i-round'), p('Triangle', 'o-triangle'), p('Spiral', 'o-spiral'), p('Heart', 'o-heart'), p('Pointy', 'o-pointy')] },
  { id: 'patterns', name: 'Patterns', blurb: 'Things that repeat', slots: [p('Squares', 'o-squares'), p('Stripes', 'o-stripes', 'i-stripes'), p('Dots', 'o-dots'), p('Lots of one thing', 'o-repeat'), p('A matching pair', 'o-pair')] },
  { id: 'textures', name: 'Textures', blurb: 'Hunt with your fingertips', slots: [p('Touchable', 'o-touch'), p('Rough', 'o-rough'), p('Shiny', 'o-shiny', 'i-shiny'), p('Soft', 'o-soft', 'i-soft'), p('Bumpy', 'o-bumpy')] },
  { id: 'materials', name: 'Materials', blurb: 'What the world is made of', slots: [p('Metal', 'o-metal'), p('Wood', 'o-wood', 'i-wood'), p('Stone', 'o-stone'), p('Glass', 'o-glass'), p('Plastic', 'o-plastic'), p('Paper', 'i-paper')] },
  { id: 'wild', name: 'Into the wild', blurb: 'Living things and wild places', slots: [p('Flower', 'o-flower'), p('Leaf', 'o-leaf'), p('Fungus', 'o-fungus'), p('Bird', 'o-bird'), p('Wild water', 'o-water')] },
  { id: 'signs', name: 'Read the street', blurb: 'Signs, numbers and arrows', slots: [p('Number', 'o-sign-number', 'i-number'), p('Arrow', 'o-arrow'), p('Warning', 'o-warning'), p('Food word', 'o-food-word')] },
  { id: 'time', name: 'Time travel', blurb: 'Old, new and passing', slots: [p('Older than you', 'o-older', 'i-older'), p('Brand new', 'o-new'), p('Tells time', 'o-clock'), p('Broken', 'o-broken'), p('The season', 'o-season')] },
  { id: 'wheels', name: 'On wheels', blurb: 'Things that roll', slots: [p('Wheels', 'o-wheels'), p('Rideable', 'o-ride'), p('Parked', 'o-parked')] },
  { id: 'light', name: 'Light and shade', blurb: 'Glow, shine and shadow', slots: [p('Makes light', 'o-light', 'i-noise', 'j-light'), p('Reflection', 'o-reflection'), p('Shadow', 'o-shadow')] },
  { id: 'tiers', name: 'Full spectrum', blurb: 'One card of every tier', slots: [t('Common', 'common'), t('Uncommon', 'uncommon'), t('Rare', 'rare'), t('Epic', 'epic'), t('One of One', 'one')] },
];

/** Progress on one set: per slot, the card that fills it (the best one), or null. */
export type SetProgress = { id: string; name: string; blurb: string; done: boolean; have: number; slots: { name: string; card: Card | null }[] };

const better = (a: Card, b: Card) => b.points - a.points || b.rarity - a.rarity || a.at - b.at;

export function setProgress(cards: Card[]): SetProgress[] {
  const sorted = [...cards].sort(better); // best first, so each slot shows its best card
  return SETS.map((s) => {
    const slots = s.slots.map((slot) => ({
      name: slot.name,
      card: sorted.find((c) => (slot.tier ? c.tier === slot.tier : slot.prompts!.includes(c.promptId))) ?? null,
    }));
    const have = slots.filter((x) => x.card).length;
    return { id: s.id, name: s.name, blurb: s.blurb, done: have === slots.length, have, slots };
  });
}

/** Sets that `card` just completed, given the collection before it. */
export function setsCompletedBy(before: Card[], card: Card): { id: string; name: string }[] {
  const was = new Set(setProgress(before).filter((s) => s.done).map((s) => s.id));
  return setProgress([...before, card])
    .filter((s) => s.done && !was.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));
}
