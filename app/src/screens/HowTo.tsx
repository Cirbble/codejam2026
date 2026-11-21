import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, H, Label, T, type IconName } from '../components/ui';
import { C, F } from '../theme';

const STEPS: Array<[IconName, string, string]> = [
  ['thunderstorm', 'Walk out', 'A cell forms where you stand. Your phone says which way and how far. Be outside it when it lands.'],
  ['people', 'Revive', 'Three hits and you are down until a teammate walks to you.'],
  ['pulse', 'Survive', 'The storm rises through five levels. Anyone still up at the end wins it for the crew.'],
];

export function HowTo({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 30, gap: 24, paddingBottom: insets.bottom + 24 }}>
          <H size={40}>How it plays</H>
          {STEPS.map(([icon, title, body]) => (
            <View key={title} style={styles.row}>
              <View style={styles.icon}>
                <Ionicons name={icon} size={22} color={C.amber} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <H size={24}>{title}</H>
                <T style={{ color: C.dim, lineHeight: 22 }}>{body}</T>
              </View>
            </View>
          ))}
          <View style={styles.safety}>
            <Label style={{ color: C.amber }}>Safety</Label>
            <T style={{ lineHeight: 22, marginTop: 6 }}>Play in parks and open spaces. Walk. Never step into a road for a cell.</T>
          </View>
          <T style={{ color: C.faint, fontSize: 14, lineHeight: 20, fontFamily: F.body }}>Your location is shared with your crew only while a game is open. No accounts.</T>
          <Button title="Got it" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  icon: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  safety: { borderWidth: 1, borderColor: 'rgba(242,193,74,0.4)', borderRadius: 12, padding: 14, backgroundColor: 'rgba(242,193,74,0.05)' },
});
