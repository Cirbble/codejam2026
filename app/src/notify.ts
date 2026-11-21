import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

// Squad rounds run while phones are in pockets: a lock-screen nudge 30 s before a round closes,
// and a call-back when the next round starts. Banners are suppressed while the app is open.

let ready = false;
let scheduledFor = '';
const ids = { warn: '', next: '' };

export async function initNotifications() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const fg = AppState.currentState === 'active';
      return { shouldShowBanner: !fg, shouldShowList: !fg, shouldPlaySound: !fg, shouldSetBadge: false };
    },
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('rounds', { name: 'Squad rounds', importance: Notifications.AndroidImportance.HIGH }).catch(() => {});
  }
  const cur = await Notifications.getPermissionsAsync().catch(() => null);
  if (cur?.granted) ready = true;
  else if (cur?.canAskAgain !== false) ready = (await Notifications.requestPermissionsAsync().catch(() => null))?.granted ?? false;
}

async function at(date: number, title: string, body: string) {
  if (date - Date.now() < 5_000) return '';
  return Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(date), channelId: 'rounds' },
  }).catch(() => '');
}

/** Schedule this round's reminders (idempotent per round key). `found` drops the 30 s warning. */
export async function remindRound(key: string, endsAtLocal: number, prompt: string, round: number, total: number, found: boolean, revealMs: number) {
  if (!ready || Platform.OS === 'web') return;
  const k = `${key}:${found ? 1 : 0}`;
  if (scheduledFor === k) return;
  scheduledFor = k;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  if (!found) ids.warn = await at(endsAtLocal - 30_000, '30 seconds left', prompt);
  ids.next = await at(endsAtLocal + revealMs, round < total ? `Round ${round + 1} is starting` : 'Squad results are in', 'Open Rarefind');
}

export async function clearReminders() {
  scheduledFor = '';
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
}
