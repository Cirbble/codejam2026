/**
 * End-to-end check against a running server: two players join over WebSocket and play the demo preset.
 * A stands still (and takes hits). B walks out of every cell it is warned about, at 5 m/s, along the
 * direction the warning gives. B must survive the storm, so the game ends won.
 *   npx tsx scripts/e2e.ts https://krillion-production-ce39cedf.up.railway.app
 */
import WebSocket from 'ws';

const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const WS = BASE.replace(/^http/, 'ws') + '/rt';
const ORIGIN = { lat: 45.5048, lng: -73.5772 };
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

type Client = { ws: WebSocket; id?: string; secret?: string; code?: string; token?: string; room?: any; events: any[]; x: number; y: number; tx: number; ty: number };

function connect(name: string, code?: string, x = 0): Promise<Client> {
  return new Promise((resolve, reject) => {
    const c: Client = { ws: new WebSocket(WS), events: [], x, y: 0, tx: x, ty: 0 };
    c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'hello', name, code, create: !code })));
    c.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'welcome') {
        Object.assign(c, { id: m.playerId, secret: m.secret, code: m.code, token: m.watchToken });
        resolve(c);
      } else if (m.t === 'state') c.room = m.room;
      else if (m.t === 'ev') {
        c.events.push(m.ev);
        if (m.ev.kind === 'warn' && c === b) {
          // walk out the way the warning says, a little past the edge
          const deg = DIRS.indexOf(m.ev.moveDir) * 45;
          const go = m.ev.moveM + 4;
          c.tx = c.x + Math.sin((deg * Math.PI) / 180) * go;
          c.ty = c.y + Math.cos((deg * Math.PI) / 180) * go;
        }
      } else if (m.t === 'error') reject(new Error(m.message));
    });
    c.ws.on('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  log(ok ? 'PASS' : 'FAIL', what);
  if (!ok) failures++;
};

const R = 6371000;
const send = (c: Client) => {
  // step toward the target at up to 5 m per second
  const dx = c.tx - c.x;
  const dy = c.ty - c.y;
  const n = Math.hypot(dx, dy);
  if (n > 0.1) {
    const k = Math.min(1, 5 / n);
    c.x += dx * k;
    c.y += dy * k;
  }
  const lat = ORIGIN.lat + ((c.y / R) * 180) / Math.PI;
  const lng = ORIGIN.lng + ((c.x / (R * Math.cos((ORIGIN.lat * Math.PI) / 180))) * 180) / Math.PI;
  c.ws.send(JSON.stringify({ t: 'pos', lat, lng, acc: 5, sim: true, age: 0 }));
};

let b: Client;
const a = await connect('E2E-A');
b = await connect('E2E-B', a.code, 8);
log('room', a.code);
const posTimer = setInterval(() => {
  send(a);
  send(b);
}, 1000);
await sleep(1500);
a.ws.send(JSON.stringify({ t: 'settings', settings: { quick: true, radiusM: 60 } }));
await sleep(600);
check(a.room?.settings.quick === true, 'demo preset applied');
check(a.room?.players.length === 2, 'two players in lobby');
check(!('prompt' in (a.room ?? {})) && !('boss' in (a.room ?? {})), 'no photo-game fields in the room');
a.ws.send(JSON.stringify({ t: 'start' }));
await sleep(6500);
check(a.room?.phase === 'playing', 'storm started');
check(a.events.some((e) => e.kind === 'start'), 'start event delivered');

await sleep(15_000);
const all = () => [...a.events, ...b.events];
check(all().some((e) => e.kind === 'warn'), 'players were warned with a direction');
const w = all().find((e) => e.kind === 'warn');
if (w) log('warn example:', JSON.stringify(w));

log('waiting for the storm to pass…');
for (let i = 0; i < 120 && a.room?.phase !== 'ended'; i++) await sleep(1000);
const meB = a.room?.results?.ranking.find((r: any) => r.id === b.id);
log('A hits', a.room?.players?.find((p: any) => p.id === a.id)?.hits, '· B dodges', b.events.filter((e) => e.kind === 'dodge').length, '· levels', all().filter((e) => e.kind === 'level').map((e) => e.level).join(','));
check(all().some((e) => e.kind === 'level'), 'storm level rose during the game');
check(b.events.some((e) => e.kind === 'dodge'), 'B dodged by walking out');
check(a.room?.phase === 'ended' && !!a.room?.results, `game ended with results (outcome: ${a.room?.outcome})`);
check(a.room?.outcome === 'won' && meB?.survived === true, 'B survived, so the crew won');
check(a.events.some((e) => e.kind === 'end'), 'end event delivered');

const watch = await fetch(`${BASE}/api/rooms/${a.code}?token=${a.token}`);
check(watch.ok, 'spectator API works with token');
const noWatch = await fetch(`${BASE}/api/rooms/${a.code}`);
check(noWatch.status === 404, 'spectator API refuses without token');
const judge = await fetch(`${BASE}/api/judge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check(judge.status === 404, 'no photo judge endpoint');

clearInterval(posTimer);
a.ws.send(JSON.stringify({ t: 'leave' }));
b.ws.send(JSON.stringify({ t: 'leave' }));
await sleep(300);
a.ws.close();
b.ws.close();
log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
