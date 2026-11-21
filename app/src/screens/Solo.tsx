import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, FlatList, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { BoardRow, cap, fetchBoard, type RoomView } from '../api';
import { EmptySlot, GameCard } from '../components/GameCard';
import { Bar, Button, H, Label, Mono, Screen, T } from '../components/ui';
import { useNav } from '../nav';
import { useSquad } from '../squad';
import { C, F, TIERS } from '../theme';

/** Quick play: one player, three 60 s indoor rounds, score goes on the team board. */
export function SoloStart() {
  const nav = useNav();
  const squad = useSquad();
  const [perm, requestPerm, getPerm] = useCameraPermissions();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && getPerm().then((p) => p.granted && setCamBlocked(false)));
    return () => sub.remove();
  }, [getPerm]);
  const [team, setTeam] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [camBlocked, setCamBlocked] = useState(false);
  useEffect(() => {
    AsyncStorage.multiGet(['rarefind.team', 'rarefind.name'])
      .then(([[, t], [, n]]) => {
        if (t) setTeam(t);
        if (n) setName(n);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (squad.error) setBusy(false);
  }, [squad.error]);
  const t = team.trim().replace(/\s+/g, ' ').slice(0, 24);
  const n = name.trim().slice(0, 16) || t;
  return (
    <Screen>
      <Bar onBack={nav.back} title="Quick play" right={<Button title="Team board" icon="award" kind="line" onPress={() => nav.push({ name: 'board' })} style={{ height: 44, paddingHorizontal: 12, borderRadius: 13 }} />} />
      <ScrollView contentContainerStyle={{ gap: 22, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
        <View style={styles.rules}>
          <H size={30} style={{ color: C.paper }}>
            3 rounds. 60 seconds each.
          </H>
        </View>
        <View style={{ gap: 8 }}>
          <Label>Team</Label>
          <TextInput value={team} onChangeText={(v) => { squad.clearError(); setTeam(v); }} placeholder="Team name" placeholderTextColor={C.faint} maxLength={24} autoCapitalize="words" style={styles.input} />
        </View>
        <View style={{ gap: 8 }}>
          <Label>Your name</Label>
          <TextInput value={name} onChangeText={setName} placeholder="Optional" placeholderTextColor={C.faint} maxLength={16} autoCapitalize="words" style={styles.input} />
        </View>
        <Button
          title="Start"
          icon="play"
          disabled={!t}
          busy={busy}
          onPress={async () => {
            AsyncStorage.multiSet([['rarefind.team', t], ['rarefind.name', name.trim()]]).catch(() => {});
            setBusy(true);
            // ask for the camera now, so the permission prompt doesn't eat round one
            const fresh = await getPerm().catch(() => perm);
            let granted = !!fresh?.granted;
            if (!granted && fresh?.canAskAgain !== false) granted = !!(await requestPerm().catch(() => null))?.granted;
            if (!granted) {
              setBusy(false);
              setCamBlocked(true);
              return;
            }
            if (squad.session) {
              squad.leave(); // a squad you were in is left properly, not orphaned
              await new Promise((r) => setTimeout(r, 300));
            }
            squad.solo(n, t);
          }}
        />
        {camBlocked && (
          <View style={{ gap: 10 }}>
            <T style={{ color: C.blaze, fontFamily: F.bodyBold, textAlign: 'center' }}>
              {Platform.OS === 'web' ? 'Allow the camera for this site in your browser, then try again.' : 'Quick play needs the camera.'}
            </T>
            {Platform.OS !== 'web' && <Button title="Open settings" kind="line" onPress={() => Linking.openSettings()} />}
          </View>
        )}
        {squad.error && <T style={{ color: C.blaze, fontFamily: F.bodyBold, textAlign: 'center' }}>{squad.error}</T>}
      </ScrollView>
    </Screen>
  );
}

export function SoloResults({ room }: { room: RoomView }) {
  const nav = useNav();
  const squad = useSquad();
  const { width } = useWindowDimensions();
  const me = room.players[0];
  const cards = room.rounds.flatMap((r) => r.cards);
  const best = [...cards].sort((a, b) => b.points - a.points || b.rarity - a.rarity || a.at - b.at)[0];
  const again = () => {
    const team = room.team ?? '';
    const name = me?.name ?? team;
    squad.leave();
    setTimeout(() => squad.solo(name, team), 300);
  };
  return (
    <Screen>
      <Bar onBack={() => { squad.leave(); nav.reset(); }} title={room.team ?? 'Quick play'} />
      <ScrollView contentContainerStyle={{ gap: 22, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Label>Score</Label>
          <H size={72} style={{ fontVariant: ['tabular-nums'] }}>
            {me?.score ?? 0}
          </H>
          {room.counted === false ? (
            <T style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.inkSoft }}>Practice run · doesn't count</T>
          ) : room.boardRank != null ? (
            <T style={{ fontFamily: F.bodyBold, fontSize: 18 }}>
              {room.team} is #{room.boardRank} on the board
            </T>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
          {room.rounds.map((r, i) => {
            const c = r.cards[0];
            return c ? (
              <GameCard key={i} card={c} width={Math.min(118, (width - 60) / 3)} flat live={false} />
            ) : (
              <View key={i} style={{ alignItems: 'center', gap: 6 }}>
                <EmptySlot width={Math.min(118, (width - 60) / 3)} />
                <Mono style={{ color: C.ink }}>No find</Mono>
              </View>
            );
          })}
        </View>
        {best && (
          <T style={{ textAlign: 'center', color: C.inkSoft }}>
            Best find: <Text style={{ fontFamily: F.bodyBold, color: TIERS[best.tier].text }}>{best.title}</Text>
          </T>
        )}
      </ScrollView>
      <View style={{ gap: 10 }}>
        <Button title={room.runsLeft === 0 ? 'Practice again' : 'Play again'} icon="rotate-ccw" kind={room.runsLeft === 0 ? 'line' : 'blaze'} onPress={again} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title="Team board" icon="award" kind="line" onPress={() => nav.push({ name: 'board' })} style={{ flex: 1, paddingHorizontal: 10 }} />
          <Button title="Squad" icon="users" kind="line" onPress={() => { squad.leave(); nav.reset({ name: 'squad' }); }} style={{ flex: 1, paddingHorizontal: 10 }} />
        </View>
        <Button title="Done" kind="quiet" onPress={() => { squad.leave(); nav.reset(); }} />
      </View>
    </Screen>
  );
}

export function Board() {
  const nav = useNav();
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    fetchBoard()
      .then((r) => {
        setRows(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);
  return (
    <Screen>
      <Bar onBack={nav.back} title="Team board" />
      {!rows ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Mono>{failed ? "Can't reach the server" : 'Loading'}</Mono>
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <H size={28}>No teams yet</H>
          <Button title="Quick play" icon="zap" onPress={() => nav.push({ name: 'solo' })} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.team}
          contentContainerStyle={{ gap: 8, paddingBottom: 20 }}
          renderItem={({ item, index }) => (
            <View style={[styles.row, index === 0 && { backgroundColor: C.card }]}>
              <Text style={{ fontFamily: F.display, fontSize: 22, width: 34, color: C.ink }}>{index + 1}</Text>
              {item.bestCard ? <GameCard card={item.bestCard} width={40} flat live={false} /> : <View style={{ width: 40 }} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 17 }}>
                  {item.team}
                </T>
                <Mono>
                  {item.plays} {item.plays === 1 ? 'run' : 'runs'}
                  {item.bestCard ? ` · ${item.bestCard.title}` : ''}
                </Mono>
              </View>
              <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, fontVariant: ['tabular-nums'] }}>{item.best}</Text>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rules: { backgroundColor: C.ink, borderRadius: 24, padding: 22, gap: 10, transform: [{ rotate: '-1deg' }] },
  input: { height: 58, borderRadius: 16, borderWidth: 2, borderColor: C.ink, backgroundColor: C.card, paddingHorizontal: 18, fontFamily: F.bodyMid, fontSize: 18, color: C.ink },
  miss: { borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: C.faint, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paperDeep },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 2, borderColor: C.ink },
});
