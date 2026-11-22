import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { RoomView } from '../api';
import { C, F } from '../theme';
import { Button, H, Label, T } from './ui';

// Mini tutorial: three steps per mode, shown the first time a player meets that mode, and on demand.

export type HowToKey = 'classic' | 'bingo' | 'unique' | 'impostor' | 'quick';
type Step = { icon: React.ComponentProps<typeof Feather>['name']; text: string };

export const HOWTO: Record<HowToKey, { title: string; steps: Step[] }> = {
  classic: {
    title: 'Squad',
    steps: [
      { icon: 'map-pin', text: 'Everyone gets the same prompt. Go out and find one in real life.' },
      { icon: 'camera', text: 'Photograph it. The AI checks it fits and names what you found.' },
      { icon: 'award', text: 'Rarer finds score more. After each round every card is revealed. 5 rounds.' },
    ],
  },
  bingo: {
    title: 'Bingo',
    steps: [
      { icon: 'grid', text: 'You get a 3×3 card of prompts, all open at once, against one clock.' },
      { icon: 'camera', text: 'Tap a square to photograph a find for it. One find per square.' },
      { icon: 'zap', text: 'Only finds on a full row, column or diagonal score. Each line +50; the first line in the squad +100.' },
    ],
  },
  unique: {
    title: 'Unique only',
    steps: [
      { icon: 'map-pin', text: 'Same prompt for everyone, same rounds as a normal squad.' },
      { icon: 'users', text: 'If someone else finds the same thing as you that round, you both score 0.' },
      { icon: 'eye-off', text: 'Skip the obvious answer. Guess what your friends will pick, then pick something else.' },
    ],
  },
  impostor: {
    title: 'Impostor',
    steps: [
      { icon: 'user-x', text: 'Each round one player secretly gets a slightly different prompt. It could be you.' },
      { icon: 'camera', text: 'Everyone hunts. The impostor tries to find something that passes for the real prompt.' },
      { icon: 'check-square', text: 'Then vote on whose card doesn’t fit. +50 for spotting them; +100 to an impostor who gets away.' },
    ],
  },
  quick: {
    title: 'Quick play',
    steps: [
      { icon: 'clock', text: 'Three prompts, 60 seconds each. Find something near you and photograph it.' },
      { icon: 'award', text: 'The AI judges it. Rarer finds score more: 10 points for common, up to 100.' },
      { icon: 'flag', text: 'Race the ghost of today’s top team. Your team’s best counted run goes on the board.' },
    ],
  },
};

export const modeOf = (room: RoomView): HowToKey => (room.bingo ? 'bingo' : room.unique ? 'unique' : room.impostor ? 'impostor' : 'classic');

const seenKey = (k: HowToKey) => `rarefind.howto.${k}`;

/** Opens on its own the first time this device meets `k`; show() reopens it. */
export function useHowTo(k: HowToKey | null) {
  const [open, setOpen] = useState<HowToKey | null>(null);
  useEffect(() => {
    if (!k) return;
    let live = true;
    AsyncStorage.getItem(seenKey(k))
      .then((v) => live && !v && setOpen(k))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [k]);
  const close = useCallback(() => {
    if (open) AsyncStorage.setItem(seenKey(open), '1').catch(() => {});
    setOpen(null);
  }, [open]);
  return { open, show: () => k && setOpen(k), close };
}

export function HowToSheet({ k, onClose }: { k: HowToKey | null; onClose: () => void }) {
  const how = k ? HOWTO[k] : null;
  return (
    <Modal visible={!!how} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          {how && (
            <>
              <Label>How to play</Label>
              <H size={32}>{how.title}</H>
              <View style={{ gap: 14, marginTop: 6 }}>
                {how.steps.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                    <View style={styles.dot}>
                      <Feather name={s.icon} size={20} color={C.white} />
                    </View>
                    <T style={{ flex: 1, fontSize: 16, lineHeight: 22, fontFamily: F.bodyMid }}>{s.text}</T>
                  </View>
                ))}
              </View>
              <Button title="Got it" onPress={onClose} style={{ marginTop: 10 }} />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A small "How to play" link. */
export function HowToLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 4 }}>
      <Feather name="help-circle" size={16} color={C.inkSoft} />
      <T style={{ fontFamily: F.bodyBold, color: C.inkSoft, fontSize: 14 }}>How to play</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(18,21,15,0.55)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 520, backgroundColor: C.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 34, gap: 8, borderWidth: 2, borderColor: C.ink },
  dot: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
});
