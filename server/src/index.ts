import express from 'express';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './game.js';
import type { ClientMsg, GameEvent, ServerMsg } from './types.js';

const PORT = Number(process.env.PORT || 8787);
const PUBLIC = join(process.cwd(), 'public');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

type Conn = { ws: WebSocket; ip: string; code?: string; playerId?: string; watcher?: boolean };
const createHits = new Map<string, number[]>();
const helloHits = new Map<string, number[]>();
const rooms = new Map<string, Room>();
const conns = new Set<Conn>();
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const ROOMS_FILE = join(DATA_DIR, 'rooms.json');
mkdirSync(DATA_DIR, { recursive: true });

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function emitTo(code: string) {
  return (playerId: string, ev: GameEvent) => {
    for (const c of conns) if (c.code === code && c.playerId === playerId) send(c.ws, { t: 'ev', ev });
  };
}

function newCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function getRoom(code: string | undefined): Room | undefined {
  return code ? rooms.get(code.toUpperCase().trim()) : undefined;
}

// ---------------- HTTP ----------------
const app = express();
app.set('trust proxy', true); // Railway sits behind a proxy: rate limits must see the real client IP
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/rooms/:code', (req, res) => {
  const r = getRoom(req.params.code);
  if (!r || req.query.token !== r.watchToken) return res.status(404).json({ error: 'No such room' });
  res.json(r.spectatorView());
});

app.get('/watch/:code', (_req, res) => res.sendFile(join(PUBLIC, 'watch.html')));
app.use(express.static(PUBLIC, { extensions: ['html'] }));

// ---------------- WS ----------------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/rt', maxPayload: 64 * 1024 });

function broadcast(room: Room) {
  const msg = JSON.stringify({ t: 'state', room: room.view() } satisfies ServerMsg);
  let spec: string | null = null;
  for (const c of conns) {
    if (c.code !== room.code || c.ws.readyState !== WebSocket.OPEN) continue;
    if (c.watcher) c.ws.send((spec ??= JSON.stringify({ t: 'state', room: room.spectatorView() } satisfies ServerMsg)));
    else c.ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const conn: Conn = { ws, ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'anon').split(',')[0].trim() };
  const fromIp = [...conns].filter((c) => c.ip === conn.ip && !c.code).length; // venue Wi-Fi shares one IP: only cap sockets that haven't joined
  if (conns.size >= 3000 || fromIp >= 60) {
    ws.close(1013, 'busy');
    return;
  }
  setTimeout(() => {
    if (!conn.code) ws.close(1008, 'join a room'); // unauthenticated sockets don't linger
  }, 10_000);
  conns.add(conn);
  (ws as any).isAlive = true;
  ws.on('pong', () => ((ws as any).isAlive = true));
  ws.on('error', () => ws.terminate());

  let msgWindow = Date.now();
  let msgCount = 0;
  ws.on('message', (data) => {
    const t = Date.now();
    if (t - msgWindow > 1000) {
      msgWindow = t;
      msgCount = 0;
    }
    if (++msgCount > 20) return; // a phone sends ~1 msg/s; anything this fast is abuse
    let m: ClientMsg;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    try {
      handle(conn, m);
    } catch (e) {
      const message = (e as Error).message;
      const code = /no room/i.test(message) ? 'no_room' : /full/i.test(message) ? 'full' : /in progress/i.test(message) ? 'in_progress' : /too many/i.test(message) ? 'rate' : 'other';
      send(ws, { t: 'error', message, code });
    }
  });

  ws.on('close', () => {
    conns.delete(conn);
    const room = getRoom(conn.code);
    const p = room?.players.get(conn.playerId ?? '');
    if (room && p) {
      const stillThere = [...conns].some((c) => c.code === room.code && c.playerId === p.id);
      if (!stillThere) room.setConnected(p.id, false);
      broadcast(room);
    }
  });
});

function rotateWatch(room: Room) {
  room.watchToken = Room.newToken();
  for (const c of [...conns])
    if (c.code === room.code) {
      if (c.watcher) {
        c.ws.close();
        conns.delete(c);
      } else send(c.ws, { t: 'watchToken', watchToken: room.watchToken });
    }
  saveRooms();
}

function handle(conn: Conn, m: ClientMsg) {
  const ws = conn.ws;
  if (m.t === 'hello') {
    const tnow = Date.now();
    const hits = (helloHits.get(conn.ip) ?? []).filter((t) => tnow - t < 60_000);
    if (hits.length >= 200) throw new Error('Too many join attempts. Wait a minute.');
    helloHits.set(conn.ip, [...hits, tnow]);
    // One membership per connection: leaving the old room first
    const old = getRoom(conn.code);
    if (old && conn.playerId) old.setConnected(conn.playerId, false);
    let room = getRoom(m.code);
    if (m.create || !m.code) {
      const now = Date.now();
      const recent = (createHits.get(conn.ip) ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= 6 || rooms.size >= 500) throw new Error('Too many new rooms. Try again in a minute.');
      createHits.set(conn.ip, [...recent, now]);
      const code = newCode();
      room = new Room(code, emitTo(code));
      rooms.set(code, room);
    }
    if (!room) throw new Error('No room with that code');
    let p = m.playerId ? room.players.get(m.playerId) : undefined;
    if (p && p.secret !== m.secret) p = undefined;
    if (!p) {
      if (room.phase !== 'lobby') throw new Error('Game in progress. Join when the crew is back in the lobby.');
      if ([...room.players.values()].filter((x) => !x.bot).length >= 8) throw new Error('Room is full');
      p = room.addPlayer(m.name);
    } else if (m.name) p.name = m.name.slice(0, 16);
    room.setConnected(p.id, true);
    room.setActive(p.id, true); // a phone that (re)connects is in the foreground
    conn.code = room.code;
    conn.playerId = p.id;
    send(ws, { t: 'welcome', playerId: p.id, secret: p.secret, code: room.code, watchToken: room.watchToken });
    broadcast(room);
    return;
  }
  if (m.t === 'watch') {
    const room = getRoom(m.code);
    if (!room || m.token !== room.watchToken) throw new Error('No room with that code');
    conn.code = room.code;
    conn.watcher = true;
    send(ws, { t: 'state', room: room.spectatorView() });
    return;
  }
  const room = getRoom(conn.code);
  if (!room || !conn.playerId) return;
  const isHost = room.hostId === conn.playerId;
  switch (m.t) {
    case 'pos':
      room.updatePosition(conn.playerId, Number(m.lat), Number(m.lng), Number(m.acc), !!m.sim, Number(m.age) || 0);
      break;
    case 'settings':
      if (!isHost) break;
      room.updateSettings(m.settings ?? {});
      broadcast(room);
      break;
    case 'bots':
      if (!isHost) break;
      room.setBots(Number(m.n) || 0);
      broadcast(room);
      break;
    case 'start':
      if (!isHost) break;
      room.start();
      broadcast(room);
      saveRooms(); // persist immediately: a redeploy right after Start must not drop the game
      break;
    case 'again':
      if (!isHost) break;
      room.backToLobby();
      broadcast(room);
      break;
    case 'kick':
      if (!isHost) break;
      if (room.kick(conn.playerId, String(m.id))) {
        for (const c of [...conns])
          if (c.code === room.code && c.playerId === m.id) {
            send(c.ws, { t: 'error', message: 'The host removed you from the crew.', code: 'kicked' });
            c.code = c.playerId = undefined; // no more state for them
            c.ws.close();
          }
        rotateWatch(room); // a removed player keeps no spectator access
        broadcast(room);
      }
      break;
    case 'rotateWatch':
      if (!isHost) break;
      rotateWatch(room);
      break;
    case 'ack':
      room.ack(conn.playerId, String(m.id));
      break;
    case 'active':
      room.setActive(conn.playerId, !!m.on);
      broadcast(room);
      break;
    case 'pause':
      if (!isHost) break;
      room.setPaused(!!m.on);
      broadcast(room);
      break;
    case 'leave':
      room.removePlayer(conn.playerId);
      conn.code = conn.playerId = undefined;
      broadcast(room);
      break;
  }
}

// game loop: 4 Hz simulation, 2 Hz broadcast
let tickN = 0;
setInterval(() => {
  tickN++;
  for (const room of rooms.values()) {
    room.tick();
    if (tickN % 2 === 0) broadcast(room);
  }
}, 250);

// heartbeat + cleanup
setInterval(() => {
  for (const c of conns) {
    const w = c.ws as any;
    if (!w.isAlive) {
      c.ws.terminate();
      continue;
    }
    w.isAlive = false;
    c.ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    const connected = [...conns].some((c) => c.code === code);
    const expired = (!connected && now - r.lastActivity > 45 * 60_000) || now - r.lastActivity > 6 * 3600_000 || (r.phase === 'ended' && now - (r.finishedAt ?? now) > 2 * 3600_000);
    if (expired) rooms.delete(code);
  }
}, 10_000);

// ---------------- persistence (survives redeploys) ----------------
function saveRooms() {
  try {
    const tmp = ROOMS_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify({ rooms: [...rooms.values()].map((r) => r.snapshot()) }));
    renameSync(tmp, ROOMS_FILE);
  } catch (e) {
    console.warn('[persist] save failed', (e as Error).message);
  }
}
function loadRooms() {
  try {
    if (!existsSync(ROOMS_FILE)) return;
    const saved = JSON.parse(readFileSync(ROOMS_FILE, 'utf8'));
    const arr: any[] = Array.isArray(saved) ? saved : saved.rooms;
    for (const o of arr) {
      if (Date.now() - (o.lastActivity ?? 0) > 3 * 3600_000) continue;
      try {
        rooms.set(o.code, Room.restore(o, emitTo(o.code)));
      } catch {}
    }
    console.log(`[persist] restored ${rooms.size} rooms`);
  } catch (e) {
    console.warn('[persist] load failed', (e as Error).message);
  }
}
loadRooms();
setInterval(saveRooms, 2000);
// also save on every phase change
const lastPhase = new Map<string, string>();
setInterval(() => {
  for (const r of rooms.values())
    if (lastPhase.get(r.code) !== r.phase) {
      lastPhase.set(r.code, r.phase);
      saveRooms();
    }
}, 250);
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    saveRooms();
    process.exit(0);
  });

server.listen(PORT, () => console.log(`squall server on :${PORT}`));
