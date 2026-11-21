import { randomBytes } from 'node:crypto';
import { twinFor } from './prompts.js';
import type { Card, Ghost, Phase, Prompt, PromptDef, RejectReason, Reply, RoomView } from './types.js';

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
export type RoomOpts = { solo?: boolean; team?: string | null; bingo?: boolean; unique?: boolean; impostor?: boolean; rand?: () => number; ghost?: Ghost | null; onEnd?: (room: Room) => void };
/** Impostor: at least this many players to start; vote length; result screen; bonuses. */
export const IMPOSTOR_MIN_PLAYERS = 3;
export const IMPOSTOR_VOTE_MS = 45_000;
export const IMPOSTOR_RESULT_MS = 10_000;
export const IMPOSTOR_SPOT_BONUS = 50;
export const IMPOSTOR_FOOL_BONUS = 100;
/** Bingo (squad option): one 3x3 card of prompts, hunted all at once against one clock. */
export const BINGO_SIZE = 3;
export const BINGO_HUNT_MS = 5 * 60_000;
export const BINGO_QUICK_HUNT_MS = 3 * 60_000;
export const BINGO_REVEAL_MS = 8_000;
/** Each completed row, column or diagonal; plus a bonus for the first player to complete any line. */
export const BINGO_LINE_BONUS = 50;
export const BINGO_FIRST_BONUS = 100;
/** Every row, column and diagonal of the grid, as cell indexes. */
export const BINGO_LINES: number[][] = (() => {
  const n = BINGO_SIZE;
  const idx = [...Array(n).keys()];
  return [...idx.map((r) => idx.map((c) => r * n + c)), ...idx.map((c) => idx.map((r) => r * n + c)), idx.map((i) => i * n + i), idx.map((i) => i * n + (n - 1 - i))];
})();
export const MAX_PLAYERS = 12;
export const MAX_TRIES = 6;
export const LOBBY_IDLE_MS = 30 * 60_000;
export const ANY_IDLE_MS = 2 * 3600_000;
export const ENDED_TTL_MS = 3 * 3600_000;
/** A find received before the hunt ended still counts if its verdict lands within this window. */
export const LATE_GRACE_MS = 20_000;
/** Shutter pressed before the deadline ('shooting'): the upload may arrive up to this long after it. */
export const SHOOT_GRACE_MS = 25_000;
/** A late card that lands during the reveal stays on screen at least this long. */
export const LATE_SHOW_MS = 4_000;
/** The host role passes to a connected player after this long away (lobby and ended only). */
export const HOST_GRACE_MS = 30_000;

export type Clock = () => number;
/** twinsOnly: impostor games draw only prompts that have a twin. */
export type PickPrompts = (quick: boolean, count: number, twinsOnly?: boolean) => PromptDef[];

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
type Pending = { submissionId: string; round: number; receivedAt: number; shot?: boolean; promptId?: string };

/** Live bingo standing for one player: marked squares, completed lines and when the first line was completed. */
export type BingoStanding = { marks: string[]; scoring: string[]; lines: number; firstLineAt: number | null };

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
  /** current round: slot -> locked card (slot = playerId; in bingo, `${playerId}|${promptId}`) */
  found = new Map<string, Card>();
  /** current round: slot -> judged tries */
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
    this.bingo = !opts.solo && !!opts.bingo;
    this.unique = !opts.solo && !this.bingo && !!opts.unique;
    this.impostor = !opts.solo && !this.bingo && !this.unique && !!opts.impostor;
    if (opts.rand) this.rand = opts.rand;
    this.ghost = this.solo ? (opts.ghost ?? null) : null;
    this.onEnd = opts.onEnd;
    if (this.solo) this.quick = true;
  }

  solo: boolean;
  bingo: boolean;
  /** Unique only (squad rounds): a find scores only if nobody else in the squad found the same label that round. */
  unique: boolean;
  /** Impostor (squad rounds): one player per round hunts a twin prompt; the squad votes on who it was. */
  impostor: boolean;
  /** impostor: per round, the impostor's playerId */
  impostors: (string | null)[] = [];
  /** impostor: per round, voter -> suspect */
  votes: Record<string, string>[] = [];
  /** impostor: the current reveal is still taking votes */
  voteOpen = false;
  /** solo: the run being raced (fixed when the run is created) */
  ghost: Ghost | null;
  /** per round: when its hunt started (for ghost splits) */
  huntStarts: number[] = [];

  /** Solo: when each round's find landed (ms into the hunt, capped at its length) and its points; null for a miss. */
  splits(): Ghost['splits'] {
    return this.rounds.map((r, i) => {
      const c = r.cards[0];
      const start = this.huntStarts[i];
      if (!c || start == null) return null;
      return { ms: Math.max(0, Math.min(this.huntMs, c.at - start)), points: c.points };
    });
  }
  private rand: () => number = Math.random;
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
    return this.solo ? SOLO_ROUNDS : this.bingo ? 1 : TOTAL_ROUNDS;
  }

  /** Prompts drawn at the start: one per round, or the whole bingo grid. */
  get promptCount() {
    return this.bingo ? BINGO_SIZE * BINGO_SIZE : this.totalRounds;
  }

  get huntMs() {
    if (this.bingo) return this.quick ? BINGO_QUICK_HUNT_MS : BINGO_HUNT_MS;
    return this.quick ? QUICK_HUNT_MS : HUNT_MS;
  }

  /** Key for a player's find: one per round, or one per grid square in bingo. */
  slot(playerId: string, promptId?: string) {
    return this.bingo ? `${playerId}|${promptId ?? ''}` : playerId;
  }

  /** The prompt a find is for: the round's prompt, or (bingo) the named square, if it is on the grid. */
  private promptFor(promptId?: string, playerId?: string): PromptDef | undefined {
    if (!this.bingo) {
      const base = this.prompts[this.round - 1];
      // impostor: this round's impostor hunts the twin
      if (base && playerId && this.impostor && this.impostors[this.round - 1] === playerId) return twinFor(base.id) ?? base;
      return base;
    }
    return promptId ? this.prompts.find((p) => p.id === promptId) : undefined;
  }

  private dropFinds(playerId: string) {
    for (const k of [...this.found.keys()]) if (k === playerId || k.startsWith(`${playerId}|`)) this.found.delete(k);
  }

  /** A player's bingo card right now: which squares are marked, how many lines, when the first line closed. */
  bingoStanding(playerId: string): BingoStanding {
    const cells = this.prompts.map((p) => this.found.get(this.slot(playerId, p.id)));
    let lines = 0;
    let firstLineAt: number | null = null;
    const onLine = new Set<number>();
    for (const line of BINGO_LINES) {
      const cs = line.map((i) => cells[i]);
      if (!cs.every(Boolean)) continue;
      lines++;
      line.forEach((i) => onLine.add(i));
      const at = Math.max(...cs.map((c) => c!.at));
      if (firstLineAt == null || at < firstLineAt) firstLineAt = at;
    }
    return {
      marks: this.prompts.filter((_, i) => cells[i]).map((p) => p.id),
      scoring: this.prompts.filter((_, i) => onLine.has(i)).map((p) => p.id),
      lines,
      firstLineAt,
    };
  }

  /** The player who completed a line first (ties go to the earlier joiner), or null. */
  firstBingo(): string | null {
    let best: { id: string; at: number; joined: number } | null = null;
    for (const p of this.players.values()) {
      const at = this.bingoStanding(p.id).firstLineAt;
      if (at == null) continue;
      if (!best || at < best.at || (at === best.at && p.joinedAt < best.joined)) best = { id: p.id, at, joined: p.joinedAt };
    }
    return best?.id ?? null;
  }

  /**
   * Bingo totals: a square's points count only if it sits on a completed line (once, however many lines it is on),
   * plus the line bonuses and the first-bingo bonus. Squares off every line score nothing.
   */
  private scoreBingo() {
    const first = this.firstBingo();
    for (const p of this.players.values()) {
      const st = this.bingoStanding(p.id);
      let pts = 0;
      for (const id of st.scoring) pts += this.found.get(this.slot(p.id, id))?.points ?? 0;
      p.score = pts + st.lines * BINGO_LINE_BONUS + (first === p.id ? BINGO_FIRST_BONUS : 0);
    }
  }

  private touch() {
    this.version++;
    this.lastActivity = this.now();
  }

  get prompt(): PromptDef | null {
    if (this.bingo) return null; // bingo hunts the whole grid at once (view.grid)
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
    this.dropFinds(id);
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
  /** Bingo, Unique only and Impostor are separate modes: turning one on turns the others off. */
  private setMode(byId: string, mode: 'bingo' | 'unique' | 'impostor', on: boolean): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby' || this.solo) return false;
    const before = `${this.bingo}${this.unique}${this.impostor}`;
    if (on) this.bingo = this.unique = this.impostor = false;
    this[mode] = on;
    if (`${this.bingo}${this.unique}${this.impostor}` !== before) this.touch();
    return true;
  }
  setBingo(byId: string, on: boolean) {
    return this.setMode(byId, 'bingo', on);
  }
  setUnique(byId: string, on: boolean) {
    return this.setMode(byId, 'unique', on);
  }
  setImpostor(byId: string, on: boolean) {
    return this.setMode(byId, 'impostor', on);
  }

  // ---------------- impostor ----------------
  /** The impostor for the current round (picked when its hunt starts). */
  get impostorId(): string | null {
    return this.impostor ? (this.impostors[this.round - 1] ?? null) : null;
  }

  /** The prompt this player hunts this round: the twin for the impostor, the round's prompt for everyone else. */
  promptOf(playerId: string): PromptDef | null {
    const p = this.prompt;
    if (!p) return null;
    return this.impostorId === playerId ? (twinFor(p.id) ?? p) : p;
  }

  /** Pick this round's impostor at random, avoiding last round's when possible. */
  private pickImpostor() {
    const ids = [...this.players.keys()];
    const last = this.impostors[this.round - 2];
    const pool = ids.length > 1 ? ids.filter((id) => id !== last) : ids;
    this.impostors[this.round - 1] = pool[Math.floor(this.rand() * pool.length)] ?? null;
  }

  /** WS 'vote': during the vote, name who you think the impostor is (not yourself). Changing your vote is fine. */
  vote(playerId: string, target: string): boolean {
    if (!this.impostor || this.phase !== 'reveal' || !this.voteOpen) return false;
    if (!this.players.has(playerId) || !this.players.has(target) || target === playerId) return false;
    (this.votes[this.round - 1] ??= {})[playerId] = target;
    this.touch();
    const connected = [...this.players.values()].filter((p) => p.connected);
    const votes = this.votes[this.round - 1];
    if (connected.length > 0 && connected.every((p) => votes[p.id])) this.closeVote();
    return true;
  }

  /** End the vote: points land, the impostor is named, and a short result screen runs before the next round. */
  private closeVote() {
    if (!this.voteOpen) return;
    this.voteOpen = false;
    this.scoreImpostor();
    this.endsAt = this.now() + IMPOSTOR_RESULT_MS;
    this.touch();
  }

  /** Who got the most votes in a round's vote (ties: null), and whether that was the impostor. */
  impostorResult(i: number): { impostor: string | null; caught: boolean; votes: Record<string, string> } {
    const imp = this.impostors[i] ?? null;
    const votes = this.votes[i] ?? {};
    const tally = new Map<string, number>();
    for (const t of Object.values(votes)) tally.set(t, (tally.get(t) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    const leaders = [...tally].filter(([, n]) => n === top).map(([id]) => id);
    // caught: the impostor alone got the most votes
    return { impostor: imp, caught: top > 0 && leaders.length === 1 && leaders[0] === imp, votes };
  }

  /** Impostor totals: finds from rounds whose vote is over, +50 per correct vote, +100 to an impostor who got away. */
  private scoreImpostor() {
    for (const p of this.players.values()) p.score = 0;
    const add = (id: string | null | undefined, n: number) => {
      const p = id ? this.players.get(id) : undefined;
      if (p) p.score += n;
    };
    this.rounds.forEach((r, i) => {
      if (i === this.round - 1 && this.phase === 'reveal' && this.voteOpen) return; // still voting
      for (const c of r.cards) add(c.playerId, c.points);
      const res = this.impostorResult(i);
      if (!res.impostor) return;
      for (const [voter, target] of Object.entries(res.votes)) if (target === res.impostor && voter !== res.impostor) add(voter, IMPOSTOR_SPOT_BONUS);
      if (!res.caught) add(res.impostor, IMPOSTOR_FOOL_BONUS);
    });
  }

  /** Unique only: a card scores if no other card in its round has the same label. */
  private counts(card: Card, round: Card[]): boolean {
    return !this.unique || !round.some((o) => o !== card && o.label === card.label);
  }

  /** Unique only: totals from the finished rounds (a late duplicate can take points back from an earlier card). */
  private scoreUnique() {
    for (const p of this.players.values()) p.score = 0;
    for (const r of this.rounds)
      for (const c of r.cards) {
        const p = c.playerId ? this.players.get(c.playerId) : undefined;
        if (p && this.counts(c, r.cards)) p.score += c.points;
      }
  }

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
    if (this.impostor && this.players.size < IMPOSTOR_MIN_PLAYERS) return false;
    this.prompts = this.pick(this.quick, this.promptCount, this.impostor).slice(0, this.promptCount);
    if (this.prompts.length < this.promptCount) return false;
    if (this.impostor && !this.prompts.every((p) => twinFor(p.id))) return false;
    for (const p of this.players.values()) p.score = 0;
    this.rounds = [];
    this.impostors = [];
    this.votes = [];
    this.voteOpen = false;
    this.huntStarts = [];
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
    else if (this.phase === 'reveal' && this.voteOpen) this.closeVote();
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
    this.impostors = [];
    this.votes = [];
    this.voteOpen = false;
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
      } else if (this.voteOpen) this.closeVote();
      else this.afterReveal();
    }
  }

  /** In-flight finds for the revealed round, received before the hunt ended, still within the grace window. */
  latePending(): boolean {
    if (this.phase !== 'reveal' || this.huntEndedAt == null) return false;
    const since = this.now() - this.huntEndedAt;
    for (const p of this.pending.values())
      if (p.round === this.round && p.receivedAt <= this.huntEndedAt && since < (p.shot ? SHOOT_GRACE_MS + LATE_GRACE_MS : LATE_GRACE_MS)) return true;
    // shutter pressed before the buzzer, upload not here yet
    for (const [pid, s] of this.shots) if (s.round === this.round && !this.found.has(this.slot(pid, s.promptId)) &&!this.pending.has(pid) && since < SHOOT_GRACE_MS) return true;
    return false;
  }

  /** WS 'shooting': the player pressed the shutter for this prompt; counts only before the deadline. */
  markShooting(playerId: string, promptId: string): boolean {
    if (this.phase !== 'hunting' || !promptId || this.promptFor(promptId, playerId)?.id !== promptId ||!this.players.has(playerId) || this.found.has(this.slot(playerId, promptId))) return false;
    // bingo: the latest shutter press names the square the upload is for
    const prev = this.shots.get(playerId);
    if (!prev || (this.bingo && prev.promptId !== promptId)) this.shots.set(playerId, { round: this.round, at: this.now(), promptId });
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
  shots = new Map<string, { round: number; at: number; promptId?: string }>();

  private toHunting() {
    this.earlyEnd = null;
    this.shots.clear();
    this.phase = 'hunting';
    this.found.clear();
    this.tries.clear();
    this.huntEndedAt = null;
    this.endsAt = this.now() + this.huntMs;
    this.huntStarts[this.round - 1] = this.now();
    this.voteOpen = false;
    if (this.impostor) this.pickImpostor();
    this.touch();
  }

  private toReveal() {
    this.phase = 'reveal';
    this.huntEndedAt = this.now();
    this.revealMs = this.solo ? SOLO_REVEAL_MS : this.bingo ? BINGO_REVEAL_MS : revealMsFor(this.found.size);
    this.endsAt = this.now() + this.revealMs;
    if (this.bingo) {
      // one finished "round" per square, so the results list every square's cards
      this.rounds = this.prompts.map((prompt) => ({ prompt, cards: [] }));
      this.syncRoundCards();
      this.scoreBingo();
      this.touch();
      return;
    }
    this.rounds.push({ prompt: this.prompts[this.round - 1], cards: [] });
    this.syncRoundCards();
    if (this.unique) {
      this.scoreUnique();
      this.touch();
      return;
    }
    if (this.impostor) {
      // the reveal starts as a vote; the round's points land when it closes
      this.voteOpen = true;
      this.revealMs = IMPOSTOR_VOTE_MS;
      this.endsAt = this.now() + IMPOSTOR_VOTE_MS;
      this.votes[this.round - 1] ??= {};
      this.touch();
      return;
    }
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
      if (!this.bingo) this.found.clear(); // bingo keeps its card for the results grid (again() clears it)
      if (this.solo && !this.boardRecorded) this.tryRecord();
      this.touch();
      return;
    }
    this.round++;
    this.toHunting();
  }

  private syncRoundCards() {
    if (this.bingo) {
      for (const r of this.rounds) r.cards = sortCards([...this.found.values()].filter((c) => c.promptId === r.prompt.id));
      return;
    }
    const r = this.rounds[this.round - 1];
    if (r) r.cards = sortCards([...this.found.values()]);
  }

  private checkEarlyEnd() {
    if (this.phase !== 'hunting') return;
    // every joined player counts until the deadline or an explicit leave (a pocketed phone is still playing)
    const all = [...this.players.values()];
    const done = (id: string) => (this.bingo ? this.prompts.every((q) => this.found.has(this.slot(id, q.id))) : this.found.has(id));
    if (all.length > 0 && all.every((p) => done(p.id))) this.toReveal();
  }

  // ---------------- finds ----------------
  /** Gate a find before any AI spend. On 'ok' the caller must call settle() or abort(). */
  /** promptId: required in bingo (the square the photo is for); ignored otherwise. */
  precheck(playerId: string, submissionId: string, promptId?: string): Precheck {
    const prior = this.replies.get(`${playerId}:${submissionId}`);
    if (prior) return { kind: 'prior', reply: prior };
    if (!this.players.has(playerId)) return { kind: 'error', reply: err(403, 'bad_request', 'Join the squad first.') };
    const shot = this.shots.get(playerId);
    const shotGrace =
      this.phase === 'reveal' &&
      shot?.round === this.round &&
      (!this.bingo || shot.promptId === promptId) &&
      this.huntEndedAt != null &&
      shot.at <= this.huntEndedAt &&
      this.now() - this.huntEndedAt <= SHOOT_GRACE_MS;
    if (this.phase !== 'hunting' && !shotGrace) return { kind: 'error', reply: err(409, 'closed', 'This prompt is closed.') };
    const prompt = this.promptFor(promptId, playerId);
    if (!prompt) return { kind: 'error', reply: err(409, 'closed', 'That prompt is not on the card.') };
    const slot = this.slot(playerId, prompt.id);
    const unit = this.bingo ? 'square' : 'round';
    if (this.found.has(slot)) return { kind: 'error', reply: err(409, 'locked', `You already locked a find this ${unit}.`) };
    if ((this.tries.get(slot) ?? 0) >= MAX_TRIES) return { kind: 'error', reply: err(409, 'locked', `No tries left this ${unit}.`) };
    if (this.pending.has(playerId)) return { kind: 'error', reply: { status: 429, body: { error: 'rate', message: 'One photo at a time.', retryAfterMs: 2000 } } };
    // a late upload announced before the buzzer counts as received at the shutter press
    const receivedAt = shotGrace ? shot!.at : this.now();
    this.pending.set(playerId, { submissionId, round: this.round, receivedAt, shot: shotGrace, promptId: prompt.id });
    return { kind: 'ok', round: this.round, prompt, receivedAt };
  }

  /** Take back an accepted find whose save failed after settle(): the same submission can be sent again. */
  unsettle(playerId: string, submissionId: string, card: Card) {
    const key = `${playerId}:${submissionId}`;
    const slot = this.slot(playerId, card.promptId);
    if (this.found.get(slot)?.id !== card.id) return;
    const early = this.earlyEnd;
    if (early && early.key === key && this.phase === 'reveal' && this.round === early.round) {
      // this find triggered the early reveal: roll the transition back so "Send again" lands in an open hunt
      if (this.bingo) {
        for (const pl of this.players.values()) pl.score = 0; // bingo has one round: totals were all from this reveal
        this.rounds = [];
      } else if (this.unique) {
        this.rounds.pop();
        this.scoreUnique();
      } else if (this.impostor) {
        this.rounds.pop();
        this.voteOpen = false;
        this.votes[this.round - 1] = {};
        this.scoreImpostor();
      } else {
        for (const [pid, c] of this.found) {
          const pl = this.players.get(pid);
          if (pl) pl.score = Math.max(0, pl.score - c.points);
        }
        this.rounds.pop();
      }
      this.phase = 'hunting';
      this.endsAt = early.huntEndsAt;
      this.huntEndedAt = null;
      this.revealMs = null;
      this.earlyEnd = null;
      this.replies.delete(key);
      this.found.delete(slot);
      this.tries.set(slot, Math.max(0, (this.tries.get(slot) ?? 1) - 1));
      this.touch();
      return;
    }
    this.replies.delete(key);
    this.found.delete(slot);
    this.tries.set(slot, Math.max(0, (this.tries.get(slot) ?? 1) - 1));
    const p = this.players.get(playerId);
    if (this.bingo) {
      if (this.phase !== 'hunting') this.scoreBingo(); // a lost square can also undo a line
    } else if (this.unique || this.impostor) {
      // recomputed below, once the card is out of the round
    } else if (p && this.phase !== 'hunting') p.score = Math.max(0, p.score - card.points); // points were applied at the reveal
    if (this.phase === 'reveal') this.syncRoundCards();
    if (this.unique && this.phase !== 'hunting') this.scoreUnique();
    if (this.impostor && this.phase !== 'hunting') this.scoreImpostor();
    this.touch();
  }

  /**
   * Startup reconciliation: a squad/solo card was committed but the crash came before the room snapshot.
   * Credit it if its round is still open; otherwise return false so the caller frees the photo for a retry.
   */
  restoreCredit(playerId: string, submissionId: string, round: number, card: Card): boolean {
    const key = `${playerId}:${submissionId}`;
    const slot = this.slot(playerId, card.promptId);
    if (this.found.get(slot)?.id === card.id || this.replies.has(key)) return true; // already credited
    if (this.phase !== 'hunting' || this.round !== round || !this.players.has(playerId) || this.found.has(slot) || !this.promptFor(card.promptId)) return false;
    this.found.set(slot, card);
    this.tries.set(slot, (this.tries.get(slot) ?? 0) + 1);
    this.replies.set(key, { status: 200, body: { accepted: true, card } });
    this.touch();
    this.checkEarlyEnd();
    return true;
  }

  triesLeft(playerId: string, promptId?: string) {
    return Math.max(0, MAX_TRIES - (this.tries.get(this.slot(playerId, promptId)) ?? 0));
  }

  /** AI unavailable: no try used, nothing stored. */
  abort(playerId: string, submissionId: string) {
    if (this.pending.get(playerId)?.submissionId === submissionId) this.pending.delete(playerId);
  }

  /** Record a judged find. mint() is called only when the card will actually be kept. promptId: the bingo square. */
  settle(playerId: string, submissionId: string, round: number, outcome: Outcome, mint: () => Card, promptId?: string): Reply {
    const key = `${playerId}:${submissionId}`;
    const prior = this.replies.get(key);
    if (prior) return prior;
    const pend = this.pending.get(playerId);
    if (pend?.submissionId === submissionId) this.pending.delete(playerId);
    const slot = this.slot(playerId, promptId ?? pend?.promptId);
    const unit = this.bingo ? 'square' : 'round';
    const p = this.players.get(playerId);
    const save = (r: Reply) => {
      this.replies.set(key, r);
      this.touch();
      return r;
    };
    if (!p) return err(403, 'bad_request', 'You left the squad.');
    const sameRound = this.round === round && (this.phase === 'hunting' || this.phase === 'reveal');
    if (pend?.shot) this.shots.delete(playerId); // the announced upload has landed
    const grace = pend?.shot ? SHOOT_GRACE_MS + LATE_GRACE_MS : LATE_GRACE_MS;
    const inTime = this.phase === 'hunting' || (pend != null && this.huntEndedAt != null && pend.receivedAt <= this.huntEndedAt && this.now() - this.huntEndedAt < grace);
    if (!sameRound || !inTime) return save(err(409, 'closed', 'Time ran out on that prompt.'));
    if (this.bingo && !this.promptFor(promptId ?? pend?.promptId)) return save(err(409, 'closed', 'That prompt is not on the card.'));
    const tries = (this.tries.get(slot) ?? 0) + 1;
    this.tries.set(slot, tries);
    if (!outcome.accepted) return save({ status: 200, body: { accepted: false, reason: outcome.reason, verdict: outcome.verdict, triesLeft: Math.max(0, MAX_TRIES - tries) } });
    if (this.found.has(slot)) return save(err(409, 'locked', `You already locked a find this ${unit}.`));
    let card: Card;
    try {
      card = mint();
    } catch (e) {
      this.tries.set(slot, tries - 1); // not saved: the same submission can be sent again
      throw e;
    }
    this.found.set(slot, card);
    if (this.phase === 'reveal') {
      // a late card after the reveal started
      if (this.bingo) this.scoreBingo();
      else if (!this.unique && !this.impostor) p.score += card.points;
    }
    const reply = save({ status: 200, body: { accepted: true, card } });
    if (this.phase === 'reveal') {
      this.syncRoundCards();
      if (this.unique) this.scoreUnique(); // the late card may also cancel someone else's
      if (this.impostor && !this.voteOpen) this.scoreImpostor();
      this.revealMs = this.solo ? SOLO_REVEAL_MS : this.bingo ? BINGO_REVEAL_MS : this.impostor ? IMPOSTOR_VOTE_MS : revealMsFor(this.found.size);
      // impostor: the vote keeps its own deadline and the result screen its 10 s; the late card just shows a moment
      const floor = this.impostor ? 0 : (this.huntEndedAt ?? this.now()) + this.revealMs;
      this.endsAt = Math.max(this.endsAt ?? 0, floor, this.now() + LATE_SHOW_MS);
    } else {
      const huntEndsAt = this.endsAt;
      this.checkEarlyEnd();
      if ((this.phase as Phase) === 'reveal') this.earlyEnd = { key, round: this.round, huntEndsAt };
    }
    return reply;
  }

  // ---------------- view ----------------
  /**
   * me: the player this view is for. Impostor views differ per player (the impostor sees their twin prompt), so the
   * server builds one per connection in impostor games.
   */
  view(me?: string): RoomView {
    // impostor vote: the round's cards all wear the real prompt, without the judge's line or counts, so the
    // impostor's card doesn't give itself away
    const voting = this.impostor && this.phase === 'reveal' && this.voteOpen;
    const base = this.prompts[this.round - 1];
    const mask = (cards: Card[]) => (voting && base ? cards.map((c) => ({ ...c, promptId: base.id, promptText: base.text, verdict: '', sameCount: 1, totalCount: 1 })) : cards);
    const roundCards = (r: { cards: Card[] }, i: number) => (i === this.round - 1 ? mask(r.cards) : r.cards);
    const reveal =
      this.phase !== 'reveal' ? null : this.bingo ? sortCards(this.rounds.flatMap((r) => withSameAs(r.cards))) : withSameAs(mask(this.rounds[this.round - 1]?.cards ?? []));
    const inGame = this.phase !== 'lobby' && this.phase !== 'ended';
    const showGrid = this.bingo && this.phase !== 'lobby';
    const standings = showGrid ? new Map([...this.players.keys()].map((id) => [id, this.bingoStanding(id)])) : null;
    const size = BINGO_SIZE * BINGO_SIZE;
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
      prompt: publicPrompt(me && this.impostor ? this.promptOf(me) : this.prompt),
      bingo: this.bingo,
      unique: this.unique,
      impostor: this.impostor ? this.impostorView(me) : null,
      ghost: this.solo ? this.ghost : null,
      huntMs: this.huntMs,
      // squares only: which ones each player has marked and lines, never the cards (no tier hints mid-hunt)
      grid: showGrid ? this.prompts.map((p) => publicPrompt(p)!) : null,
      bingoBoard: standings
        ? {
            marks: Object.fromEntries([...standings].map(([id, s]) => [id, s.marks])),
            lines: Object.fromEntries([...standings].map(([id, s]) => [id, s.lines])),
            first: this.firstBingo(),
            lineBonus: BINGO_LINE_BONUS,
            firstBonus: BINGO_FIRST_BONUS,
          }
        : null,
      endsAt: this.endsAt,
      revealMs: this.phase === 'reveal' ? this.revealMs : null,
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        // bingo: found = the whole card is marked
        .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, found: inGame && (standings ? standings.get(p.id)!.marks.length === size : this.found.has(p.id)) })),
      reveal,
      rounds: this.rounds.map((r, i) => ({ prompt: publicPrompt(r.prompt)!, cards: withSameAs(roundCards(r, i)) })),
      ...this.results(),
    };
  }

  /** What one player may know about the impostor game right now. */
  private impostorView(me?: string): NonNullable<RoomView['impostor']> {
    const inRound = this.phase === 'countdown' || this.phase === 'hunting' || this.phase === 'reveal';
    const you = !!me && inRound && this.phase !== 'countdown' && this.impostorId === me;
    const base = this.prompts[this.round - 1];
    const votes = this.votes[this.round - 1] ?? {};
    const closed = (i: number) => i < this.rounds.length && !(i === this.round - 1 && this.phase === 'reveal' && this.voteOpen);
    return {
      you,
      // the impostor also sees the real prompt, so they can try to blend in
      crewPrompt: you && base ? publicPrompt(base) : null,
      voteOpen: this.phase === 'reveal' && this.voteOpen,
      voted: this.phase === 'reveal' ? Object.keys(votes) : [],
      myVote: me ? (votes[me] ?? null) : null,
      minPlayers: IMPOSTOR_MIN_PLAYERS,
      spotBonus: IMPOSTOR_SPOT_BONUS,
      foolBonus: IMPOSTOR_FOOL_BONUS,
      // finished votes only: who it was, their prompt, the votes and whether they were caught
      rounds: this.rounds.map((r, i) => {
        if (!closed(i)) return null;
        const res = this.impostorResult(i);
        const twin = twinFor(r.prompt.id);
        return res.impostor && twin ? { impostorId: res.impostor, twin: publicPrompt(twin)!, caught: res.caught, votes: res.votes } : null;
      }),
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
      // unique only: the best card that scored (duplicates win nothing)
      roundWinners: this.rounds.map((r) => sortCards(r.cards.filter((c) => this.counts(c, r.cards)))[0]?.playerId ?? null),
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
      bingo: this.bingo,
      unique: this.unique,
      impostor: this.impostor,
      impostors: this.impostors,
      votes: this.votes,
      voteOpen: this.voteOpen,
      ghost: this.ghost,
      huntStarts: this.huntStarts,
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
    const r = new Room(s.code, s.quick, now, pick, { solo: !!s.solo, team: s.team ?? null, bingo: !!s.bingo, unique: !!s.unique, impostor: !!s.impostor, ghost: s.ghost ?? null, onEnd });
    r.huntStarts = s.huntStarts ?? [];
    r.impostors = s.impostors ?? [];
    r.votes = s.votes ?? [];
    r.voteOpen = !!s.voteOpen;
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
