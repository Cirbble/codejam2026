import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cell, Me, Probe, Scope } from '../components/Radar';
import { Button, DbzLegend, Label, T, fmtCoord } from '../components/ui';
import { initNotifications } from '../game/coach';
import { useGame } from '../net/GameProvider';
import { useLoc } from '../net/LocationProvider';
import { C, F, R } from '../theme';
import { HowTo } from './HowTo';

/** A quiet storm on the home scope: a few cells at different strengths, slowly breathing. */
function HomeScope({ size }: { size: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 700);
    return () => clearInterval(id);
  }, []);
  const c = size / 2;
  const u = size / 300;
  const breathe = (phase: number) => (Math.sin((t + phase) * 0.45) + 1) / 2;
  return (
    <Scope size={size} spanM={100}>
      <Cell x={c + 62 * u} y={c - 70 * u} r={34 * u} k={0.55 + 0.45 * breathe(0)} />
      <Cell x={c - 84 * u} y={c + 30 * u} r={22 * u} k={0.25 + 0.3 * breathe(3)} />
      <Cell x={c + 30 * u} y={c + 92 * u} r={16 * u} k={0.1 + 0.2 * breathe(5)} />
      <Probe x={c - 40 * u} y={c - 60 * u} />
      <Me x={c} y={c} />
    </Scope>
  );
}

export function Home() {
  const { name, setName, create, join, status, error, clearError } = useGame();
  const { demo, setDemo, requestPermission, permission, fix } = useLoc();
  const [code, setCode] = useState('');
  const [how, setHow] = useState(false);
  const [locErr, setLocErr] = useState(false);
  const { width } = useWindowDimensions();
  // first launch: safety + how-to briefing, once
  useEffect(() => {
    AsyncStorage.getItem('squall.briefed').then((v) => {
      if (!v) {
        setHow(true);
        AsyncStorage.setItem('squall.briefed', '1');
      }
    });
  }, []);
  const insets = useSafeAreaInsets();
  const busy = status === 'connecting';
  const ready = name.trim().length > 0;
  const scope = Math.min(Math.min(width, 520) - 56, 300);

  const prepare = async () => {
    clearError();
    if (!demo && permission !== 'granted') {
      const ok = await requestPermission();
      setLocErr(!ok); // still let them in: the lobby offers demo location and Settings
    }
    initNotifications().catch(() => {});
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 20 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <T style={styles.word} accessibilityRole="header">
            Squall
          </T>
          <T style={styles.readout}>{demo ? 'DEMO LOCATION' : fix ? `${fmtCoord(fix.lat, fix.lng)}  ±${Math.round(fix.acc)}M` : 'NO FIX'}</T>
        </View>

        <View style={{ alignItems: 'center', gap: 10 }}>
          <HomeScope size={scope} />
          <View style={{ width: scope }}>
            <DbzLegend labels />
          </View>
        </View>

        <View style={{ gap: 12 }}>
          <TextInput
            value={name}
            onChangeText={(t) => setName(t.slice(0, 16))}
            placeholder="Your name"
            placeholderTextColor={C.faint}
            style={styles.input}
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel="Your name"
          />
          <Button
            title="Start a crew"
            icon="radio-outline"
            big
            disabled={!ready}
            loading={busy && !code}
            onPress={async () => {
              await prepare();
              create();
            }}
          />
          <View style={styles.joinRow}>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4))}
              placeholder="CODE"
              placeholderTextColor={C.faint}
              style={[styles.input, styles.code]}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Room code"
            />
            <Button
              title="Join"
              kind="ghost"
              disabled={!ready || code.length !== 4}
              loading={busy && !!code}
              style={{ flex: 1 }}
              onPress={async () => {
                await prepare();
                join(code);
              }}
            />
          </View>
          {error && <T style={{ color: C.danger, fontSize: 15 }}>{error}</T>}
          {locErr && (
            <View style={{ gap: 8 }}>
              <T style={{ color: C.amber, fontSize: 15 }}>Location is off, so the storm can't find you.</T>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Settings" kind="ghost" style={{ flex: 1 }} onPress={() => Linking.openSettings()} />
                <Button title="Demo" kind="ghost" style={{ flex: 1 }} onPress={() => (setDemo(true), setLocErr(false))} />
              </View>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Pressable onPress={() => setHow(true)} accessibilityRole="button" accessibilityLabel="How it plays" hitSlop={10}>
            <Label style={{ color: C.ink }}>How it plays</Label>
          </Pressable>
          <View style={styles.demo}>
            <Label>Demo</Label>
            <Switch value={demo} onValueChange={setDemo} trackColor={{ true: C.amber, false: C.panel2 }} thumbColor={C.ink} {...({ activeThumbColor: C.ink } as object)} accessibilityLabel="Demo mode, simulated location" />
          </View>
        </View>
      </ScrollView>
      <HowTo visible={how} onClose={() => setHow(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 20, flexGrow: 1, justifyContent: 'space-between', maxWidth: 520, width: '100%', alignSelf: 'center' },
  top: { gap: 2 },
  word: { fontFamily: F.displayHeavy, fontSize: 84, lineHeight: 84, letterSpacing: 1, textTransform: 'uppercase', color: C.ink },
  readout: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1.2, color: C.dim },
  input: { backgroundColor: C.panel, borderRadius: R.md, borderWidth: 1, borderColor: C.line, color: C.ink, fontFamily: F.bodyMedium, fontSize: 18, paddingHorizontal: 16, paddingVertical: 14 },
  joinRow: { flexDirection: 'row', gap: 10 },
  code: { width: 128, letterSpacing: 6, textAlign: 'center', fontFamily: F.monoBold },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
