import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { AppState, Platform } from 'react-native';
import type { GameEvent } from '../shared/types';

/** Voice + haptics + local notifications, so the phone can stay in a pocket. */
// Web dev and test runs (localhost, or ?mute=1) stay silent: nobody wants a test tab talking out loud.
const silentWeb =
  Platform.OS === 'web' && typeof window !== 'undefined' && (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location?.hostname ?? '') || /[?&]mute=1/.test(window.location?.search ?? ''));
let muted = silentWeb;
export const setMuted = (m: boolean) => {
  muted = m || silentWeb;
  if (m) Speech.stop();
};
export const isMuted = () => muted;
/** Preflight: iPhones in silent mode don't speak, so check the voice before the game. */
export function testVoice() {
  if (silentWeb) return;
  Speech.stop();
  Speech.speak('Voice check. If you can hear this, you are ready.', { language: 'en-US' });
}

const native = Platform.OS !== 'web';
let headingDeg: number | null = null;
/** Latest compass heading from the game screen (null when unknown). */
export const setHeading = (h: number | null) => {
  headingDeg = h;
};
const COMPASS: Record<string, number> = { north: 0, 'north-east': 45, east: 90, 'south-east': 135, south: 180, 'south-west': 225, west: 270, 'north-west': 315 };
/**
 * "ahead and to your left" beats "south-west" when you're standing in a park, but only with a good, fresh compass.
 * Eight ways either way: body-relative never loses precision against the compass words.
 */
const REL = ['straight ahead', 'ahead and to your right', 'to your right', 'behind you, to the right', 'behind you', 'behind you, to the left', 'to your left', 'ahead and to your left'];
export function relativeDir(compassDir: string): string {
  const deg = COMPASS[compassDir];
  if (deg == null || headingDeg == null) return compassDir;
  const rel = (((deg - headingDeg) % 360) + 360) % 360;
  return REL[Math.round(rel / 45) % 8];
}
/** Let the voice play even with the iPhone ringer switch on silent. */
export async function initAudio() {
  if (!native) return;
  try {
    const { setAudioModeAsync } = await import('expo-audio');
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
  } catch {}
}
const spokenStrikes = new Set<string>();

/** After a reconnect, the server's warning may have been missed: say it from local state instead. */
export function sayMissedWarning(strikeId: string, dir: string, m: number, sec: number, mega: boolean) {
  if (spokenStrikes.has(strikeId)) return;
  spokenStrikes.add(strikeId);
  buzz.warn();
  say(`${mega ? 'Supercell! ' : ''}Walk ${m} metres ${relativeDir(dir)}. ${sec} seconds.`, true);
}

function say(text: string, urgent = false) {
  if (muted) return;
  if (urgent) Speech.stop();
  Speech.speak(text, { rate: urgent ? 1.08 : 1.0, pitch: 1.0, language: 'en-US' });
}

const buzz = {
  warn: () => native && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  hit: async () => {
    if (!native) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 140);
  },
  good: () => native && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  tap: () => native && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  bad: () => native && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};
export const haptic = buzz;

export function handleEvent(ev: GameEvent) {
  switch (ev.kind) {
    case 'start':
      buzz.good();
      say('Storm incoming. Keep the app open and walk out of every cell.');
      break;
    case 'level':
      buzz.warn();
      say(ev.level >= 5 ? 'Level five. Hold on.' : `Storm level ${ev.level}.`);
      break;
    case 'warn':
      spokenStrikes.add(ev.strikeId);
      buzz.warn();
      say(`${ev.mega ? 'Supercell! ' : ''}Walk ${ev.moveM} metres ${relativeDir(ev.moveDir)}. ${ev.inSec} seconds.`, true);
      break;
    case 'hit':
      buzz.hit();
      say(ev.hp === 1 ? 'Hit. One life left.' : `Hit. ${ev.hp} lives left.`, true);
      break;
    case 'dodge':
      buzz.tap();
      if (Math.random() < 0.5) say('Clear.');
      break;
    case 'downed':
      buzz.bad();
      say("You're down. Stay where you are. A teammate has to walk to you.", true);
      break;
    case 'revived':
      buzz.good();
      say(`Back up. Thanks, ${ev.by}.`);
      break;
    case 'revivedOther':
      buzz.good();
      say(`You revived ${ev.name}.`);
      break;
    case 'orb':
      buzz.tap();
      say(ev.orb === 'heart' ? 'Extra life.' : 'Star.');
      break;
    case 'oob':
      buzz.warn();
      say(`You're outside the zone. Head ${relativeDir(ev.dir)}, ${ev.m} metres.`);
      break;
    case 'teammateDown':
      buzz.warn();
      say(`${ev.name} is down, ${ev.m} metres ${relativeDir(ev.dir)}. Go revive them.`);
      break;
    case 'end':
      buzz.good();
      cancelScheduled();
      say('The storm has passed.');
      break;
  }
}

// ---------- local notifications (work while the phone is locked) ----------
let ready = false;
let armed = false;
/** True only when the current round's lock-screen reminder was actually scheduled. */
export const notificationsReady = () => ready && armed;
export async function initNotifications() {
  if (!native) return false;
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const open = AppState.currentState === 'active';
      return { shouldShowBanner: !open, shouldShowList: true, shouldPlaySound: !open, shouldSetBadge: false };
    },
  });
  if (Platform.OS === 'android') {
    // Android 13+ only shows the permission prompt once a channel exists
    await Notifications.setNotificationChannelAsync('game', { name: 'Game', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 120, 250] }).catch(() => {});
  }
  const cur = await Notifications.getPermissionsAsync();
  const ok = cur.granted || (await Notifications.requestPermissionsAsync()).granted;
  ready = ok;
  return ok;
}

let reminderGen = 0;
export async function cancelScheduled() {
  reminderGen++;
  armed = false;
  if (!native) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
}
