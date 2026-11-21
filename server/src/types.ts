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

export type Phase = 'lobby' | 'countdown' | 'hunting' | 'reveal' | 'ended';

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
  prompt: Prompt | null;
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
  | { accepted: true; card: Card }
  | { accepted: false; reason: RejectReason; verdict: string; triesLeft?: number }
  | { error: ErrorCode; message: string; retryAfterMs?: number };

/** An HTTP reply, stored as-is so a repeated submissionId gets the identical answer. */
export type Reply = { status: number; body: FindBody };

export type ClientMsg =
  | { t: 'create'; name: string; quick?: boolean; device: string; op?: string; solo?: boolean; team?: string }
  | { t: 'join'; code: string; name: string; device: string; op?: string }
  | { t: 'resume'; code: string; playerId: string; secret: string }
  | { t: 'settings'; quick: boolean }
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
