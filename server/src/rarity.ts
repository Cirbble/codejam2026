import type { Tier } from './types.js';

export const TIER_POINTS: Record<Tier, number> = { common: 10, uncommon: 30, rare: 60, epic: 85, one: 100 };
/** The crowd never outweighs the AI: a handful of identical answers can't swing a card from common to One of One. */
export const MAX_CROWD_WEIGHT = 0.5;
/** One of One needs the AI to agree the find is at least fairly unusual. */
export const ONE_MIN_AI = 60;

/**
 * sameCount and totalCount include the find being scored. firstEver: this find is the first counted find of its
 * label for the prompt (decided before the counts are incremented; deduplicated finds never qualify).
 * crowd = 100 * (1 - same/total); w = min(0.5, (total-1)/25); rarity = round(w*crowd + (1-w)*ai).
 */
export function scoreFind(aiRarity: number, sameCount: number, totalCount: number, firstEver: boolean): { rarity: number; tier: Tier; points: number } {
  const ai = clamp(Math.round(Number(aiRarity) || 0), 0, 100);
  const total = Math.max(1, totalCount);
  const same = clamp(sameCount, 1, total);
  const crowd = 100 * (1 - same / total);
  const w = Math.min(MAX_CROWD_WEIGHT, (total - 1) / 25);
  const rarity = clamp(Math.round(w * crowd + (1 - w) * ai), 0, 100);
  const firstOfKind = firstEver && ai >= 80;
  const tier = tierFor(rarity, firstOfKind, ai);
  return { rarity, tier, points: TIER_POINTS[tier] };
}

export function tierFor(rarity: number, firstOfKind = false, aiRarity = 100): Tier {
  if ((rarity >= 97 || firstOfKind) && aiRarity >= ONE_MIN_AI) return 'one';
  if (rarity >= 85) return 'epic';
  if (rarity >= 65) return 'rare';
  if (rarity >= 40) return 'uncommon';
  return 'common';
}

const ARTICLES = new Set(['a', 'an', 'the']);

/** trim, lowercase, strip articles and punctuation, collapse spaces, max 4 words. */
export function normalizeLabel(raw: string): string {
  const words = String(raw ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w));
  return words.slice(0, 4).join(' ').slice(0, 48);
}

/** Reuse an existing label when the new one only differs by a plural 's'/'es'. */
export function canonicalLabel(label: string, existing: Record<string, number> | undefined): string {
  if (!existing || existing[label]) return label;
  for (const cand of [label.replace(/es$/, ''), label.replace(/s$/, ''), label + 's', label + 'es'])
    if (cand !== label && cand && existing[cand]) return cand;
  return label;
}

export function titleFor(label: string): string {
  return label ? label[0].toUpperCase() + label.slice(1) : label;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
