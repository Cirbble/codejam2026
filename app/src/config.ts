import Constants from 'expo-constants';

const fromConfig = (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl;
export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || fromConfig || 'https://krillion-production-ce39cedf.up.railway.app').replace(/\/$/, '');
export const WS_URL = SERVER_URL.replace(/^http/, 'ws') + '/rt';

/** Where demo mode drops you when there's no GPS (McGill, Trottier Building). */
export const DEMO_ORIGIN = { lat: 45.50705, lng: -73.57905 };
