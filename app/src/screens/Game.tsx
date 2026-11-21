import { Feather } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GameMap from '../components/GameMap';
import { Joystick } from '../components/Joystick';
import { IconButton, Lives, fmtClock } from '../components/ui';
import { isMuted, relativeDir, sayMissedWarning, setHeading, setMuted } from '../game/coach';
import { useGame, useMe, useNow } from '../net/GameProvider';
import { useLoc } from '../net/LocationProvider';
import { bearingDeg, compass, distanceM, escapeExit } from '../shared/geo';
import { C, F, dbzColor } from '../theme';

/** Compass heading (deg) where the device supports it, so arrows point the way you're actually facing. */
function useHeading(enabled: boolean) {
  const [heading, setHeadingState] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchHeadingAsync((h) => setHeadingState(h.trueHeading >= 0 ? h.trueHeading : h.magHeading))
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
  const { room, session, leave, stale, clockSkew, onEvent } = useGame();
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
        if (ev.kind === 'hit') setFlash({ kind: 'hit', text: ev.hp === 1 ? 'Hit · 1 life left' : `Hit · ${ev.hp} lives left`, at: Date.now() - clockSkew });
        else if (ev.kind === 'dodge') setFlash({ kind: 'dodge', text: `Clear +${ev.points}`, at: Date.now() - clockSkew });
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
  const rel = (deg: number) => (heading == null ? compass(deg) : relativeDir(compass(deg)));
  const nearest = <G extends { lat: number; lng: number }>(xs: G[]) =>
    here ? xs.map((x) => ({ x, m: Math.round(distanceM(here, x)), deg: bearingDeg(here, x) })).sort((a, b) => a.m - b.m)[0] ?? null : null;
  const mate = nearest(room.players.filter((p) => p.id !== session.playerId && p.status === 'downed' && p.lat != null).map((p) => ({ ...p, lat: p.lat!, lng: p.lng! })));
  const helper = downed ? nearest(room.players.filter((p) => p.id !== session.playerId && p.status === 'alive' && p.lat != null).map((p) => ({ ...p, lat: p.lat!, lng: p.lng! }))) : null;
  const probe = nearest(room.orbs);
  const arrowDeg = danger ? (heading == null ? danger.deg : danger.deg - heading) : 0;
  const flashOn = flash && now - flash.at < 1800;
  const level = room.level ?? 1;
  const lvColor = dbzColor((level - 0.5) / LEVELS);
  const scopeSize = Math.max(200, Math.min(scopeArea.w, scopeArea.h, 520));
  const instrW = Math.min(winW, 560) - 24 - 44;
  /** Biggest display size at which `s` fits on one line (Unbounded runs about 0.8 em per glyph). */
  const fit = (s: string, w: number) => Math.max(30, Math.min(60, Math.floor(w / Math.max(4, s.length * 0.8))));

  // the one instruction: what to do right now, as big as the screen allows
  type Tone = 'calm' | 'danger' | 'down' | 'note';
  let tone: Tone = 'calm';
  let bg: string = C.surface;
  let fg: string = C.ink;
  let big = '';
  let sub = '';
  let side: React.ReactNode = null;
  if (downed) {
    tone = 'down';
    big = "You're down";
    sub = helper ? `${helper.x.name} is ${helper.m} m ${rel(helper.deg)}` : 'Nobody is up';
  } else if (me?.gpsWeak && !demo) {
    tone = 'note';
    big = 'Weak GPS';
    sub = "Cells can't hit you until it settles";
  } else if (me?.oob && room.center && here) {
    tone = 'note';
    big = `Walk ${Math.max(1, Math.round(distanceM(here, room.center) - room.settings.radiusM))} m`;
    sub = `${rel(bearingDeg(here, room.center))}, back into the zone`;
  } else if (danger) {
    tone = 'danger';
    const impact = danger.sec < 1.5;
    const k = danger.mega ? 1 : Math.min(1, Math.max(0, 1 - danger.sec / 12));
    bg = dbzColor(0.2 + k * 0.8);
    fg = bg === C.dbz[1] || bg === C.dbz[2] ? C.ink : C.white;
    big = impact ? 'Impact' : `Walk ${danger.m} m`;
    sub = impact ? (danger.mega ? 'Supercell' : 'Brace') : rel(danger.deg);
    side = (
      <View style={[styles.side, { borderColor: fg }]} accessibilityLabel={impact ? 'Impact now' : `${Math.ceil(danger.sec)} seconds`}>
        {impact ? <Feather name="zap" size={36} color={fg} /> : <Text style={[styles.secs, { color: fg }]}>{Math.ceil(danger.sec)}</Text>}
      </View>
    );
  } else if (flashOn) {
    tone = flash!.kind === 'hit' ? 'danger' : 'calm';
    if (flash!.kind === 'hit') {
      bg = C.dbz[3];
      fg = C.white;
    }
    big = flash!.kind === 'hit' ? 'Hit' : 'Dodged';
    sub = flash!.text;
  } else if (mate) {
    tone = 'note';
    big = `Revive ${mate.x.name}`;
    sub = `${mate.m} m ${rel(mate.deg)}`;
  } else {
    big = 'Clear';
    sub = probe ? `${probe.x.kind === 'kit' ? 'Kit' : 'Probe'} ${probe.m} m ${rel(probe.deg)}` : '';
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.sky }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headLeft}>
          {me && <Lives hp={me.hp} max={me.maxHp} />}
          <Text style={styles.clock} accessibilityLabel={`Storm ends in ${fmtClock(left)}`}>
            {fmtClock(left)}
          </Text>
          <View style={[styles.level, { borderColor: lvColor }]}>
            <View style={[styles.levelDot, { backgroundColor: lvColor }]} />
            <Text style={styles.levelT}>Level {level}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
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

      <View style={styles.scopeArea} onLayout={(e) => setScopeArea({ w: e.nativeEvent.layout.width - 24, h: e.nativeEvent.layout.height - 16 })}>
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
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.big, { color: fg, fontSize: fit(big, instrW), lineHeight: fit(big, instrW) * 1.14 }]} numberOfLines={1}>
                {big}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {!!sub && (
                  <Text style={[styles.sub, { color: fg, flex: 1 }]} numberOfLines={2}>
                    {sub}
                  </Text>
                )}
                {side}
              </View>
              {tone === 'down' && (
                <View style={styles.progress}>
                  <View style={[styles.progressFill, { width: `${Math.round((me?.reviveProgress ?? 0) * 100)}%` }]} />
                </View>
              )}
            </View>
          </>
        )}
      </View>

      {countdown > 0 && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: C.sky }]}>
          <Text style={{ fontFamily: F.displayHeavy, fontSize: 180, lineHeight: 200, color: C.ink }}>{countdown}</Text>
          <Text style={[styles.sub, { color: C.inkSoft }]}>Storm incoming</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  clock: { fontFamily: F.monoBold, fontSize: 18, color: C.ink, fontVariant: ['tabular-nums'] },
  level: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 2, borderRadius: 999, paddingHorizontal: 10, height: 30 },
  levelDot: { width: 8, height: 8, borderRadius: 4 },
  levelT: { fontFamily: F.bodyBold, fontSize: 14, color: C.ink },
  scopeArea: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 12, paddingTop: 22 },
  stale: { position: 'absolute', top: 8, alignSelf: 'center', backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  joy: { position: 'absolute', right: 14, bottom: 6 },
  instr: { marginHorizontal: 12, minHeight: 170, borderRadius: 28, paddingHorizontal: 22, paddingVertical: 20, flexDirection: 'row', alignItems: 'center' },
  instrCalm: { boxShadow: `0px 3px 0px ${C.line}` },
  big: { fontFamily: F.displayHeavy, letterSpacing: -1.5 },
  sub: { fontFamily: F.bodyBold, fontSize: 28, lineHeight: 34 },
  side: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  secs: { fontFamily: F.displayHeavy, fontSize: 30, lineHeight: 36 },
  progress: { height: 10, borderRadius: 5, backgroundColor: C.skyDeep, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: 10, backgroundColor: C.ink },
  center: { alignItems: 'center', justifyContent: 'center' },
});
