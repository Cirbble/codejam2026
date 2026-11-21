import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Dot, IconButton, Isobars, Panel, Segmented, T } from '../components/ui';
import { SERVER_URL } from '../config';
import { testVoice } from '../game/coach';
import { useGame, useMe } from '../net/GameProvider';
import { useLoc } from '../net/LocationProvider';
import { C, F, R } from '../theme';

function Head({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.ink }}>{children}</Text>;
}

export function Lobby() {
  const { room, session, send, leave, error } = useGame();
  const me = useMe();
  const { fix, demo, setDemo, permission, requestPermission, locError, retry } = useLoc();
  const appliedDemo = React.useRef('');
  const insets = useSafeAreaInsets();
  const [botDraft, setBotDraft] = useState<number | null>(null);
  const serverBotCount = room?.players.filter((p) => p.bot).length;
  useEffect(() => {
    setBotDraft(null);
  }, [serverBotCount]);
  // Joining a demo-preset crew switches this phone to the demo location too
  const quick = !!room?.settings.quick;
  const autoDemo = React.useRef(false);
  useEffect(() => {
    if (quick && !demo) {
      autoDemo.current = true;
      setDemo(true);
    } else if (!quick && autoDemo.current && demo && permission === 'granted') {
      autoDemo.current = false;
      setDemo(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick]);
  // A host who chose Demo on the home screen gets the table-demo preset (short storm, small zone, bots) once
  const isHost = !!room && room.hostId === session?.playerId;
  useEffect(() => {
    if (!room || !isHost || !demo || room.settings.quick || room.phase !== 'lobby' || appliedDemo.current === room.code) return;
    appliedDemo.current = room.code;
    send({ t: 'settings', settings: { quick: true, radiusM: 60 } });
    if (!room.players.some((p) => p.bot)) send({ t: 'bots', n: 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.code, isHost, demo]);
  if (!room || !session) return null;
  const host = room.hostId === session.playerId;
  const s = room.settings;
  const serverBots = room.players.filter((p) => p.bot).length;
  const bots = botDraft ?? serverBots;
  const setBots = (n: number) => {
    const v = Math.max(0, Math.min(5, n));
    setBotDraft(v);
    send({ t: 'bots', n: v });
  };
  const watchUrl = `${SERVER_URL}/watch/${room.code}?t=${session.watchToken}`;
  const gpsOk = !!fix && (demo || (fix.acc <= 30 && Date.now() - fix.at < 8000));
  const set = (patch: Partial<typeof s>) => send({ t: 'settings', settings: patch });

  return (
    <View style={{ flex: 1, backgroundColor: C.sky }}>
      <Isobars />
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 170 }]}>
        <View style={styles.top}>
          <IconButton icon="x" label="Leave crew" onPress={leave} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <IconButton icon="volume-2" label="Voice check" onPress={testVoice} />
            <IconButton icon="share-2" label="Invite" onPress={() => Share.share({ message: `Join my Squall crew: code ${room.code}` })} />
          </View>
        </View>

        <View style={{ gap: 2 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.inkSoft }}>Crew code</Text>
          <Text style={styles.code} accessibilityLabel={`Crew code ${room.code.split('').join(' ')}`}>
            {room.code}
          </Text>
        </View>

        <Panel style={{ paddingVertical: 6 }}>
          {room.players.map((p, i) => {
            const st = p.bot ? 'Bot' : p.lat == null ? 'Finding GPS' : p.sim ? 'Demo' : p.gpsWeak ? 'Weak GPS' : 'Ready';
            return (
              <View key={p.id} style={[styles.player, i > 0 && { borderTopWidth: 1, borderTopColor: C.skyDeep }]}>
                <Dot color={p.color} size={14} />
                <T style={styles.name} numberOfLines={1}>
                  {p.name}
                  {p.id === me?.id ? <T style={{ color: C.faint }}> (you)</T> : null}
                  {p.id === room.hostId && p.id !== me?.id ? <T style={{ color: C.faint }}> (host)</T> : null}
                </T>
                <T style={{ color: p.gpsWeak && !p.bot && !p.sim && p.lat != null ? C.dbz[3] : C.inkSoft, fontFamily: F.bodyBold, fontSize: 16 }}>{st}</T>
                {host && !p.bot && p.id !== room.hostId && (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} hitSlop={8} onPress={() => send({ t: 'kick', id: p.id })}>
                    <Feather name="x" size={18} color={C.faint} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </Panel>

        <View style={{ gap: 10 }}>
          <Head>Storm</Head>
          <Segmented
            value={s.quick ? 0 : s.durationSec}
            options={[
              { value: 0, label: 'Demo' },
              { value: 300, label: '5 min' },
              { value: 480, label: '8 min' },
              { value: 720, label: '12 min' },
            ]}
            onChange={(v) => {
              if (v === 0) {
                set({ quick: true, radiusM: 60 });
                if (!demo) setDemo(true);
                if (serverBots === 0) setBots(2);
              } else {
                set({ quick: false, durationSec: v });
                if (demo && permission === 'granted') setDemo(false); // leaving the table demo: back to real GPS
              }
            }}
            disabled={!host}
          />
        </View>
        <View style={{ gap: 10 }}>
          <Head>Zone</Head>
          <Segmented
            value={s.radiusM}
            options={[
              { value: 60, label: '60 m' },
              { value: 120, label: '120 m' },
              { value: 200, label: '200 m' },
            ]}
            onChange={(v) => set({ radiusM: v })}
            disabled={!host}
          />
        </View>
        {host && s.quick && (
          <View style={styles.rowBetween}>
            <Head>Practice bots</Head>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="Fewer bots" onPress={() => setBots(bots - 1)} style={styles.step} hitSlop={8}>
                <Feather name="minus" size={20} color={C.ink} />
              </Pressable>
              <Text style={styles.stepN}>{bots}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="More bots" onPress={() => setBots(bots + 1)} style={styles.step} hitSlop={8}>
                <Feather name="plus" size={20} color={C.ink} />
              </Pressable>
            </View>
          </View>
        )}
        <Button title="Big screen" icon="monitor" kind="outline" onPress={() => (Platform.OS === 'web' ? Linking.openURL(watchUrl) : Share.share({ message: watchUrl, url: watchUrl }))} />
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: insets.bottom + 16 }]}>
        {!gpsOk && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            {permission !== 'granted' && !demo && <Button title="Allow location" kind="outline" style={{ flex: 1 }} onPress={async () => ((await requestPermission()) ? null : Linking.openSettings())} />}
            {permission === 'granted' && locError && !demo && <Button title="Retry GPS" kind="outline" style={{ flex: 1 }} onPress={retry} />}
            <Button title="Use demo" kind="outline" style={{ flex: 1 }} onPress={() => setDemo(true)} />
          </View>
        )}
        {error && <T style={{ color: C.dbz[3], textAlign: 'center', marginBottom: 10, fontFamily: F.bodyBold }}>{error}</T>}
        {host ? (
          <Button title={gpsOk ? 'Start the storm' : 'Finding GPS'} disabled={!gpsOk} onPress={() => send({ t: 'start' })} />
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: 18 }}>
            <T style={{ color: C.inkSoft, fontFamily: F.bodyMid }}>Waiting for the host</T>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 24, gap: 22, maxWidth: 560, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontFamily: F.displayHeavy, fontSize: 60, lineHeight: 70, letterSpacing: 2, color: C.ink },
  player: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  name: { flex: 1, fontFamily: F.bodyBold, fontSize: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 2px 0px ${C.line}` },
  stepN: { width: 30, textAlign: 'center', fontFamily: F.display, fontSize: 20, color: C.ink },
  cta: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 14, backgroundColor: C.sky, borderTopWidth: 1, borderTopColor: C.skyDeep },
});
