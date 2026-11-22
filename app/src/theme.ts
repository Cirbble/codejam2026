// Brillion design tokens.
// Concept: the climb. Every screen sits on a sky that matches its altitude (see components/Sky.tsx),
// pearl panels float on top, and gold is kept for the rarest tier and the one main action.
// Token names are the same as before, so every screen picks up the new palette.

export const C = {
  paper: '#F4F7FC', // pearl: rows, sheets and panels that sit on the sky
  paperDeep: '#E3E9F4',
  card: '#FFFFFF',
  ink: '#1A2140', // night blue
  inkSoft: '#3A4470',
  faint: '#5E6687',
  line: '#C9D2E6',
  blaze: '#8C6310', // deep gold: accents, urgent timers and errors (white text passes AA on it)
  gold: '#B8892A',
  goldLight: '#E8C872',
  goldPale: '#FFE08A',
  white: '#FFFFFF',
  glass: 'rgba(255,255,255,0.86)',
  scrim: 'rgba(10,14,40,0.55)',
};

export const F = {
  display: 'CormorantGaramond_700Bold',
  displayMid: 'CormorantGaramond_600SemiBold',
  caps: 'Cinzel_600SemiBold',
  body: 'Inter_400Regular',
  bodyMid: 'Inter_500Medium',
  bodyBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_500Medium',
};

export type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'one';
export type Zone = 'foothill' | 'ridge' | 'cloudline' | 'summit' | 'brillion';

// The internal tier keys stay the same as the server's; only names and looks changed.
// color: chips and ribbons (white text passes AA). glow: the same hue lightened for use on night skies.
export const TIERS: Record<Tier, { name: string; short: string; color: string; frame: string; ink: string; text: string; glow: string; zone: Zone; rank: number }> = {
  common: { name: 'Foothill', short: 'Foothill', color: '#8A6A55', frame: '#E8D2C2', ink: '#3A2E26', text: '#7A5A45', glow: '#E0B9A0', zone: 'foothill', rank: 0 },
  uncommon: { name: 'Ridge', short: 'Ridge', color: '#2F7350', frame: '#BFE3C8', ink: '#0E3B1E', text: '#2F7350', glow: '#8FE0AC', zone: 'ridge', rank: 1 },
  rare: { name: 'Cloudline', short: 'Cloud', color: '#2F62C8', frame: '#C3D4F6', ink: '#0F2A66', text: '#2F62C8', glow: '#B4CCFF', zone: 'cloudline', rank: 2 },
  epic: { name: 'Summit', short: 'Summit', color: '#6340C0', frame: '#D7CBF5', ink: '#3A1466', text: '#6340C0', glow: '#D8C8FF', zone: 'summit', rank: 3 },
  one: { name: 'One in a Brillion', short: 'Brillion', color: '#8C6310', frame: '#F6E3A2', ink: '#5C3F08', text: '#8C6310', glow: '#FFE08A', zone: 'brillion', rank: 4 },
};

// holographic stops for the top tier's sheen
export const HOLO = ['#FF8FC6', '#FFE08A', '#7DEAFF', '#C2A8FF', '#FFF4D2'] as const;

export const TIER_ORDER: Tier[] = ['one', 'epic', 'rare', 'uncommon', 'common'];

/** The climb is the score: every point is 20 m, so a perfect day (5 × 100) reaches 10,000 m. */
export const METRES_PER_POINT = 20;
export const altitude = (points: number) => `${(Math.max(0, points) * METRES_PER_POINT).toLocaleString('en-US')} m`;

/** Today's altitude decides which sky Home and Today sit on. */
export const zoneForPoints = (points: number): Zone => {
  const m = points * METRES_PER_POINT;
  if (m >= 9000) return 'brillion';
  if (m >= 6000) return 'summit';
  if (m >= 3000) return 'cloudline';
  if (m >= 1200) return 'ridge';
  return 'foothill';
};

export const isNight = (z: Zone) => z === 'summit' || z === 'brillion';
