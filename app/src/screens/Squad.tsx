import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cap, inviteLink, type Card, type RoomView } from '../api';
import { shareText } from '../share';
import { EmptySlot, GameCard, Sparkle } from '../components/GameCard';
import { RarityMeter } from '../components/RarityMeter';
import { Bar, Button, Field, H, IconButton, Label, Mono, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { FadeIn } from '../components/Motion';
import { useSquad } from '../squad';
import { SoloResults } from './Solo';
import { BingoCard, BingoHunt, BingoReveal } from './Bingo';
import { ImpostorResult, ImpostorVote, impostorTally } from './Impostor';
import { Avatar, clock, useClock } from '../components/squadBits';
import { HowToLink, HowToSheet, modeOf, useHowTo } from '../components/HowTo';
import { GhostBar } from './Solo';
import { C, F, TIERS } from '../theme';

/** true once the squad has been disconnected for a moment: a quick reconnect never flashes the banner */
function useOutage(connected: boolean) {
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (connected) {
      setOut(false);
      return;
    }
    const t = setTimeout(() => setOut(true), 1500);
    return () => clearTimeout(t);
  }, [connected]);
  return out;
}

/** asks before leaving a game that is under way */
function confirmLeave(solo: boolean, go: () => void) {
  const title = solo ? 'End this run?' : 'Leave the squad?';
  const body = solo ? 'This run won\'t count.' : 'The others keep playing without you.';
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || window.confirm(`${title}\n${body}`)) go();
    return;
  }
  Alert.alert(title, body, [
    { text: 'Stay', style: 'cancel' },
    { text: solo ? 'End run' : 'Leave', style: 'destructive', onPress: go },
  ]);
}

export default function Squad() {
  const squad = useSquad();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const outage = useOutage(squad.connected);
  if (!squad.session) return <Start />;
  if (!squad.room) return <Connecting />;
  const r = squad.room;
  const midGame = r.phase === 'countdown' || r.phase === 'hunting' || r.phase === 'reveal';
  // Bingo's header makes room for the X beside it; the other screens get a strip above them
  const besideX = r.phase === 'hunting' && !!r.bingo;
  const screen =
    r.phase === 'lobby' ? (
      <Lobby room={r} />
    ) : r.phase === 'countdown' || (r.phase === 'hunting' && !r.bingo) ? (
      <Hunt room={r} />
    ) : r.phase === 'hunting' ? (
      <BingoHunt room={r} />
    ) : r.phase === 'reveal' ? (
      r.bingo ? <BingoReveal room={r} /> : r.impostor ? r.impostor.voteOpen ? <ImpostorVote room={r} /> : <ImpostorResult room={r} /> : <RoundReveal room={r} />
    ) : r.solo ? (
      <SoloResults room={r} />
    ) : (
      <Results room={r} />
    );
  return (
    // mid-game the screen sits below its own strip for the X, so the X never covers the game's header
    <View style={{ flex: 1, paddingTop: midGame && !besideX ? 52 : 0 }}>
      {screen}
      {midGame && (
        <View style={[styles.quit, { top: insets.top + (besideX ? 10 : 6) }]}>
          <IconButton
            icon="x"
            label={r.solo ? 'End run' : 'Leave squad'}
            onPress={() =>
              confirmLeave(!!r.solo, () => {
                squad.leave();
                nav.reset();
              })
            }
          />
        </View>
      )}
      {outage && (
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
  const [code, setCode] = useState(squad.pendingJoin ?? '');
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
      <Bar onBack={nav.back} title="Squad" />
      <ScrollView contentContainerStyle={{ gap: 28, paddingTop: 12 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Label>Your name</Label>
          <Field
            value={name}
            onChangeText={(v) => {
              squad.clearError();
              setName(v);
            }}
            placeholder="Sam"
            maxLength={16}
            autoCapitalize="words"
          />
        </View>
        <Button title="Start a squad" icon="plus" onPress={() => go(() => squad.create(clean, false))} disabled={!clean} busy={busy && !code} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.rule} />
          <Mono>or join one</Mono>
          <View style={styles.rule} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Field
            value={code}
            onChangeText={(v) => {
              squad.clearError();
              setCode(v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4));
            }}
            placeholder="CODE"
            autoCapitalize="characters"
            autoCorrect={false}
            style={[{ flex: 1, minWidth: 0, width: 0, fontFamily: F.mono, letterSpacing: 8, textAlign: 'center', fontSize: 24 }]}
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
  const [copied, setCopied] = useState(false);
  const squad = useSquad();
  const me = squad.session!.playerId;
  const host = room.hostId === me;
  // the mode's how-to opens the first time this phone meets it (also when the host switches modes)
  const howto = useHowTo(modeOf(room));
  return (
    <Screen>
      <HowToSheet k={howto.open} onClose={howto.close} />
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
        <Button title={copied ? 'Link copied' : 'Invite friends'} icon="share-2" kind="line" onPress={async () => (await shareText(`Join my Brillion squad: ${inviteLink(room.code)} (code ${room.code})`)) === 'copied' && setCopied(true)} style={{ height: 48, marginTop: 10 }} />
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
            <ModePicker room={room} onHelp={howto.show} />
            {/* where you play sets both the prompt pool and the clock, so the two presets say both */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { quick: true, label: `Indoor · ${room.bingo ? '3 min' : '60 s'}` },
                { quick: false, label: `Outdoor · ${room.bingo ? '5 min' : '3 min'}` },
              ].map((o) => {
                const on = room.quick === o.quick;
                return (
                  <Pressable
                    key={o.label}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    disabled={!squad.connected}
                    onPress={() => {
                      tap();
                      squad.send({ t: 'settings', quick: o.quick });
                    }}
                    style={[styles.mode, { flexBasis: 0 }, on && { backgroundColor: C.ink }]}
                  >
                    <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 16, color: on ? C.white : C.ink }}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Button title={room.impostor && room.players.length < (room.impostor.minPlayers ?? 3) ? `Needs ${room.impostor.minPlayers ?? 3} players` : 'Start'} icon="play" kind="blaze" onPress={() => squad.send({ t: 'start' })} disabled={!squad.connected || (!!room.impostor && room.players.length < (room.impostor.minPlayers ?? 3))} />
            {squad.error && <T style={{ color: C.blaze, fontFamily: F.bodyBold, textAlign: 'center' }}>{squad.error}</T>}
          </>
        ) : (
          <View style={{ paddingVertical: 10, gap: 6 }}>
            <Mono style={{ textAlign: 'center' }}>
              {room.bingo ? 'Bingo game · ' : room.unique ? 'Unique only · ' : room.impostor ? 'Impostor · ' : ''}Waiting for the host to start
            </Mono>
            <HowToLink onPress={howto.show} />
          </View>
        )}
        <Button title="Leave squad" kind="quiet" onPress={squad.leave} />
      </View>
    </Screen>
  );
}

type Mode = 'classic' | 'bingo' | 'unique' | 'impostor';
const MODES: { key: Mode; label: string }[] = [
  { key: 'classic', label: 'Classic' },
  { key: 'bingo', label: 'Bingo' },
  { key: 'unique', label: 'Unique' },
  { key: 'impostor', label: 'Impostor' },
];

/** Host's game mode choice: the modes are exclusive, so one row of pills and a line saying what it does. */
function ModePicker({ room, onHelp }: { room: RoomView; onHelp: () => void }) {
  const squad = useSquad();
  const mode: Mode = room.bingo ? 'bingo' : room.unique ? 'unique' : room.impostor ? 'impostor' : 'classic';
  const min = room.impostor?.minPlayers ?? 3;
  const about: Record<Mode, string> = {
    classic: '5 rounds, one prompt each',
    bingo: 'A 3×3 card, all at once',
    unique: 'Same find as a friend scores 0',
    impostor: 'One player has a different prompt',
  };
  const pick = (m: Mode) => {
    tap();
    squad.send(m === 'classic' ? { t: 'settings', bingo: false, unique: false, impostor: false } : { t: 'settings', [m]: true });
  };
  return (
    <View style={[styles.toggle, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {MODES.map((m) => {
          const on = m.key === mode;
          return (
            <Pressable
              key={m.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              disabled={!squad.connected}
              onPress={() => pick(m.key)}
              style={[styles.mode, on && { backgroundColor: C.ink }]}
            >
              <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 16, color: on ? C.white : C.ink }}>
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Mono style={{ flex: 1, color: C.inkSoft }}>{about[mode]}</Mono>
        <Pressable accessibilityRole="button" accessibilityLabel="How to play" hitSlop={10} onPress={onHelp}>
          <Feather name="help-circle" size={22} color={C.ink} />
        </Pressable>
      </View>
    </View>
  );
}

function Hunt({ room }: { room: RoomView }) {
  const nav = useNav();
  const squad = useSquad();
  const now = useClock(squad.skew);
  const me = squad.session!.playerId;
  const mine = room.players.find((p) => p.id === me);
  const left = (room.endsAt ?? now) - now;
  const span = room.huntMs ?? (room.quick ? 60 : 180) * 1000;
  const urgent = left < 20_000;
  const host = room.hostId === me;

  if (room.phase === 'countdown') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Label>{room.bingo ? `Bingo · 9 squares · ${clock(span)}` : `Round ${room.round} of ${room.totalRounds}`}</Label>
          <H size={140} style={{ fontVariant: ['tabular-nums'] }}>
            {Math.max(1, Math.ceil(left / 1000))}
          </H>
        </View>
      </Screen>
    );
  }
  return (
    <Screen>
      <Label style={{ textAlign: 'center' }}>
        Round {room.round} of {room.totalRounds}
      </Label>
      <Text style={{ fontFamily: F.display, fontSize: 64, lineHeight: 70, textAlign: 'center', color: urgent ? C.blaze : C.ink, fontVariant: ['tabular-nums'] }}>{clock(left)}</Text>
      <View style={styles.track}>
        <View style={{ width: `${Math.max(0, Math.min(1, left / span)) * 100}%`, height: '100%', backgroundColor: urgent ? C.blaze : C.ink, borderRadius: 999 }} />
      </View>
      {room.solo && <GhostBar room={room} left={left} span={span} />}
      <View style={{ flex: 1, justifyContent: 'flex-start', paddingTop: 26 }}>
        <FadeIn key={room.round} dx={40} dy={0} duration={420}>
        <View style={[styles.promptCard, room.impostor?.you && { backgroundColor: C.blaze }]}>
          {room.impostor?.you ? <Label style={{ color: C.white }}>You're the impostor</Label> : <Sparkle size={34} />}
          <H size={44} style={{ color: C.paper }}>
            {cap(room.prompt?.text)}
          </H>
          {room.unique && <Mono style={{ color: C.paper }}>Unique only: skip the obvious one. Same find as a friend scores 0.</Mono>}
          {room.impostor &&
            (room.impostor.you ? (
              <T style={{ color: C.white, fontFamily: F.bodyBold }}>
                Everyone else got "{room.impostor.crewPrompt?.text}". Find yours so it passes as theirs.
              </T>
            ) : (
              <Mono style={{ color: C.paper }}>One of you has a different prompt. Watch what they shoot.</Mono>
            ))}
        </View>
        </FadeIn>
        {!room.solo && room.players.length > 1 && (
          <T style={{ fontFamily: F.bodyBold, textAlign: 'center', marginTop: 22 }}>
            {room.players.filter((p) => p.found).length} of {room.players.length} found
          </T>
        )}
      {room.players.length > 1 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, justifyContent: 'center' }}>
        {room.players.map((p) => (
          <View key={p.id} style={[styles.pchip, p.found && { backgroundColor: C.ink }]}>
            {p.found && <Feather name="check" size={14} color={C.white} />}
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: p.found ? C.white : C.ink }}>{p.id === me ? 'You' : p.name}</Text>
          </View>
        ))}
      </View>}
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
        {host && <Button title={room.solo ? 'Skip this one' : 'End round now'} kind="quiet" onPress={() => squad.send({ t: 'skip' })} disabled={!squad.connected} />}
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
  const twoLine = cards.some((c) => c.sameAs?.length || same[c.id]); // keeps the cards in a row aligned
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
              <View key={c.id} style={{ gap: 10, width: cw }}>
                <View style={{ gap: 2, alignItems: 'center', minHeight: twoLine ? 50 : undefined }}>
                  <T numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 18 }}>{c.playerName}</T>
                  {c.sameAs?.length ? (
                    <Mono numberOfLines={1} style={room.unique ? { color: C.blaze } : undefined}>
                      {room.unique ? 'Scores 0 · ' : ''}same as {c.sameAs.join(', ')}
                    </Mono>
                  ) : same[c.id] ? (
                    <Mono numberOfLines={1}>same as {same[c.id]}</Mono>
                  ) : null}
                </View>
                <GameCard card={c} width={cw} />
                <H size={26} style={{ color: TIERS[c.tier].text, textAlign: 'center' }}>
                  {TIERS[c.tier].name} · {room.unique && c.sameAs?.length ? '+0' : `+${c.points}`}
                </H>
                <RarityMeter card={c} width={cw} delay={350} />
              </View>
            ))}
          </ScrollView>
        )}
        <Mono style={{ textAlign: 'center', marginTop: 10, fontSize: 15, color: C.ink }}>
          {last ? 'Results' : 'Next round'} in {Math.max(0, Math.ceil(((room.endsAt ?? now) - now) / 1000))} s
        </Mono>
      </View>
    </Screen>
  );
}

function Results({ room }: { room: RoomView }) {
  const nav = useNav();
  const squad = useSquad();
  const { width } = useWindowDimensions();
  const me = squad.session!.playerId;
  const all = room.rounds.flatMap((r) => r.cards);
  const best = [...all].sort((a, b) => b.points - a.points || b.rarity - a.rarity || a.at - b.at)[0];
  const ranking = [...room.players].sort((a, b) => b.score - a.score);
  const top = ranking[0]?.score ?? 0;
  const winners = room.winners ?? (top > 0 ? ranking.filter((p) => p.score === top).map((p) => p.id) : []);
  const nameOf = (id: string) => (id === me ? 'You' : room.players.find((p) => p.id === id)?.name ?? '');
  const cardById = new Map(all.map((c) => [c.id, c]));
  const roundsWon = (id: string) => (room.roundWinners ?? []).map((w, i) => (w === id ? i + 1 : 0)).filter(Boolean);
  const cw = Math.min(width * 0.56, 230);
  const bb = room.bingo ? room.bingoBoard : null;
  const [viewing, setViewing] = useState(me); // bingo: whose card is shown
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
          {winners.length > 0 && <T numberOfLines={1} style={{ fontFamily: F.bodyBold, color: C.inkSoft }}>{top} pts</T>}
        </View>
        {bb && room.grid && (
          <View style={{ gap: 10 }}>
            <Label style={{ textAlign: 'center' }}>
              {viewing === me ? 'Your card' : `${nameOf(viewing)}'s card`} · {bb.lines[viewing] ?? 0} {(bb.lines[viewing] ?? 0) === 1 ? 'line' : 'lines'}
              {bb.first === viewing ? ' · first BINGO' : ''}
            </Label>
            <BingoCard grid={room.grid} cards={all.filter((c) => c.playerId === viewing)} />
            {room.players.length > 1 && <Mono style={{ textAlign: 'center' }}>Tap a player to see their card</Mono>}
          </View>
        )}
        {best && !bb && (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Label>Find of the game · {best.playerId === me || (!best.playerId && best.playerName === room.players.find((p) => p.id === me)?.name) ? 'You' : best.playerName}</Label>
            <GameCard card={best} width={cw} />
          </View>
        )}
        <View style={{ gap: 8 }}>
          {ranking.map((p, i) => {
            const theirs = all.filter((c) => (c.playerId ? c.playerId === p.id : c.playerName === p.name));
            const bestCard = (room.best?.[p.id] && cardById.get(room.best[p.id])) || [...theirs].sort((a, b) => b.points - a.points)[0];
            const won = roundsWon(p.id);
            const lines = bb?.lines[p.id] ?? 0;
            return (
              <Pressable
                key={p.id}
                disabled={!bb}
                accessibilityRole={bb ? 'button' : undefined}
                accessibilityLabel={bb ? `Show ${p.name}'s card` : undefined}
                onPress={() => setViewing(p.id)}
                style={[styles.rank, winners.includes(p.id) && { backgroundColor: C.card }, bb && viewing === p.id && { borderColor: C.blaze }]}
              >
                <Mono style={{ width: 22, color: C.ink, fontSize: 16 }}>{i + 1}</Mono>
                <Avatar id={p.id} name={p.name} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T style={{ fontFamily: F.bodyBold }}>
                    {p.name}
                    {p.id === me ? ' (you)' : ''}
                  </T>
                  <Mono style={{ marginTop: 2 }}>
                    {bb
                      ? `${theirs.length} of 9 · ${lines} ${lines === 1 ? 'line' : 'lines'}${bb.first === p.id ? ' · first BINGO' : ''}`
                      : room.impostor
                        ? (() => {
                            const t = impostorTally(room, p.id);
                            return `${theirs.length} ${theirs.length === 1 ? 'find' : 'finds'} · spotted ${t.spotted}${t.fooled ? ` · fooled ${t.fooled}` : ''}`;
                          })()
                        : `${theirs.length} ${theirs.length === 1 ? 'find' : 'finds'}${won.length ? ` · ${won.length} ${won.length === 1 ? 'win' : 'wins'}` : ''}`}
                  </Mono>
                </View>
                {bestCard && <GameCard card={bestCard} width={44} flat live={false} />}
                <Text style={{ fontFamily: F.display, fontSize: 26, color: C.ink, fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'right' }}>{p.score}</Text>
              </Pressable>
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
  rule: { flex: 1, height: 2, backgroundColor: C.line },
  tile: { width: 62, height: 80, borderRadius: 12, borderWidth: 2, borderColor: C.ink, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 4px 0px ${C.ink}` },
  player: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 2, borderColor: C.line },
  mode: { flexBasis: '47%', flexGrow: 1, height: 48, borderRadius: 14, borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  track: { height: 12, borderRadius: 999, backgroundColor: C.paperDeep, marginTop: 6, overflow: 'hidden', borderWidth: 2, borderColor: C.ink },
  pchip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: C.ink },
  locked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 58, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: C.ink },
  quit: { position: 'absolute', left: 16 },
  offline: { position: 'absolute', top: 54, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: 999, backgroundColor: C.ink },
  promptCard: { backgroundColor: C.ink, borderRadius: 26, padding: 24, paddingTop: 22, gap: 14, transform: [{ rotate: '-1.5deg' }], boxShadow: '6px 8px 0px rgba(18,21,15,0.18)' },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 2, borderColor: C.ink },
});
