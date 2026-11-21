// Rarefind design tokens.
// Concept: a field binder. Every find is a collectible card; the screens are the paper it sits on.
// Daylight palette (it's played outside, in the sun), ink for structure, trail-marker orange for "act now",
// and the five tier colours carry all the excitement.

export const C = {
  paper: '#E9EDE5', // binder page: cool green-grey, never cream
  paperDeep: '#DDE2D8',
  card: '#FAFBF7',
  ink: '#12150F',
  inkSoft: '#454B41',
  faint: '#7D8577',
  line: '#C3C9BC',
  blaze: '#F2542D', // trail-marker orange: timers, primary highlights
  white: '#FFFFFF',
  scrim: 'rgba(18,21,15,0.55)',
};

export const F = {
  display: 'BricolageGrotesque_800ExtraBold',
  displayMid: 'BricolageGrotesque_600SemiBold',
  body: 'Inter_400Regular',
  bodyMid: 'Inter_500Medium',
  bodyBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_500Medium',
};

export type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'one';

export const TIERS: Record<Tier, { name: string; color: string; frame: string; ink: string; rank: number }> = {
  common: { name: 'Common', color: '#7F877A', frame: '#D3D8CD', ink: '#12150F', rank: 0 },
  uncommon: { name: 'Uncommon', color: '#23914A', frame: '#BFE3C8', ink: '#0E3B1E', rank: 1 },
  rare: { name: 'Rare', color: '#2563EB', frame: '#BCD0FA', ink: '#0F2A66', rank: 2 },
  epic: { name: 'Epic', color: '#8B35E0', frame: '#DCC4F7', ink: '#3A1466', rank: 3 },
  one: { name: 'One of One', color: '#E0457B', frame: '#F7C9D9', ink: '#5C1230', rank: 4 },
};

// holographic stops for One of One frames and the foil sheen
export const HOLO = ['#FF6FB1', '#FFD45C', '#5CE6C8', '#6E8BFF', '#C77DFF'] as const;

export const TIER_ORDER: Tier[] = ['one', 'epic', 'rare', 'uncommon', 'common'];
