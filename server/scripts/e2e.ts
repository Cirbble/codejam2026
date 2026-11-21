/**
 * End-to-end check against a running server with real photos (uses a handful of AI calls; repeats hit the judge cache).
 *   npx tsx scripts/e2e.ts <baseUrl> [imgDir]
 * imgDir (default scripts/img) holds 768 px JPEGs like the app sends: red_fire_hydrant, laptop_screen, ball, pen, shoe, park_bench.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const IMG = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), 'img');
const WS_URL = BASE.replace(/^http/, 'ws') + '/rt';
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (n: number) => randomBytes(n).toString('hex');
const photo = (f: string) => readFileSync(join(IMG, f)).toString('base64');
let failures = 0;
const check = (ok: unknown, what: string) => {
  log(ok ? 'PASS' : 'FAIL', what);
  if (!ok) failures++;
};

async function api(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: res.status, json: await res.json().catch(() => null) };
}

type Client = { ws: WebSocket; device: string; id?: string; secret?: string; code?: string; room?: any; errors: any[]; states: number[] };
function connect(first: object, device = hex(16)): Promise<Client> {
  return new Promise((resolve, reject) => {
    const c: Client = { ws: new WebSocket(WS_URL), device, errors: [], states: [] };
    c.ws.on('open', () => c.ws.send(JSON.stringify({ ...first, device })));
    c.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'welcome') {
        Object.assign(c, { id: m.playerId, secret: m.secret, code: m.code });
        resolve(c);
      } else if (m.t === 'state') {
        c.room = m.room;
        c.states.push(Date.now());
      }
      else if (m.t === 'error') {
        c.errors.push(m);
        reject(new Error(`${m.code}: ${m.message}`));
      }
    });
    c.ws.on('error', reject);
  });
}
const sendWs = (c: Client, m: object) => c.ws.send(JSON.stringify(m));
async function waitFor(c: Client, pred: (room: any) => boolean, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (c.room && pred(c.room)) return true;
    await sleep(100);
  }
  return false;
}
/** Send one message on a fresh socket and return the first reply. */
function once(msg: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => ws.send(JSON.stringify(msg)));
    ws.on('message', (d) => {
      resolve(JSON.parse(String(d)));
      ws.close();
    });
    ws.on('error', reject);
  });
}
const squadFind = (c: Client, image: string, submissionId = hex(8)) =>
  api('/api/find', { device: c.device, promptId: c.room.prompt.id, image, submissionId, mode: 'squad', code: c.code, playerId: c.id, secret: c.secret });

// ---------------- basics ----------------
check((await api('/health')).json?.ok === true, 'health');
check((await fetch(BASE + '/api/stats')).status === 404 && (await fetch(BASE + '/api/stats?token=nope')).status === 404, 'stats hidden without the token');
for (const f of ['red_fire_hydrant.jpg', 'laptop_screen.jpg']) if (!existsSync(join(IMG, f))) throw new Error(`missing ${f} in ${IMG}`);
const hydrant = photo('red_fire_hydrant.jpg');
const laptop = photo('laptop_screen.jpg');
const bad = await api('/api/find', { device: hex(16), promptId: 'o-red', image: 'notajpeg'.repeat(100), submissionId: hex(8), mode: 'daily' });
check(bad.status === 400 && bad.json?.error === 'bad_request', 'non-JPEG refused before any AI spend');

// ---------------- squad ----------------
const a = await connect({ t: 'create', name: 'Ava', quick: false });
const b = await connect({ t: 'join', code: a.code, name: 'Ben' });
log('room', a.code);
check(await waitFor(a, (r) => r.players.length === 2), 'two players in lobby');
{
  const op = hex(8);
  const dev = hex(16);
  const r1 = await connect({ t: 'join', code: a.code, name: 'Retry', op }, dev);
  const r2 = await connect({ t: 'join', code: a.code, name: 'Retry', op }, dev);
  await sleep(300);
  check(r1.id === r2.id && r1.secret === r2.secret && a.room.players.length === 3, 'retried join with the same op -> same player, no ghost');
  sendWs(r2, { t: 'leave' });
  check(await waitFor(a, (r) => r.players.length === 2), 'retry player left');
  r1.ws.close();
  r2.ws.close();
}
sendWs(a, { t: 'settings', quick: true });
check(await waitFor(a, (r) => r.quick === true), 'host switched to quick');
const wrongJoin = await connect({ t: 'join', code: 'ZZZZ', name: 'X' }).catch((e) => e as Error);
check(wrongJoin instanceof Error && /no_room/.test(wrongJoin.message), 'join with an unknown code -> no_room');

sendWs(a, { t: 'start' });
check(await waitFor(a, (r) => r.phase === 'countdown'), 'countdown');
check(await waitFor(a, (r) => r.phase === 'hunting', 6000), `hunting: "${a.room?.prompt?.text}"`);
check(a.room.prompt?.id === 'i-red' && !!a.room.prompt.examples, 'quick game opens with "something red" (with examples)');
const late = await connect({ t: 'join', code: a.code, name: 'Late' }).catch((e) => e as Error);
check(late instanceof Error && /in_progress/.test(late.message), 'joining mid-game -> in_progress');

const forged = await api('/api/find', { device: b.device, promptId: 'i-red', image: hydrant, submissionId: hex(8), mode: 'squad', code: a.code, playerId: b.id, secret: 'nope' });
check(forged.status === 403, 'wrong secret refused (403)');

let t0 = Date.now();
const scr = await squadFind(b, laptop);
log('screen verdict', scr.status, `${Date.now() - t0} ms`, JSON.stringify(scr.json));
check(scr.json?.accepted === false && scr.json?.reason === 'screen' && scr.json?.triesLeft === 5, 'laptop screen rejected as a screen, 5 tries left');

const subA = hex(8);
t0 = Date.now();
const fa = await squadFind(a, hydrant, subA);
log('hydrant verdict', fa.status, `${Date.now() - t0} ms`, JSON.stringify(fa.json));
const cardA = fa.json?.card;
check(fa.json?.accepted === true && cardA?.label && cardA?.photo?.startsWith('/p/') && cardA.playerName === 'Ava' && cardA.playerId === a.id && cardA.mode === 'squad', `hydrant accepted: "${cardA?.label}" ${cardA?.tier} ${cardA?.points} pts`);
const again = await squadFind(a, hydrant, subA);
check(JSON.stringify(again.json) === JSON.stringify(fa.json), 'same submissionId returns the same reply');
check(a.room.phase === 'hunting' && a.room.players.find((p: any) => p.id === a.id)?.found === true && a.room.reveal === null, 'others only see "found" while hunting');
check(a.room.players.every((p: any) => p.score === 0), 'scores stay hidden until the reveal');
const img = await fetch(BASE + cardA.photo);
check(img.status === 200 && img.headers.get('content-type') === 'image/jpeg', 'card photo served');
{
  const full = Buffer.from(await img.arrayBuffer()).length;
  const th = await fetch(`${BASE}${cardA.photo}?w=240`);
  const tb = Buffer.from(await th.arrayBuffer());
  check(th.status === 200 && th.headers.get('content-type') === 'image/jpeg' && tb[0] === 0xff && tb.length < full, `240 px thumbnail served (${tb.length} vs ${full} bytes)`);
  const q = await fetch(`${BASE}/q`, { redirect: 'manual' });
  check(q.status === 302 && q.headers.get('location') === '/play/?solo=1', 'GET /q -> 302 /play/?solo=1');
}

await sleep(4200); // per-device judge gap
const fb = await squadFind(b, hydrant);
check(fb.json?.accepted === true && fb.json.card.label === cardA.label, 'second player finds the same thing');
check(await waitFor(a, (r) => r.phase === 'reveal', 3000), 'everyone found -> early reveal');
const rev = a.room.reveal ?? [];
check(rev.length === 2 && rev[0].rarity >= rev[1].rarity, 'reveal has both cards, rarest first');
check(rev.every((c: any) => Array.isArray(c.sameAs) && c.sameAs.length === 1), `"same as" tags: ${rev.map((c: any) => `${c.playerName}~${c.sameAs}`).join(', ')}`);
check(a.room.revealMs === 12000 && a.room.endsAt - a.room.now > 10000 && a.room.endsAt - a.room.now <= 12000, `reveal is 6 s + 3 s per card (revealMs ${a.room.revealMs})`);
const top = await api('/api/prompt/i-red/top');
check(top.json?.total >= 1 && top.json.top.some((x: any) => x.label === cardA.label), `prompt top: ${JSON.stringify(top.json?.top?.slice(0, 3))}`);

// resume from a fresh socket with the saved credentials
const a2 = await connect({ t: 'resume', code: a.code, playerId: a.id, secret: a.secret }, a.device);
check(a2.id === a.id && a2.code === a.code, 'resume on a new socket');
a2.ws.close();

for (let r = 2; r <= 5; r++) {
  sendWs(a, { t: 'skip' }); // reveal -> next round
  check(await waitFor(a, (x) => x.phase === 'hunting' && x.round === r, 3000), `round ${r} hunting`);
  sendWs(a, { t: 'skip' });
  await waitFor(a, (x) => x.phase === 'reveal' && x.round === r, 3000);
}
sendWs(a, { t: 'skip' });
check(await waitFor(a, (x) => x.phase === 'ended'), 'ended after round 5');
check(a.room.rounds.length === 5 && a.room.rounds[0].cards.length === 2, 'results: 5 rounds kept');
const scoreA = a.room.players.find((p: any) => p.id === a.id)?.score;
check(scoreA === cardA.points, `totals: Ava ${scoreA}`);
check(a.room.best?.[a.id] === cardA.id && Array.isArray(a.room.roundWinners) && a.room.roundWinners.length === 5 && a.room.roundWinners.slice(1).every((w: any) => w === null), `results: best + roundWinners ${JSON.stringify(a.room.roundWinners)}`);
sendWs(b, { t: 'again' });
await sleep(500);
check(a.room.phase === 'ended', 'non-host cannot restart');
sendWs(a, { t: 'again' });
check(await waitFor(a, (x) => x.phase === 'lobby' && x.players.length === 2), 'again -> lobby with the same players');
{
  // second game opens with "something red" again: the same photo from the same device is refused
  sendWs(a, { t: 'start' });
  check(await waitFor(a, (r) => r.phase === 'hunting' && r.prompt?.id === 'i-red', 8000), 'second game hunting');
  await sleep(1500);
  const replay = await squadFind(a, hydrant);
  check(replay.json?.accepted === false && replay.json.reason === 'unclear' && /already used this photo/i.test(replay.json.verdict), `replayed photo refused: ${JSON.stringify(replay.json)}`);
  const orig = await squadFind(a, hydrant, subA);
  check(JSON.stringify(orig.json) === JSON.stringify(fa.json), 'the original submissionId still returns the original result');
  while (a.room.phase !== 'ended') {
    sendWs(a, { t: 'skip' });
    await sleep(150);
  }
  sendWs(a, { t: 'again' });
  check(await waitFor(a, (x) => x.phase === 'lobby'), 'back to the lobby');
}
{
  const before = a.states.length;
  await sleep(4600);
  check(a.states.length > before, `idle lobby still gets a state heartbeat (${a.states.length - before} in 4.6 s)`);
}
const coll = await api(`/api/collection?device=${a.device}`);
check(coll.json?.cards?.[0]?.id === cardA.id, 'squad card is in the collection');
b.ws.close();
const left = await once({ t: 'leave', code: a.code, playerId: b.id, secret: b.secret });
check(left?.t === 'left', 'leave with credentials on a fresh socket -> left');
check(await waitFor(a, (x) => x.players.length === 1), 'leave removes the player');
const left2 = await once({ t: 'leave', code: a.code, playerId: b.id, secret: b.secret });
check(left2?.t === 'left', 'repeating the leave is idempotent');
a.ws.close();
b.ws.close();

// ---------------- solo (People's Choice) ----------------
{
  const teamName = `E2E  Test ${hex(2)}`;
  const s = await connect({ t: 'create', name: 'Solo', quick: true, solo: true, team: teamName, op: hex(8) });
  await waitFor(s, (r) => !!r, 2000);
  check(s.room?.solo === true && s.room.team === teamName.replace(/\s+/g, ' ') && s.room.totalRounds === 3, `solo room ${s.code} for "${s.room?.team}"`);
  check(await waitFor(s, (r) => r.phase === 'countdown' || r.phase === 'hunting', 2000), 'solo starts on its own');
  const again2 = await connect({ t: 'create', name: 'Solo', quick: true, solo: true, team: teamName, op: hex(8) }, s.device).catch((e) => e as Error);
  check(again2 instanceof Error && /rate/.test(again2.message), 'one solo run per phone every 30 s');
  const crash = await connect({ t: 'join', code: s.code, name: 'Crasher' }).catch((e) => e as Error);
  check(crash instanceof Error && /full/.test(crash.message), 'joining a solo room -> full');
  check(await waitFor(s, (r) => r.phase === 'hunting' && r.prompt?.id === 'i-red', 6000), 'solo round 1 is "something red"');
  check(s.room.endsAt - s.room.now > 50_000 && s.room.endsAt - s.room.now <= 60_000, 'solo rounds are 60 s');
  const sf = await squadFind(s, hydrant);
  check(sf.json?.accepted === true, `solo find accepted: ${sf.json?.card?.label} ${sf.json?.card?.points} pts`);
  check(await waitFor(s, (r) => r.phase === 'reveal', 3000) && s.room.revealMs === 4000, 'solo: early end, 4 s reveal');
  check(await waitFor(s, (r) => r.phase === 'hunting' && r.round === 2, 6000), 'solo round 2 after the 4 s reveal');
  const seen = new Set([s.room.prompt.id, 'i-red']);
  sendWs(s, { t: 'skip' });
  await waitFor(s, (r) => r.phase === 'reveal');
  sendWs(s, { t: 'skip' });
  check(await waitFor(s, (r) => r.phase === 'hunting' && r.round === 3, 3000) && !seen.has(s.room.prompt.id), 'round 3 prompt is new');
  sendWs(s, { t: 'skip' });
  await waitFor(s, (r) => r.phase === 'reveal');
  sendWs(s, { t: 'skip' });
  check(await waitFor(s, (r) => r.phase === 'ended'), 'solo run ended after 3 rounds');
  const pts = sf.json?.card?.points;
  check(typeof s.room.boardRank === 'number' && s.room.boardRank >= 1 && s.room.boardBest === pts, `ended view: boardRank ${s.room.boardRank}, boardBest ${s.room.boardBest}`);
  const bd = await api('/api/board');
  const row = bd.json?.teams?.find((t: any) => t.team === s.room.team);
  check(row && row.best === pts && row.plays === 1 && row.bestCard?.id === sf.json.card.id && bd.json.updatedAt > 0, 'GET /api/board lists the team with its best card');
  const reset = await fetch(`${BASE}/api/board/reset?token=nope`, { method: 'POST' });
  check(reset.status === 404, 'board reset needs the token');
  s.ws.close();
}

// ---------------- daily ----------------
const dev = hex(16);
const d0 = await api(`/api/daily?device=${dev}`);
log('daily', d0.json?.day, d0.json?.prompts?.map((p: any) => p.id).join(', '));
check(d0.json?.prompts?.length === 5 && d0.json.score === 0 && d0.json.resetsAt > Date.now(), 'daily: 5 prompts, score 0, resetsAt in the future');
const prompts: any[] = d0.json.prompts;
const fits: Record<string, string> = {
  'o-red': 'red_fire_hydrant.jpg', 'o-metal': 'red_fire_hydrant.jpg', 'o-round': 'ball.jpg', 'o-sit': 'park_bench.jpg', 'o-wood': 'park_bench.jpg',
  'o-plastic': 'pen.jpg', 'o-soft': 'shoe.jpg', 'o-lost': 'shoe.jpg', 'o-many-colors': 'ball.jpg',
};
const target = prompts.find((p) => fits[p.id] && existsSync(join(IMG, fits[p.id])));
const tp = target ?? prompts[0];
const other = prompts.find((p) => p !== tp)!;
const ds = await api('/api/find', { device: dev, promptId: other.id, image: laptop, submissionId: hex(8), mode: 'daily' });
log('daily screen', JSON.stringify(ds.json));
check(ds.json?.accepted === false && ds.json.reason === 'screen' && ds.json.triesLeft === 5, `daily: laptop screen rejected for "${other.text}"`);
await sleep(4200);
const file = target ? fits[target.id] : 'red_fire_hydrant.jpg';
const sub = hex(8);
const df = await api('/api/find', { device: dev, promptId: tp.id, image: photo(file), submissionId: sub, mode: 'daily' });
log('daily find', tp.id, file, JSON.stringify(df.json));
if (target) check(df.json?.accepted === true && df.json.card.day === d0.json.day && df.json.card.mode === 'daily', `daily: ${file} accepted for "${tp.text}"`);
else check(df.status === 200 && typeof df.json?.accepted === 'boolean', `daily: judged (no photo fits today's set; accepted=${df.json?.accepted})`);
const dup = await api('/api/find', { device: dev, promptId: tp.id, image: photo(file), submissionId: sub, mode: 'daily' });
check(JSON.stringify(dup.json) === JSON.stringify(df.json), 'daily: same submissionId -> same reply');
const d1 = await api(`/api/daily?device=${dev}`);
check(d1.json?.tries?.[other.id] === 1, 'daily: tries recorded');
if (df.json?.accepted) {
  check(d1.json.cards[tp.id]?.id === df.json.card.id && d1.json.score === df.json.card.points, 'daily: card locked in and scored');
  await sleep(4200);
  const relock = await api('/api/find', { device: dev, promptId: tp.id, image: hydrant, submissionId: hex(8), mode: 'daily' });
  check(relock.status === 409 && relock.json?.error === 'locked', 'daily: prompt locked after a find');
}
const rate1 = await api('/api/find', { device: dev, promptId: other.id, image: laptop, submissionId: hex(8), mode: 'daily' });
const rate2 = await api('/api/find', { device: dev, promptId: other.id, image: laptop, submissionId: hex(8), mode: 'daily' });
check(rate2.status === 429 && rate2.json?.error === 'rate' && rate2.json.retryAfterMs > 0, `rate limit: second photo within 4 s refused (${rate1.status}/${rate2.status})`);

log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
