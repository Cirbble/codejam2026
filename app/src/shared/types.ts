// Shared wire types. Keep in sync with app/src/shared/types.ts (copy this file there).
export type Phase = 'lobby' | 'countdown' | 'playing' | 'ended';
export type LatLng = { lat: number; lng: number };

export type PlayerView = {
  id: string;
  name: string;
  color: string;
  lat: number | null;
  lng: number | null;
  acc: number;
  hp: number;
  maxHp: number;
  score: number;
  status: 'alive' | 'downed';
  gpsWeak: boolean;
  bot: boolean;
  sim: boolean;
  connected: boolean;
  oob: boolean;
  reviveProgress: number; // 0..1
  distanceM: number;
  movingSec: number;
  hits: number;
  dodges: number;
  orbs: number;
  revives: number;
  /** app in the background / phone locked: can't be hit, doesn't count as standing */
  inactive: boolean;
};

/** A storm cell: it lands at `hitAt` and strikes everything inside radius `r` (metres). */
export type StrikeView = {
  id: string;
  lat: number;
  lng: number;
  r: number;
  warnAt: number;
  hitAt: number;
  kind: 'strike' | 'mega';
};

/** Field pickups: a probe is points, a kit restores one life. */
export type OrbView = { id: string; lat: number; lng: number; kind: 'star' | 'heart'; expiresAt: number };

export type FeedItem = { id: string; at: number; text: string; kind: string };

export type Results = {
  ranking: Array<{ id: string; name: string; color: string; score: number; survived: boolean; bot: boolean }>;
  team: {
    distanceM: number;
    activeMin: number;
    dodges: number;
    hits: number;
    revives: number;
    durationSec: number;
    peakLevel: number;
    simulated: boolean;
    /** bots or demo location: a practice game */
    practice: boolean;
  };
  awards: Array<{ title: string; playerName: string; detail: string }>;
};

export type Settings = { durationSec: number; radiusM: number; quick: boolean };

export type RoomView = {
  code: string;
  hostId: string;
  phase: Phase;
  settings: Settings;
  center: LatLng | null;
  startsAt: number | null;
  endsAt: number | null;
  now: number;
  /** storm level 1..5: cells form faster and grow as it rises */
  level: number;
  /** null while running; why the storm clock is stopped otherwise */
  paused: null | 'host' | 'away' | 'reconnect';
  players: PlayerView[];
  strikes: StrikeView[];
  orbs: OrbView[];
  outcome: 'won' | 'lost' | null;
  feed: FeedItem[];
  results: Results | null;
};

/** Personal event, drives voice + haptics on the device. */
export type GameEvent =
  | { kind: 'warn'; strikeId: string; inSec: number; moveDir: string; moveM: number; mega: boolean }
  | { kind: 'hit'; hp: number }
  | { kind: 'dodge'; points: number }
  | { kind: 'downed' }
  | { kind: 'revived'; by: string }
  | { kind: 'revivedOther'; name: string }
  | { kind: 'orb'; orb: 'star' | 'heart'; points: number }
  | { kind: 'oob'; dir: string; m: number }
  | { kind: 'teammateDown'; name: string; dir: string; m: number }
  | { kind: 'level'; level: number }
  | { kind: 'start' }
  | { kind: 'end' };

export type ClientMsg =
  | { t: 'hello'; name: string; code?: string; create?: boolean; playerId?: string; secret?: string }
  | { t: 'watch'; code: string; token: string }
  | { t: 'pos'; lat: number; lng: number; acc: number; sim?: boolean; age?: number }
  | { t: 'settings'; settings: Partial<Settings> }
  | { t: 'bots'; n: number }
  | { t: 'start' }
  | { t: 'again' }
  | { t: 'leave' }
  | { t: 'rotateWatch' }
  | { t: 'kick'; id: string }
  /** the phone received (and spoke) this warning: its escape time starts now */
  | { t: 'ack'; id: string }
  /** app foreground/background */
  | { t: 'active'; on: boolean }
  /** host: stop or restart the storm clock, penalty-free */
  | { t: 'pause'; on: boolean };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; secret: string; code: string; watchToken: string }
  | { t: 'state'; room: RoomView }
  | { t: 'watchToken'; watchToken: string }
  | { t: 'ev'; ev: GameEvent }
  | { t: 'error'; message: string; code?: 'no_room' | 'full' | 'in_progress' | 'rate' | 'kicked' | 'other' };
