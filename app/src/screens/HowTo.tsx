import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, H, T, type IconName } from '../components/ui';
import { C, F } from '../theme';

const STEPS: Array<[IconName, string, string]> = [
  ['navigation', 'Walk out', 'A storm cell forms where you stand. Your phone says which way and how far. Be outside it when it lands.'],
  ['users', 'Revive', 'Three hits and you are down until a teammate walks to you.'],
  ['sun', 'Outlast it', 'If anyone is still up when the storm passes, the crew wins.'],
];

export function HowTo({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: C.sky }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 34, gap: 28, paddingBottom: insets.bottom + 24 }}>
          <H size={34}>How it plays</H>
          {STEPS.map(([icon, title, body]) => (
            <View key={title} style={styles.row}>
              <View style={styles.icon}>
                <Feather name={icon} size={22} color={C.white} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <H size={20}>{title}</H>
                <T style={{ color: C.inkSoft }}>{body}</T>
              </View>
            </View>
          ))}
          <View style={styles.safety}>
            <T style={{ fontFamily: F.bodyBold }}>Play in parks and open spaces. Walk. Never step into a road for a cell.</T>
          </View>
          <Button title="Got it" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  safety: { borderRadius: 20, padding: 18, backgroundColor: C.surface, boxShadow: `0px 2px 0px ${C.line}` },
});
