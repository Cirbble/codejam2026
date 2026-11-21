import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cell, Me, Scope, Star } from '../components/Radar';
import { Button, IconButton, Isobars, T } from '../components/ui';
import { initNotifications } from '../game/coach';
import { useGame } from '../net/GameProvider';
import { useLoc } from '../net/LocationProvider';
import { C, CREW, F, R } from '../theme';
import { HowTo } from './HowTo';
import { Circle } from 'react-native-svg';

/** A quiet storm on the home scope: a few cells at different strengths, slowly breathing. */
function HomeScope({ size }: { size: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 700);
    return () => clearInterval(id);
  }, []);
  const c = size / 2;
  const u = size / 300;
  const breathe = (phase: number) => (Math.sin((t + phase) * 0.4) + 1) / 2;
  return (
    <Scope size={size} spanM={100} labels={false}>
      <Cell x={c + 60 * u} y={c - 64 * u} r={38 * u} k={0.6 + 0.4 * breathe(0)} />
      <Cell x={c - 82 * u} y={c + 34 * u} r={24 * u} k={0.25 + 0.3 * breathe(3)} />
      <Cell x={c + 28 * u} y={c + 90 * u} r={17 * u} k={0.05 + 0.2 * breathe(5)} />
      <Star x={c - 46 * u} y={c - 58 * u} />
      <Circle cx={c - 30 * u} cy={c + 52 * u} r={7} fill={CREW[0]} stroke={C.white} strokeWidth={2.5} />
      <Circle cx={c + 70 * u} cy={c + 20 * u} r={7} fill={CREW[1]} stroke={C.white} strokeWidth={2.5} />
      <Me x={c} y={c} />
    </Scope>
  );
}

export function Home() {
  const { name, setName, create, join, status, error, clearError } = useGame();
  const { demo, setDemo, requestPermission, permission } = useLoc();
  const [code, setCode] = useState('');
  const [how, setHow] = useState(false);
  const [locErr, setLocErr] = useState(false);
  const { width, height } = useWindowDimensions();
  // first launch: the safety + how-to sheet, once
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
  const scope = Math.min(Math.min(width, 520) - 40, height * 0.46, 380);

  const prepare = async () => {
    clearError();
    if (!demo && permission !== 'granted') {
      const ok = await requestPermission();
      setLocErr(!ok); // still let them in: the lobby offers demo location and Settings
    }
    initNotifications().catch(() => {});
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.sky }}>
      <Isobars />
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 18 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <Text style={styles.word} accessibilityRole="header">
            squall
          </Text>
          <IconButton icon="help-circle" label="How it plays" onPress={() => setHow(true)} />
        </View>

        <View style={{ alignItems: 'center' }}>
          <HomeScope size={scope} />
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
              kind="outline"
              disabled={!ready || code.length !== 4}
              loading={busy && !!code}
              style={{ flex: 1 }}
              onPress={async () => {
                await prepare();
                join(code);
              }}
            />
          </View>
          {error && <T style={{ color: C.dbz[3], fontFamily: F.bodyBold }}>{error}</T>}
          {locErr && (
            <View style={{ gap: 10 }}>
              <T style={{ fontFamily: F.bodyBold }}>Location is off, so the storm can't find you.</T>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Settings" kind="outline" style={{ flex: 1 }} onPress={() => Linking.openSettings()} />
                <Button title="Demo" kind="outline" style={{ flex: 1 }} onPress={() => (setDemo(true), setLocErr(false))} />
              </View>
            </View>
          )}
          <View style={styles.demo}>
            <T style={{ fontFamily: F.bodyMid, color: C.inkSoft }}>Demo mode</T>
            <Switch
              value={demo}
              onValueChange={setDemo}
              trackColor={{ true: C.ink, false: C.line }}
              thumbColor={C.white}
              {...({ activeThumbColor: C.white } as object)}
              accessibilityLabel="Demo mode, simulated location"
            />
          </View>
        </View>
      </ScrollView>
      <HowTo visible={how} onClose={() => setHow(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 24, gap: 22, flexGrow: 1, justifyContent: 'space-between', maxWidth: 520, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  word: { fontFamily: F.displayHeavy, fontSize: 44, lineHeight: 52, letterSpacing: -2, color: C.ink },
  input: { height: 60, backgroundColor: C.surface, borderRadius: R.md, color: C.ink, fontFamily: F.bodyMid, fontSize: 19, paddingHorizontal: 20, boxShadow: `inset 0px 2px 0px ${C.skyDeep}` },
  joinRow: { flexDirection: 'row', gap: 10 },
  code: { width: 140, letterSpacing: 6, textAlign: 'center', fontFamily: F.monoBold },
  demo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 2 },
});
