import { randomBytes } from 'node:crypto';
import type { Card, Phase, Prompt, PromptDef, RejectReason, Reply, RoomView } from './types.js';

export const COUNTDOWN_MS = 3_000;
export const HUNT_MS = 180_000;
export const QUICK_HUNT_MS = 60_000;
/** Reveal: 6 s plus 3 s per card, capped at 20 s. */
export const REVEAL_BASE_MS = 6_000;
export const REVEAL_PER_CARD_MS = 3_000;
export const REVEAL_MAX_MS = 20_000;
export const revealMsFor = (cards: number) => Math.min(REVEAL_MAX_MS, REVEAL_BASE_MS + REVEAL_PER_CARD_MS * cards);
export const TOTAL_ROUNDS = 5;
/** Solo (People's Choice table visit): one player, 3 quick rounds, short reveal, auto-start. */
export const SOLO_ROUNDS = 3;
export const SOLO_REVEAL_MS = 4_000;
export const SOLO_ENDED_TTL_MS = 10 * 60_000;
export type RoomOpts = { solo?: boolean; team?: string | null; onEnd?: (room: Room) => void };
export const MAX_PLAYERS = 12;
export const MAX_TRIES = 6;
export const LOBBY_IDLE_MS = 30 * 60_000;
export const ANY_IDLE_MS = 2 * 3600_000;
export const ENDED_TTL_MS = 3 * 3600_000;
/** A find received before the hunt ended still counts if its verdict lands within this window. */
export const LATE_GRACE_MS = 20_000;
/** Shutter pressed before the deadline ('shooting'): the upload may arrive up to this long after it. */
export const SHOOT_GRACE_MS = 25_000;
/** Only a press this close to the buzzer earns the upload grace (an early press can't buy extra hunting time). */
export const SHOOT_WINDOW_MS = 10_000;
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

/** shot: the upload was announced by a 'shooting' message before the deadline (gets the upload grace). */
type Pending = { submissionId: string; round: number; receivedAt: number; shot?: boolean };

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
  /** length of the current reveal (grows when a late card joins) */
  revealMs: number | null = null;
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
    opts: RoomOpts = {},
  ) {
    this.lastActivity = now();
    this.emptySince = now();
    this.solo = !!opts.solo;
    this.team = opts.solo ? (opts.team ?? null) : null;
    this.onEnd = opts.onEnd;
    if (this.solo) this.quick = true;
  }

  solo: boolean;
  team: string | null;
  private onEnd?: (room: Room) => void;
  /** solo: the run is safely on the leaderboard (set only after the board was written) */
  boardRecorded = false;
  /** solo: unique id of this run, the leaderboard's idempotency key */
  runId: string | null = null;
  private recordRetryAt = 0;
  /** solo, ended: the team's standing right after this run */
  board: { rank: number | null; best: number | null; counted?: boolean; runsLeft?: number } | null = null;

  get totalRounds() {
    return this.solo ? SOLO_ROUNDS : TOTAL_ROUNDS;
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
    if (this.solo) return 'full';
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
    if (byId !== this.hostId || this.phase !== 'lobby' || this.solo) return false;
    if (this.quick !== quick) {
      this.quick = quick;
      this.touch();
    }
    return true;
  }

  start(byId: string): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby' || this.players.size < 1) return false;
    this.prompts = this.pick(this.quick).slice(0, this.totalRounds);
    if (this.prompts.length < this.totalRounds) return false;
    for (const p of this.players.values()) p.score = 0;
    this.rounds = [];
    this.replies.clear();
    if (this.solo) this.runId = `${this.code}-${token(8)}`;
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
    if (byId !== this.hostId || this.phase !== 'ended' || this.solo) return false; // a solo run is one-shot
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

  /** Put the finished solo run on the board; on a save failure, retry from tick() every 5 s. */
  private tryRecord() {
    if (!this.onEnd) return;
    try {
      this.onEnd(this);
      this.boardRecorded = true;
    } catch (e) {
      console.warn('[room] board save failed, will retry', (e as Error).message);
      this.recordRetryAt = this.now() + 5000;
    }
  }

  tick() {
    const now = this.now();
    this.tickHost(now);
    if (this.solo && this.phase === 'ended' && !this.boardRecorded && this.onEnd && now >= this.recordRetryAt) {
      this.tryRecord();
      this.touch();
    }
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
    if (this.phase !== 'reveal' || this.huntEndedAt == null) return false;
    const since = this.now() - this.huntEndedAt;
    for (const p of this.pending.values())
      if (p.round === this.round && p.receivedAt <= this.huntEndedAt && since < (p.shot ? SHOOT_GRACE_MS + LATE_GRACE_MS : LATE_GRACE_MS)) return true;
    // shutter pressed before the buzzer, upload not here yet
    for (const [pid, s] of this.shots)
      if (s.round === this.round && this.shotCounts(s) && !this.found.has(pid) && !this.pending.has(pid) && since < SHOOT_GRACE_MS) return true;
    // an admitted late upload waiting for its retry
    for (const [pid, a] of this.lateAdmit) if (a.round === this.round && !this.found.has(pid) && !this.pending.has(pid) && this.now() <= a.until) return true;
    return false;
  }

  /** A press earns grace only if it came in the last SHOOT_WINDOW_MS before the buzzer. */
  private shotCounts(s: { at: number }): boolean {
    return this.huntEndedAt != null && s.at <= this.huntEndedAt && this.huntEndedAt - s.at <= SHOOT_WINDOW_MS;
  }

  /** WS 'shooting': the player pressed the shutter for this prompt; counts only before the deadline. */
  markShooting(playerId: string, promptId: string): boolean {
    if (this.phase !== 'hunting' || this.prompt?.id !== promptId || !this.players.has(playerId) || this.found.has(playerId)) return false;
    this.shots.set(playerId, { round: this.round, at: this.now() }); // latest press wins
    return true;
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

  /** The find whose settle() triggered the current early reveal (so a failed save can roll it back). */
  private earlyEnd: { key: string; round: number; huntEndsAt: number | null } | null = null;

  /** playerId -> shutter press during the current hunt */
  shots = new Map<string, { round: number; at: number }>();
  /** playerId -> the late upload a press admitted; survives a transient refusal until the grace deadline */
  lateAdmit = new Map<string, { submissionId: string; hash?: string; round: number; shotAt: number; until: number }>();

  private toHunting() {
    this.earlyEnd = null;
    this.shots.clear();
    this.lateAdmit.clear();
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
    this.revealMs = this.solo ? SOLO_REVEAL_MS : revealMsFor(this.found.size);
    this.endsAt = this.now() + this.revealMs;
    this.rounds.push({ prompt: this.prompts[this.round - 1], cards: [] });
    this.syncRoundCards();
    // the round's points land at the reveal, so totals during the hunt never hint at anyone's tier
    for (const [pid, c] of this.found) {
      const p = this.players.get(pid);
      if (p) p.score += c.points;
    }
    this.touch();
  }

  private afterReveal() {
    if (this.round >= this.totalRounds) {
      this.phase = 'ended';
      this.endsAt = null;
      this.endedAt = this.now();
      this.found.clear();
      if (this.solo && !this.boardRecorded) this.tryRecord();
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
  precheck(playerId: string, submissionId: string, imageHash?: string): Precheck {
    const prior = this.replies.get(`${playerId}:${submissionId}`);
    if (prior) return { kind: 'prior', reply: prior };
    if (!this.players.has(playerId)) return { kind: 'error', reply: err(403, 'bad_request', 'Join the squad first.') };
    const shot = this.shots.get(playerId);
    const shotGrace = this.phase === 'reveal' && shot?.round === this.round && this.shotCounts(shot) && this.now() - this.huntEndedAt! <= SHOOT_GRACE_MS;
    // a press is used up by the next upload: during the hunt (it needs no grace) or as the one late upload it allows
    if (this.phase === 'hunting' || shotGrace) this.shots.delete(playerId);
    // a late upload already admitted, then refused for a transient reason (rate, busy, AI down): its retry gets back in
    const admit = this.lateAdmit.get(playerId);
    const readmit =
      !shotGrace && this.phase === 'reveal' && admit != null && admit.round === this.round && admit.submissionId === submissionId && (!admit.hash || admit.hash === imageHash) && this.now() <= admit.until;
    if (this.phase !== 'hunting' && !shotGrace && !readmit) return { kind: 'error', reply: err(409, 'closed', 'This prompt is closed.') };
    if (shotGrace) this.lateAdmit.set(playerId, { submissionId, hash: imageHash, round: this.round, shotAt: shot!.at, until: this.huntEndedAt! + SHOOT_GRACE_MS });
    if (this.found.has(playerId)) return { kind: 'error', reply: err(409, 'locked', 'You already locked a find this round.') };
    if ((this.tries.get(playerId) ?? 0) >= MAX_TRIES) return { kind: 'error', reply: err(409, 'locked', 'No tries left this round.') };
    if (this.pending.has(playerId)) return { kind: 'error', reply: { status: 429, body: { error: 'rate', message: 'One photo at a time.', retryAfterMs: 2000 } } };
    // a late upload announced before the buzzer counts as received at the shutter press
    const receivedAt = shotGrace ? shot!.at : readmit ? admit!.shotAt : this.now();
    this.pending.set(playerId, { submissionId, round: this.round, receivedAt, shot: shotGrace || readmit });
    return { kind: 'ok', round: this.round, prompt: this.prompts[this.round - 1], receivedAt };
  }

  /** Take back an accepted find whose save failed after settle(): the same submission can be sent again. */
  unsettle(playerId: string, submissionId: string, card: Card) {
    const key = `${playerId}:${submissionId}`;
    if (this.found.get(playerId)?.id !== card.id) return;
    const early = this.earlyEnd;
    if (early && early.key === key && this.phase === 'reveal' && this.round === early.round) {
      // this find triggered the early reveal: roll the transition back so "Send again" lands in an open hunt
      for (const [pid, c] of this.found) {
        const pl = this.players.get(pid);
        if (pl) pl.score = Math.max(0, pl.score - c.points);
      }
      this.rounds.pop();
      this.phase = 'hunting';
      this.endsAt = early.huntEndsAt;
      this.huntEndedAt = null;
      this.revealMs = null;
      this.earlyEnd = null;
      this.replies.delete(key);
      this.found.delete(playerId);
      this.tries.set(playerId, Math.max(0, (this.tries.get(playerId) ?? 1) - 1));
      this.touch();
      return;
    }
    this.replies.delete(key);
    this.found.delete(playerId);
    this.tries.set(playerId, Math.max(0, (this.tries.get(playerId) ?? 1) - 1));
    const p = this.players.get(playerId);
    if (p && this.phase !== 'hunting') p.score = Math.max(0, p.score - card.points); // points were applied at the reveal
    if (this.phase === 'reveal') this.syncRoundCards();
    this.touch();
  }

  /**
   * Startup reconciliation: a squad/solo card was committed but the crash came before the room snapshot.
   * Credit it if its round is still open; otherwise return false so the caller frees the photo for a retry.
   */
  restoreCredit(playerId: string, submissionId: string, round: number, card: Card): boolean {
    const key = `${playerId}:${submissionId}`;
    if (this.found.get(playerId)?.id === card.id || this.replies.has(key)) return true; // already credited
    if (this.phase !== 'hunting' || this.round !== round || !this.players.has(playerId) || this.found.has(playerId)) return false;
    this.found.set(playerId, card);
    this.tries.set(playerId, (this.tries.get(playerId) ?? 0) + 1);
    this.replies.set(key, { status: 200, body: { accepted: true, card } });
    this.touch();
    this.checkEarlyEnd();
    return true;
  }

  triesLeft(playerId: string) {
    return Math.max(0, MAX_TRIES - (this.tries.get(playerId) ?? 0));
  }

  /** AI unavailable: no try used, nothing stored. */
  abort(playerId: string, submissionId: string) {
    this.shots.delete(playerId);
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
    if (pend?.shot) {
      this.shots.delete(playerId); // the announced upload has landed
      if (this.lateAdmit.get(playerId)?.submissionId === submissionId) this.lateAdmit.delete(playerId);
    }
    const grace = pend?.shot ? SHOOT_GRACE_MS + LATE_GRACE_MS : LATE_GRACE_MS;
    const inTime = this.phase === 'hunting' || (pend != null && this.huntEndedAt != null && pend.receivedAt <= this.huntEndedAt && this.now() - this.huntEndedAt < grace);
    if (!sameRound || !inTime) return save(err(409, 'closed', 'Time ran out on that prompt.'));
    const tries = (this.tries.get(playerId) ?? 0) + 1;
    this.tries.set(playerId, tries);
    if (!outcome.accepted) return save({ status: 200, body: { accepted: false, reason: outcome.reason, verdict: outcome.verdict, triesLeft: Math.max(0, MAX_TRIES - tries) } });
    if (this.found.has(playerId)) return save(err(409, 'locked', 'You already locked a find this round.'));
    let card: Card;
    try {
      card = mint();
    } catch (e) {
      this.tries.set(playerId, tries - 1); // not saved: the same submission can be sent again
      throw e;
    }
    this.found.set(playerId, card);
    if (this.phase === 'reveal') p.score += card.points; // a late card after the reveal started
    const reply = save({ status: 200, body: { accepted: true, card } });
    if (this.phase === 'reveal') {
      this.syncRoundCards();
      this.revealMs = this.solo ? SOLO_REVEAL_MS : revealMsFor(this.found.size);
      this.endsAt = Math.max(this.endsAt ?? 0, (this.huntEndedAt ?? this.now()) + this.revealMs, this.now() + LATE_SHOW_MS);
    } else {
      const huntEndsAt = this.endsAt;
      this.checkEarlyEnd();
      if ((this.phase as Phase) === 'reveal') this.earlyEnd = { key, round: this.round, huntEndsAt };
    }
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
      totalRounds: this.totalRounds,
      solo: this.solo,
      team: this.team,
      boardRank: this.solo && this.phase === 'ended' ? (this.board?.rank ?? null) : null,
      boardBest: this.solo && this.phase === 'ended' ? (this.board?.best ?? null) : null,
      counted: this.solo && this.phase === 'ended' ? (this.board?.counted ?? null) : null,
      runsLeft: this.solo && this.phase === 'ended' ? (this.board?.runsLeft ?? null) : null,
      prompt: publicPrompt(this.prompt),
      endsAt: this.endsAt,
      revealMs: this.phase === 'reveal' ? this.revealMs : null,
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
        if (!b || rank(c, b) < 0) best[c.playerId] = c;
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
    return this.phase === 'ended' && this.endedAt != null && now - this.endedAt > (this.solo ? SOLO_ENDED_TTL_MS : ENDED_TTL_MS);
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
      revealMs: this.revealMs,
      players: [...this.players.values()],
      found: [...this.found],
      tries: [...this.tries],
      shots: [...this.shots],
      rounds: this.rounds,
      replies: [...this.replies],
      lastActivity: this.lastActivity,
      emptySince: this.emptySince,
      endedAt: this.endedAt,
      solo: this.solo,
      team: this.team,
      boardRecorded: this.boardRecorded,
      board: this.board,
      runId: this.runId,
    };
  }

  /** Restore after a redeploy. Timers are paused for the downtime so nobody loses hunting time. */
  static restore(s: ReturnType<Room['snapshot']>, now: Clock = Date.now, pick?: PickPrompts, onEnd?: (room: Room) => void): Room {
    const r = new Room(s.code, s.quick, now, pick, { solo: !!s.solo, team: s.team ?? null, onEnd });
    r.boardRecorded = !!s.boardRecorded;
    r.runId = s.runId ?? null;
    r.board = s.board ?? null;
    const down = Math.max(0, now() - (s.savedAt ?? now()));
    r.phase = s.phase;
    r.hostId = s.hostId;
    r.round = s.round;
    r.prompts = s.prompts;
    r.endsAt = s.endsAt == null ? null : s.endsAt + down;
    r.huntEndedAt = s.huntEndedAt == null ? null : s.huntEndedAt + down;
    r.revealMs = s.revealMs ?? null;
    for (const p of s.players) r.players.set(p.id, { ...p, connected: false, awaySince: now() });
    r.found = new Map(s.found);
    r.tries = new Map(s.tries);
    r.shots = new Map(s.shots ?? []);
    r.rounds = s.rounds;
    r.replies = new Map(s.replies);
    r.lastActivity = s.lastActivity;
    r.emptySince = now();
    r.endedAt = s.endedAt;
    return r;
  }
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort(rank);
}

/** Points first (a 100-point One of One beats an 85-point Epic), then rarity, then the earlier find. */
export function rank(a: Card, b: Card): number {
  return b.points - a.points || b.rarity - a.rarity || a.at - b.at;
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
