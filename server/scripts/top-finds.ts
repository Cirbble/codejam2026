// For every prompt: ask the model for realistic top-tier finds, then score each with the real judge rubric
// (described in text instead of a photo). Spends real AI calls. Usage (from server/): npx tsx scripts/top-finds.ts <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instructions, SCHEMA } from '../src/judge.js';
import { INDOOR, OUTDOOR } from '../src/prompts.js';
import type { PromptDef } from '../src/types.js';

const KEY = readFileSync(join(process.cwd(), '..', '..', '.secrets', 'GEMINI_API_KEY'), 'utf8').trim();
const MODEL = (process.env.GEMINI_MODELS || 'gemini-3.8-flash').split(',')[0];
const out = process.argv[2];

async function ask(text: string, schema: object) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.4, thinkingConfig: { thinkingLevel: 'low' } } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j: any = await res.json();
      return JSON.parse(j.candidates[0].content.parts.map((p: any) => (p.thought ? '' : p.text ?? '')).join(''));
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
  return null;
}

const IDEAS = { type: 'ARRAY', items: { type: 'OBJECT', properties: { find: { type: 'STRING' }, photo: { type: 'STRING' } }, required: ['find', 'photo'] } };

async function one(p: PromptDef, indoor: boolean) {
  const where = indoor ? 'indoors at a university hackathon venue in Montreal (classrooms, hallways, a cafeteria, backpacks, desks)' : 'outdoors around a city university campus in Montreal in late November';
  const ideas = (await ask(
    `A photo scavenger game prompt: "${p.text}". Typical answers: ${p.examples}.\nSuggest ${process.env.IDEAS || 4} finds that would be the rarest, most surprising answers for this prompt, but that a student could genuinely find and photograph ${where} today. No props bought for the purpose, nothing staged. For each give "find" (2 to 5 words) and "photo" (one sentence describing the photo).`,
    IDEAS,
  )) as { find: string; photo: string }[] | null;
  const scored = [];
  for (const i of ideas ?? []) {
    const j = await ask(`${instructions(p, [])}\n\nThis is a calibration run: no image is attached. Judge as if the attached photo were a clear, real camera photo showing: ${i.photo}`, SCHEMA);
    if (j) scored.push({ find: i.find, photo: i.photo, ai: Number(j.aiRarity), match: !!j.match && !j.screen, verdict: j.verdict });
  }
  scored.sort((a, b) => b.ai - a.ai);
  return { id: p.id, text: p.text, indoor, best: scored.filter((s) => s.match)[0] ?? null, all: scored };
}

(async () => {
  const only = process.env.ONLY?.split(',');
  const all = [...INDOOR.map((p) => [p, true] as const), ...OUTDOOR.map((p) => [p, false] as const)].filter(([p]) => !only || only.includes(p.id));
  const res: any[] = [];
  for (let i = 0; i < all.length; i += 8) {
    res.push(...(await Promise.all(all.slice(i, i + 8).map(([p, indoor]) => one(p, indoor)))));
    console.log(`${res.length}/${all.length}`);
  }
  writeFileSync(out, JSON.stringify(res, null, 1));
  const top = res.map((r) => r.best?.ai ?? 0);
  console.log('prompts', res.length, '| best >= 97:', top.filter((x) => x >= 97).length, '| best 80-96:', top.filter((x) => x >= 80 && x < 97).length, '| below 80:', top.filter((x) => x < 80).length);
})();
