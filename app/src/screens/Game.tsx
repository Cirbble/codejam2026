import { Feather } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GameMap from '../components/GameMap';
import { Joystick } from '../components/Joystick';
import { Button, IconButton, Lives, fmtClock } from '../components/ui';
import { isMuted, sayMissedWarning, setHeading, setMuted } from '../game/coach';
import { useGame, useMe, useNow } from '../net/GameProvider';
import { useLoc } from '../net/LocationProvider';
import { bearingDeg, compass, distanceM, escapeExit } from '../shared/geo';
import { C, F, dbzColor } from '../theme';

/** Compass heading (deg) where the device supports it, so arrows point the way you're actually facing. */
function useHeading(enabled: boolean) {
  const [heading, setHeadingState] = useState<number | null>(null);
  const lastHeadingAt = useRef(0);
  // stale compass (no reading for 3 s): stop using it
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => Date.now() - lastHeadingAt.current > 3000 && setHeadingState(null), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    // only a calibrated compass gives body-relative directions; otherwise we fall back to compass words
    Location.watchHeadingAsync((h) => {
      const good = Platform.OS === 'ios' ? h.accuracy >= 0 && h.accuracy <= 30 : h.accuracy >= 2;
      setHeadingState(good ? (h.trueHeading >= 0 ? h.trueHeading : h.magHeading) : null);
      lastHeadingAt.current = Date.now();
    })
      .then((s) => (cancelled ? s.remove() : (sub = s)))
      .catch(() => {});
    return () => {
      cancelled = true;
      sub?.remove();
      setHeadingState(null);
      setHeading(null); // the coach must not use a stale heading for later directions
    };
  }, [enabled]);
  return enabled ? heading : null;
}

const LEVELS = 5;

export function Game() {
  const { room, session, leave, stale, clockSkew, onEvent, send } = useGame();
  const me = useMe();
  const { fix, demo, setVelocity } = useLoc();
  const now = useNow(200);
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [muted, setMutedState] = useState(isMuted());
  const [scopeArea, setScopeArea] = useState({ w: 360, h: 360 });
  const [flash, setFlash] = useState<{ kind: 'hit' | 'dodge'; text: string; at: number } | null>(null);
  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.kind === 'hit') setFlash({ kind: 'hit', text: ev.hp === 1 ? '1 life left' : `${ev.hp} lives left`, at: Date.now() - clockSkew });
        else if (ev.kind === 'dodge') setFlash({ kind: 'dodge', text: `+${ev.points} points`, at: Date.now() - clockSkew });
      }),
    [onEvent, clockSkew],
  );

  const heading = useHeading(!demo);
  useEffect(() => setHeading(heading), [heading]);

  // The storm can reach you at any moment: keep the screen on for the whole game.
  useEffect(() => {
    activateKeepAwakeAsync('storm').catch(() => {});
    return () => {
      deactivateKeepAwake('storm').catch(() => {});
    };
  }, []);

  const danger = useMemo(() => {
    if (!room || !fix) return null;
    let best: { id: string; dir: string; deg: number; m: number; sec: number; mega: boolean; exit: { lat: number; lng: number } } | null = null;
    const here = { lat: fix.lat, lng: fix.lng };
    for (const s of room.strikes) {
      const d = distanceM(here, s);
      if (d > s.r + 1) continue;
      const sec = Math.max(0, (s.hitAt - now) / 1000);
      if (best && best.sec < sec) continue;
      // same exit rule as the server: out of the cell, but never out of the zone
      const e = escapeExit(s, here, room.center, room.settings.radiusM);
      best = { id: s.id, dir: compass(e.deg), deg: e.deg, m: e.m, sec, mega: s.kind === 'mega', exit: e.exit };
    }
    return best;
  }, [room, fix, now]);

  // If we reconnected inside a cell and missed the spoken warning, say it now.
  useEffect(() => {
    if (danger && danger.sec > 1.5) sayMissedWarning(danger.id, danger.dir, danger.m, Math.round(danger.sec), danger.mega);
  }, [danger?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!room || !session) return null;
  const countdown = room.phase === 'countdown' && room.startsAt ? Math.ceil((room.startsAt - now) / 1000) : 0;
  const left = (room.endsAt ?? now) - now;
  const downed = me?.status === 'downed';
  const here = fix ? { lat: fix.lat, lng: fix.lng } : null;
  const nearest = <G extends { lat: number; lng: number }>(xs: G[]) =>
    here ? xs.map((x) => ({ x, m: Math.round(distanceM(here, x)), deg: bearingDeg(here, x) })).sort((a, b) => a.m - b.m)[0] ?? null : null;
  const mate = nearest(room.players.filter((p) => p.id !== session.playerId && p.status === 'downed' && p.lat != null).map((p) => ({ ...p, lat: p.lat!, lng: p.lng! })));
  const helper = downed ? nearest(room.players.filter((p) => p.id !== session.playerId && p.status === 'alive' && p.lat != null).map((p) => ({ ...p, lat: p.lat!, lng: p.lng! }))) : null;
  const star = nearest(room.orbs.filter((o) => o.kind === 'star'));
  const heartNear = me && me.hp < me.maxHp ? nearest(room.orbs.filter((o) => o.kind === 'heart')) : null;
  const flashOn = flash && now - flash.at < 1800;
  const level = room.level ?? 1;
  const lvColor = dbzColor((level - 0.5) / LEVELS);
  const scopeSize = Math.max(200, Math.min(scopeArea.w, scopeArea.h, 520));
  const host = room.hostId === session.playerId;
  /** Biggest display size at which the longest line fits (Unbounded runs about 0.8 em per glyph). */
  const fit = (lines: string[], w: number, max = 56) => Math.max(28, Math.min(max, Math.floor(w / Math.max(4, Math.max(...lines.map((l) => l.length)) * 0.7))));
  /** Short direction words for the card (the voice says the long form). */
  const SHORT = ['ahead', 'ahead right', 'right', 'back right', 'behind', 'back left', 'left', 'ahead left'];
  const dirWord = (deg: number) => (heading == null ? compass(deg) : SHORT[Math.round(((((deg - heading) % 360) + 360) % 360) / 45) % 8]);
  const screenDeg = (deg: number) => (heading == null ? deg : deg - heading);

  // the one instruction: what to do right now, as big as the screen allows
  let bg: string = C.surface;
  let fg: string = C.ink;
  let lines: string[] = [];
  let sub = '';
  let arrow: { deg: number; label: string } | null = null;
  let progress: number | null = null;
  if (downed) {
    lines = ['Wait for a', 'teammate'];
    sub = helper ? `${helper.x.name} is ${helper.m} m ${dirWord(helper.deg)}` : 'Nobody is up to reach you';
    if ((me?.reviveProgress ?? 0) > 0) {
      progress = me!.reviveProgress;
      sub = helper ? `${helper.x.name} is reviving you` : sub;
    }
  } else if (me?.gpsWeak && !demo) {
    lines = ['Weak GPS'];
    sub = 'No points until it settles. Step into the open.';
  } else if (me?.oob && room.center && here) {
    const deg = bearingDeg(here, room.center);
    lines = [`Walk ${Math.max(1, Math.round(distanceM(here, room.center) - room.settings.radiusM))} m`, dirWord(deg)];
    sub = 'Back into the zone';
    arrow = { deg: screenDeg(deg), label: '' };
  } else if (danger) {
    const k = danger.mega ? 1 : Math.min(1, Math.max(0, 1 - danger.sec / 12));
    bg = dbzColor(0.2 + k * 0.8);
    fg = bg === C.dbz[1] || bg === C.dbz[2] ? C.ink : C.white;
    lines = [`Walk ${danger.m} m`, dirWord(danger.deg)];
    sub = danger.mega ? 'Supercell: two lives' : '';
    arrow = { deg: screenDeg(danger.deg), label: `${Math.max(0, Math.ceil(danger.sec))} s` };
  } else if (flashOn) {
    if (flash!.kind === 'hit') {
      bg = C.dbz[3];
      fg = C.white;
      lines = ['Hit'];
    } else lines = ['Dodged'];
    sub = flash!.text;
  } else if (mate) {
    lines = [`Revive ${mate.x.name}`];
    sub = `Walk ${mate.m} m ${dirWord(mate.deg)}`;
    arrow = { deg: screenDeg(mate.deg), label: `${mate.m} m` };
  } else {
    lines = ['Clear'];
    const go = heartNear && heartNear.m < 45 ? { what: 'the heart', p: heartNear } : star && star.m < 40 ? { what: 'the star', p: star } : null;
    sub = go ? `Grab ${go.what}, ${go.p.m} m ${dirWord(go.p.deg)}` : '';
  }
  const cardW = Math.min(winW, 560) - 24 - 40 - (arrow ? 98 : 0);
  const size = fit(lines, cardW, lines.length > 1 && !arrow ? 46 : 56);

  return (
    <View style={{ flex: 1, backgroundColor: C.sky }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headLeft}>
          {me && <Lives hp={me.hp} max={me.maxHp} size={14} />}
          <Text style={styles.clock} accessibilityLabel={`Storm ends in ${fmtClock(left)}`}>
            {fmtClock(left)}
          </Text>
          <View style={[styles.level, { borderColor: lvColor }]}>
            <View style={[styles.levelDot, { backgroundColor: lvColor }]} />
            <Text style={styles.levelT}>Level {level}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {host && <IconButton icon="pause" label="Pause the storm" onPress={() => send({ t: 'pause', on: true })} />}
          <IconButton
            icon={muted ? 'volume-x' : 'volume-2'}
            label={muted ? 'Unmute voice' : 'Mute voice'}
            onPress={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          />
          <IconButton
            icon="x"
            label="Leave game"
            onPress={() => {
              if (Platform.OS === 'web') return leave();
              Alert.alert('Leave the game?', undefined, [
                { text: 'Stay', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: leave },
              ]);
            }}
          />
        </View>
      </View>

      <View style={styles.scopeArea} onLayout={(e) => setScopeArea({ w: e.nativeEvent.layout.width - 24, h: e.nativeEvent.layout.height - 30 })}>
        <GameMap room={room} meId={session.playerId} myFix={fix} now={now} escape={danger && danger.sec >= 1.5 ? danger.exit : null} heading={heading} size={scopeSize} />
        {stale && (
          <View pointerEvents="none" style={styles.stale}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>Reconnecting</Text>
          </View>
        )}
        {demo && (
          <View style={styles.joy}>
            <Joystick onMove={setVelocity} />
          </View>
        )}
      </View>

      <View style={[styles.instr, { backgroundColor: bg, marginBottom: insets.bottom + 12 }, bg === C.surface && styles.instrCalm]}>
        {room.phase === 'countdown' ? null : (
          <>
            {arrow && (
              <View style={[styles.arrow, { borderColor: fg }]} accessibilityElementsHidden importantForAccessibility="no">
                <Feather name="arrow-up" size={44} color={fg} style={{ transform: [{ rotate: `${arrow.deg}deg` }] }} />
                {!!arrow.label && <Text style={[styles.arrowT, { color: fg }]}>{arrow.label}</Text>}
              </View>
            )}
            <View style={{ flex: 1, gap: 6 }} accessible accessibilityLabel={[...lines, sub, arrow?.label ?? ''].join(' ')}>
              {lines.map((l, i) => (
                <Text key={i} style={[styles.big, { color: fg, fontSize: size, lineHeight: Math.round(size * 1.12) }]} numberOfLines={1}>
                  {l}
                </Text>
              ))}
              {!!sub && (
                <Text style={[styles.sub, { color: fg }]} numberOfLines={2}>
                  {sub}
                </Text>
              )}
              {progress != null && (
                <View style={styles.progress}>
                  <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
              )}
            </View>
          </>
        )}
      </View>

      {room.paused && room.phase === 'playing' && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(216,224,230,0.94)', paddingHorizontal: 32, gap: 14 }]}>
          <Feather name="pause-circle" size={56} color={C.ink} />
          <Text style={[styles.big, { fontSize: 44, lineHeight: 52, color: C.ink }]}>Paused</Text>
          <Text style={[styles.sub, { color: C.inkSoft, textAlign: 'center' }]}>
            {room.paused === 'host' ? 'The host stopped the storm. Nothing lands.' : room.paused === 'away' ? 'Every phone is locked or away.' : 'Waiting for the crew to reconnect.'}
          </Text>
          {host && room.paused === 'host' && <Button title="Resume" icon="play" onPress={() => send({ t: 'pause', on: false })} style={{ alignSelf: 'stretch', marginTop: 10 }} />}
        </View>
      )}

      {countdown > 0 && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: C.sky, paddingHorizontal: 32 }]}>
          <Text style={{ fontFamily: F.displayHeavy, fontSize: 180, lineHeight: 200, color: C.ink }}>{countdown}</Text>
          <Text style={[styles.sub, { color: C.ink, textAlign: 'center' }]}>Open ground only. Never step into a road.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clock: { fontFamily: F.monoBold, fontSize: 18, color: C.ink, fontVariant: ['tabular-nums'] },
  level: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 2, borderRadius: 999, paddingHorizontal: 10, height: 30 },
  levelDot: { width: 8, height: 8, borderRadius: 4 },
  levelT: { fontFamily: F.bodyBold, fontSize: 14, color: C.ink },
  scopeArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  stale: { position: 'absolute', top: 8, alignSelf: 'center', backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  joy: { position: 'absolute', right: 14, bottom: 4 },
  instr: { marginHorizontal: 12, minHeight: 176, borderRadius: 28, paddingHorizontal: 20, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  instrCalm: { boxShadow: `0px 3px 0px ${C.line}` },
  big: { fontFamily: F.displayHeavy, letterSpacing: -1.2 },
  sub: { fontFamily: F.bodyBold, fontSize: 20, lineHeight: 26 },
  arrow: { width: 82, height: 108, borderRadius: 24, borderWidth: 3, alignItems: 'center', justifyContent: 'center', gap: 2 },
  arrowT: { fontFamily: F.monoBold, fontSize: 20 },
  progress: { height: 10, borderRadius: 5, backgroundColor: C.skyDeep, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 10, backgroundColor: C.ink },
  center: { alignItems: 'center', justifyContent: 'center' },
});
