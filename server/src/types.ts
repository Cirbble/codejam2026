// Shapes shared with the app. Keep in sync with SPEC.md (the contract).

export type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'one';

export type Card = {
  id: string;
  promptId: string;
  promptText: string;
  label: string;
  title: string;
  tier: Tier;
  points: number;
  rarity: number;
  sameCount: number;
  totalCount: number;
  verdict: string;
  photo: string;
  mode: 'daily' | 'squad';
  day?: string;
  playerName?: string;
  at: number;
  /** Found in a solo run: scored from aiRarity alone, so crowd stats like "Only find" don't apply. */
  solo?: boolean;
  /** Squad cards: the finder's player id in that room. */
  playerId?: string;
  /** Squad reveal/rounds only: names of other squad members who found the same label that round. */
  sameAs?: string[];
};

export type Prompt = { id: string; text: string; examples?: string };

/** Internal prompt record: `cat` keeps a day or a squad game from repeating a category. */
export type PromptDef = Prompt & { cat: string };

/** Ghost race: a Quick play run to race, with when (ms into each round) its find landed and what it scored. */
export type Ghost = { team: string; score: number; splits: ({ ms: number; points: number } | null)[] };

export type Phase ='lobby' | 'countdown' | 'hunting' | 'reveal' | 'ended';

export type RoomView = {
  code: string;
  phase: Phase;
  hostId: string;
  now: number;
  quick: boolean;
  round: number;
  totalRounds: number;
  /** solo run (People's Choice): one player, 3 rounds, auto-start */
  solo: boolean;
  team: string | null;
  /** ended solo room only: the team's leaderboard rank (1-based) and best score after this run; null otherwise */
  boardRank: number | null;
  boardBest: number | null;
  /** ended solo room only: whether this run counted for the team (first 3 per team per phone), and counted runs left on this phone */
  counted: boolean | null;
  runsLeft: number | null;
  /** null in bingo: every square is open at once (see grid) */
  prompt: Prompt | null;
  /** bingo squad: one 3x3 card of prompts against one clock */
  bingo: boolean;
  /** unique only (squad rounds): a find whose label someone else in the squad also found that round scores 0 */
  unique: boolean;
  /**
   * impostor squads only (null otherwise). Built per player: `you` and `crewPrompt` reach only this round's
   * impostor (whose `prompt` is the twin). rounds: per finished round, the result once its vote has closed.
   */
  impostor: {
    you: boolean;
    crewPrompt: Prompt | null;
    voteOpen: boolean;
    voted: string[];
    myVote: string | null;
    minPlayers: number;
    spotBonus: number;
    foolBonus: number;
    rounds: ({ impostorId: string; twin: Prompt; caught: boolean; votes: Record<string, string> } | null)[];
  } | null;
  /** solo only: today's best run to race (same prompts), or null when nobody has played yet today */
  ghost: Ghost | null;
  /** length of a hunt in ms (for the timer bar) */
  huntMs: number;
  /** bingo, after the lobby: the 9 prompts, row by row */
  grid: Prompt[] | null;
  /** bingo, after the lobby: marked promptIds and completed lines per playerId, and who completed a line first */
  bingoBoard: { marks: Record<string, string[]>; lines: Record<string, number>; first: string | null; lineBonus: number; firstBonus: number } | null;
  endsAt: number | null;
  /** reveal only: this reveal's length in ms (6 s + 3 s per card, max 20 s); null otherwise */
  revealMs: number | null;
  players: { id: string; name: string; score: number; connected: boolean; found: boolean }[];
  reveal: Card[] | null;
  rounds: { prompt: Prompt; cards: Card[] }[];
  /** playerId -> id of that player's rarest card in the finished rounds */
  best: Record<string, string>;
  /** per finished round: playerId of the rarest card, null when nobody found anything */
  roundWinners: (string | null)[];
  /** ended only: every playerId tied for the top score; empty when everyone has 0 (and before the end) */
  winners: string[];
};

export type ErrorCode = 'rate' | 'locked' | 'closed' | 'budget' | 'ai_down' | 'bad_request';
export type RejectReason = 'no_match' | 'screen' | 'unclear';

export type FindBody =
  | { accepted: true; card: Card; /** collection sets this find completed */ setsDone?: { id: string; name: string }[] }
  | { accepted: false; reason: RejectReason; verdict: string; triesLeft?: number }
  | { error: ErrorCode; message: string; retryAfterMs?: number };

/** An HTTP reply, stored as-is so a repeated submissionId gets the identical answer. */
export type Reply = { status: number; body: FindBody };

export type ClientMsg =
  | { t: 'create'; name: string; quick?: boolean; device: string; op?: string; solo?: boolean; team?: string }
  | { t: 'join'; code: string; name: string; device: string; op?: string }
  | { t: 'resume'; code: string; playerId: string; secret: string }
  | { t: 'settings'; quick?: boolean; bingo?: boolean; unique?: boolean; impostor?: boolean }
  | { t: 'vote'; target: string }
  | { t: 'start' }
  | { t: 'skip' }
  | { t: 'again' }
  | { t: 'kick'; id: string }
  | { t: 'leave'; code?: string; playerId?: string; secret?: string }
  | { t: 'shooting'; promptId: string };

export type WsErrorCode = 'no_room' | 'full' | 'in_progress' | 'kicked' | 'rate' | 'other';

export type ServerMsg =
  | { t: 'welcome'; playerId: string; secret: string; code: string }
  | { t: 'left' }
  | { t: 'state'; room: RoomView }
  | { t: 'error'; code: WsErrorCode; message: string };
