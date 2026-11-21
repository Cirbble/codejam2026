import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { cap, type Card, type RoomView } from '../api';
import { EmptySlot, GameCard, Sparkle } from '../components/GameCard';
import { Bar, Button, H, IconButton, Label, Mono, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { clearReminders, remindRound } from '../notify';
import { useSquad } from '../squad';
import { C, F, TIERS } from '../theme';

const AVATAR = ['#23914A', '#2563EB', '#8B35E0', '#E0457B', '#F2542D', '#0E7C86', '#9A6B00', '#475569'];
const colorFor = (id: string) => AVATAR[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];

function useClock(skew: number) {
  const [now, setNow] = useState(Date.now() - skew);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() - skew), 250);
    return () => clearInterval(id);
  }, [skew]);
  return now;
}
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colorFor(id), borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.display, color: C.white, fontSize: size * 0.45 }}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

export default function Squad() {
  const squad = useSquad();
  if (!squad.session) return <Start />;
  if (!squad.room) return <Connecting />;
  const r = squad.room;
  const screen =
    r.phase === 'lobby' ? <Lobby room={r} /> : r.phase === 'countdown' || r.phase === 'hunting' ? <Hunt room={r} /> : r.phase === 'reveal' ? <RoundReveal room={r} /> : <Results room={r} />;
  return (
    <View style={{ flex: 1 }}>
      {screen}
      {!squad.connected && (
        <View pointerEvents="none" style={styles.offline}>
          <Feather name="wifi-off" size={16} color={C.white} />
          <Text style={{ fontFamily: F.bodyBold, color: C.white, fontSize: 14 }}>Reconnecting</Text>
        </View>
      )}
    </View>
  );
}

function Connecting() {
  const nav = useNav();
  const squad = useSquad();
  return (
    <Screen>
      <Bar onBack={nav.back} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Mono>Joining squad {squad.session?.code}</Mono>
      </View>
      <Button title="Leave squad" kind="quiet" onPress={squad.leave} />
    </Screen>
  );
}

function Start() {
  const nav = useNav();
  const squad = useSquad();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('rarefind.name').then((n) => n && setName(n)).catch(() => {});
  }, []);
  useEffect(() => {
    if (squad.error) setBusy(false);
  }, [squad.error]);
  const clean = name.trim().slice(0, 16);
  const go = (fn: () => void) => {
    AsyncStorage.setItem('rarefind.name', clean).catch(() => {});
    setBusy(true);
    fn();
  };
  return (
    <Screen>
      <Bar onBack={nav.back} title="Play with friends" />
      <ScrollView contentContainerStyle={{ gap: 28, paddingTop: 12 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Label>Your name</Label>
          <TextInput
            value={name}
            onChangeText={(v) => {
              squad.clearError();
              setName(v);
            }}
            placeholder="Sam"
            placeholderTextColor={C.faint}
            maxLength={16}
            autoCapitalize="words"
            style={styles.input}
          />
        </View>
        <Button title="Start a squad" icon="plus" onPress={() => go(() => squad.create(clean, false))} disabled={!clean} busy={busy && !code} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.rule} />
          <Mono>or join one</Mono>
          <View style={styles.rule} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TextInput
            value={code}
            onChangeText={(v) => {
              squad.clearError();
              setCode(v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4));
            }}
            placeholder="CODE"
            placeholderTextColor={C.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, { flex: 1, minWidth: 0, width: 0, fontFamily: F.mono, letterSpacing: 8, textAlign: 'center', fontSize: 24 }]}
          />
          <Button title="Join" kind="line" onPress={() => go(() => squad.join(code, clean))} disabled={!clean || code.length !== 4} busy={busy && !!code} />
        </View>
        {squad.error && <T style={{ color: C.blaze, fontFamily: F.bodyBold, textAlign: 'center' }}>{squad.error}</T>}
      </ScrollView>
    </Screen>
  );
}

function Lobby({ room }: { room: RoomView }) {
  const nav = useNav();
  const squad = useSquad();
  const me = squad.session!.playerId;
  const host = room.hostId === me;
  return (
    <Screen>
      <Bar onBack={nav.back} title="Squad" />
      <View style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Label>Squad code</Label>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {room.code.split('').map((ch, i) => (
            <View key={i} style={[styles.tile, { transform: [{ rotate: `${(i - 1.5) * 2}deg` }] }]}>
              <Text style={{ fontFamily: F.display, fontSize: 40, color: C.ink }}>{ch}</Text>
            </View>
          ))}
        </View>
        <Button title="Invite friends" icon="share-2" kind="line" onPress={() => Share.share({ message: `Join my Rarefind squad: ${room.code}` })} style={{ height: 48, marginTop: 10 }} />
      </View>
      <ScrollView style={{ flex: 1, marginTop: 24 }} contentContainerStyle={{ gap: 10 }}>
        <Label>{room.players.length} in the squad</Label>
        {room.players.map((p) => (
          <View key={p.id} style={styles.player}>
            <Avatar id={p.id} name={p.name} />
            <T style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 17, opacity: p.connected ? 1 : 0.45 }}>
              {p.name}
              {p.id === me ? ' (you)' : ''}
            </T>
            {p.id === room.hostId && <Mono>host</Mono>}
            {host && p.id !== me && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} hitSlop={10} onPress={() => squad.send({ t: 'kick', id: p.id })}>
                <Feather name="x" size={20} color={C.faint} />
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
      <View style={{ gap: 12 }}>
        {host ? (
          <>
            <View style={styles.toggle}>
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: F.bodyBold }}>Quick indoor rounds</T>
                <Mono>{room.quick ? '60 s each' : '3 min each'}</Mono>
              </View>
              <Switch value={room.quick} disabled={!squad.connected} onValueChange={(v) => squad.send({ t: 'settings', quick: v })} trackColor={{ true: C.ink, false: C.line }} thumbColor={C.white} />
            </View>
            <Button title="Start" icon="play" kind="blaze" onPress={() => squad.send({ t: 'start' })} disabled={!squad.connected} />
          </>
        ) : (
          <Mono style={{ textAlign: 'center', paddingVertical: 18 }}>Waiting for the host to start</Mono>
        )}
        <Button title="Leave squad" kind="quiet" onPress={squad.leave} />
      </View>
    </Screen>
  );
}

function Hunt({ room }: { room: RoomView }) {
  const nav = useNav();
  const squad = useSquad();
  const now = useClock(squad.skew);
  const me = squad.session!.playerId;
  const mine = room.players.find((p) => p.id === me);
  const left = (room.endsAt ?? now) - now;
  const span = (room.quick ? 60 : 180) * 1000;
  const urgent = left < 20_000;
  const host = room.hostId === me;
  const endsLocal = room.endsAt != null ? room.endsAt + squad.skew : null;
  useEffect(() => {
    if (room.phase !== 'hunting' || endsLocal == null) return;
    if (mine?.found) clearReminders();
    else remindRound(`${room.code}:${room.round}`, endsLocal, cap(room.prompt?.text));
  }, [room.phase, room.code, room.round, endsLocal, mine?.found, room.prompt?.text]);

  if (room.phase === 'countdown') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Label>
            Round {room.round} of {room.totalRounds}
          </Label>
          <H size={140} style={{ fontVariant: ['tabular-nums'] }}>
            {Math.max(1, Math.ceil(left / 1000))}
          </H>
        </View>
      </Screen>
    );
  }
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>
          Round {room.round} of {room.totalRounds}
        </Label>
        <Text style={{ fontFamily: F.mono, fontSize: 22, color: urgent ? C.blaze : C.ink, fontVariant: ['tabular-nums'] }}>{clock(left)}</Text>
      </View>
      <View style={styles.track}>
        <View style={{ width: `${Math.max(0, Math.min(1, left / span)) * 100}%`, height: '100%', backgroundColor: urgent ? C.blaze : C.ink, borderRadius: 999 }} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={styles.promptCard}>
          <Sparkle size={34} />
          <H size={44} style={{ color: C.paper }}>
            {cap(room.prompt?.text)}
          </H>
          {room.prompt?.examples && <T style={{ color: '#A9B1A2' }}>Like {room.prompt.examples}</T>}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {room.players.map((p) => (
          <View key={p.id} style={[styles.pchip, p.found && { backgroundColor: C.ink }]}>
            {p.found && <Feather name="check" size={14} color={C.white} />}
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: p.found ? C.white : C.ink }}>{p.id === me ? 'You' : p.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ gap: 12 }}>
        {mine?.found ? (
          <View style={styles.locked}>
            <Feather name="lock" size={18} color={C.ink} />
            <T style={{ fontFamily: F.bodyBold }}>Your find is in</T>
          </View>
        ) : (
          <Button
            title="Take photo"
            icon="camera"
            kind="blaze"
            onPress={() => room.prompt && nav.push({ name: 'shoot', promptId: room.prompt.id, promptText: room.prompt.text, examples: room.prompt.examples, mode: 'squad' })}
          />
        )}
        {host && <Button title="End round now" kind="quiet" onPress={() => squad.send({ t: 'skip' })} disabled={!squad.connected} />}
      </View>
    </Screen>
  );
}

function sameAs(cards: Card[]) {
  const m = new Map<string, string>();
  const out: Record<string, string> = {};
  for (const c of cards) {
    const prev = m.get(c.label);
    if (prev) out[c.id] = prev;
    else m.set(c.label, c.playerName ?? '');
  }
  return out;
}

function RoundReveal({ room }: { room: RoomView }) {
  const squad = useSquad();
  const now = useClock(squad.skew);
  const { width } = useWindowDimensions();
  const cards = room.reveal ?? [];
  const same = useMemo(() => sameAs(cards), [cards]);
  const cw = cards.length === 1 ? Math.min(width - 80, 300) : Math.min(width * 0.62, 260);
  const last = room.round >= room.totalRounds;
  return (
    <Screen pad={false}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 6 }}>
        <Label>Round {room.round} reveal</Label>
        <H size={32}>{cap(room.prompt?.text)}</H>
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {cards.length === 0 ? (
          <View style={{ alignItems: 'center', gap: 18 }}>
            <EmptySlot width={150} />
            <H size={26} style={{ textAlign: 'center', color: C.inkSoft }}>
              Nobody found one
            </H>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, paddingHorizontal: 20, paddingVertical: 12, flexGrow: 1, justifyContent: cards.length * (cw + 18) < width ? 'center' : 'flex-start' }} snapToInterval={cw + 18} decelerationRate="fast">
            {cards.map((c) => (
              <View key={c.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T style={{ fontFamily: F.bodyBold, fontSize: 18 }}>{c.playerName}</T>
                  <T style={{ fontFamily: F.display, fontSize: 18, color: TIERS[c.tier].color }}>+{c.points}</T>
                  {c.sameAs?.length ? <Mono>same as {c.sameAs.join(', ')}</Mono> : same[c.id] ? <Mono>same as {same[c.id]}</Mono> : null}
                </View>
                <GameCard card={c} width={cw} />
              </View>
            ))}
          </ScrollView>
        )}
      </View>
      <Mono style={{ textAlign: 'center', marginBottom: 8, fontSize: 15, color: C.ink }}>
        {last ? 'Results' : 'Next round'} in {Math.max(0, Math.ceil(((room.endsAt ?? now) - now) / 1000))} s
      </Mono>
    </Screen>
  );
}

function Results({ room }: { room: RoomView }) {
  const nav = useNav();
  const squad = useSquad();
  const { width } = useWindowDimensions();
  const me = squad.session!.playerId;
  const all = room.rounds.flatMap((r) => r.cards);
  const best = [...all].sort((a, b) => b.points - a.points || b.rarity - a.rarity)[0];
  const ranking = [...room.players].sort((a, b) => b.score - a.score);
  const top = ranking[0]?.score ?? 0;
  const winners = room.winners ?? (top > 0 ? ranking.filter((p) => p.score === top).map((p) => p.id) : []);
  const nameOf = (id: string) => (id === me ? 'You' : room.players.find((p) => p.id === id)?.name ?? '');
  const cardById = new Map(all.map((c) => [c.id, c]));
  const roundsWon = (id: string) => (room.roundWinners ?? []).map((w, i) => (w === id ? i + 1 : 0)).filter(Boolean);
  const cw = Math.min(width * 0.56, 230);
  return (
    <Screen>
      <Bar onBack={nav.back} title="Squad results" />
      <ScrollView contentContainerStyle={{ gap: 24, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Label>{winners.length > 1 ? 'Tied for first' : winners.length === 1 ? 'Winner' : 'No finds this game'}</Label>
          {winners.length > 0 && (
            <H size={40} style={{ textAlign: 'center' }}>
              {winners.map(nameOf).join(' & ')}
            </H>
          )}
          {winners.length > 0 && <T style={{ fontFamily: F.bodyBold, color: C.inkSoft }}>{top} points</T>}
        </View>
        {best && (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Label>Find of the game · {best.playerName}</Label>
            <GameCard card={best} width={cw} />
          </View>
        )}
        <View style={{ gap: 8 }}>
          {ranking.map((p, i) => {
            const theirs = all.filter((c) => (c.playerId ? c.playerId === p.id : c.playerName === p.name));
            const bestCard = (room.best?.[p.id] && cardById.get(room.best[p.id])) || [...theirs].sort((a, b) => b.points - a.points)[0];
            const won = roundsWon(p.id);
            return (
              <View key={p.id} style={[styles.rank, winners.includes(p.id) && { backgroundColor: C.card }]}>
                <Mono style={{ width: 22, color: C.ink, fontSize: 16 }}>{i + 1}</Mono>
                <Avatar id={p.id} name={p.name} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T style={{ fontFamily: F.bodyBold }}>
                    {p.name}
                    {p.id === me ? ' (you)' : ''}
                  </T>
                  <Mono style={{ marginTop: 2 }}>
                    {theirs.length} {theirs.length === 1 ? 'find' : 'finds'}
                    {won.length ? ` · won round ${won.join(', ')}` : ''}
                  </Mono>
                </View>
                {bestCard && <GameCard card={bestCard} width={44} flat live={false} />}
                <Text style={{ fontFamily: F.display, fontSize: 26, color: C.ink, fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'right' }}>{p.score}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ gap: 10 }}>
        {room.hostId === me ? <Button title="Play again" icon="rotate-ccw" onPress={() => squad.send({ t: 'again' })} /> : <Mono style={{ textAlign: 'center', paddingVertical: 12 }}>Waiting for the host</Mono>}
        <Button
          title="Leave squad"
          kind="quiet"
          onPress={() => {
            squad.leave();
            nav.reset();
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { height: 58, borderRadius: 16, borderWidth: 2, borderColor: C.ink, backgroundColor: C.card, paddingHorizontal: 18, fontFamily: F.bodyMid, fontSize: 18, color: C.ink },
  rule: { flex: 1, height: 2, backgroundColor: C.line },
  tile: { width: 62, height: 80, borderRadius: 12, borderWidth: 2, borderColor: C.ink, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 4px 0px ${C.ink}` },
  player: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 2, borderColor: C.line },
  track: { height: 8, borderRadius: 999, backgroundColor: C.paperDeep, marginTop: 10, overflow: 'hidden' },
  pchip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: C.ink },
  locked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 58, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: C.ink },
  offline: { position: 'absolute', top: 54, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: 999, backgroundColor: C.ink },
  promptCard: { backgroundColor: C.ink, borderRadius: 26, padding: 24, paddingTop: 22, gap: 14, transform: [{ rotate: '-1.5deg' }], boxShadow: '6px 8px 0px rgba(18,21,15,0.18)' },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 2, borderColor: C.ink },
});
