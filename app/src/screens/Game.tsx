import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GameMap from '../components/GameMap';
import { Joystick } from '../components/Joystick';
import { H, Label, Lives, T, fmtClock } from '../components/ui';
import { isMuted, relativeDir, sayMissedWarning, setHeading, setMuted } from '../game/coach';
import { useGame, useMe, useNow } from '../net/GameProvider';
import { useLoc } from '../net/LocationProvider';
import { bearingDeg, compass, distanceM, escapeExit } from '../shared/geo';
import { C, F, R, dbzColor } from '../theme';

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
  const scopeSize = Math.max(200, Math.min(scopeArea.w, scopeArea.h));

  let panel: React.ReactNode;
  let tone: 'calm' | 'danger' | 'down' | 'note' = 'calm';
  if (downed) {
    tone = 'down';
    panel = (
      <>
        <Label style={{ color: C.amber }}>Down</Label>
        <H size={40} style={{ marginTop: 4 }}>
          Stay put
        </H>
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${Math.round((me?.reviveProgress ?? 0) * 100)}%` }]} />
        </View>
        <T style={styles.sub}>{helper ? `${helper.x.name} is ${helper.m} m ${rel(helper.deg)}` : 'Nobody is up'}</T>
      </>
    );
  } else if (me?.gpsWeak && !demo) {
    tone = 'note';
    panel = (
      <>
        <Label style={{ color: C.amber }}>GPS ±{Math.round(me.acc)} m</Label>
        <H size={36} style={{ marginTop: 4 }}>
          Weak signal
        </H>
        <T style={styles.sub}>Cells can't hit you until it settles</T>
      </>
    );
  } else if (me?.oob && room.center && here) {
    tone = 'note';
    const d = Math.round(distanceM(here, room.center) - room.settings.radiusM);
    panel = (
      <>
        <Label style={{ color: C.amber }}>Outside the zone</Label>
        <H size={40} style={{ marginTop: 4 }}>
          {`Walk ${Math.max(1, d)} m`}
        </H>
        <T style={styles.big}>{rel(bearingDeg(here, room.center))}</T>
      </>
    );
  } else if (danger) {
    tone = 'danger';
    const impact = danger.sec < 1.5;
    panel = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
        <View style={[styles.arrow, impact && { backgroundColor: C.danger }]} accessibilityElementsHidden importantForAccessibility="no">
          {impact ? <Ionicons name="flash" size={46} color="#fff" /> : <Ionicons name="arrow-up" size={52} color={C.amberInk} style={{ transform: [{ rotate: `${arrowDeg}deg` }] }} />}
        </View>
        <View style={{ flex: 1 }}>
          <Label style={{ color: C.danger }}>{danger.mega ? 'Supercell' : 'Strike warning'}</Label>
          <H size={44} style={{ marginTop: 2 }}>
            {impact ? 'Impact' : `Walk ${danger.m} m`}
          </H>
          {!impact && <T style={styles.big}>{rel(danger.deg)}</T>}
          <T style={styles.mono}>{impact ? 'NOW' : `T-${Math.ceil(danger.sec)} S`}</T>
        </View>
      </View>
    );
  } else if (flashOn) {
    tone = flash!.kind === 'hit' ? 'danger' : 'calm';
    panel = (
      <>
        <Label style={{ color: flash!.kind === 'hit' ? C.danger : C.safe }}>{flash!.kind === 'hit' ? 'Struck' : 'Dodged'}</Label>
        <H size={44} style={{ marginTop: 4, color: flash!.kind === 'hit' ? C.danger : C.safe }}>
          {flash!.text}
        </H>
      </>
    );
  } else if (mate) {
    tone = 'note';
    panel = (
      <>
        <Label style={{ color: C.amber }}>Revive</Label>
        <H size={40} style={{ marginTop: 4 }}>
          {mate.x.name}
        </H>
        <T style={styles.big}>{`${mate.m} m ${rel(mate.deg)}`}</T>
      </>
    );
  } else {
    panel = (
      <>
        <Label style={{ color: C.safe }}>Status</Label>
        <H size={44} style={{ marginTop: 4, color: C.safe }}>
          Clear
        </H>
        {probe && <T style={styles.sub}>{`${probe.x.kind === 'kit' ? 'Kit' : 'Probe'} ${probe.m} m ${rel(probe.deg)}`}</T>}
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* instrument header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ gap: 4 }}>
          <Label>Level</Label>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <T style={{ fontFamily: F.displayHeavy, fontSize: 40, lineHeight: 40, color: lvColor }}>{level}</T>
            <View style={{ flexDirection: 'row', gap: 2, marginBottom: 6 }}>
              {Array.from({ length: LEVELS }, (_, i) => (
                <View key={i} style={{ width: 6, height: 14, borderRadius: 1, backgroundColor: i < level ? dbzColor((i + 0.5) / LEVELS) : C.line }} />
              ))}
            </View>
          </View>
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Label>Storm ends</Label>
          <T style={styles.clock} accessibilityLabel={`Storm ends in ${fmtClock(left)}`}>
            {fmtClock(left)}
          </T>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute voice' : 'Mute voice'}
            onPress={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
            style={styles.iconBtn}
          >
            <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={19} color={C.ink} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave game"
            onPress={() => {
              if (Platform.OS === 'web') return leave();
              Alert.alert('Leave the game?', undefined, [
                { text: 'Stay', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: leave },
              ]);
            }}
            style={styles.iconBtn}
          >
            <Ionicons name="close" size={21} color={C.ink} />
          </Pressable>
        </View>
      </View>
      <View style={styles.subHeader}>
        {me && <Lives hp={me.hp} max={me.maxHp} />}
        <T style={styles.monoDim}>{`${me?.score ?? 0} PTS`}</T>
        <T style={styles.monoDim}>{demo ? 'DEMO' : fix ? `±${Math.round(fix.acc)} M` : 'NO FIX'}</T>
      </View>

      {/* the scope */}
      <View style={styles.scopeArea} onLayout={(e) => setScopeArea({ w: e.nativeEvent.layout.width - 20, h: e.nativeEvent.layout.height - 14 })}>
        <GameMap room={room} meId={session.playerId} myFix={fix} now={now} escape={danger && danger.sec >= 1.5 ? danger.exit : null} heading={heading} size={scopeSize} />
        {stale && (
          <View pointerEvents="none" style={styles.stale}>
            <T style={{ fontFamily: F.mono, fontSize: 12, color: C.amber, letterSpacing: 1 }}>RECONNECTING</T>
          </View>
        )}
        {demo && (
          <View style={styles.joy}>
            <Joystick onMove={setVelocity} />
          </View>
        )}
      </View>

      {/* the one thing to do right now */}
      <View style={[styles.panel, tone === 'danger' && styles.panelDanger, tone === 'down' && styles.panelDown, { marginBottom: insets.bottom + 12 }]}>{room.phase === 'countdown' ? null : panel}</View>

      {countdown > 0 && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(7,17,21,0.9)' }]}>
          <Label style={{ color: C.amber }}>Storm incoming</Label>
          <T style={{ fontFamily: F.displayHeavy, fontSize: 150, lineHeight: 160, color: C.ink }}>{countdown}</T>
          <T style={styles.sub}>Walk out of every cell</T>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16 },
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  clock: { fontFamily: F.monoBold, fontSize: 30, color: C.ink, fontVariant: ['tabular-nums'] },
  iconBtn: { width: 42, height: 42, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  monoDim: { fontFamily: F.mono, fontSize: 12, color: C.dim, letterSpacing: 1 },
  scopeArea: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 10, paddingTop: 10 },
  stale: { position: 'absolute', top: 6, alignSelf: 'center', backgroundColor: C.panel, borderWidth: 1, borderColor: C.amber, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 4 },
  joy: { position: 'absolute', right: 12, bottom: 4 },
  panel: { marginHorizontal: 12, minHeight: 150, justifyContent: 'center', backgroundColor: C.panel, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, paddingHorizontal: 20, paddingVertical: 18 },
  panelDanger: { borderColor: C.danger, backgroundColor: '#1E0E0C' },
  panelDown: { borderColor: C.amber },
  arrow: { width: 92, height: 92, borderRadius: 46, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center' },
  big: { fontFamily: F.display, fontSize: 30, lineHeight: 32, color: C.ink, textTransform: 'uppercase', letterSpacing: 0.4 },
  sub: { fontFamily: F.bodyMedium, fontSize: 17, color: C.dim, marginTop: 6 },
  mono: { fontFamily: F.monoBold, fontSize: 18, color: C.danger, marginTop: 6, letterSpacing: 1 },
  progress: { height: 8, borderRadius: 2, backgroundColor: C.line, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: C.amber },
  center: { alignItems: 'center', justifyContent: 'center' },
});
