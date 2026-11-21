import { Platform, Share } from 'react-native';

/** Share text: the native sheet where there is one, otherwise copy to the clipboard. Returns what happened. */
export async function shareText(message: string): Promise<'shared' | 'copied' | 'failed'> {
  if (Platform.OS === 'web') {
    const nav = (globalThis as any).navigator;
    if (nav?.share) {
      try {
        await nav.share({ text: message });
        return 'shared';
      } catch {}
    }
    try {
      await nav?.clipboard?.writeText(message);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  try {
    await Share.share({ message });
    return 'shared';
  } catch {
    return 'failed';
  }
}
