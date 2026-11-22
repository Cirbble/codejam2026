import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, FlatList, Linking, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { BoardRow, cap, fetchBoard, type RoomView } from '../api';
import { EmptySlot, GameCard } from '../components/GameCard';
import { Bar, Button, Field, H, Label, Mono, Screen, T } from '../components/ui';
import { HowToLink, HowToSheet, useHowTo } from '../components/HowTo';
import { clock } from '../components/squadBits';
import { useNav } from '../nav';
import { useSquad } from '../squad';
import { C, F, TIERS } from '../theme';

/** Quick play: one player, three 60 s indoor rounds, score goes on the team board. */
const ADJ = ['Swift', 'Bold', 'Lucky', 'Sharp', 'Quiet', 'Brave', 'Sunny', 'Clever', 'Wild', 'Keen', 'Bright', 'Rapid', 'Steady', 'Merry', 'Jolly', 'Nimble'];
const ANIMAL = ['Otters', 'Foxes', 'Herons', 'Badgers', 'Lynx', 'Owls', 'Moose', 'Beavers', 'Falcons', 'Hares', 'Ravens', 'Wolves', 'Loons', 'Bison', 'Martens', 'Puffins'];
/** a fresh table's starting name: readable on the projector, rarely repeated, and one tap to replace */
const randomTeam = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${ANIMAL[Math.floor(Math.random() * ANIMAL.length)]}`;

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
        setTeam(t || randomTeam());
        if (n) setName(n);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (squad.error) setBusy(false);
  }, [squad.error]);
  const t = team.trim().replace(/\s+/g, ' ').slice(0, 24);
  const n = name.trim().slice(0, 16) || t;
  const howto = useHowTo('quick');
  return (
    <Screen>
      <HowToSheet k={howto.open} onClose={howto.close} />
      <Bar onBack={nav.back} title="Quick play" right={<Button title="Team board" icon="award" kind="line" onPress={() => nav.push({ name: 'board' })} style={{ height: 44, paddingHorizontal: 12, borderRadius: 13 }} />} />
      <ScrollView contentContainerStyle={{ gap: 22, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
        <View style={styles.rules}>
          <H size={30} style={{ color: C.paper }}>
            3 rounds. 60 seconds each.
          </H>
        </View>
        <HowToLink onPress={howto.show} />
        <View style={{ gap: 8 }}>
          <Label>Team name</Label>
          <Field value={team} onChangeText={(v) => { squad.clearError(); setTeam(v); }} placeholder="Team name" maxLength={24} autoCapitalize="words" selectTextOnFocus />
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

/** Who the ghost is, as the player should read it. */
const ownGhost = (room: RoomView) => !!(room.ghost && room.team && room.ghost.team.toLowerCase() === room.team.toLowerCase());
/** how the ghost reads mid-sentence: "your best" for your own team's best run, otherwise that team's name */
const ghostName = (room: RoomView) => (ownGhost(room) ? 'your best' : (room.ghost?.team ?? ''));

/**
 * Ghost race, under the Quick play timer: when today's top run found its item this round, a running score
 * against it, and a marker on the round's timeline that the elapsed bar catches up to.
 */
export function GhostBar({ room, left, span }: { room: RoomView; left: number; span: number }) {
  const g = room.ghost;
  if (!g) return null;
  const split = g.splits[room.round - 1] ?? null;
  const elapsed = Math.max(0, Math.min(span, span - left));
  const passed = !!split && elapsed >= split.ms;
  const mine = room.players[0]?.score ?? 0; // points land at each reveal, so this is through last round
  const theirs = g.splits.slice(0, room.round - 1).reduce((n, s) => n + (s?.points ?? 0), 0);
  return (
    <View style={styles.ghost}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="flag" size={15} color={passed ? C.blaze : C.inkSoft} />
        <T numberOfLines={1} style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 15 }}>
          You {mine}
        </T>
        <T numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodyBold, fontSize: 15, color: passed ? C.blaze : C.inkSoft }}>
          {ownGhost(room) ? 'Best' : g.team} {theirs}
        </T>
      </View>
    </View>
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
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <H size={72} style={{ fontVariant: ['tabular-nums'] }}>
              {me?.score ?? 0}
            </H>
            <T numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 22 }}>
              pts
            </T>
          </View>
          {room.counted === false ? (
            <T style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.inkSoft }}>Practice run · doesn't count</T>
          ) : room.boardRank != null ? (
            <T style={{ fontFamily: F.bodyBold, fontSize: 18 }}>
              {room.team} is #{room.boardRank} on the board
            </T>
          ) : null}
          {room.ghost && (
            <View style={[styles.ghostResult, (me?.score ?? 0) > room.ghost.score && { backgroundColor: C.blaze, borderColor: C.blaze }]}>
              <Feather name="flag" size={16} color={(me?.score ?? 0) > room.ghost.score ? C.white : C.ink} />
              <T style={{ fontFamily: F.bodyBold, color: (me?.score ?? 0) > room.ghost.score ? C.white : C.ink }}>
                {(() => {
                  const d = (me?.score ?? 0) - room.ghost!.score;
                  const who = ghostName(room);
                  return d > 0 ? `You beat ${who} by ${d}` : d === 0 ? `Tied with ${who} (${room.ghost!.score})` : `${-d} behind ${who} (${room.ghost!.score})`;
                })()}
              </T>
            </View>
          )}
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
      </ScrollView>
      <View style={{ gap: 10 }}>
        <Button title={room.runsLeft === 0 ? 'Practice again' : 'Play again'} icon="rotate-ccw" kind={room.runsLeft === 0 ? 'line' : 'blaze'} onPress={again} />
        <Button title="Team board" icon="award" kind="line" onPress={() => nav.push({ name: 'board' })} />
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
              <Text style={{ fontFamily: F.display, fontSize: 22, width: 34, color: C.ink }}>{(rows ?? []).findIndex((r) => r.best === item.best) + 1}</Text>
              {item.bestCard ? <GameCard card={item.bestCard} width={40} flat live={false} /> : <View style={{ width: 40 }} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 17 }}>
                  {item.team}
                </T>
                {item.bestCard && <Mono numberOfLines={1}>{item.bestCard.title}</Mono>}
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
  miss: { borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: C.faint, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paperDeep },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 2, borderColor: C.ink },
  ghost: { paddingHorizontal: 4, marginTop: 14 },
  ghostTrack: { height: 10, borderRadius: 999, backgroundColor: C.paperDeep, justifyContent: 'center' },
  ghostMark: { position: 'absolute', width: 14, height: 14, marginLeft: -7, borderRadius: 7, borderWidth: 2, borderColor: C.paper },
  ghostResult: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 14, height: 40, borderRadius: 999, borderWidth: 2, borderColor: C.ink },
});
