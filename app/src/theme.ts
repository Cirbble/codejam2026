/**
 * Squall: a daylight storm chart.
 * Pale storm-sky ground, deep slate ink, faint isobars. The radar reflectivity scale is the only bright colour,
 * and it always means danger: cells, hits, the last life.
 */
export const C = {
  sky: '#D8E0E6', // ground: pale storm sky, cool blue-grey
  skyDeep: '#C8D2DA',
  surface: '#EEF2F5', // raised panels and the scope glass
  ink: '#16212A', // deep slate: text, primary buttons, your dot
  inkSoft: '#465560',
  faint: '#5E6C77',
  line: '#B3BFC9',
  isobar: 'rgba(22,33,42,0.06)',
  white: '#FFFFFF',
  // reflectivity, light rain -> hail core (danger only)
  dbz: ['#2E9B57', '#E3BC1A', '#EE8A22', '#D7372B', '#B32A78'] as const,
};

/** Reflectivity colour for an intensity 0..1 (a cell gets hotter as it is about to land). */
export function dbzColor(t: number) {
  const i = Math.max(0, Math.min(C.dbz.length - 1, Math.floor(t * C.dbz.length)));
  return C.dbz[i];
}

/** Player marker colours: muted slate-family tints, so nothing but a cell reads as danger. */
export const CREW = ['#3E6F96', '#6B5B95', '#2F7D78', '#8A6B3D', '#5A6B7C', '#8C4F6A', '#4F7A4B', '#7A6F5A'];

export const F = {
  display: 'Unbounded_700Bold',
  displayHeavy: 'Unbounded_800ExtraBold',
  displayMid: 'Unbounded_500Medium',
  body: 'Figtree_400Regular',
  bodyMid: 'Figtree_500Medium',
  bodyBold: 'Figtree_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
};

export const R = { sm: 10, md: 16, lg: 24, pill: 999 };
