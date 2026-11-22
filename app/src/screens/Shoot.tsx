import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { settle, showBase } from '../components/Backdrop';
import { AppState, Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cap, Card, newSubmissionId, rarityLine, submitFind } from '../api';
import { FlipReveal, Pending } from '../components/Reveal';
import { CARD_RATIO } from '../components/GameCard';
import { Button, H, IconButton, Label, Mono, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { useSquad } from '../squad';
import { C, F, TIERS } from '../theme';

type Phase =
  | { k: 'aim' }
  | { k: 'capturing' }
  | { k: 'judging'; uri: string }
  | { k: 'won'; card: Card; uri: string; setsDone?: { id: string; name: string }[] }
  | { k: 'nope'; uri: string; verdict: string; triesLeft?: number; screen?: boolean }
  | { k: 'error'; uri?: string; message: string; retry?: () => void };

const DEV_PHOTOS = ['red_fire_hydrant', 'fire_hydrant', 'red_bicycle', 'maple_leaf', 'cardinal', 'payphone', 'pennant', 'bicycle_shadow', 'ball', 'pen', 'shoe', 'park_bench', 'laptop_screen'];

/** expo-camera's web build opens the camera without a resolution, so browsers fall back to about 640x480, and it never
 *  asks for autofocus. Once the stream is up, ask the track for the camera's full resolution and continuous focus. */
async function sharpenWebCamera() {
  try {
    const video = document.querySelector('video');
    const track = (video?.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
    if (!track) return;
    const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { focusMode?: string[] };
    const w = Math.min(caps.width?.max ?? 1920, 3840);
    const h = Math.min(caps.height?.max ?? 1440, 2880);
    await track.applyConstraints({ width: { ideal: w }, height: { ideal: h } }).catch(() => {});
    if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
  } catch {}
}

/**
 * crop (web): a digital zoom factor z and the camera view's size. The preview fills the view (cover), so the photo is
 * first cut to what was visible, then to its centre 1/z, using the image's real size (the track's reported size can differ).
 */
async function toJpeg(uri: string, crop?: { z: number; viewW: number; viewH: number }) {
  const ops: ImageManipulator.Action[] = [];
  if (crop && crop.z > 1.01 && crop.viewW > 0 && crop.viewH > 0) {
    const info = await ImageManipulator.manipulateAsync(uri, []);
    const w = info.width;
    const h = info.height;
    if (w && h) {
      const view = crop.viewW / crop.viewH;
      const visW = w / h > view ? h * view : w;
      const visH = w / h > view ? h : w / view;
      const cw = Math.max(1, Math.round(visW / crop.z));
      const ch = Math.max(1, Math.round(visH / crop.z));
      ops.push({ crop: { originX: Math.round((w - cw) / 2), originY: Math.round((h - ch) / 2), width: cw, height: ch } });
    }
  }
  ops.push({ resize: { width: 1080 } });
  const out = await ImageManipulator.manipulateAsync(uri, ops, { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  return { uri: out.uri, b64: out.base64 ?? '' };
}

// Zoom like a phone camera: pinch, or tap a step. Native uses the lens zoom; the web build zooms digitally (scaled preview, cropped photo).
const WEB = Platform.OS === 'web';
const MAX_ZOOM = WEB ? 4 : 8;
const ZOOM_STEPS = [1, 2, 4];
/** expo-camera takes 0..1 across the device's zoom range; this treats that range as 1× to MAX_ZOOM× */
const lensZoom = (x: number) => Math.min(1, Math.max(0, (x - 1) / (MAX_ZOOM - 1)));
const fmtZoom = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`);

function Checking() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, []);
  return <Mono>{slow ? 'Still checking. Slow connection' : 'Checking your find'}</Mono>;
}

export default function Shoot({ promptId, promptText, examples, mode }: { promptId: string; promptText: string; examples?: string; mode: 'daily' | 'squad' }) {
  const nav = useNav();
  const squad = useSquad();
  const insets = useSafeAreaInsets();
  const { width, height: winH } = useWindowDimensions();
  const [perm, requestPerm, getPerm] = useCameraPermissions();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && getPerm());
    return () => sub.remove();
  }, [getPerm]);
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: 'aim' });
  const [camKey, setCamKey] = useState(0);
  const [camFailed, setCamFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const span = (t: ArrayLike<{ pageX: number; pageY: number }>) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
  // web: a two-finger pinch would zoom the whole page; on this screen it zooms the camera instead
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!WEB || typeof document === 'undefined') return;
    const html = document.documentElement;
    const prev = [html.style.touchAction, document.body.style.touchAction];
    html.style.touchAction = 'none';
    document.body.style.touchAction = 'none';
    const noPageZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    // Safari reports pinches as gesture events (scale relative to the gesture start)
    let gz = 1;
    const gStart = (e: Event) => {
      e.preventDefault();
      gz = zoomRef.current;
    };
    const gChange = (e: Event) => {
      e.preventDefault();
      const s = (e as unknown as { scale?: number }).scale ?? 1;
      setZoom(Math.round(Math.min(MAX_ZOOM, Math.max(1, gz * s)) * 10) / 10);
    };
    const opts = { passive: false } as AddEventListenerOptions;
    document.addEventListener('touchmove', noPageZoom, opts);
    document.addEventListener('gesturestart', gStart, opts);
    document.addEventListener('gesturechange', gChange, opts);
    return () => {
      document.removeEventListener('touchmove', noPageZoom, opts);
      document.removeEventListener('gesturestart', gStart, opts);
      document.removeEventListener('gesturechange', gChange, opts);
      html.style.touchAction = prev[0];
      document.body.style.touchAction = prev[1];
    };
  }, []);
  useEffect(() => {
    if (phase.k === 'aim' || phase.k === 'nope' || phase.k === 'error') settle();
  }, [phase.k]);
  useEffect(() => () => settle(), []);
  // the reveal (card + tier line + meter, plus any "Set complete" badges) must fit the stage height too, or on a phone
  // browser the card climbs over the Close button and the meter slides under Done
  const [stageH, setStageH] = useState(0);
  const badges = phase.k === 'won' ? phase.setsDone?.length ?? 0 : 0;
  const byHeight = stageH ? (stageH - 198 - badges * 58) / CARD_RATIO : Infinity;
  const cardW = Math.max(150, Math.min(width - 72, 330, byHeight));
  const asked = useRef(false); // ask once per visit: a dismissed browser prompt reports "undetermined" again
  useEffect(() => {
    if (asked.current) return;
    if (perm && !perm.granted && perm.status === 'undetermined') {
      asked.current = true;
      requestPerm();
    }
  }, [perm, requestPerm]);

  // squad: when the round closes (time up, or everyone found), go back so the reveal isn't missed
  const startRound = useRef(squad.room?.round);
  const roomPhase = squad.room?.phase;
  const roomRound = squad.room?.round;
  useEffect(() => {
    if (mode !== 'squad') return;
    const closed = roomPhase !== 'hunting' || roomRound !== startRound.current;
    if (!closed) return;
    const mineIn =
      (!squad.room?.bingo && !!squad.room?.players.find((p) => p.id === squad.session?.playerId)?.found) ||
      !!squad.room?.bingoBoard?.marks[squad.session?.playerId ?? '']?.includes(promptId) ||
      !!squad.room?.rounds.some((r) => r.cards.some((c) => c.playerId === squad.session?.playerId && c.promptId === promptId));
    if ((phase.k === 'judging' || phase.k === 'capturing') && !mineIn) return; // the photo or its verdict is still on its way
    if (phase.k === 'error' && phase.retry) return; // "Send again" stays until the player taps it or leaves
    const t = setTimeout(() => nav.back(), phase.k === 'won' ? 3800 : phase.k === 'aim' ? 0 : 2500);
    return () => clearTimeout(t);
  }, [mode, roomPhase, roomRound, phase.k, nav]);

  const judge = async (uri: string, b64: string, submissionId = newSubmissionId()) => {
    setPhase({ k: 'judging', uri });
    showBase();
    const s = squad.session;
    const res =
      mode === 'squad' && s
        ? await submitFind({ mode: 'squad', promptId, image: b64, submissionId, code: s.code, playerId: s.playerId, secret: s.secret })
        : await submitFind({ mode: 'daily', promptId, image: b64, submissionId });
    if ('error' in res) {
      const again = ['network', 'ai_down', 'bad_response', 'rate', 'budget'].includes(res.error);
      setPhase({ k: 'error', uri, message: res.message, retry: again ? () => judge(uri, b64, submissionId) : undefined });
    } else if (res.accepted) {
      setPhase({ k: 'won', card: res.card, uri, setsDone: res.setsDone });
      if (res.setsDone?.length) setTimeout(() => tap('medium'), 1200); // after the card flip
    }
    else setPhase({ k: 'nope', uri, verdict: res.verdict, triesLeft: res.triesLeft, screen: res.reason === 'screen' });
  };

  const busy = useRef(false); // one capture at a time: a second tap can't race the first
  const shoot = async () => {
    if (!cam.current || !ready || busy.current) return;
    busy.current = true;
    setReady(false);
    setPhase({ k: 'capturing' });
    tap('medium');
    if (mode === 'squad') squad.send({ t: 'shooting', promptId }); // a slow upload that started before the buzzer still counts
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.6, shutterSound: false });
      if (!pic?.uri) throw new Error('no photo');
      const { uri, b64 } = await toJpeg(pic.uri, WEB ? { z: zoom, viewW: width, viewH: winH } : undefined);
      judge(uri, b64);
    } catch {
      setPhase({ k: 'error', message: "The camera didn't take the photo. Try again." });
      setCamKey((k) => k + 1);
    } finally {
      busy.current = false;
    }
  };

  const devShoot = async (name: string) => {
    const blob = await (await fetch(`/dev/${name}.jpg`)).blob();
    const dataUri: string = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(blob);
    });
    const { uri, b64 } = await toJpeg(dataUri);
    judge(uri, b64.replace(/^data:image\/\w+;base64,/, ''));
  };

  const close = () => nav.back();
  const devTools = __DEV__ && Platform.OS === 'web';

  // ---------- result states share the paper background
  if (phase.k !== 'aim' && phase.k !== 'capturing') {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconButton icon="x" label="Close" onPress={close} />
          {phase.k !== 'won' && (
            <Label numberOfLines={1} style={{ flex: 1 }}>
              {promptText}
            </Label>
          )}
        </View>
        <View style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', gap: 22 }} onLayout={(e) => setStageH(e.nativeEvent.layout.height)}>
          {phase.k === 'judging' && (
            <>
              <Pending width={cardW} />
              <Checking />
            </>
          )}
          {phase.k === 'won' && (
            <>
              <FlipReveal card={phase.card} width={cardW} localPhoto={phase.uri} />
              {phase.setsDone?.map((s) => (
                <View key={s.id} style={styles.setDone}>
                  <Feather name="award" size={20} color={C.white} />
                  <T style={{ color: C.white, fontFamily: F.bodyBold, fontSize: 16 }}>Set complete: {s.name}</T>
                </View>
              ))}
            </>
          )}
          {(phase.k === 'nope' || phase.k === 'error') && (
            <>
              {phase.uri ? (
                <View style={[styles.rejected, { width: cardW * 0.8, height: cardW * 0.8 }]}>
                  <Image source={{ uri: phase.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(233,237,229,0.35)' }]} />
                </View>
              ) : null}
              <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 8 }}>
                <H size={30} style={{ textAlign: 'center' }}>
                  {phase.k === 'error' ? 'Not judged yet' : phase.screen ? 'Find the real thing' : 'Not a match'}
                </H>
                <T style={{ textAlign: 'center', fontSize: 17, color: C.ink }}>
                  {phase.k === 'nope'
                    ? phase.screen && /^find the real thing\.?$/i.test(phase.verdict.trim())
                      ? 'That looks like a screen or a printed picture. Photograph the actual object.'
                      : phase.verdict
                    : phase.message}
                </T>
                {phase.k === 'nope' && phase.triesLeft != null && <T style={{ fontFamily: F.bodyBold, color: C.blaze }}>{phase.triesLeft === 0 ? 'No tries left' : `${phase.triesLeft} ${phase.triesLeft === 1 ? 'try' : 'tries'} left`} {mode === 'squad' ? (squad.room?.bingo ? 'on this square' : 'this round') : 'today'}</T>}
              </View>
            </>
          )}
        </View>
        <View style={{ gap: 12 }}>
          {phase.k === 'won' && <Button title={mode === 'squad' ? (squad.room?.bingo ? 'Back to the card' : 'Back to the round') : 'Done'} onPress={close} />}
          {phase.k === 'nope' && (phase.triesLeft == null || phase.triesLeft > 0) && <Button title="Try again" icon="camera" onPress={() => setPhase({ k: 'aim' })} />}
          {phase.k === 'error' && (phase.retry ? <Button title="Send again" icon="refresh-cw" onPress={phase.retry} /> : <Button title="Try again" icon="camera" onPress={() => setPhase({ k: 'aim' })} />)}
          {phase.k === 'nope' && phase.triesLeft === 0 ? (
            <Button title={mode === 'squad' ? (squad.room?.bingo ? 'Back to the card' : 'Back to the round') : 'Back to today'} onPress={close} />
          ) : (
            phase.k !== 'won' && phase.k !== 'judging' && <Button title="Back" kind="quiet" onPress={close} />
          )}
        </View>
      </Screen>
    );
  }

  // ---------- camera
  const denied = perm && !perm.granted;
  return (
    <View
      style={{ flex: 1, backgroundColor: C.ink, overflow: 'hidden' }}
      onTouchStart={(e) => {
        const t = e.nativeEvent.touches;
        if (t.length === 2) pinch.current = { d: span(t), z: zoom };
      }}
      onTouchMove={(e) => {
        const t = e.nativeEvent.touches;
        if (t.length !== 2) return;
        if (!pinch.current) pinch.current = { d: span(t), z: zoom };
        const next = Math.min(MAX_ZOOM, Math.max(1, (pinch.current.z * span(t)) / Math.max(1, pinch.current.d)));
        setZoom(Math.round(next * 10) / 10);
      }}
      onTouchEnd={(e) => {
        if (e.nativeEvent.touches.length < 2) pinch.current = null;
      }}
    >
      {perm?.granted && (
        <View style={[StyleSheet.absoluteFill, WEB && { transform: [{ scale: zoom }] }]} pointerEvents="none">
          <CameraView
            key={camKey}
            ref={cam}
            style={StyleSheet.absoluteFill}
            facing="back"
            zoom={WEB ? 0 : lensZoom(zoom)}
            onCameraReady={() => {
              setReady(true);
              setCamFailed(false);
              if (WEB) sharpenWebCamera();
            }}
            onMountError={() => {
              setReady(false);
              setCamFailed(true);
            }}
          />
        </View>
      )}
      <LinearGradient colors={['rgba(18,21,15,0.85)', 'rgba(18,21,15,0)']} style={[styles.topShade, { paddingTop: insets.top + 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 20 }}>
          <IconButton icon="x" label="Close" onPress={close} tone="light" />
          <View style={{ flex: 1, gap: 6 }}>
            <H size={32} style={{ color: C.white }}>
              {cap(promptText)}
            </H>
          </View>
        </View>
      </LinearGradient>

      {perm?.granted && camFailed && (
        <View style={styles.center}>
          <Feather name="camera-off" size={40} color={C.paper} />
          <T style={{ color: C.paper, textAlign: 'center', fontFamily: F.bodyBold }}>The camera didn't start.</T>
          <Button
            title="Restart camera"
            kind="blaze"
            onPress={() => {
              setCamFailed(false);
              setReady(false);
              setCamKey((k) => k + 1);
            }}
            style={{ alignSelf: 'stretch' }}
          />
        </View>
      )}
      {denied && (
        <View style={styles.center}>
          <Feather name="camera-off" size={40} color={C.paper} />
          <T style={{ color: C.paper, textAlign: 'center', fontFamily: F.bodyBold }}>{Platform.OS === 'web' ? 'Allow the camera for this site in your browser, then reload.' : 'Brillion needs the camera to see your finds.'}</T>
          {denied && (
            <Button
              title={Platform.OS === 'web' ? 'Ask again' : perm?.canAskAgain ? 'Allow camera' : 'Open settings'}
              kind="blaze"
              onPress={() => (perm?.canAskAgain ? requestPerm() : Linking.openSettings())}
              style={{ alignSelf: 'stretch' }}
            />
          )}
        </View>
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 28 }]}>
        {devTools && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 18, paddingHorizontal: 12 }}>
            {DEV_PHOTOS.map((n) => (
              <Pressable key={n} onPress={() => devShoot(n)} style={styles.devChip}>
                <Mono style={{ color: C.white, fontSize: 11 }}>{n}</Mono>
              </Pressable>
            ))}
          </View>
        )}
        {perm?.granted && !camFailed && (
          <View style={styles.zoomRow}>
            {ZOOM_STEPS.map((s, i) => {
              const next = ZOOM_STEPS[i + 1] ?? Infinity;
              const on = zoom >= s - 0.05 && zoom < next - 0.05;
              return (
                <Pressable
                  key={s}
                  accessibilityRole="button"
                  accessibilityLabel={`Zoom ${s}x`}
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    tap('light');
                    setZoom(s);
                  }}
                  hitSlop={6}
                  style={[styles.zoomChip, on && styles.zoomChipOn]}
                >
                  <Mono style={{ color: on ? C.ink : C.white, fontSize: 13 }}>{on ? fmtZoom(zoom) : `${s}×`}</Mono>
                </Pressable>
              );
            })}
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          onPress={shoot}
          disabled={!ready}
          style={({ pressed }) => [styles.shutter, !ready && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.94 }] }]}
        >
          <View style={styles.shutterIn} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  zoomRow: { flexDirection: 'row', gap: 8, padding: 4, borderRadius: 999, backgroundColor: 'rgba(18,21,15,0.55)', marginBottom: 18 },
  zoomChip: { minWidth: 44, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  zoomChipOn: { backgroundColor: C.paper },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 48 },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 40 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.white },
  rejected: { borderRadius: 18, borderWidth: 2, borderColor: C.ink, overflow: 'hidden', transform: [{ rotate: '-3deg' }] },
  setDone: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 46, borderRadius: 999, backgroundColor: C.blaze },
  devChip:{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.18)' },
});
