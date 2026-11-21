import { randomBytes } from 'node:crypto';
import { bearingDeg, compass, distanceM, escapeExit, offsetM, toLocal } from './geo.js';
import type { FeedItem, GameEvent, LatLng, OrbView, PlayerView, Results, RoomView, Settings, StrikeView } from './types.js';

// muted marker tints: on the radar only storm cells are bright
const COLORS = ['#3E6F96', '#6B5B95', '#2F7D78', '#8A6B3D', '#5A6B7C', '#8C4F6A', '#4F7A4B', '#7A6F5A'];
const BOT_NAMES = ['Gale', 'Nimbus', 'Cirrus', 'Haze', 'Drift', 'Sleet'];
const MAX_HP = 3;
const ORB_R = 9; // metres to collect
const REVIVE_R = 12; // two phones' GPS error adds up, so be generous
const REVIVE_MS = 3000;
const COUNTDOWN_MS = 5000;
const MAX_HUMAN_SPEED = 9; // m/s; faster jumps are GPS noise or vehicles
const STALE_FIX_MS = 6000; // no penalties on a stale fix
const WEAK_ACC_M = 30; // no penalties on a weak fix
const WALK_MS = 1.3; // planning pace: everything must be escapable at a brisk walk
const REACTION_S = 3;
export const LEVELS = 5;
/** The demo preset: a short, dense storm for indoor judging with the joystick. */
export const QUICK_SEC = 100;

export type Player = PlayerView & {
  secret: string;
  lastFixAt: number;
  warned: Set<string>;
  warnedAt: Record<string, number>; // strike id -> when this player was warned
  warnedNeed: Record<string, number>; // strike id -> ms they needed to escape from where they were
  lastOobWarn: number;
  joinedAt: number;
  disconnectedAt: number | null;
  anchor: LatLng | null; // distance accumulates against this, not against every jittery fix
  jumpStreak: number;
  jumpAt: number; // a persistent jump was accepted at this time: don't trust it for a few seconds
  anchorAt: number;
  heading?: number;
  speed?: number;
  reactMs?: number;
};

const rid = (n = 6) => randomBytes(n).toString('base64url').slice(0, n);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export type Emit = (playerId: string, ev: GameEvent) => void;

/** ms a walker needs to cover `m` metres, plus reaction time. */
export function walkMs(m: number, mega = false) {
  return Math.round((m / WALK_MS + REACTION_S) * 1000 * (mega ? 1.1 : 1));
}

/** Warning time (ms) so that a walker standing anywhere in the zone can leave it. */
export function warnMsFor(r: number, offsetFromTarget: number, mega: boolean) {
  const escapeM = r - Math.max(0, offsetFromTarget) + 3; // worst case for the targeted player, plus margin
  return Math.round((escapeM / WALK_MS + REACTION_S) * 1000 * (mega ? 1.1 : 1));
}

export class Room {
  code: string;
  watchToken = Room.newToken();
  static newToken() {
    return Array.from(randomBytes(6), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  }
  hostId = '';
  phase: RoomView['phase'] = 'lobby';
  settings: Settings = { durationSec: 480, radiusM: 120, quick: false };
  center: LatLng | null = null;
  startsAt: number | null = null;
  endsAt: number | null = null;
  players = new Map<string, Player>();
  strikes: StrikeView[] = [];
  orbs: OrbView[] = [];
  level = 1;
  peakLevel = 1;
  outcome: RoomView['outcome'] = null;
  feed: FeedItem[] = [];
  results: Results | null = null;
  nextStrikeAt = 0;
  nextMegaAt = 0;
  lastActivity = Date.now();
  finishedAt: number | null = null;

  private lastTick = Date.now();

  constructor(code: string, private emit: Emit) {
    this.code = code;
  }

  // ---------- players ----------
  addPlayer(name: string, bot = false): Player {
    const id = bot ? `bot-${rid(4)}` : rid(8);
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[this.players.size % COLORS.length];
    const p: Player = {
      id,
      secret: rid(16),
      name: (name || 'Player').trim().slice(0, 16) || 'Player',
      color,
      lat: null,
      lng: null,
      acc: 50,
      hp: MAX_HP,
      maxHp: MAX_HP,
      score: 0,
      status: 'alive',
      gpsWeak: true,
      bot,
      sim: false,
      connected: true,
      oob: false,
      reviveProgress: 0,
      distanceM: 0,
      movingSec: 0,
      hits: 0,
      dodges: 0,
      orbs: 0,
      revives: 0,
      lastFixAt: 0,
      warned: new Set(),
      warnedAt: {},
      warnedNeed: {},
      lastOobWarn: 0,
      joinedAt: Date.now(),
      disconnectedAt: null,
      anchor: null,
      jumpStreak: 0,
      jumpAt: 0,
      anchorAt: 0,
    };
    this.players.set(id, p);
    if (!this.hostId && !bot) this.hostId = id;
    this.log(bot ? `${p.name} (bot) joined` : `${p.name} joined`, 'join');
    return p;
  }

  kick(hostId: string, id: string): boolean {
    if (hostId !== this.hostId || id === hostId || this.phase !== 'lobby') return false;
    const p = this.players.get(id);
    if (!p || p.bot) return false;
    this.removePlayer(id);
    return true;
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.log(`${p.name} left`, 'leave');
    if (this.hostId === id) this.hostId = [...this.players.values()].find((x) => !x.bot)?.id ?? '';
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  setBots(n: number) {
    const bots = [...this.players.values()].filter((p) => p.bot);
    n = clamp(Math.round(n), 0, 5);
    while (bots.length > n) this.players.delete(bots.pop()!.id);
    for (let i = bots.length; i < n; i++) {
      const b = this.addPlayer(BOT_NAMES[i % BOT_NAMES.length], true);
      b.reactMs = rand(800, 2500);
      b.speed = rand(1.2, 1.8);
      b.heading = rand(0, 360);
      b.gpsWeak = false;
      const anchor = this.center ?? this.humanCentroid();
      if (anchor) {
        const pos = offsetM(anchor, rand(-35, 35), rand(-35, 35));
        b.lat = pos.lat;
        b.lng = pos.lng;
        b.acc = 5;
        b.lastFixAt = Date.now();
      }
    }
  }

  humanCentroid(): LatLng | null {
    const hs = this.humans().filter((p) => p.lat != null && p.connected);
    if (!hs.length) return null;
    return { lat: hs.reduce((s, p) => s + p.lat!, 0) / hs.length, lng: hs.reduce((s, p) => s + p.lng!, 0) / hs.length };
  }

  updatePosition(id: string, lat: number, lng: number, acc: number, sim: boolean, ageMs = 0) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const now = Date.now();
    const fixAt = now - clamp(Number.isFinite(ageMs) ? ageMs : 0, 0, 15_000);
    if (fixAt <= p.lastFixAt) return; // an old fix re-sent; never let it look fresh
    this.lastActivity = now;
    const wasSim = p.sim;
    if (this.phase === 'playing' && !!sim !== wasSim && !p.bot) return; // can't switch demo/real mid-match
    p.sim = !!sim;
    acc = clamp(Number.isFinite(acc) ? acc : 50, 1, 200);
    const here = { lat, lng };
    if (p.lat != null && p.lng != null && p.lastFixAt && wasSim === p.sim) {
      const d = distanceM({ lat: p.lat, lng: p.lng }, here);
      const dt = Math.max(0.2, (fixAt - p.lastFixAt) / 1000);
      // Quarantine implausible jumps (GPS glitches, vehicles) unless they persist for 3 fixes.
      if (d / dt > MAX_HUMAN_SPEED && d > 25) {
        p.jumpAt = now; // untrusted until the jump is confirmed or the fix settles
        if (++p.jumpStreak < 3) return;
        p.jumpAt = now; // the jump persisted: accept the position, but don't trust it for hits/pickups/revives yet
        p.anchor = null;
      }
    }
    p.jumpStreak = 0;
    // Distance walked: accumulate against an anchor so slow walking (1.3 m per fix) still counts, jitter doesn't.
    if (this.phase === 'playing' && acc < 25) {
      if (!p.anchor) {
        p.anchor = here;
        p.anchorAt = fixAt;
      }
      const d = distanceM(p.anchor, here);
      if (d >= Math.max(4, acc * 0.6)) {
        const secs = Math.max(1, (fixAt - p.anchorAt) / 1000);
        if (d / secs <= 3.5 && d < 500) {
          p.distanceM += d;
          p.movingSec += Math.min(d / 1.2, secs);
        }
        p.anchor = here;
        p.anchorAt = fixAt;
      }
    }
    p.lat = lat;
    p.lng = lng;
    p.acc = acc;
    p.lastFixAt = fixAt;
    if (this.phase === 'lobby') this.center = this.humanCentroid();
  }

  setConnected(id: string, on: boolean) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = on;
    p.disconnectedAt = on ? null : Date.now();
    if (!on) {
      p.warned.clear();
      p.warnedAt = {};
      p.warnedNeed = {};
    }
  }

  /** A fix we trust enough to penalise. */
  private trusted(p: Player, now: number) {
    return p.bot || (p.connected && now - p.lastFixAt < STALE_FIX_MS && p.acc <= WEAK_ACC_M && now - p.jumpAt > 5000);
  }

  // ---------- lifecycle ----------
  updateSettings(s: Partial<Settings>) {
    if (this.phase !== 'lobby' && this.phase !== 'ended') return;
    if (typeof s.durationSec === 'number' && Number.isFinite(s.durationSec)) this.settings.durationSec = clamp(Math.round(s.durationSec), 60, 1800);
    if (typeof s.radiusM === 'number' && Number.isFinite(s.radiusM)) this.settings.radiusM = clamp(Math.round(s.radiusM), 40, 300);
    if (typeof s.quick === 'boolean') this.settings.quick = s.quick;
  }

  /** Storm level for the share `t` (0..1) of the game that has passed. */
  static levelAt(t: number) {
    return clamp(1 + Math.floor(t * LEVELS), 1, LEVELS);
  }

  /** Returns true when a new game actually started. */
  start(): boolean {
    if (this.phase === 'countdown' || this.phase === 'playing') return false;
    const c = this.humanCentroid() ?? this.center;
    if (!c) throw new Error('Waiting for a location fix');
    const far = this.humans().filter((p) => p.connected && p.lat != null && distanceM(c, { lat: p.lat, lng: p.lng! }) > this.settings.radiusM * 1.5);
    const humansNow = this.humans().filter((p) => p.connected);
    const unready = humansNow.filter((p) => p.lat == null || (!p.sim && (Date.now() - p.lastFixAt > 15_000 || p.acc > 50)));
    if (unready.length) throw new Error(`Waiting for ${unready.map((p) => p.name).join(', ')} to get a location fix.`);
    const modes = new Set(humansNow.map((p) => p.sim));
    if (modes.size > 1) throw new Error('Some phones are on demo location and some on real GPS. Use the same for everyone.');
    if (far.length) throw new Error(`${far.map((p) => p.name).join(', ')} ${far.length > 1 ? 'are' : 'is'} too far away. Everyone needs to be in the same place (or all on demo).`);
    this.center = c;
    this.resetForGame();
    const now = Date.now();
    const secs = this.settings.quick ? QUICK_SEC : this.settings.durationSec;
    this.phase = 'countdown';
    this.startsAt = now + COUNTDOWN_MS;
    this.endsAt = this.startsAt + secs * 1000;
    this.nextStrikeAt = this.startsAt + (this.settings.quick ? 2000 : 3000);
    this.nextMegaAt = this.startsAt + (this.settings.quick ? 25_000 : 60_000);
    this.log(`Storm warning: ${Math.round(secs / 60)} min`, 'start');
    for (const p of this.players.values()) this.emit(p.id, { kind: 'start' });
    return true;
  }

  resetForGame() {
    this.strikes = [];
    this.orbs = [];
    this.results = null;
    this.outcome = null;
    this.finishedAt = null;
    this.level = 1;
    this.peakLevel = 1;
    for (const p of this.players.values()) {
      Object.assign(p, { hp: MAX_HP, score: 0, status: 'alive', reviveProgress: 0, distanceM: 0, movingSec: 0, hits: 0, dodges: 0, orbs: 0, revives: 0, oob: false, anchor: null });
      p.warned.clear();
      p.warnedAt = {};
      p.warnedNeed = {};
      if (p.bot && this.center) {
        const pos = offsetM(this.center, rand(-35, 35), rand(-35, 35));
        p.lat = pos.lat;
        p.lng = pos.lng;
        p.lastFixAt = Date.now();
      }
    }
  }

  backToLobby() {
    this.phase = 'lobby';
    this.startsAt = this.endsAt = null;
    this.strikes = [];
    this.orbs = [];
    this.outcome = null;
    this.level = 1;
  }

  // ---------- tick ----------
  tick() {
    const now = Date.now();
    const dt = Math.min(1000, now - this.lastTick);
    this.lastTick = now;
    if (this.phase === 'countdown' && this.startsAt && now >= this.startsAt) this.phase = 'playing';
    if (this.phase !== 'playing' || !this.center) {
      this.tickHost(now);
      for (const p of this.players.values()) p.gpsWeak = !this.trusted(p, now);
      if (this.phase === 'lobby')
        for (const p of [...this.players.values()]) if (!p.bot && !p.connected && now - (p.disconnectedAt ?? now) > 90_000) this.removePlayer(p.id);
      return;
    }

    const t = clamp((now - (this.startsAt ?? now)) / ((this.endsAt ?? now) - (this.startsAt ?? now) || 1), 0, 1);
    for (const p of this.players.values()) p.gpsWeak = !this.trusted(p, now);
    this.tickHost(now);
    this.tickLevel(t);

    this.tickBots(dt, now);
    this.spawnStrikes(now, t);
    this.warnEntering(now);
    this.resolveStrikes(now);
    this.tickOrbs(now);
    this.tickRevive(dt, now);
    this.tickBounds(now);

    // one point per second standing, on a fix we trust
    for (const p of this.players.values()) if (!p.bot && p.status === 'alive' && !p.oob && p.lat != null && this.trusted(p, now)) p.score += dt / 1000;

    // Active roster: bots, connected humans, and humans gone for under 4 minutes
    const active = [...this.players.values()].filter((p) => p.bot || p.connected || now - (p.disconnectedAt ?? now) < 240_000);
    const everyoneDown = active.length > 0 && active.every((p) => p.status === 'downed');
    const anyoneUp = active.some((p) => !p.bot && p.status === 'alive' && p.connected && now - p.lastFixAt < 30_000 && p.acc <= WEAK_ACC_M);
    if (everyoneDown && this.humans().length > 0) this.finish(now, 'lost');
    else if (this.endsAt && now >= this.endsAt) this.finish(now, anyoneUp ? 'won' : 'lost');
  }

  private tickLevel(t: number) {
    const lv = Room.levelAt(t);
    if (lv <= this.level) return;
    this.level = lv;
    this.peakLevel = Math.max(this.peakLevel, lv);
    this.log(`Storm level ${lv}`, 'level');
    for (const p of this.players.values()) this.emit(p.id, { kind: 'level', level: lv });
  }

  /** Hand the host role to a connected human if the host has been gone for 45 s. */
  private tickHost(now: number) {
    const host = this.players.get(this.hostId);
    if (host && (host.connected || now - (host.disconnectedAt ?? now) < 45_000)) return;
    const next = this.humans().find((p) => p.connected);
    if (next && next.id !== this.hostId) {
      this.hostId = next.id;
      this.log(`${next.name} is now the host`, 'host');
    }
  }

  private alive(): Player[] {
    return [...this.players.values()].filter((p) => p.status === 'alive' && p.lat != null);
  }

  private spawnStrikes(now: number, t: number) {
    if (now < this.nextStrikeAt) return;
    // one hazard at a time per player: only target players not already inside a pending zone
    const targets = this.alive().filter((p) => !this.strikes.some((s) => distanceM({ lat: p.lat!, lng: p.lng! }, s) < s.r + 6));
    const quick = this.settings.quick;
    this.nextStrikeAt = now + lerp(quick ? 5000 : 7000, quick ? 3000 : 3800, t) * rand(0.8, 1.2);
    if (!targets.length) return;
    const humanTargets = targets.filter((p) => !p.bot && this.trusted(p, now));
    const firstOfGame = this.strikes.length === 0 && now - (this.startsAt ?? now) < 6000;
    const pool = quick && firstOfGame && humanTargets.length ? humanTargets : targets;
    const target = pool[Math.floor(Math.random() * pool.length)];
    const mega = now >= this.nextMegaAt;
    if (mega) this.nextMegaAt = now + (quick ? rand(20_000, 30_000) : rand(35_000, 50_000));
    const r = mega ? rand(20, 24) : rand(9, 12 + 3 * t);
    const off = rand(0, r * 0.6);
    const ang = rand(0, Math.PI * 2);
    let pos = offsetM({ lat: target.lat!, lng: target.lng! }, Math.cos(ang) * off, Math.sin(ang) * off);
    const loc = toLocal(this.center!, pos);
    const dc = Math.hypot(loc.x, loc.y);
    const maxC = this.settings.radiusM - r * 0.5;
    if (dc > maxC) pos = offsetM(this.center!, (loc.x / dc) * maxC, (loc.y / dc) * maxC);
    if (this.strikes.some((o) => distanceM(o, pos) < o.r + r)) return; // never overlap zones: each keeps a walkable exit
    // Warning time comes from whoever is worst placed, not just the target.
    const zone = { lat: pos.lat, lng: pos.lng, r };
    const need = this.alive()
      .filter((p) => distanceM(pos, { lat: p.lat!, lng: p.lng! }) < r + 3)
      .map((p) => escapeExit(zone, { lat: p.lat!, lng: p.lng! }, this.center, this.settings.radiusM).m);
    const warnMs = Math.max(walkMs(Math.max(3, ...need), mega), mega ? 11_000 : 6_000);
    if (this.endsAt && now + warnMs > this.endsAt - 500) return; // would land after the storm passes
    const s: StrikeView = { id: rid(6), lat: pos.lat, lng: pos.lng, r, warnAt: now, hitAt: now + warnMs, kind: mega ? 'mega' : 'strike' };
    this.strikes.push(s);
    if (mega) this.log('Supercell forming', 'mega');
    this.warnPlayersFor(s, now);
  }

  private escapeFor(p: Player, s: StrikeView) {
    const here = { lat: p.lat!, lng: p.lng! };
    const e = escapeExit(s, here, this.center, this.settings.radiusM);
    return { dir: compass(e.deg), m: e.m, d: distanceM(here, s) };
  }

  private warnPlayersFor(s: StrikeView, now: number) {
    for (const p of this.alive()) {
      if (!p.bot && !p.connected) continue; // they'll get it from state on reconnect
      const { dir, m, d } = this.escapeFor(p, s);
      if (d < s.r + 3 && !p.warned.has(s.id)) {
        p.warned.add(s.id);
        p.warnedAt[s.id] = now;
        p.warnedNeed[s.id] = walkMs(m, s.kind === 'mega'); // same walking pace + reaction time as the strike's own warning
        this.emit(p.id, { kind: 'warn', strikeId: s.id, inSec: Math.max(1, Math.round((s.hitAt - now) / 1000)), moveDir: dir, moveM: m, mega: s.kind === 'mega' });
      }
    }
  }

  private warnEntering(now: number) {
    for (const s of this.strikes) if (s.hitAt - now > 2000) this.warnPlayersFor(s, now);
  }

  private resolveStrikes(now: number) {
    const due = this.strikes.filter((s) => now >= s.hitAt);
    if (!due.length) return;
    this.strikes = this.strikes.filter((s) => now < s.hitAt);
    for (const s of due) {
      for (const p of this.alive()) {
        const d = distanceM({ lat: p.lat!, lng: p.lng! }, s);
        const trusted = this.trusted(p, now);
        // Only penalise when the fix is fresh and decent, and the player is clearly inside even allowing for GPS error,
        // and only if they were warned early enough to walk out (covers reconnecting inside a zone).
        const warnedFor = p.warnedAt[s.id] != null ? now - p.warnedAt[s.id] : 0;
        const need = Math.max(2500, p.warnedNeed[s.id] ?? Infinity);
        if (trusted && warnedFor >= need && d + p.acc * 0.5 <= s.r) {
          p.hp -= s.kind === 'mega' ? 2 : 1;
          p.hits++;
          if (p.hp <= 0) this.down(p);
          else this.emit(p.id, { kind: 'hit', hp: p.hp });
        } else if (trusted && p.warned.has(s.id) && d > s.r) {
          p.dodges++;
          p.score += s.kind === 'mega' ? 25 : 10;
          this.emit(p.id, { kind: 'dodge', points: s.kind === 'mega' ? 25 : 10 });
        }
        p.warned.delete(s.id);
        delete p.warnedAt[s.id];
        delete p.warnedNeed[s.id];
      }
    }
  }

  private down(p: Player) {
    p.hp = 0;
    p.status = 'downed';
    p.reviveProgress = 0;
    this.emit(p.id, { kind: 'downed' });
    this.log(`${p.name} is down. Walk to them to revive`, 'downed');
    for (const o of this.alive()) {
      if (o.id === p.id) continue;
      const from = { lat: o.lat!, lng: o.lng! };
      const to = { lat: p.lat!, lng: p.lng! };
      this.emit(o.id, { kind: 'teammateDown', name: p.name, dir: compass(bearingDeg(from, to)), m: Math.round(distanceM(from, to)) });
    }
  }

  private tickOrbs(now: number) {
    this.orbs = this.orbs.filter((o) => o.expiresAt > now);
    const want = Math.min(6, 2 + Math.ceil(this.alive().length * 0.5));
    let guard = 0;
    while (this.orbs.length < want && guard++ < 10) {
      const R = this.settings.radiusM * 0.8;
      const a = rand(0, Math.PI * 2);
      const rr = Math.sqrt(Math.random()) * R;
      const pos = offsetM(this.center!, Math.cos(a) * rr, Math.sin(a) * rr);
      if (this.alive().some((p) => distanceM({ lat: p.lat!, lng: p.lng! }, pos) < 15)) continue;
      const kit = Math.random() < 0.12; // mostly probes; kits are a rare heal
      this.orbs.push({ id: rid(6), lat: pos.lat, lng: pos.lng, kind: kit ? 'kit' : 'probe', expiresAt: now + rand(60_000, 90_000) });
    }
    for (const p of this.alive()) {
      if (!this.trusted(p, now)) continue;
      for (const o of [...this.orbs]) {
        if (distanceM({ lat: p.lat!, lng: p.lng! }, o) <= ORB_R + Math.min(p.acc, 15) * 0.5) {
          this.orbs = this.orbs.filter((x) => x.id !== o.id);
          p.orbs++;
          let pts = 25;
          if (o.kind === 'kit') {
            if (p.hp < p.maxHp) {
              p.hp++;
              pts = 5;
            } else pts = 15;
          }
          p.score += pts;
          this.emit(p.id, { kind: 'orb', orb: o.kind, points: pts });
        }
      }
    }
  }

  private tickRevive(dt: number, now: number) {
    const alive = this.alive();
    for (const p of this.players.values()) {
      if (p.status !== 'downed' || p.lat == null) continue;
      const reachable = p.bot || (p.connected && now - p.lastFixAt < 20_000 && p.acc <= WEAK_ACC_M && now - p.jumpAt > 5000);
      const helper = reachable && alive.find((o) => o.id !== p.id && this.trusted(o, now) && distanceM({ lat: o.lat!, lng: o.lng! }, { lat: p.lat!, lng: p.lng! }) <= REVIVE_R + Math.min(o.acc, 15) * 0.5);
      if (helper) {
        p.reviveProgress = Math.min(1, p.reviveProgress + dt / REVIVE_MS);
        if (p.reviveProgress >= 1) this.revive(p, helper);
      } else p.reviveProgress = Math.max(0, p.reviveProgress - dt / (REVIVE_MS * 2));
    }
  }

  private revive(p: Player, helper: Player) {
    p.status = 'alive';
    p.hp = 1;
    p.reviveProgress = 0;
    helper.revives++;
    helper.score += 40;
    this.emit(p.id, { kind: 'revived', by: helper.name });
    this.emit(helper.id, { kind: 'revivedOther', name: p.name });
    this.log(`${helper.name} revived ${p.name}`, 'revive');
  }

  private tickBounds(now: number) {
    for (const p of this.players.values()) {
      if (p.lat == null || !this.center) continue;
      const d = distanceM(this.center, { lat: p.lat, lng: p.lng! });
      p.oob = d > this.settings.radiusM + 10;
      if (p.oob && now - p.lastOobWarn > 15000) {
        p.lastOobWarn = now;
        this.emit(p.id, { kind: 'oob', dir: compass(bearingDeg({ lat: p.lat, lng: p.lng! }, this.center)), m: Math.round(d - this.settings.radiusM) });
      }
    }
  }

  private finish(now: number, outcome: 'won' | 'lost') {
    this.phase = 'ended';
    this.finishedAt = now;
    this.outcome = outcome;
    this.strikes = [];
    this.orbs = [];
    this.computeResults(now);
    this.log(outcome === 'won' ? 'The storm passed. You made it.' : 'The storm took everyone.', 'end');
    for (const p of this.players.values()) this.emit(p.id, { kind: 'end' });
  }

  computeResults(now: number) {
    const ps = [...this.players.values()];
    const ranking = ps.map((p) => ({ id: p.id, name: p.name, color: p.color, score: Math.round(p.score), survived: p.status === 'alive' })).sort((a, b) => b.score - a.score);
    const humans = ps.filter((p) => !p.bot);
    const base = humans.length ? humans : ps;
    const sum = (f: (p: Player) => number) => base.reduce((s, p) => s + f(p), 0);
    const awards: Results['awards'] = [];
    const top = (f: (p: Player) => number, title: string, detail: (p: Player) => string) => {
      const best = [...base].sort((a, b) => f(b) - f(a))[0];
      if (best && f(best) > 0) awards.push({ title, playerName: best.name, detail: detail(best) });
    };
    top((p) => p.dodges, 'Untouchable', (p) => `${p.dodges} dodge${p.dodges === 1 ? '' : 's'}`);
    top((p) => p.revives, 'Lifeline', (p) => `${p.revives} revive${p.revives === 1 ? '' : 's'}`);
    top((p) => p.distanceM, 'Most ground', (p) => `~${Math.round(p.distanceM)} m on foot`);
    top((p) => p.orbs, 'Collector', (p) => `${p.orbs} pickup${p.orbs === 1 ? '' : 's'}`);
    this.results = {
      ranking,
      team: {
        distanceM: Math.round(sum((p) => p.distanceM)),
        activeMin: Math.round(sum((p) => p.movingSec) / 60),
        dodges: sum((p) => p.dodges),
        hits: sum((p) => p.hits),
        revives: sum((p) => p.revives),
        durationSec: Math.round(((this.finishedAt ?? now) - (this.startsAt ?? now)) / 1000),
        peakLevel: this.peakLevel,
        simulated: humans.some((p) => p.sim),
      },
      awards,
    };
  }

  // ---------- bots ----------
  private tickBots(dt: number, now: number) {
    if (!this.center) return;
    for (const b of this.players.values()) {
      if (!b.bot || b.lat == null || b.status === 'downed') continue;
      const here = { lat: b.lat, lng: b.lng! };
      let dx = 0;
      let dy = 0;
      let speed = b.speed ?? 1.5;
      const danger = this.strikes.find((s) => now - s.warnAt > (b.reactMs ?? 1000) && distanceM(here, s) < s.r + 3);
      const downed = [...this.players.values()].find((p) => p.status === 'downed' && p.lat != null);
      const orb = [...this.orbs].sort((a, c) => distanceM(here, a) - distanceM(here, c))[0];
      const toward = (to: LatLng) => {
        const v = toLocal(here, to);
        const n = Math.hypot(v.x, v.y);
        if (n > 3) {
          dx = v.x / n;
          dy = v.y / n;
        }
      };
      if (danger) {
        const v = toLocal(danger, here);
        const n = Math.hypot(v.x, v.y) || 1;
        dx = v.x / n;
        dy = v.y / n;
        speed *= 1.3;
      } else if (downed) toward({ lat: downed.lat!, lng: downed.lng! });
      else if (orb) toward(orb);
      else {
        b.heading = (b.heading ?? 0) + rand(-20, 20);
        dx = Math.sin(((b.heading ?? 0) * Math.PI) / 180) * 0.5;
        dy = Math.cos(((b.heading ?? 0) * Math.PI) / 180) * 0.5;
      }
      const c = toLocal(this.center, here);
      const cn = Math.hypot(c.x, c.y);
      if (cn > this.settings.radiusM * 0.85) {
        dx = -c.x / cn;
        dy = -c.y / cn;
      }
      const step = (speed * dt) / 1000;
      const np = offsetM(here, dx * step, dy * step);
      if (dx || dy) {
        b.distanceM += Math.hypot(dx, dy) * step;
        b.movingSec += dt / 1000;
      }
      b.lat = np.lat;
      b.lng = np.lng;
      b.acc = 5;
      b.lastFixAt = now;
    }
  }

  // ---------- persistence ----------
  snapshot() {
    const { emit, lastTick, ...rest } = this as any;
    void emit;
    void lastTick;
    return {
      ...rest,
      players: [...this.players.values()].map((p) => ({ ...p, warned: [...p.warned] })),
    };
  }

  static restore(o: any, emit: Emit): Room {
    const r = new Room(o.code, emit);
    const { players, ...rest } = o;
    // older snapshots carried photo-game fields: keep only what this game knows
    for (const k of ['prompt', 'nextPromptAt', 'rage', 'boss', 'photos', 'usedPrompts', 'rounds', 'round', 'judging', 'huntMs', 'retryGiven', 'wipeAt']) delete rest[k];
    Object.assign(r, rest);
    r.settings = { durationSec: rest.settings?.durationSec ?? 480, radiusM: rest.settings?.radiusM ?? 120, quick: !!rest.settings?.quick };
    const t = Date.now();
    r.players = new Map(
      (players as any[]).map(({ photos, pocketMs, pocketOn, dropped, ...p }) => {
        void [photos, pocketMs, pocketOn, dropped];
        return [p.id, { ...p, warned: new Set(), warnedAt: {}, warnedNeed: {}, connected: !!p.bot, disconnectedAt: p.bot ? null : t }];
      }),
    );
    return r;
  }

  // ---------- view ----------
  log(text: string, kind: string) {
    this.feed.unshift({ id: rid(6), at: Date.now(), text, kind });
    this.feed = this.feed.slice(0, 30);
  }

  /** What the big screen gets: positions rounded to ~5 m, and none before the game starts. */
  spectatorView(): RoomView {
    const v = this.view();
    const r5 = (x: number | null) => (x == null ? null : Math.round(x / 0.00005) * 0.00005);
    if (this.phase === 'lobby') v.center = null;
    v.players = v.players.map((p) => (this.phase === 'lobby' ? { ...p, lat: null, lng: null } : { ...p, lat: r5(p.lat), lng: r5(p.lng), acc: 0 }));
    return v;
  }

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      center: this.center,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      now: Date.now(),
      level: this.level,
      players: [...this.players.values()].map(({ secret, warned, warnedAt, warnedNeed, lastFixAt, lastOobWarn, joinedAt, heading, speed, reactMs, disconnectedAt, anchor, jumpStreak, jumpAt, anchorAt, ...v }) => ({
        ...v,
        score: Math.round(v.score),
        distanceM: Math.round(v.distanceM),
      })),
      strikes: this.strikes,
      orbs: this.orbs,
      outcome: this.outcome,
      feed: this.feed.slice(0, 12),
      results: this.results,
    };
  }
}
