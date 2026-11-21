/**
 * Squall: the phone is a storm spotter's radar scope.
 * Dark scope glass, phosphor ink, the radar reflectivity scale (dBZ) for danger, amber for actions.
 */
export const C = {
  bg: '#071115', // scope glass
  panel: '#0D1B20',
  panel2: '#12262C',
  line: 'rgba(140,196,182,0.16)',
  ring: 'rgba(140,196,182,0.20)',
  ink: '#E3EEE9',
  dim: '#8EA6A0',
  faint: '#5C7570',
  amber: '#F2C14A', // actions and warnings
  amberInk: '#1B1405',
  safe: '#4ED07A',
  danger: '#E4442F',
  magenta: '#C4307C',
  // reflectivity scale, light rain -> hail core
  dbz: ['#1E9E4A', '#7BC63A', '#F1D23B', '#F59B2E', '#E4442F', '#C4307C'] as const,
};

/** dBZ labels that go with C.dbz, for the legend strip. */
export const DBZ_LABELS = ['20', '30', '40', '50', '60', '70'] as const;

/** Reflectivity colour for an intensity 0..1 (a cell gets hotter as it is about to land). */
export function dbzColor(t: number) {
  const i = Math.max(0, Math.min(C.dbz.length - 1, Math.floor(t * C.dbz.length)));
  return C.dbz[i];
}

export const F = {
  display: 'BarlowCondensed_700Bold',
  displayHeavy: 'BarlowCondensed_800ExtraBold',
  body: 'Barlow_400Regular',
  bodyMedium: 'Barlow_500Medium',
  bodyBold: 'Barlow_600SemiBold',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
};

export const R = { sm: 6, md: 10, lg: 14 };
