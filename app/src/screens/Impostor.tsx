import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { cap, type RoomView } from '../api';
import { EmptySlot, GameCard } from '../components/GameCard';
import { Avatar, useClock } from '../components/squadBits';
import { H, Label, Mono, Screen, T, tap } from '../components/ui';
import { useSquad } from '../squad';
import { C, F } from '../theme';

// Impostor: one player per round hunts a twin prompt. After the hunt the squad sees every card (all wearing the
// real prompt) and votes on whose doesn't fit; then the result names the impostor and the points land.

/** The vote: every player's card, tap one to accuse them. */
export function ImpostorVote({ room }: { room: RoomView }) {
  const squad = useSquad();
  const now = useClock(squad.skew);
  const { width } = useWindowDimensions();
  const me = squad.session!.playerId;
  const imp = room.impostor!;
  const cards = room.reveal ?? [];
  const cw = Math.floor((Math.min(width, 520) - 40 - 14) / 2);
  const left = Math.max(0, Math.ceil(((room.endsAt ?? now) - now) / 1000));
  const vote = (id: string) => {
    tap();
    squad.send({ t: 'vote', target: id });
  };
  return (
    <Screen zone="ridge">
      <View style={{ gap: 4 }}>
        <Label>Round {room.round} · who's the impostor?</Label>
        <H size={30}>{cap(room.prompt?.text)}</H>
        <Mono>
          {imp.you ? 'You were the impostor. Vote like you weren’t. ' : 'One card was shot for a different prompt. '}
          {imp.voted.length} of {room.players.length} voted · {left} s
        </Mono>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingVertical: 16 }} showsVerticalScrollIndicator={false}>
        {room.players.map((p) => {
          const card = cards.find((c) => c.playerId === p.id);
          const mine = p.id === me;
          const picked = imp.myVote === p.id;
          return (
            <Pressable
              key={p.id}
              disabled={mine || !squad.connected}
              accessibilityRole="button"
              accessibilityLabel={mine ? 'Your card' : `Vote for ${p.name}`}
              accessibilityState={{ selected: picked }}
              onPress={() => vote(p.id)}
              style={{ width: cw, gap: 8 }}
            >
              {card ? <GameCard card={card} width={cw} flat live={false} /> : <EmptySlot width={cw} label="No find" />}
              <View style={[styles.voteBtn, picked && { backgroundColor: C.blaze, borderColor: C.blaze }, mine && { borderStyle: 'dashed', borderColor: C.line }]}>
                {picked && <Feather name="check" size={16} color={C.white} />}
                <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15, color: picked ? C.white : mine ? C.inkSoft : C.ink, flexShrink: 1 }}>
                  {mine ? 'You' : picked ? `Voted ${p.name}` : p.name}
                </Text>
                {imp.voted.includes(p.id) && !picked && <Feather name="check-circle" size={14} color={C.inkSoft} />}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Mono style={{ textAlign: 'center', marginBottom: 8, color: C.ink }}>
        {imp.myVote ? 'Tap another card to change your vote' : `+${imp.spotBonus} if you spot the impostor`}
      </Mono>
    </Screen>
  );
}

/** After the vote: who it was, their real prompt, how everyone voted, and the bonuses. */
export function ImpostorResult({ room }: { room: RoomView }) {
  const squad = useSquad();
  const now = useClock(squad.skew);
  const { width } = useWindowDimensions();
  const me = squad.session!.playerId;
  const imp = room.impostor!;
  const res = imp.rounds[room.round - 1];
  const name = (id: string) => (id === me ? 'You' : (room.players.find((p) => p.id === id)?.name ?? 'Someone'));
  const card = res ? room.reveal?.find((c) => c.playerId === res.impostorId) : undefined;
  const last = room.round >= room.totalRounds;
  const left = Math.max(0, Math.ceil(((room.endsAt ?? now) - now) / 1000));
  if (!res) return null;
  const youWere = res.impostorId === me;
  return (
    <Screen zone="ridge">
      <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.verdict, { backgroundColor: res.caught ? C.ink : C.blaze }]}>
          <Label style={{ color: C.paper }}>{res.caught ? 'Caught' : 'Got away'}</Label>
          <H size={34} style={{ color: C.white }}>
            {youWere ? 'You were the impostor' : `${name(res.impostorId)} was the impostor`}
          </H>
          <T style={{ color: C.paper, fontFamily: F.bodyBold }}>
            {youWere ? 'Your' : 'Their'} prompt: {res.twin.text}
          </T>
          {!res.caught && (
            <Mono style={{ color: C.paper }}>
              +{imp.foolBonus} to {name(res.impostorId)} for fooling the squad
            </Mono>
          )}
        </View>
        {card && (
          <View style={{ alignItems: 'center' }}>
            <GameCard card={card} width={Math.min(width * 0.5, 220)} />
          </View>
        )}
        <View style={{ gap: 8 }}>
          <Label>Votes</Label>
          {room.players.map((p) => {
            const target = res.votes[p.id];
            const right = !!target && target === res.impostorId && p.id !== res.impostorId;
            return (
              <View key={p.id} style={styles.row}>
                <Avatar id={p.id} name={p.name} size={28} />
                <T style={{ flex: 1, fontFamily: F.bodyBold }} numberOfLines={1}>
                  {name(p.id)} {target ? `→ ${name(target)}` : '· no vote'}
                </T>
                {right && <Text style={{ fontFamily: F.display, fontSize: 17, color: C.ink }}>+{imp.spotBonus}</Text>}
                {target && p.id !== res.impostorId && <Feather name={right ? 'check' : 'x'} size={18} color={right ? C.ink : C.blaze} />}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <Mono style={{ textAlign: 'center', marginBottom: 8, fontSize: 15, color: C.ink }}>
        {last ? 'Results' : 'Next round'} in {left} s
      </Mono>
    </Screen>
  );
}

/** Results line for a player: impostors spotted and rounds they got away with. */
export function impostorTally(room: RoomView, playerId: string) {
  let spotted = 0;
  let fooled = 0;
  for (const r of room.impostor?.rounds ?? []) {
    if (!r) continue;
    if (r.impostorId === playerId) {
      if (!r.caught) fooled++;
    } else if (r.votes[playerId] === r.impostorId) spotted++;
  }
  return { spotted, fooled };
}

const styles = StyleSheet.create({
  voteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', backgroundColor: C.glass },
  verdict: { gap: 6, padding: 20, borderRadius: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 2, borderColor: C.line },
});
