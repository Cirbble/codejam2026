import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import type { Tier } from './theme';

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
  playerId?: string;
  sameAs?: string[];
  at: number;
};
export type Prompt = { id: string; text: string; examples?: string };

export type Daily = {
  day: string;
  prompts: Prompt[];
  cards: Record<string, Card>;
  tries: Record<string, number>;
  score: number;
  resetsAt: number;
};

export type FindResult =
  | { accepted: true; card: Card }
  | { accepted: false; reason: 'no_match' | 'screen' | 'unclear'; verdict: string; triesLeft?: number }
  | { error: string; message: string; retryAfterMs?: number };

export type RoomView = {
  code: string;
  phase: 'lobby' | 'countdown' | 'hunting' | 'reveal' | 'ended';
  hostId: string;
  now: number;
  quick: boolean;
  round: number;
  totalRounds: number;
  prompt: Prompt | null;
  endsAt: number | null;
  players: { id: string; name: string; score: number; connected: boolean; found: boolean }[];
  reveal: Card[] | null;
  rounds: { prompt: Prompt; cards: Card[] }[];
  best?: Record<string, string>;
  roundWinners?: (string | null)[];
  winners?: string[];
  revealMs?: number | null;
  solo?: boolean;
  team?: string | null;
  boardRank?: number;
  boardBest?: number;
  counted?: boolean;
  runsLeft?: number;
};

export type BoardRow = { team: string; best: number; plays: number; bestCard: Card | null; at: number };

export const MAX_TRIES = 6;
export const SITE = 'https://rarefind-production.up.railway.app';
export const inviteLink = (code: string) => `${SITE}/play/?join=${code}`;

/** Code from an invite link (?join=CODE on the web, rarefind://join/CODE in the app). */
export function joinCodeFrom(url: string | null | undefined): string | null {
  const m = url && /(?:[?&]join=|join\/)([A-Za-z]{4})/.exec(url);
  return m ? m[1].toUpperCase() : null;
}

export const SERVER: string = (
  process.env.EXPO_PUBLIC_SERVER_URL ||
  (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl ||
  'http://localhost:8790'
).replace(/\/$/, '');

export const photoUrl = (c: Card, small = false) => (c.photo.startsWith('http') ? c.photo : SERVER + c.photo) + (small ? '?w=240' : '');

let deviceId: string | null = null;
export async function getDevice(): Promise<string> {
  if (deviceId) return deviceId;
  const saved = await AsyncStorage.getItem('rarefind.device').catch(() => null);
  if (saved && /^[0-9a-f]{32}$/.test(saved)) return (deviceId = saved);
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  const bytes = new Uint8Array(16);
  if (g?.getRandomValues) g.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256) ^ (Date.now() >> (i % 8)) & 255;
  deviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  AsyncStorage.setItem('rarefind.device', deviceId).catch(() => {});
  return deviceId;
}

async function getJSON<T>(path: string, ms = 10_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(SERVER + path, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

let dailyMem: Daily | null = null;
let collectionMem: Card[] | null = null;

/** Last known daily hunt, if it is still today's. */
export const peekDaily = () => (dailyMem && dailyMem.resetsAt > Date.now() ? dailyMem : null);
export const peekCollection = () => collectionMem;

export async function loadCachedDaily(): Promise<Daily | null> {
  if (peekDaily()) return dailyMem;
  try {
    const raw = await AsyncStorage.getItem('rarefind.dailyCache');
    const d = raw ? (JSON.parse(raw) as Daily) : null;
    if (d && d.resetsAt > Date.now()) return (dailyMem = d);
  } catch {}
  return null;
}

export async function fetchDaily(): Promise<Daily> {
  const d = await getJSON<Daily>(`/api/daily?device=${await getDevice()}`);
  dailyMem = d;
  prefetchCards(Object.values(d.cards), true);
  AsyncStorage.setItem('rarefind.dailyCache', JSON.stringify(d)).catch(() => {});
  return d;
}

export async function fetchCollection(): Promise<Card[]> {
  const c = (await getJSON<{ cards: Card[] }>(`/api/collection?device=${await getDevice()}`)).cards;
  collectionMem = c;
  prefetchCards(c.slice(0, 24), true);
  return c;
}

export async function fetchTop(promptId: string) {
  return getJSON<{ total: number; top: { label: string; count: number }[] }>(`/api/prompt/${encodeURIComponent(promptId)}/top`);
}

export const newSubmissionId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** Sends a photo to the judge. Retries the same submissionId once on a network failure (the server is idempotent). */
export async function submitFind(
  body: { promptId: string; image: string; submissionId: string } & ({ mode: 'daily' } | { mode: 'squad'; code: string; playerId: string; secret: string }),
): Promise<FindResult> {
  const device = await getDevice();
  const payload = JSON.stringify({ ...body, device });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20_000);
      let j: FindResult | null = null;
      try {
        const r = await fetch(SERVER + '/api/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: ctl.signal });
        j = (await r.json().catch(() => null)) as FindResult | null;
      } finally {
        clearTimeout(t);
      }
      if (j) return j;
      return { error: 'bad_response', message: 'The judge sent back something odd. Try again.' };
    } catch {
      if (attempt === 1) return { error: 'network', message: 'No connection to the judge. Check your signal and try again.' };
    }
  }
  return { error: 'network', message: 'No connection to the judge.' };
}

/** Prompts and labels arrive lowercase; show them sentence-case. */
export const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** One concrete sentence about how rare a card is, used under cards. */
export function rarityLine(c: { title: string; sameCount: number; totalCount: number }) {
  const what = c.title.charAt(0).toLowerCase() + c.title.slice(1);
  if (c.sameCount <= 1) return `Only you found a ${what} · ${c.totalCount} ${c.totalCount === 1 ? 'find' : 'finds'} for this prompt`;
  return `${c.sameCount} of ${c.totalCount} finds were a ${what}`;
}

export async function fetchBoard(): Promise<BoardRow[]> {
  return (await getJSON<{ teams: BoardRow[] }>('/api/board')).teams;
}

/** Warm the image cache so cards never appear before their photo. */
export function prefetchCards(cards: Card[], small = false) {
  const urls = cards.map((c) => photoUrl(c, small));
  if (urls.length) Image.prefetch(urls, 'memory-disk').catch(() => {});
}
