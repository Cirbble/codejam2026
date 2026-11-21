/**
 * Smoke test for impostor squads against a running local server (no AI calls needed):
 *   npx tsx scripts/impostor-smoke.ts [baseUrl]
 * Three players: checks that exactly one phone gets the twin prompt and that nobody else's messages carry it,
 * then runs a vote and checks the result and the bonuses.
 */
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error('local servers only');
  process.exit(2);
}
const hex = (n: number) => randomBytes(n).toString('hex');
let failures = 0;
const check = (ok: unknown, what: string) => {
  console.log(ok ? 'PASS' : 'FAIL', what);
  if (!ok) failures++;
};

type Client = { name: string; ws: WebSocket; room: any; raw: string[]; id?: string; code?: string; device: string; errors: string[] };
function connect(name: string): Promise<Client> {
  return new Promise((res) => {
    const c: Client = { name, ws: new WebSocket(BASE.replace(/^http/, 'ws') + '/rt'), room: null, raw: [], device: hex(16), errors: [] };
    c.ws.on('message', (d) => {
      const s = String(d);
      c.raw.push(s);
      const m = JSON.parse(s);
      if (m.t === 'welcome') Object.assign(c, { id: m.playerId, code: m.code });
      if (m.t === 'state') c.room = m.room;
      if (m.t === 'error') c.errors.push(m.message);
    });
    c.ws.on('open', () => res(c));
  });
}
const send = (c: Client, m: object) => c.ws.send(JSON.stringify(m));
async function waitFor(c: Client, pred: (r: any) => boolean, ms = 6000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (c.room && pred(c.room)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

const a = await connect('Ana');
send(a, { t: 'create', name: 'Ana', device: a.device, op: hex(4) });
await waitFor(a, (r) => r.phase === 'lobby');
const b = await connect('Ben');
send(b, { t: 'join', code: a.code, name: 'Ben', device: b.device, op: hex(4) });
await waitFor(a, (r) => r.players.length === 2);

send(a, { t: 'settings', impostor: true });
check(await waitFor(b, (r) => r.impostor !== null), 'impostor mode on, seen by everyone');
send(a, { t: 'start' });
await new Promise((r) => setTimeout(r, 400));
check(a.errors.some((e) => /at least 3/.test(e)) && a.room.phase === 'lobby', 'two players cannot start');

const c = await connect('Cai');
send(c, { t: 'join', code: a.code, name: 'Cai', device: c.device, op: hex(4) });
await waitFor(a, (r) => r.players.length === 3);
send(a, { t: 'settings', unique: true });
check(await waitFor(a, (r) => r.unique === true && r.impostor === null), 'unique turns impostor off');
send(a, { t: 'settings', impostor: true });
check(await waitFor(a, (r) => r.impostor !== null && r.unique === false), 'and impostor turns unique off');

const all = [a, b, c];
for (const x of all) x.raw.length = 0;
send(a, { t: 'start' });
check(await waitFor(a, (r) => r.phase === 'hunting', 8000) && (await waitFor(b, (r) => r.phase === 'hunting')) && (await waitFor(c, (r) => r.phase === 'hunting')), 'everyone hunting');
const imps = all.filter((x) => x.room.impostor.you);
check(imps.length === 1, `exactly one impostor (${imps.map((x) => x.name).join(', ')})`);
const imp = imps[0];
const crew = all.filter((x) => x !== imp);
const real = crew[0].room.prompt;
check(crew.every((x) => x.room.prompt.id === real.id), `crew share the prompt "${real.text}"`);
check(imp.room.prompt.id !== real.id && imp.room.impostor.crewPrompt.id === real.id, `impostor sees "${imp.room.prompt.text}" and the crew's prompt`);
check(crew.every((x) => x.raw.every((s) => !s.includes(imp.room.prompt.text))), "the twin never reaches the crew's phones");

send(a, { t: 'skip' });
check(await waitFor(a, (r) => r.phase === 'reveal' && r.impostor.voteOpen), 'vote open after the hunt');
send(crew[0], { t: 'vote', target: imp.id });
send(crew[1], { t: 'vote', target: imp.id });
check(await waitFor(a, (r) => r.impostor.voted.length === 2), 'votes counted, voters shown');
send(imp, { t: 'vote', target: crew[0].id });
check(await waitFor(a, (r) => r.phase === 'reveal' && !r.impostor.voteOpen), 'vote closes once everyone voted');
const res = a.room.impostor.rounds[0];
check(res?.impostorId === imp.id && res.caught === true, 'result: impostor named and caught');
const score = (x: Client) => a.room.players.find((p: any) => p.id === x.id).score;
check(score(crew[0]) === 50 && score(crew[1]) === 50 && score(imp) === 0, `bonuses: ${all.map((x) => `${x.name} ${score(x)}`).join(', ')}`);
check(await waitFor(a, (r) => r.phase === 'hunting' && r.round === 2, 15_000), 'next round after the result');
check(all.filter((x) => x.room.impostor.you).length === 1, 'round 2 has one impostor');

for (const x of all) x.ws.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
