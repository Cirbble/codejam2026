import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { bingoLineCells, cap, fetchCollection, photoUrl, type Card, type Prompt, type RoomView } from '../api';
import { EmptySlot, GameCard } from '../components/GameCard';
import { Avatar, clock, useClock } from '../components/squadBits';
import { Button, H, Label, Mono, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { useSquad } from '../squad';
import { C, F, TIERS } from '../theme';

// Bingo: one 3x3 card of prompts, all open at once, one clock. A find's points count only once it sits on a
// completed row/column/diagonal; each line adds a bonus, and the first line in the squad adds a bigger one.

const GAP = 8;
const tileWidth = (width: number) => Math.floor((Math.min(width, 520) - 40 - GAP * 2) / 3);

export function BingoHunt({ room }: { room: RoomView }) {
  const nav = useNav();
  const squad = useSquad();
  const now = useClock(squad.skew);
  const { width } = useWindowDimensions();
  const me = squad.session!.playerId;
  const grid = room.grid ?? [];
  const bb = room.bingoBoard;
  const mine = new Set(bb?.marks[me] ?? []);
  const marked = grid.map((p) => mine.has(p.id));
  const onLine = bingoLineCells(marked);
  const myLines = bb?.lines[me] ?? 0;
  const left = (room.endsAt ?? now) - now;
  const span = room.huntMs ?? 5 * 60_000;
  const urgent = left < 30_000;
  const host = room.hostId === me;
  const tw = tileWidth(width);
  const first = bb?.first ?? null;
  const firstName = first === me ? 'You' : room.players.find((p) => p.id === first)?.name;

  // your own finds on your squares (photo and tier), from your collection: the room never sends cards mid-hunt,
  // so nobody else's tiers leak
  const [found, setFound] = useState<Record<string, Card>>({});
  const huntStart = (room.endsAt ?? 0) - span;
  useEffect(() => {
    if (!mine.size) return;
    let live = true;
    fetchCollection()
      .then((cs) => {
        if (!live) return;
        const out: Record<string, Card> = {};
        for (const c of cs) {
          if (c.mode !== 'squad' || !mine.has(c.promptId) || c.at < huntStart - 60_000) continue;
          if (!out[c.promptId] || c.at > out[c.promptId].at) out[c.promptId] = c;
        }
        setFound(out);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mine.size, huntStart]);

  // a buzz when you complete a line
  const prevLines = useRef(myLines);
  useEffect(() => {
    if (myLines > prevLines.current) tap('medium');
    prevLines.current = myLines;
  }, [myLines]);

  const open = (p: Prompt) => nav.push({ name: 'shoot', promptId: p.id, promptText: p.text, examples: p.examples, mode: 'squad' });

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ gap: 2 }}>
          <Label>Bingo</Label>
          <T style={{ fontFamily: F.bodyBold }}>
            {mine.size} of 9 · {myLines} {myLines === 1 ? 'line' : 'lines'}
          </T>
        </View>
        <Text style={{ fontFamily: F.display, fontSize: 44, lineHeight: 48, color: urgent ? C.blaze : C.ink, fontVariant: ['tabular-nums'] }}>{clock(left)}</Text>
      </View>
      <View style={styles.track}>
        <View style={{ width: `${Math.max(0, Math.min(1, left / span)) * 100}%`, height: '100%', backgroundColor: urgent ? C.blaze : C.ink, borderRadius: 999 }} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14, paddingTop: 14, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {first ? (
          <View style={[styles.banner, first === me && { backgroundColor: C.blaze }]}>
            <H size={24} style={{ color: C.white }}>
              BINGO!
            </H>
            <T style={{ flex: 1, color: C.white, fontFamily: F.bodyBold }}>
              {firstName} got the first line{bb ? ` · +${bb.firstBonus}` : ''}
            </T>
          </View>
        ) : (
          null
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, justifyContent: 'center', alignSelf: 'center', width: tw * 3 + GAP * 2 }}>
          {grid.map((p, i) => {
            const done = marked[i];
            const line = onLine.has(i);
            const card = done ? found[p.id] : undefined;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={done ? `${p.text}, found` : `Photograph ${p.text}`}
                disabled={done}
                onPress={() => open(p)}
                style={({ pressed }) => [
                  styles.tile,
                  { width: tw, height: Math.round(tw * 1.12) },
                  done && { backgroundColor: line ? C.blaze : C.ink },
                  done && card && { padding: 0, overflow: 'hidden', borderWidth: line ? 4 : 3, borderColor: line ? C.blaze : TIERS[card.tier].color },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}
              >
                {done && card ? (
                  <>
                    <Image source={{ uri: photoUrl(card, true) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <View style={[styles.tierStrip, { backgroundColor: TIERS[card.tier].color }]}>
                      <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: tw < 100 ? 11 : 13, color: C.white }}>
                        {TIERS[card.tier].name}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Text numberOfLines={5} style={{ fontFamily: F.bodyBold, fontSize: tw < 100 ? 13 : 15, lineHeight: tw < 100 ? 16 : 19, color: done ? C.white : C.ink }}>
                      {cap(p.text)}
                    </Text>
                    <Feather name={done ? 'check-circle' : 'camera'} size={18} color={done ? C.white : C.faint} style={{ alignSelf: 'flex-end' }} />
                  </>
                )}
              </Pressable>
            );
          })}
        </View>
        {room.players.length > 1 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {room.players.map((p) => {
              const n = bb?.marks[p.id]?.length ?? 0;
              const l = bb?.lines[p.id] ?? 0;
              return (
                <View key={p.id} style={[styles.pchip, l > 0 && { backgroundColor: C.ink }]}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: l > 0 ? C.white : C.ink }}>
                    {p.id === me ? 'You' : p.name} · {n}/9{l ? ` · ${l} ${l === 1 ? 'line' : 'lines'}` : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      {host && <Button title="End game now" kind="quiet" onPress={() => squad.send({ t: 'skip' })} disabled={!squad.connected} />}
    </Screen>
  );
}

/** One player's finished card: their card on each square they found, an empty slot elsewhere. */
export function BingoCard({ grid, cards }: { grid: Prompt[]; cards: Card[] }) {
  const { width } = useWindowDimensions();
  const tw = tileWidth(width);
  const byPrompt = new Map(cards.map((c) => [c.promptId, c]));
  const onLine = bingoLineCells(grid.map((p) => byPrompt.has(p.id)));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, justifyContent: 'center', alignSelf: 'center', width: tw * 3 + GAP * 2 }}>
      {grid.map((p, i) => {
        const c = byPrompt.get(p.id);
        return (
          <View key={p.id} style={{ width: tw, gap: 4 }}>
            {/* a find off every completed line scored nothing: dimmed */}
            <View style={[onLine.has(i) && styles.lineRing, c && !onLine.has(i) && { opacity: 0.4 }]}>
              {c ? <GameCard card={c} width={tw - (onLine.has(i) ? 6 : 0)} flat live={false} /> : <EmptySlot width={tw} />}
            </View>
            <Text numberOfLines={2} style={{ fontFamily: F.bodyMid, fontSize: 12, lineHeight: 15, color: C.inkSoft, textAlign: 'center' }}>
              {cap(p.text)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function BingoReveal({ room }: { room: RoomView }) {
  const squad = useSquad();
  const now = useClock(squad.skew);
  const me = squad.session!.playerId;
  const cards = room.reveal ?? [];
  const bb = room.bingoBoard;
  const ranking = [...room.players].sort((a, b) => b.score - a.score);
  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Label>Time's up</Label>
        <H size={32}>Your bingo card</H>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 18, paddingVertical: 14 }} showsVerticalScrollIndicator={false}>
        {room.grid && <BingoCard grid={room.grid} cards={cards.filter((c) => c.playerId === me)} />}
        <View style={{ gap: 8 }}>
          {ranking.map((p) => {
            const l = bb?.lines[p.id] ?? 0;
            return (
              <View key={p.id} style={styles.row}>
                <Avatar id={p.id} name={p.name} size={30} />
                <View style={{ flex: 1 }}>
                  <T style={{ fontFamily: F.bodyBold }}>{p.id === me ? 'You' : p.name}</T>
                  <Mono>
                    {bb?.marks[p.id]?.length ?? 0} of 9 · {l} {l === 1 ? 'line' : 'lines'}
                    {bb?.first === p.id ? ' · first BINGO' : ''}
                  </Mono>
                </View>
                <Text style={{ fontFamily: F.display, fontSize: 24, color: C.ink, fontVariant: ['tabular-nums'] }}>{p.score}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <Mono style={{ textAlign: 'center', marginBottom: 8, fontSize: 15, color: C.ink }}>Results in {Math.max(0, Math.ceil(((room.endsAt ?? now) - now) / 1000))} s</Mono>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { height: 12, borderRadius: 999, backgroundColor: C.paperDeep, marginTop: 8, overflow: 'hidden', borderWidth: 2, borderColor: C.ink },
  tierStrip: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 4, paddingHorizontal: 6, alignItems: 'center' },
  tile: { borderRadius: 16, borderWidth: 2, borderColor: C.ink, backgroundColor: C.card, padding: 10, justifyContent: 'space-between' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, backgroundColor: C.ink },
  pchip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: C.ink },
  lineRing: { borderRadius: 18, borderWidth: 3, borderColor: C.blaze, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, borderWidth: 2, borderColor: C.ink },
});
