import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Dot, Label, Panel, Segmented, T } from '../components/ui';
import { SERVER_URL } from '../config';
import { testVoice } from '../game/coach';
import { useGame, useMe } from '../net/GameProvider';
import { useLoc } from '../net/LocationProvider';
import { C, F, R } from '../theme';

function Util({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={10} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={16} color={C.dim} />
      <Label>{label}</Label>
    </Pressable>
  );
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
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + (gpsOk ? 120 : 190) }]}>
        <View style={styles.header}>
          <View>
            <Label>Crew code</Label>
            <T style={styles.code} accessibilityLabel={`Room code ${room.code.split('').join(' ')}`}>
              {room.code}
            </T>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Invite" onPress={() => Share.share({ message: `Join my Squall crew: code ${room.code}` })} style={styles.iconBtn}>
            <Ionicons name="share-outline" size={21} color={C.ink} />
          </Pressable>
        </View>

        <Panel style={{ paddingVertical: 8 }}>
          {room.players.map((p, i) => {
            const st = p.bot ? 'BOT' : p.lat == null ? 'LOCATING' : p.sim ? 'DEMO' : p.gpsWeak ? 'WEAK' : `±${Math.round(p.acc)} M`;
            const col = p.bot ? C.faint : p.lat == null ? C.faint : p.sim ? C.dim : p.gpsWeak ? C.amber : C.safe;
            return (
              <View key={p.id} style={[styles.player, i > 0 && { borderTopWidth: 1, borderTopColor: C.line }]}>
                <Dot color={p.color} size={12} />
                <T style={styles.name} numberOfLines={1}>
                  {p.name}
                </T>
                {p.id === me?.id && <T style={styles.tag}>YOU</T>}
                {p.id === room.hostId && <T style={styles.tag}>HOST</T>}
                <T style={[styles.status, { color: col }]}>{st}</T>
                {host && !p.bot && p.id !== room.hostId && (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} hitSlop={8} onPress={() => send({ t: 'kick', id: p.id })}>
                    <Ionicons name="close" size={18} color={C.dim} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </Panel>

        <View style={{ gap: 8 }}>
          <Label>Storm</Label>
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
                // leaving the table demo: back to real GPS where we have it
                if (demo && permission === 'granted') setDemo(false);
              }
            }}
            disabled={!host}
          />
        </View>
        <View style={{ gap: 8 }}>
          <Label>Zone radius</Label>
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
        {host && (
          <View style={styles.rowBetween}>
            <Label>Practice bots</Label>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="Fewer bots" onPress={() => setBots(bots - 1)} style={styles.step} hitSlop={8}>
                <Ionicons name="remove" size={20} color={C.ink} />
              </Pressable>
              <T style={styles.stepN}>{bots}</T>
              <Pressable accessibilityRole="button" accessibilityLabel="More bots" onPress={() => setBots(bots + 1)} style={styles.step} hitSlop={8}>
                <Ionicons name="add" size={20} color={C.ink} />
              </Pressable>
            </View>
          </View>
        )}

        <Button title="Big screen" icon="tv-outline" kind="ghost" onPress={() => (Platform.OS === 'web' ? Linking.openURL(watchUrl) : Share.share({ message: watchUrl, url: watchUrl }))} />
        <View style={styles.utils}>
          <Util icon="volume-high-outline" label="Voice check" onPress={testVoice} />
          {host && <Util icon="eye-off-outline" label="New screen link" onPress={() => send({ t: 'rotateWatch' })} />}
          <Util icon="exit-outline" label="Leave" onPress={leave} />
        </View>
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: insets.bottom + 14 }]}>
        {!gpsOk && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            {permission !== 'granted' && !demo && <Button title="Allow location" kind="ghost" style={{ flex: 1 }} onPress={async () => ((await requestPermission()) ? null : Linking.openSettings())} />}
            {permission === 'granted' && locError && !demo && <Button title="Retry GPS" kind="ghost" style={{ flex: 1 }} onPress={retry} />}
            <Button title="Demo location" kind="ghost" style={{ flex: 1 }} onPress={() => setDemo(true)} />
          </View>
        )}
        {error && <T style={{ color: C.danger, textAlign: 'center', marginBottom: 8 }}>{error}</T>}
        {host ? (
          <Button title={gpsOk ? 'Start the storm' : 'Waiting for GPS'} icon={gpsOk ? 'thunderstorm' : undefined} big disabled={!gpsOk} onPress={() => send({ t: 'start' })} />
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: 18 }}>
            <Label>Waiting for the host</Label>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 18, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  code: { fontFamily: F.monoBold, fontSize: 56, letterSpacing: 8, color: C.ink, lineHeight: 64 },
  iconBtn: { width: 46, height: 46, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  name: { flex: 1, fontFamily: F.bodyBold, fontSize: 18 },
  tag: { fontFamily: F.mono, fontSize: 10, color: C.dim, borderWidth: 1, borderColor: C.line, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, letterSpacing: 1 },
  status: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1, minWidth: 64, textAlign: 'right' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  utils: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: { width: 38, height: 38, borderRadius: R.md, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  stepN: { width: 30, textAlign: 'center', fontFamily: F.monoBold, fontSize: 18 },
  cta: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, backgroundColor: 'rgba(7,17,21,0.95)', borderTopWidth: 1, borderTopColor: C.line },
});
