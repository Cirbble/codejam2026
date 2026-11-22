// Judges each dev photo against prompts it plausibly fits and prints the tier spread. Spends real AI calls.
// Usage (from server/): npx tsx scripts/judge-spread.ts <photoDir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgePhoto } from '../src/judge.js';
import { promptById } from '../src/prompts.js';
import { scoreSolo } from '../src/rarity.js';

const dir = process.argv[2];
const CASES: [string, string][] = [
  ['red_bicycle', 'o-red'], ['red_bicycle', 'o-wheels'], ['cardinal', 'o-red'], ['cardinal', 'o-bird'], ['payphone', 'o-older'],
  ['payphone', 'o-red'], ['maple_leaf', 'o-red'], ['pennant', 'o-triangle'], ['fire_hydrant', 'o-red'], ['red_fire_hydrant', 'i-red'],
  ['bicycle_shadow', 'o-shadow'], ['ball', 'i-round'], ['shoe', 'i-soft'], ['pen', 'o-plastic'], ['park_bench', 'o-wood'], ['laptop_screen', 'o-light'],
];

(async () => {
  const tally: Record<string, number> = {};
  for (const [photo, pid] of CASES) {
    const p = promptById(pid);
    if (!p) { console.log('no prompt', pid); continue; }
    const b64 = readFileSync(join(dir, photo + '.jpg')).toString('base64');
    const res: any = await judgePhoto(p, [], b64, 'daily', 'spread-test'); const r: any = res.ok ? res.j : { label: res.error };
    const s = r.match ? scoreSolo(r.aiRarity) : null;
    if (s) tally[s.tier] = (tally[s.tier] || 0) + 1;
    console.log(`${photo.padEnd(18)} ${p.text.padEnd(34)} ${r.screen ? 'SCREEN' : r.match ? 'match ' : 'miss  '} ai=${String(r.aiRarity).padStart(3)} ${s ? s.tier : '-'}  ${r.label} | ${r.verdict}`);
  }
  console.log('tiers', tally);
})();
