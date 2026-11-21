import path from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room.js';
import { IP_HOURLY_JUDGE, ipAttempts, judgePhoto, judgeStats, type Judgement } from './judge.js';
import { canonicalLabel, normalizeLabel, scoreFind, scoreSolo, titleFor } from './rarity.js';
import { dailyPrompts, nextTorontoMidnight, promptById, soloPrompts, squadPrompts, torontoDay } from './prompts.js';
import { thumbnail, THUMB_W } from './thumbs.js';
import { DATA_DIR, PHOTO_DIR, byDevice, cards, commitFinds, countFind, peekCounts, markPendingSquad, clearPendingSquad, pendingSquads, releaseUsedPhoto, resetPromptCounts, dailyEntry, dailyEntryMut, daily, dropCardsWithoutPhotos, flushAll, usedPhoto, promptTotals, saveCard, topLabels, writeAtomic } from './store.js';
import { IMPOSTOR_MIN_PLAYERS, MAX_TRIES } from './room.js';
import { Lru } from './lru.js';
import { dict } from './dict.js';
import { boardView, displayTeam, ghostFor, hideTeam, recordRun, resetBoard, teamKey } from './board.js';
import { setProgress, setsCompletedBy } from './sets.js';
import type { Card, ClientMsg, ErrorCode, FindBody, Prompt, Reply, ServerMsg, WsErrorCode } from './types.js';

const PORT = Number(process.env.PORT || 8787);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const JUDGE_GAP_MS = 4000;
const MAX_IN_FLIGHT = 10;
const ROOMS_FILE = join(DATA_DIR, 'rooms.json');

/** Event-sized limits (venue Wi-Fi puts everyone behind one IP). All overridable by env. */
const envInt = (name: string, dflt: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const LIMITS = {
  IP_JUDGE_PER_MIN: envInt('IP_JUDGE_PER_MIN', 300),
  IP_FIND_REQ_PER_MIN: envInt('IP_FIND_REQ_PER_MIN', 600),
  CREATE_PER_IP_MIN: envInt('CREATE_PER_IP_MIN', 60),
  JOIN_PER_IP_MIN: envInt('JOIN_PER_IP_MIN', 300),
  WS_PENDING_PER_IP: envInt('WS_PENDING_PER_IP', 300),
  SOLO_PER_IP: envInt('SOLO_PER_IP', 80), // per 10 minutes
  TEAM_RUNS_PER_HOUR: envInt('TEAM_RUNS_PER_HOUR', 20),
};

const rooms = new Map<string, Room>();
let shuttingDown = false;
let inFlight = 0;

const fail = (status: number, error: ErrorCode, message: string): Reply => ({ status, body: { error, message } });
const rateLimited = (message: string, retryAfterMs: number): Reply => ({ status: 429, body: { error: 'rate', message, retryAfterMs: Math.max(250, Math.ceil(retryAfterMs)) } });

/** One client-IP rule for HTTP and WS: behind Railway's proxy, the first x-forwarded-for hop; otherwise the socket. */
const BEHIND_PROXY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.TRUST_PROXY);
function clientIp(headers: IncomingHttpHeaders, socketAddr: string | undefined): string {
  if (BEHIND_PROXY) {
    const xff = headers['x-forwarded-for'];
    const first = String(Array.isArray(xff) ? xff[0] : (xff ?? '')).split(',')[0].trim();
    if (first) return first;
  }
  return socketAddr || 'anon';
}
const validDevice = (d: unknown): d is string => typeof d === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(d);

// ---------------- HTTP ----------------
const app = express();
app.set('trust proxy', false); // client IPs come from clientIp()
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '3mb' })); // 2 MB of JPEG is ~2.7 MB of base64
app.use((e: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!e) return next();
  const big = e.type === 'entity.too.large';
  res.status(big ? 413 : 400).json({ error: 'bad_request', message: big ? 'Photo too large.' : 'Bad JSON.' });
});

// landing page at /, the web build of the app at /play (single-page app)
// quick-play link for the table visits
app.get('/q', (_req, res) => res.redirect(302, '/play/?solo=1'));

const PUBLIC = path.resolve(process.env.PUBLIC_DIR || 'public');
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: '5m' }));
app.get(/^\/play(\/[^.]*)?$/, (_req, res) => res.sendFile(path.join(PUBLIC, 'play', 'index.html'))); // asset paths (with a dot) 404 instead of returning the page
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/stats', (req, res) => {
  const token = process.env.STATS_TOKEN;
  if (!token || req.query.token !== token) return res.sendStatus(404);
  res.json({ judge: judgeStats, rooms: rooms.size, cards: Object.keys(cards.data).length });
});

function cardsOf(device: string): Card[] {
  return (byDevice.data[device] ?? []).map((id) => cards.data[id]).filter(Boolean);
}

app.get('/api/daily', (req, res) => {
  const device = req.query.device;
  if (!validDevice(device)) return res.status(400).json({ error: 'bad_request', message: 'Missing device.' });
  const day = torontoDay();
  const prompts = dailyPrompts(day).map(pub);
  const e = dailyEntry(day, device);
  const outCards: Record<string, Card> = {};
  let score = 0;
  for (const [pid, cid] of Object.entries(e.cards)) {
    const c = cards.data[cid];
    if (c) {
      outCards[pid] = c;
      score += c.points;
    }
  }
  res.json({ day, prompts, cards: outCards, tries: { ...e.tries }, score, resetsAt: nextTorontoMidnight() });
});

app.get('/api/collection', (req, res) => {
  const device = req.query.device;
  if (!validDevice(device)) return res.status(400).json({ error: 'bad_request', message: 'Missing device.' });
  const all = cardsOf(device).sort((a, b) => b.at - a.at);
  res.json({ cards: all, sets: setProgress(all) });
});

app.get('/api/board', (_req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.json(boardView());
});
const adminOk = (req: express.Request) => !!process.env.STATS_TOKEN && req.query.token === process.env.STATS_TOKEN;
// moderation: hide a team (its runs stay saved); ?hidden=0 shows it again
app.post('/api/board/hide', (req, res) => {
  if (!adminOk(req)) return res.sendStatus(404);
  const team = String(req.query.team ?? '');
  try {
    if (!hideTeam(team, req.query.hidden !== '0')) return res.status(404).json({ error: 'bad_request', message: 'No such team.' });
  } catch {
    return res.status(503).json({ error: 'ai_down', message: 'Could not save. Try again.' });
  }
  res.json({ ok: true, team: displayTeam(team), hidden: req.query.hidden !== '0' });
});
// moderation: zero one prompt's crowd counts
app.post('/api/counts/reset', (req, res) => {
  if (!adminOk(req)) return res.sendStatus(404);
  const prompt = String(req.query.prompt ?? '');
  if (!promptById(prompt)) return res.status(404).json({ error: 'bad_request', message: 'No such prompt.' });
  try {
    res.json({ ok: true, prompt, cleared: resetPromptCounts(prompt) });
  } catch {
    res.status(503).json({ error: 'ai_down', message: 'Could not save. Try again.' });
  }
});
app.post('/api/board/reset', (req, res) => {
  const token = process.env.STATS_TOKEN;
  if (!token || req.query.token !== token) return res.sendStatus(404);
  resetBoard();
  res.json({ ok: true });
});

app.get('/api/prompt/:id/top', (req, res) => {
  const { total } = promptTotals(req.params.id);
  res.json({ total, top: topLabels(req.params.id, 10) });
});

app.get('/p/:file', async (req, res) => {
  const m = /^([a-f0-9]{16,64})\.jpg$/.exec(req.params.file);
  const f = m && join(PHOTO_DIR, `${m[1]}.jpg`);
  if (!f || !existsSync(f)) return res.sendStatus(404);
  res.setHeader('content-type', 'image/jpeg');
  res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  if (Number(req.query.w) === THUMB_W) {
    const t = await thumbnail(m![1]); // made on save; generated now for older cards
    if (t) return res.end(t);
  }
  res.end(readFileSync(f)); // full photo (also the fallback when a thumbnail can't be made)
});

// ---------- finds ----------
const submissions = new Lru<Promise<Reply>>(5000, 30 * 60_000); // `${device}:${submissionId}`
const lastJudge = new Map<string, number>();
const ipHits = new Map<string, number[]>();
const dailyPending = new Set<string>();
const TRANSIENT = ['rate', 'budget', 'ai_down', 'bad_request'];

/** Called only once a find has passed its preconditions and the rate gate: from here on it is cached. */
function tracked(key: string, run: () => Promise<Reply>): Promise<Reply> {
  const p = run().catch((e) => {
    console.error('[find]', e);
    return fail(500, 'ai_down', 'Something went wrong. Try again.');
  });
  submissions.set(key, p);
  // Transient refusals are not idempotent: a retry with the same submissionId gets a fresh attempt.
  p.then((out) => {
    if ('error' in out.body && TRANSIENT.includes(out.body.error)) submissions.delete(key);
  });
  return p;
}

app.post('/api/find', async (req, res) => {
  const b = req.body ?? {};
  const device = b.device;
  const submissionId = typeof b.submissionId === 'string' ? b.submissionId.slice(0, 64) : '';
  if (!validDevice(device) || !submissionId) return res.status(400).json({ error: 'bad_request', message: 'Missing device or submissionId.' });
  const key = `${device}:${submissionId}`;
  const out = await (submissions.get(key) ??
    handleFind(b, device, submissionId, clientIp(req.headers, req.socket.remoteAddress), key, isTestTraffic(req.headers)).catch((e) => {
      console.error('[find]', e);
      return fail(500, 'ai_down', 'Something went wrong. Try again.');
    }));
  // a find that completes a collection set says so (computed per request; the stored reply stays as it was)
  if ('accepted' in out.body && out.body.accepted) {
    const card = out.body.card;
    const setsDone = setsCompletedBy(cardsOf(device).filter((c) => c.id !== card.id), card);
    if (setsDone.length) return res.status(out.status).json({ ...out.body, setsDone });
  }
  res.status(out.status).json(out.body);
});

function decodeImage(image: unknown): Buffer | null {
  if (typeof image !== 'string' || image.length < 200) return null;
  const buf = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (buf.length > MAX_IMAGE_BYTES || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  return buf;
}

/** Rate gates shared by both modes. Returns a refusal, or null to go ahead. */
function gate(rateKey: string, ip: string): Reply | null {
  if (shuttingDown) return fail(503, 'ai_down', 'Server is restarting. Try again in a few seconds.');
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= LIMITS.IP_JUDGE_PER_MIN) return rateLimited('Too many photos. Take a breath.', 60_000 - (now - hits[0]));
  const since = now - (lastJudge.get(rateKey) ?? 0);
  if (since < JUDGE_GAP_MS) return rateLimited('One photo every few seconds.', JUDGE_GAP_MS - since);
  if (inFlight >= MAX_IN_FLIGHT) return rateLimited('Busy. Try again in a few seconds.', 2000);
  const hour = ipAttempts(ip);
  if (hour.length >= IP_HOURLY_JUDGE) return rateLimited('This network has sent a lot of photos. Try again later.', 3600_000 - (now - hour[0]));
  ipHits.set(ip, [...hits, now]);
  lastJudge.set(rateKey, now);
  return null;
}

async function judge(prompt: Prompt, b64: string, rateKey: string, ip: string, mode: 'daily' | 'squad') {
  inFlight++;
  try {
    // every provider attempt, failures included, is charged to the IP and global budgets inside judgePhoto
    const r = await judgePhoto(prompt, topLabels(prompt.id, 40).map((x) => x.label), b64, mode, ip);
    if (!r.ok) lastJudge.delete(rateKey); // no cooldown when the AI didn't answer
    return r;
  } finally {
    inFlight--;
  }
}

function judgeFailure(error: 'budget' | 'ai_down' | 'ip', ip: string): Reply {
  if (error === 'ip') {
    const hits = ipAttempts(ip);
    return rateLimited('This network has sent a lot of photos. Try again later.', hits.length ? 3600_000 - (Date.now() - hits[0]) : 60_000);
  }
  return error === 'budget' ? fail(503, 'budget', 'The judge is resting. Try again later.') : fail(503, 'ai_down', 'The judge is unavailable. Try again.');
}

function outcomeOf(j: Judgement) {
  if (j.match) return { accepted: true as const };
  if (j.screen) return { accepted: false as const, reason: 'screen' as const, verdict: 'Find the real thing.' };
  if (j.label === 'unclear') return { accepted: false as const, reason: 'unclear' as const, verdict: j.verdict };
  return { accepted: false as const, reason: 'no_match' as const, verdict: j.verdict };
}

const SAVE_FAILED = (): Reply => fail(503, 'ai_down', 'Could not save your find. Send again.');
const usedPhotoReply = (triesLeft: number): Reply => ({ status: 200, body: { accepted: false, reason: 'unclear', verdict: 'You already used this photo. Find a new one.', triesLeft } });
const hashOf = (jpeg: Buffer) => createHash('sha1').update(jpeg).digest('hex');

/** Count, score and durably store an accepted find. Throws (with all in-memory state undone) if it can't be saved. */
/** e2e traffic sends x-rarefind-test: <STATS_TOKEN>; its finds never touch the crowd counts. */
function isTestTraffic(headers: IncomingHttpHeaders): boolean {
  const token = process.env.STATS_TOKEN;
  return !!token && headers['x-rarefind-test'] === token;
}

function mintCard(prompt: Prompt, j: Judgement, jpeg: Buffer, device: string, extra: Partial<Card>, crowdKey = device, test = false, solo = false): { card: Card; undo: () => void } {
  const label = canonicalLabel(normalizeLabel(j.label), promptTotals(prompt.id).map);
  const imageHash = hashOf(jpeg);
  const count = test ? peekCounts(prompt.id, label) : countFind(prompt.id, label, crowdKey, imageHash);
  const { sameCount, totalCount, firstEver } = count;
  // solo (board) runs score from aiRarity alone, so a find scores the same at any table and any time
  const s = solo ? scoreSolo(j.aiRarity) : scoreFind(j.aiRarity, sameCount, totalCount, firstEver);
  const id = randomBytes(12).toString('hex');
  const card: Card = {
    id,
    promptId: prompt.id,
    promptText: prompt.text,
    label,
    title: titleFor(label),
    tier: s.tier,
    points: s.points,
    rarity: s.rarity,
    sameCount,
    totalCount,
    verdict: j.verdict,
    photo: `/p/${id}.jpg`,
    at: Date.now(),
    mode: 'daily',
    ...extra,
  };
  let undoCard: () => void;
  try {
    undoCard = saveCard(card, device, jpeg, imageHash); // photo on disk first; metadata staged in memory, the caller commits
  } catch (e) {
    count.undo();
    throw e;
  }
  return {
    card,
    undo: () => {
      undoCard();
      count.undo();
    },
  };
}

const reqHits = new Map<string, number[]>();

async function handleFind(b: any, device: string, submissionId: string, ip: string, key: string, test = false): Promise<Reply> {
  // cheap per-IP request cap before any decoding or lookups
  const now = Date.now();
  const hits = (reqHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= LIMITS.IP_FIND_REQ_PER_MIN) return rateLimited('Too many requests. Take a breath.', 60_000 - (now - hits[0]));
  hits.push(now);
  reqHits.set(ip, hits);
  const jpeg = decodeImage(b.image);
  if (!jpeg) return fail(400, 'bad_request', 'Photo must be a JPEG under 2 MB.');
  const b64 = jpeg.toString('base64');
  if (b.mode === 'squad') return squadFind(b, device, submissionId, ip, jpeg, b64, key, test);
  if (b.mode !== 'daily') return fail(400, 'bad_request', 'Unknown mode.');

  const day = torontoDay();
  const prompt = dailyPrompts(day).find((x) => x.id === b.promptId);
  if (!prompt) return fail(409, 'closed', "That prompt isn't in today's set.");
  const lockKey = `${day}:${device}:${prompt.id}`;
  const e = dailyEntry(day, device);
  const stored = e.subs?.[submissionId];
  if (stored) return stored; // idempotent across restarts
  if (e.cards[prompt.id]) return fail(409, 'locked', 'You already locked this prompt today.');
  if ((e.tries[prompt.id] ?? 0) >= MAX_TRIES) return fail(409, 'locked', 'No tries left for this prompt today.');
  if (dailyPending.has(lockKey)) return rateLimited('One photo at a time.', 2000);
  if (usedPhoto(prompt.id, device, hashOf(jpeg))) return usedPhotoReply(Math.max(0, MAX_TRIES - (e.tries[prompt.id] ?? 0)));
  const g = gate(device, ip);
  if (g) return g;
  dailyPending.add(lockKey);
  return tracked(key, async () => {
  try {
    const r = await judge(prompt, b64, device, ip, 'daily');
    if (!r.ok) return judgeFailure(r.error, ip);
    const entry = dailyEntryMut(day, device);
    if (entry.cards[prompt.id]) return fail(409, 'locked', 'You already locked this prompt today.');
    entry.tries[prompt.id] = (entry.tries[prompt.id] ?? 0) + 1;
    const keep = (reply: Reply) => {
      (entry.subs ??= dict())[submissionId] = reply;
      daily.flush();
      return reply;
    };
    const o = outcomeOf(r.j);
    if (!o.accepted) return keep({ status: 200, body: { accepted: false, reason: o.reason, verdict: o.verdict, triesLeft: Math.max(0, MAX_TRIES - entry.tries[prompt.id]) } });
    let made: ReturnType<typeof mintCard> | undefined;
    try {
      made = mintCard(prompt, r.j, jpeg, device, { mode: 'daily', day }, device, test);
      const reply: Reply = { status: 200, body: { accepted: true, card: made.card } };
      entry.cards[prompt.id] = made.card.id;
      (entry.subs ??= dict())[submissionId] = reply;
      commitFinds(); // ONE atomic write: counts, marks, card, device list, daily lock and reply
      void thumbnail(made.card.id); // 240 px thumbnail in the background
      return reply;
    } catch (err) {
      console.error('[find] save failed', (err as Error).message);
      made?.undo();
      delete entry.cards[prompt.id];
      delete entry.subs?.[submissionId];
      entry.tries[prompt.id] = Math.max(0, entry.tries[prompt.id] - 1);
      return SAVE_FAILED(); // transient: not cached, the same submission can be sent again
    }
  } finally {
    dailyPending.delete(lockKey);
  }
  });
}

async function squadFind(b: any, device: string, submissionId: string, ip: string, jpeg: Buffer, b64: string, key: string, test = false): Promise<Reply> {
  const room = getRoom(b.code);
  if (!room) return fail(409, 'closed', 'That squad is gone.');
  const player = room.auth(b.playerId, b.secret);
  if (!player) return fail(403, 'bad_request', 'Join the squad first.');
  const pre = room.precheck(player.id, submissionId, typeof b.promptId === 'string' ? b.promptId : undefined);
  if (pre.kind !== 'ok') return pre.reply;
  if (b.promptId && b.promptId !== pre.prompt.id) {
    room.abort(player.id, submissionId);
    return fail(409, 'closed', 'That prompt is over.');
  }
  if (usedPhoto(pre.prompt.id, player.device || device, hashOf(jpeg))) {
    room.abort(player.id, submissionId);
    return usedPhotoReply(room.triesLeft(player.id, pre.prompt.id));
  }
  const rateKey = `${room.code}:${player.id}`; // per squad member: two tabs on one laptop share a device id
  const g = gate(rateKey, ip);
  if (g) {
    room.abort(player.id, submissionId);
    return g;
  }
  return tracked(key, async () => {
  const r = await judge(pre.prompt, b64, rateKey, ip, 'squad');
  if (!r.ok) {
    room.abort(player.id, submissionId);
    return judgeFailure(r.error, ip);
  }
  let reply: Reply;
  let made: ReturnType<typeof mintCard> | undefined;
  try {
    reply = room.settle(player.id, submissionId, pre.round, outcomeOf(r.j), () => {
      const dev = player.device || device;
      // solo runs count crowd stats per (device, team): one phone passed between tables still counts each team
      made = mintCard(pre.prompt, r.j, jpeg, dev, { mode: 'squad', playerName: player.name, playerId: player.id }, room.solo && room.team ? `${dev}|team:${teamKey(room.team)}` : dev, test, room.solo);
      // journal it in the same atomic commit: a crash before the room snapshot is reconciled on startup
      markPendingSquad(made.card.id, { code: room.code, playerId: player.id, submissionId, round: pre.round });
      try {
        commitFinds(); // atomic write of the find metadata (photo already on disk)
      } catch (e) {
        clearPendingSquad(made.card.id);
        made.undo();
        made = undefined;
        throw e;
      }
      return made.card;
    }, pre.prompt.id);
  } catch (err) {
    console.error('[find] save failed', (err as Error).message);
    return SAVE_FAILED();
  }
  if (made && 'accepted' in reply.body && reply.body.accepted) {
    try {
      saveRooms(true); // the room snapshot must hold the find too
      clearPendingSquad(made.card.id);
    } catch (err) {
      console.error('[find] room snapshot failed', (err as Error).message);
      room.unsettle(player.id, submissionId, made.card);
      clearPendingSquad(made.card.id);
      made.undo();
      commitFinds(false); // best effort: take the card back out of finds.json
      broadcast(room, true);
      return SAVE_FAILED();
    }
  }
  if (made && 'accepted' in reply.body && reply.body.accepted) void thumbnail(made.card.id);
  broadcast(room, true);
  return reply;
  });
}

function pub(p: Prompt): Prompt {
  return { id: p.id, text: p.text, examples: p.examples };
}

// ---------------- WS ----------------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/rt', maxPayload: 16 * 1024 });
type Conn = { ws: WebSocket; ip: string; code?: string; playerId?: string };
const conns = new Set<Conn>();
const createHits = new Map<string, number[]>();
const joinHits = new Map<string, number[]>();
/** create/join retries: `${t}:${device}:${op}` -> the original membership, kept 10 minutes */
const ops = new Lru<{ code: string; playerId: string }>(5000, 10 * 60_000);
const opKey = (m: any) => (typeof m.op === 'string' && m.op.length >= 4 ? `${m.t}:${typeof m.device === 'string' ? m.device.slice(0, 64) : ''}:${m.op.slice(0, 64)}` : null);
/** A retried create/join gets the original welcome back instead of a second player. */
function replayOp(conn: Conn, m: any): boolean {
  const k = opKey(m);
  const prev = k ? ops.get(k) : undefined;
  const room = prev && getRoom(prev.code);
  const p = room?.players.get(prev!.playerId);
  if (!room || !p) return false;
  attach(conn, room, p.id, p.secret);
  return true;
}
function rememberOp(m: any, code: string, playerId: string) {
  const k = opKey(m);
  if (k) ops.set(k, { code, playerId });
}
const sentVersion = new Map<string, number>();

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function getRoom(code: unknown): Room | undefined {
  return typeof code === 'string' ? rooms.get(code.toUpperCase().trim()) : undefined;
}
function newCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
function broadcast(room: Room, force = false) {
  if (!force && sentVersion.get(room.code) === room.version) return;
  sentVersion.set(room.code, room.version);
  // impostor games: each player gets their own view (the impostor's prompt is theirs alone)
  const shared = room.impostor ? null : JSON.stringify({ t: 'state', room: room.view() } satisfies ServerMsg);
  for (const c of conns)
    if (c.code === room.code && c.ws.readyState === WebSocket.OPEN) c.ws.send(shared ?? JSON.stringify({ t: 'state', room: room.view(c.playerId) } satisfies ServerMsg));
}
function limited(map: Map<string, number[]>, ip: string, max: number) {
  const now = Date.now();
  const hits = (map.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= max) return true;
  map.set(ip, [...hits, now]);
  return false;
}
class WsError extends Error {
  constructor(
    public code: WsErrorCode,
    message: string,
  ) {
    super(message);
  }
}

wss.on('connection', (ws, req) => {
  const conn: Conn = { ws, ip: clientIp(req.headers, req.socket.remoteAddress) };
  const loose = [...conns].filter((c) => c.ip === conn.ip && !c.code).length;
  if (conns.size >= 3000 || loose >= LIMITS.WS_PENDING_PER_IP || shuttingDown) return ws.close(1013, 'busy');
  conns.add(conn);
  setTimeout(() => {
    if (!conn.code && ws.readyState === WebSocket.OPEN) ws.close(1008, 'join a room');
  }, 15_000).unref();
  (ws as any).isAlive = true;
  ws.on('pong', () => ((ws as any).isAlive = true));
  ws.on('error', () => ws.terminate());

  let windowAt = Date.now();
  let count = 0;
  ws.on('message', (data) => {
    const t = Date.now();
    if (t - windowAt > 1000) {
      windowAt = t;
      count = 0;
    }
    if (++count > 20) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    try {
      handle(conn, m);
    } catch (e) {
      const code = e instanceof WsError ? e.code : 'other';
      if (!(e instanceof WsError)) console.error('[ws]', e);
      send(ws, { t: 'error', code, message: (e as Error).message });
    }
  });

  ws.on('close', () => {
    conns.delete(conn);
    detach(conn);
  });
});

function detach(conn: Conn) {
  const room = getRoom(conn.code);
  if (room && conn.playerId) {
    const still = [...conns].some((c) => c !== conn && c.code === room.code && c.playerId === conn.playerId);
    if (!still) room.setConnected(conn.playerId, false);
    broadcast(room);
  }
  conn.code = conn.playerId = undefined;
}

function attach(conn: Conn, room: Room, playerId: string, secret: string) {
  if (conn.code && (conn.code !== room.code || conn.playerId !== playerId)) detach(conn);
  conn.code = room.code;
  conn.playerId = playerId;
  room.setConnected(playerId, true);
  send(conn.ws, { t: 'welcome', playerId, secret, code: room.code });
  broadcast(room, true);
}

// ---------------- People's Choice: solo runs + team leaderboard ----------------
/** The phone's solo run still in progress (countdown, hunting or reveal), if any. Scans rooms, so it survives restarts. */
function activeSoloRun(device: string): Room | undefined {
  for (const r of rooms.values()) if (r.solo && r.phase !== 'ended' && r.phase !== 'lobby' && [...r.players.values()].some((p) => p.device === device)) return r;
  return undefined;
}
const soloIpHits = new Map<string, number[]>();
const teamHits = new Map<string, number[]>();
/** Solo runs share one fixed prompt set per Toronto day; squads draw at random. */
const pickFor = (solo: boolean) => (solo ? () => soloPrompts(torontoDay()) : (q: boolean, n: number, twins?: boolean) => squadPrompts(q, Math.random, n, !!twins));
function windowLimited(map: Map<string, number[]>, key: string, max: number, windowMs: number) {
  const now = Date.now();
  const hits = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return true;
  map.set(key, [...hits, now]);
  return false;
}
/** A solo room just ended: put the run on the board and keep the standing for the ended view. */
function recordSolo(room: Room) {
  const p = [...room.players.values()][0];
  if (!p || !room.team) return;
  // throws on a board write failure: the room keeps boardRecorded=false and retries (idempotent by runId)
  room.board = recordRun({ runId: room.runId ?? room.code, team: room.team, playerName: p.name, score: p.score, bestCardId: room.results().best[p.id] ?? null, at: room.endedAt ?? Date.now(), device: p.device, splits: room.splits() });
}

function leavePlayer(room: Room, playerId: string) {
  room.removePlayer(playerId);
  for (const c of conns) if (c.code === room.code && c.playerId === playerId) c.code = c.playerId = undefined;
  if (room.players.size === 0) {
    rooms.delete(room.code);
    sentVersion.delete(room.code);
  } else broadcast(room);
  saveRooms();
}

function handle(conn: Conn, m: ClientMsg) {
  switch (m?.t) {
    case 'create': {
      if (replayOp(conn, m)) return;
      const solo = !!m.solo;
      let team: string | null = null;
      if (solo) {
        team = displayTeam(m.team);
        if (!team) throw new WsError('other', 'Enter your team name.');
        if (!validDevice(m.device)) throw new WsError('other', 'Missing device.');
        // one run at a time per phone; "Play again" right after a run ends is fine
        if (activeSoloRun(m.device)) throw new WsError('rate', 'This phone is already in a solo run. Finish or leave it first.');
        if (windowLimited(soloIpHits, conn.ip, LIMITS.SOLO_PER_IP, 10 * 60_000)) throw new WsError('rate', 'Too many solo runs from this network. Try again in a few minutes.');
        if (windowLimited(teamHits, teamKey(team), LIMITS.TEAM_RUNS_PER_HOUR, 3600_000)) throw new WsError('rate', 'This team has played a lot this hour. Try again later.');
      }
      if (limited(createHits, conn.ip, LIMITS.CREATE_PER_IP_MIN) || rooms.size >= 1000) throw new WsError('rate', 'Too many new squads. Try again in a minute.');
      const code = newCode();
      const room = new Room(code, solo || !!m.quick, Date.now, pickFor(solo), { solo, team, onEnd: recordSolo, ghost: solo ? ghostFor(torontoDay()) : null }); // the ghost: today's best run, same prompts
      rooms.set(code, room);
      const p = room.addPlayer(m.name, validDevice(m.device) ? m.device : '');
      if (solo) {
        room.start(p.id); // a solo run starts on its own: 3 s countdown, then round 1
      }
      rememberOp(m, code, p.id);
      attach(conn, room, p.id, p.secret);
      saveRooms();
      return;
    }
    case 'join': {
      if (replayOp(conn, m)) return;
      if (limited(joinHits, conn.ip, LIMITS.JOIN_PER_IP_MIN)) throw new WsError('rate', 'Too many tries. Wait a minute.');
      const room = getRoom(m.code);
      if (!room) throw new WsError('no_room', 'No squad with that code.');
      const ok = room.canJoin();
      if (ok === 'in_progress') throw new WsError('in_progress', 'That squad is mid-game. Join when they are back in the lobby.');
      if (ok === 'full') throw new WsError('full', 'That squad is full.');
      const p = room.addPlayer(m.name, validDevice(m.device) ? m.device : '');
      rememberOp(m, room.code, p.id);
      attach(conn, room, p.id, p.secret);
      return;
    }
    case 'resume': {
      if (limited(joinHits, conn.ip, LIMITS.JOIN_PER_IP_MIN)) throw new WsError('rate', 'Too many tries. Wait a minute.');
      const room = getRoom(m.code);
      if (!room) throw new WsError('no_room', 'That squad is gone.');
      const p = room.auth(m.playerId, m.secret);
      if (!p) throw new WsError('kicked', 'You are no longer in this squad.');
      attach(conn, room, p.id, p.secret);
      return;
    }
    case 'leave': {
      if (!m.code && !m.playerId) break; // a plain leave on an attached socket, below
      // leave with credentials on any socket: lets the app retry a leave that happened offline
      if (limited(joinHits, conn.ip, LIMITS.JOIN_PER_IP_MIN)) throw new WsError('rate', 'Too many tries. Wait a minute.');
      const room = getRoom(m.code);
      const p = room?.players.get(String(m.playerId));
      if (room && p) {
        if (p.secret !== m.secret) throw new WsError('other', 'Wrong player credentials.');
        leavePlayer(room, p.id);
      }
      send(conn.ws, { t: 'left' }); // already gone counts as left
      return;
    }
  }
  const room = getRoom(conn.code);
  const me = conn.playerId;
  if (!room || !me || !room.players.has(me)) throw new WsError('no_room', 'Join a squad first.');
  switch (m.t) {
    case 'start':
      if (room.start(me)) saveRooms();
      else if (room.hostId !== me) throw new WsError('other', 'Only the host can start.');
      else if (room.impostor && room.players.size < IMPOSTOR_MIN_PLAYERS) throw new WsError('other', `Impostor needs at least ${IMPOSTOR_MIN_PLAYERS} players.`);
      else throw new WsError('other', 'Cannot start now.');
      break;
    case 'vote':
      if (!room.vote(me, String((m as any).target ?? ''))) throw new WsError('other', 'Voting is closed.');
      break;
    case 'settings':
      if (
        (m.quick !== undefined && !room.setQuick(me, !!m.quick)) ||
        (m.bingo !== undefined && !room.setBingo(me, !!m.bingo)) ||
        (m.unique !== undefined && !room.setUnique(me, !!m.unique)) ||
        (m.impostor !== undefined && !room.setImpostor(me, !!m.impostor))
      )
        throw new WsError('other', 'Only the host can change settings in the lobby.');
      break;
    case 'shooting':
      room.markShooting(me, String((m as any).promptId ?? '')); // silent: only extends the upload grace
      return;
    case 'skip':
      if (!room.skip(me)) throw new WsError('other', 'Only the host can skip.');
      break;
    case 'again':
      if (!room.again(me)) throw new WsError('other', 'Only the host can restart after the game ends.');
      break;
    case 'kick': {
      const id = String((m as any).id);
      if (!room.kick(me, id)) throw new WsError('other', 'Only the host can remove players in the lobby.');
      for (const c of [...conns])
        if (c.code === room.code && c.playerId === id) {
          send(c.ws, { t: 'error', code: 'kicked', message: 'The host removed you from the squad.' });
          c.code = c.playerId = undefined;
          c.ws.close();
        }
      break;
    }
    case 'leave':
      leavePlayer(room, me);
      send(conn.ws, { t: 'left' });
      return;
    default:
      return;
  }
  broadcast(room);
}

// tick: 4 Hz; broadcast on change, plus a state heartbeat every 4 s (stale-socket detection + clock sync)
let tickN = 0;
setInterval(() => {
  tickN++;
  for (const room of rooms.values()) {
    const before = room.phase;
    room.tick();
    if (room.phase !== before) saveRooms();
    broadcast(room, tickN % 16 === 0);
  }
}, 250);

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
  for (const [code, r] of rooms)
    if (r.expired()) {
      rooms.delete(code);
      sentVersion.delete(code);
    }
}, 15_000);

// ---------------- persistence ----------------
let savedVersions = '';
function saveRooms(strict = false) {
  try {
    writeAtomic(ROOMS_FILE, JSON.stringify({ rooms: [...rooms.values()].map((r) => r.snapshot()) }));
    savedVersions = [...rooms.values()].map((r) => `${r.code}${r.version}`).join();
  } catch (e) {
    console.warn('[persist] rooms save failed', (e as Error).message);
    if (strict) throw e;
  }
}
/**
 * Crash window between the find commit and the room snapshot: credit journaled squad/solo cards whose round is
 * still open, otherwise free the photo so the same picture can be sent again.
 */
function reconcileSquadFinds() {
  let credited = 0;
  let released = 0;
  for (const [cardId, p] of pendingSquads()) {
    const card = cards.data[cardId];
    const room = rooms.get(p.code);
    if (card && room?.restoreCredit(p.playerId, p.submissionId, p.round, card)) credited++;
    else {
      releaseUsedPhoto(cardId);
      submissions.delete(`${card?.playerId ? (room?.players.get(card.playerId)?.device ?? '') : ''}:${p.submissionId}`);
      released++;
    }
    clearPendingSquad(cardId);
  }
  if (credited || released) {
    console.warn(`[reconcile] squad finds: ${credited} credited, ${released} released for retry`);
    commitFinds(false);
    saveRooms();
  }
}

function loadRooms() {
  try {
    if (!existsSync(ROOMS_FILE)) return;
    const saved = JSON.parse(readFileSync(ROOMS_FILE, 'utf8'));
    for (const s of saved.rooms ?? []) {
      const r = Room.restore(s, Date.now, pickFor(!!s.solo), recordSolo);
      if (!r.expired()) rooms.set(r.code, r);
    }
    console.log(`[persist] restored ${rooms.size} rooms`);
  } catch (e) {
    console.warn('[persist] rooms load failed', (e as Error).message);
  }
}
loadRooms();
reconcileSquadFinds();
{
  const dropped = dropCardsWithoutPhotos();
  if (dropped) console.warn(`[store] dropped ${dropped} cards whose photo is missing`);
}
setInterval(() => {
  const v = [...rooms.values()].map((r) => `${r.code}${r.version}`).join();
  if (v !== savedVersions) saveRooms();
}, 2000);

for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, async () => {
    shuttingDown = true;
    const until = Date.now() + 18_000; // let in-flight judgements finish
    while (inFlight > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    saveRooms();
    flushAll();
    process.exit(0);
  });

server.listen(PORT, () => console.log(`rarefind server on :${PORT} (data ${DATA_DIR}, judge key ${judgeStats.hasKey ? 'set' : 'missing'})`));
