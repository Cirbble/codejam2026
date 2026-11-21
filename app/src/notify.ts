import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

// Squad rounds run while phones are in pockets: a lock-screen nudge 30 s before the round closes.
// Banners are suppressed while the app is open (the screen already shows the timer).

let ready = false;
let scheduledFor = '';

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

/** Schedule the "30 seconds left" reminder for this round (idempotent per round key). */
export async function remindRound(key: string, endsAtLocal: number, prompt: string) {
  if (!ready || Platform.OS === 'web' || scheduledFor === key) return;
  scheduledFor = key;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  const at = endsAtLocal - 30_000;
  if (at - Date.now() < 5_000) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: '30 seconds left', body: prompt },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: 'rounds' },
  }).catch(() => {});
}

export async function clearReminders() {
  scheduledFor = '';
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
}
