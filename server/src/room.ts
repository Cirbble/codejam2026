import { randomBytes } from 'node:crypto';
import type { Card, Phase, Prompt, PromptDef, RejectReason, Reply, RoomView } from './types.js';

export const COUNTDOWN_MS = 3_000;
export const HUNT_MS = 180_000;
export const QUICK_HUNT_MS = 60_000;
export const REVEAL_MS = 8_000;
export const TOTAL_ROUNDS = 5;
export const MAX_PLAYERS = 12;
export const MAX_TRIES = 6;
export const LOBBY_IDLE_MS = 30 * 60_000;
export const ANY_IDLE_MS = 2 * 3600_000;
export const ENDED_TTL_MS = 3 * 3600_000;
/** A find received before the hunt ended still counts if its verdict lands within this window. */
export const LATE_GRACE_MS = 20_000;
/** A late card that lands during the reveal stays on screen at least this long. */
export const LATE_SHOW_MS = 4_000;
/** The host role passes to a connected player after this long away (lobby and ended only). */
export const HOST_GRACE_MS = 30_000;

export type Clock = () => number;
export type PickPrompts = (quick: boolean) => PromptDef[];

export type Player = {
  id: string;
  secret: string;
  name: string;
  device: string;
  score: number;
  connected: boolean;
  joinedAt: number;
  awaySince?: number | null;
};

type Pending = { submissionId: string; round: number; receivedAt: number };

export type Precheck =
  | { kind: 'prior'; reply: Reply }
  | { kind: 'error'; reply: Reply }
  | { kind: 'ok'; round: number; prompt: PromptDef; receivedAt: number };

export type Outcome = { accepted: true } | { accepted: false; reason: RejectReason; verdict: string };

const err = (status: number, error: any, message: string): Reply => ({ status, body: { error, message } });
const token = (n: number) => randomBytes(n).toString('hex');

export class Room {
  phase: Phase = 'lobby';
  hostId = '';
  round = 0;
  prompts: PromptDef[] = [];
  endsAt: number | null = null;
  huntEndedAt: number | null = null;
  players = new Map<string, Player>();
  /** current round: playerId -> locked card */
  found = new Map<string, Card>();
  /** current round: playerId -> judged tries */
  tries = new Map<string, number>();
  rounds: { prompt: PromptDef; cards: Card[] }[] = [];
  /** `${playerId}:${submissionId}` -> reply, for the whole game */
  replies = new Map<string, Reply>();
  pending = new Map<string, Pending>();
  lastActivity: number;
  emptySince: number | null = null;
  endedAt: number | null = null;
  /** bumps on every visible change, so the server only broadcasts when needed */
  version = 0;

  constructor(
    public code: string,
    public quick: boolean,
    private now: Clock = Date.now,
    private pick: PickPrompts = () => [],
  ) {
    this.lastActivity = now();
    this.emptySince = now();
  }

  private touch() {
    this.version++;
    this.lastActivity = this.now();
  }

  get prompt(): PromptDef | null {
    return this.round > 0 && this.phase !== 'lobby' && this.phase !== 'ended' ? (this.prompts[this.round - 1] ?? null) : null;
  }

  // ---------------- players ----------------
  addPlayer(name: string, device: string): Player {
    const p: Player = { id: token(8), secret: token(16), name: cleanName(name), device, score: 0, connected: true, joinedAt: this.now() };
    this.players.set(p.id, p);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = p.id;
    this.emptySince = null;
    this.touch();
    return p;
  }

  canJoin(): 'ok' | 'in_progress' | 'full' {
    if (this.phase !== 'lobby') return 'in_progress';
    if (this.players.size >= MAX_PLAYERS) return 'full';
    return 'ok';
  }

  auth(playerId: string, secret: string): Player | undefined {
    const p = this.players.get(String(playerId));
    return p && typeof secret === 'string' && p.secret === secret ? p : undefined;
  }

  setConnected(id: string, on: boolean) {
    const p = this.players.get(id);
    if (!p || p.connected === on) return;
    p.connected = on;
    p.awaySince = on ? null : this.now();
    this.emptySince = this.connectedCount() === 0 ? this.now() : null;
    this.touch();
  }

  connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  removePlayer(id: string) {
    if (!this.players.delete(id)) return;
    this.found.delete(id);
    this.pending.delete(id);
    if (this.hostId === id) {
      const next = [...this.players.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt)[0];
      this.hostId = next?.id ?? '';
    }
    if (this.connectedCount() === 0) this.emptySince ??= this.now();
    this.touch();
    this.checkEarlyEnd();
  }

  kick(byId: string, id: string): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby' || id === byId || !this.players.has(id)) return false;
    this.removePlayer(id);
    return true;
  }

  // ---------------- flow ----------------
  setQuick(byId: string, quick: boolean): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby') return false;
    if (this.quick !== quick) {
      this.quick = quick;
      this.touch();
    }
    return true;
  }

  start(byId: string): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby' || this.players.size < 1) return false;
    this.prompts = this.pick(this.quick).slice(0, TOTAL_ROUNDS);
    if (this.prompts.length < TOTAL_ROUNDS) return false;
    for (const p of this.players.values()) p.score = 0;
    this.rounds = [];
    this.replies.clear();
    this.round = 1;
    this.found.clear();
    this.tries.clear();
    this.phase = 'countdown';
    this.endsAt = this.now() + COUNTDOWN_MS;
    this.endedAt = null;
    this.touch();
    return true;
  }

  skip(byId: string): boolean {
    if (byId !== this.hostId) return false;
    if (this.phase === 'hunting') this.toReveal();
    else if (this.phase === 'reveal') {
      if (this.latePending()) {
        this.endsAt = this.now(); // move on as soon as the in-flight verdicts land
        this.touch();
      } else this.afterReveal();
    } else if (this.phase === 'countdown') this.toHunting();
    else return false;
    return true;
  }

  again(byId: string): boolean {
    if (byId !== this.hostId || this.phase !== 'ended') return false;
    this.phase = 'lobby';
    this.round = 0;
    this.prompts = [];
    this.endsAt = null;
    this.rounds = [];
    this.found.clear();
    this.tries.clear();
    this.replies.clear();
    this.pending.clear();
    for (const p of this.players.values()) p.score = 0;
    this.touch();
    return true;
  }

  tick() {
    const now = this.now();
    this.tickHost(now);
    if (this.endsAt == null || now < this.endsAt) return;
    if (this.phase === 'countdown') this.toHunting();
    else if (this.phase === 'hunting') this.toReveal();
    else if (this.phase === 'reveal') {
      if (this.latePending()) {
        this.endsAt = now + 1000; // hold while a photo sent before the deadline is still being judged
        this.touch();
      } else this.afterReveal();
    }
  }

  /** In-flight finds for the revealed round, received before the hunt ended, still within the grace window. */
  latePending(): boolean {
    if (this.phase !== 'reveal' || this.huntEndedAt == null || this.now() - this.huntEndedAt >= LATE_GRACE_MS) return false;
    for (const p of this.pending.values()) if (p.round === this.round && p.receivedAt <= this.huntEndedAt) return true;
    return false;
  }

  private tickHost(now: number) {
    if (this.phase !== 'lobby' && this.phase !== 'ended') return;
    const host = this.players.get(this.hostId);
    if (!host || host.connected || now - (host.awaySince ?? now) < HOST_GRACE_MS) return;
    const next = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) return;
    this.hostId = next.id;
    this.touch();
  }

  private toHunting() {
    this.phase = 'hunting';
    this.found.clear();
    this.tries.clear();
    this.huntEndedAt = null;
    this.endsAt = this.now() + (this.quick ? QUICK_HUNT_MS : HUNT_MS);
    this.touch();
  }

  private toReveal() {
    this.phase = 'reveal';
    this.huntEndedAt = this.now();
    this.endsAt = this.now() + REVEAL_MS;
    this.rounds.push({ prompt: this.prompts[this.round - 1], cards: [] });
    this.syncRoundCards();
    this.touch();
  }

  private afterReveal() {
    if (this.round >= TOTAL_ROUNDS) {
      this.phase = 'ended';
      this.endsAt = null;
      this.endedAt = this.now();
      this.found.clear();
      this.touch();
      return;
    }
    this.round++;
    this.toHunting();
  }

  private syncRoundCards() {
    const r = this.rounds[this.round - 1];
    if (r) r.cards = sortCards([...this.found.values()]);
  }

  private checkEarlyEnd() {
    if (this.phase !== 'hunting') return;
    // every joined player counts until the deadline or an explicit leave (a pocketed phone is still playing)
    const all = [...this.players.values()];
    if (all.length > 0 && all.every((p) => this.found.has(p.id))) this.toReveal();
  }

  // ---------------- finds ----------------
  /** Gate a find before any AI spend. On 'ok' the caller must call settle() or abort(). */
  precheck(playerId: string, submissionId: string): Precheck {
    const prior = this.replies.get(`${playerId}:${submissionId}`);
    if (prior) return { kind: 'prior', reply: prior };
    if (!this.players.has(playerId)) return { kind: 'error', reply: err(403, 'bad_request', 'Join the squad first.') };
    if (this.phase !== 'hunting') return { kind: 'error', reply: err(409, 'closed', 'This prompt is closed.') };
    if (this.found.has(playerId)) return { kind: 'error', reply: err(409, 'locked', 'You already locked a find this round.') };
    if ((this.tries.get(playerId) ?? 0) >= MAX_TRIES) return { kind: 'error', reply: err(409, 'locked', 'No tries left this round.') };
    if (this.pending.has(playerId)) return { kind: 'error', reply: { status: 429, body: { error: 'rate', message: 'One photo at a time.', retryAfterMs: 2000 } } };
    const receivedAt = this.now();
    this.pending.set(playerId, { submissionId, round: this.round, receivedAt });
    return { kind: 'ok', round: this.round, prompt: this.prompts[this.round - 1], receivedAt };
  }

  /** AI unavailable: no try used, nothing stored. */
  abort(playerId: string, submissionId: string) {
    if (this.pending.get(playerId)?.submissionId === submissionId) this.pending.delete(playerId);
  }

  /** Record a judged find. mint() is called only when the card will actually be kept. */
  settle(playerId: string, submissionId: string, round: number, outcome: Outcome, mint: () => Card): Reply {
    const key = `${playerId}:${submissionId}`;
    const prior = this.replies.get(key);
    if (prior) return prior;
    const pend = this.pending.get(playerId);
    if (pend?.submissionId === submissionId) this.pending.delete(playerId);
    const p = this.players.get(playerId);
    const save = (r: Reply) => {
      this.replies.set(key, r);
      this.touch();
      return r;
    };
    if (!p) return err(403, 'bad_request', 'You left the squad.');
    const sameRound = this.round === round && (this.phase === 'hunting' || this.phase === 'reveal');
    const inTime = this.phase === 'hunting' || (pend != null && this.huntEndedAt != null && pend.receivedAt <= this.huntEndedAt && this.now() - this.huntEndedAt < LATE_GRACE_MS);
    if (!sameRound || !inTime) return save(err(409, 'closed', 'Time ran out on that prompt.'));
    const tries = (this.tries.get(playerId) ?? 0) + 1;
    this.tries.set(playerId, tries);
    if (!outcome.accepted) return save({ status: 200, body: { accepted: false, reason: outcome.reason, verdict: outcome.verdict, triesLeft: Math.max(0, MAX_TRIES - tries) } });
    if (this.found.has(playerId)) return save(err(409, 'locked', 'You already locked a find this round.'));
    const card = mint();
    this.found.set(playerId, card);
    p.score += card.points;
    const reply = save({ status: 200, body: { accepted: true, card } });
    if (this.phase === 'reveal') {
      this.syncRoundCards();
      this.endsAt = Math.max(this.endsAt ?? 0, this.now() + LATE_SHOW_MS);
    } else this.checkEarlyEnd();
    return reply;
  }

  // ---------------- view ----------------
  view(): RoomView {
    const reveal = this.phase === 'reveal' ? withSameAs(this.rounds[this.round - 1]?.cards ?? []) : null;
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      now: this.now(),
      quick: this.quick,
      round: this.phase === 'lobby' ? 0 : this.round,
      totalRounds: TOTAL_ROUNDS,
      prompt: publicPrompt(this.prompt),
      endsAt: this.endsAt,
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, found: this.phase !== 'lobby' && this.phase !== 'ended' && this.found.has(p.id) })),
      reveal,
      rounds: this.rounds.map((r) => ({ prompt: publicPrompt(r.prompt)!, cards: withSameAs(r.cards) })),
      ...this.results(),
    };
  }

  /** Best card per player and the winner of each finished round (rarest card; ties go to the earlier find). */
  results(): { best: Record<string, string>; roundWinners: (string | null)[]; winners: string[] } {
    const best: Record<string, Card> = {};
    for (const r of this.rounds)
      for (const c of r.cards) {
        if (!c.playerId) continue;
        const b = best[c.playerId];
        if (!b || c.rarity > b.rarity || (c.rarity === b.rarity && c.points > b.points)) best[c.playerId] = c;
      }
    return {
      best: Object.fromEntries(Object.entries(best).map(([pid, c]) => [pid, c.id])),
      roundWinners: this.rounds.map((r) => sortCards(r.cards)[0]?.playerId ?? null),
      winners: this.winners(),
    };
  }

  winners(): string[] {
    if (this.phase !== 'ended') return [];
    const top = Math.max(0, ...[...this.players.values()].map((p) => p.score));
    if (top <= 0) return [];
    return [...this.players.values()].filter((p) => p.score === top).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.id);
  }

  expired(): boolean {
    const now = this.now();
    if (this.emptySince != null) {
      if (this.phase === 'lobby' && now - this.emptySince > LOBBY_IDLE_MS) return true;
      if (now - this.emptySince > ANY_IDLE_MS) return true;
    }
    return this.phase === 'ended' && this.endedAt != null && now - this.endedAt > ENDED_TTL_MS;
  }

  // ---------------- persistence ----------------
  snapshot() {
    return {
      v: 1,
      savedAt: this.now(),
      code: this.code,
      quick: this.quick,
      phase: this.phase,
      hostId: this.hostId,
      round: this.round,
      prompts: this.prompts,
      endsAt: this.endsAt,
      huntEndedAt: this.huntEndedAt,
      players: [...this.players.values()],
      found: [...this.found],
      tries: [...this.tries],
      rounds: this.rounds,
      replies: [...this.replies],
      lastActivity: this.lastActivity,
      emptySince: this.emptySince,
      endedAt: this.endedAt,
    };
  }

  /** Restore after a redeploy. Timers are paused for the downtime so nobody loses hunting time. */
  static restore(s: ReturnType<Room['snapshot']>, now: Clock = Date.now, pick?: PickPrompts): Room {
    const r = new Room(s.code, s.quick, now, pick);
    const down = Math.max(0, now() - (s.savedAt ?? now()));
    r.phase = s.phase;
    r.hostId = s.hostId;
    r.round = s.round;
    r.prompts = s.prompts;
    r.endsAt = s.endsAt == null ? null : s.endsAt + down;
    r.huntEndedAt = s.huntEndedAt == null ? null : s.huntEndedAt + down;
    for (const p of s.players) r.players.set(p.id, { ...p, connected: false, awaySince: now() });
    r.found = new Map(s.found);
    r.tries = new Map(s.tries);
    r.rounds = s.rounds;
    r.replies = new Map(s.replies);
    r.lastActivity = s.lastActivity;
    r.emptySince = now();
    r.endedAt = s.endedAt;
    return r;
  }
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.rarity - a.rarity || b.points - a.points || a.at - b.at);
}

function withSameAs(cards: Card[]): Card[] {
  return cards.map((c) => {
    const same = cards.filter((o) => o !== c && o.label === c.label).map((o) => o.playerName ?? '');
    return same.length ? { ...c, sameAs: same } : c;
  });
}

function publicPrompt(p: PromptDef | null): Prompt | null {
  return p ? { id: p.id, text: p.text, examples: p.examples } : null;
}

export function cleanName(name: unknown): string {
  const s = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return s || 'Player';
}
