/**
 * Smoke test for bingo squads against a running local server (no AI calls needed):
 *   npx tsx scripts/bingo-smoke.ts [baseUrl]
 * Creates a squad, turns on bingo, starts, checks the 3x3 grid, checks that finds are routed to a square, ends the game.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error('local servers only');
  process.exit(2);
}
const hex = (n: number) => randomBytes(n).toString('hex');
const img = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'img', 'ball.jpg')).toString('base64');
let failures = 0;
const check = (ok: unknown, what: string) => {
  console.log(ok ? 'PASS' : 'FAIL', what);
  if (!ok) failures++;
};

type Client = { ws: WebSocket; room: any; id?: string; secret?: string; code?: string; device: string; errors: string[] };
function connect(): Promise<Client> {
  return new Promise((res) => {
    const c: Client = { ws: new WebSocket(BASE.replace(/^http/, 'ws') + '/rt'), room: null, device: hex(16), errors: [] };
    c.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'welcome') Object.assign(c, { id: m.playerId, secret: m.secret, code: m.code });
      if (m.t === 'state') c.room = m.room;
      if (m.t === 'error') c.errors.push(m.message);
    });
    c.ws.on('open', () => res(c));
  });
}
const send = (c: Client, m: object) => c.ws.send(JSON.stringify(m));
async function waitFor(c: Client, pred: (r: any) => boolean, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (c.room && pred(c.room)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
const find = async (c: Client, promptId: string | undefined) => {
  const r = await fetch(BASE + '/api/find', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device: c.device, promptId, image: img, submissionId: hex(6), mode: 'squad', code: c.code, playerId: c.id, secret: c.secret }),
  });
  return { status: r.status, body: (await r.json()) as any };
};

const a = await connect();
send(a, { t: 'create', name: 'Ana', device: a.device, op: hex(4) });
check(await waitFor(a, (r) => r.phase === 'lobby'), 'squad created');
const b = await connect();
send(b, { t: 'join', code: a.code, name: 'Ben', device: b.device, op: hex(4) });
check(await waitFor(a, (r) => r.players.length === 2), 'second player joined');

send(b, { t: 'settings', bingo: true });
await new Promise((r) => setTimeout(r, 300));
check(b.errors.some((e) => /host/i.test(e)) && a.room.bingo === false, 'only the host can turn bingo on');
send(a, { t: 'settings', bingo: true });
check(await waitFor(b, (r) => r.bingo === true), 'bingo on, seen by everyone');
send(a, { t: 'settings', quick: true });
check(await waitFor(a, (r) => r.quick === true && r.bingo === true), 'quick toggles independently');
check(a.room.huntMs === 180_000, `indoor bingo clock is 3 min (got ${a.room.huntMs})`);
send(a, { t: 'settings', quick: false });
check(await waitFor(a, (r) => r.quick === false && r.huntMs === 300_000), 'outdoor bingo clock is 5 min');

send(a, { t: 'start' });
check(await waitFor(a, (r) => r.phase === 'hunting', 6000), 'countdown, then hunting');
const grid = a.room.grid as { id: string; text: string }[];
check(grid?.length === 9 && new Set(grid.map((p) => p.id)).size === 9, `9 distinct squares: ${grid?.map((p) => p.text).join(' | ')}`);
check(a.room.prompt === null && a.room.totalRounds === 1, 'no single prompt, one round');
check(a.room.endsAt - a.room.now > 290_000, 'about 5 minutes on the clock');

const noSquare = await find(a, undefined);
check(noSquare.status === 409 && /not on the card/.test(noSquare.body.message), `find without a square is refused (${noSquare.status} ${noSquare.body.message})`);
const offCard = await find(a, 'i-red-nope');
check(offCard.status === 409, 'find for a square not on the card is refused');
const onCard = await find(a, grid[4].id);
// no AI key locally: reaching the judge (ai_down / budget) means the square was accepted for judging
check(onCard.status !== 409 && onCard.status !== 400, `find for a real square reaches the judge (${onCard.status} ${onCard.body.error ?? ''})`);

send(a, { t: 'skip' });
check(await waitFor(b, (r) => r.phase === 'reveal'), 'host ends the game: reveal');
check(b.room.rounds.length === 9 && b.room.bingoBoard?.lines[b.id!] === 0, 'reveal lists 9 squares, nobody has a line');
check(await waitFor(b, (r) => r.phase === 'ended', 12_000), 'results after the reveal');
send(a, { t: 'again' });
check(await waitFor(a, (r) => r.phase === 'lobby' && r.bingo === true && r.grid === null), 'play again: back to lobby, still bingo');

a.ws.close();
b.ws.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
