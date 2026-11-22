import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cap, Card, newSubmissionId, rarityLine, submitFind } from '../api';
import { FlipReveal, Pending } from '../components/Reveal';
import { Button, Glass, H, IconButton, Label, Mono, Screen, T, tap } from '../components/ui';
import { Sky } from '../components/Sky';
import { useNav } from '../nav';
import { useSquad } from '../squad';
import { C, F, isNight, TIERS } from '../theme';

type Phase =
  | { k: 'aim' }
  | { k: 'capturing' }
  | { k: 'judging'; uri: string }
  | { k: 'won'; card: Card; setsDone?: { id: string; name: string }[] }
  | { k: 'nope'; uri: string; verdict: string; triesLeft?: number; screen?: boolean }
  | { k: 'error'; uri?: string; message: string; retry?: () => void };

const DEV_PHOTOS = ['red_fire_hydrant', 'ball', 'pen', 'shoe', 'bench', 'laptop_screen'];

async function toJpeg(uri: string) {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 768 } }], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  return { uri: out.uri, b64: out.base64 ?? '' };
}

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
  const { width, height } = useWindowDimensions();
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
  const cardW = Math.min(width - 72, 330);
  useEffect(() => {
    if (perm && !perm.granted && perm.status === 'undetermined') requestPerm();
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
    const t = setTimeout(() => nav.back(), phase.k === 'won' ? 2200 : phase.k === 'aim' ? 0 : 2500);
    return () => clearTimeout(t);
  }, [mode, roomPhase, roomRound, phase.k, nav]);

  const judge = async (uri: string, b64: string, submissionId = newSubmissionId()) => {
    setPhase({ k: 'judging', uri });
    const s = squad.session;
    const res =
      mode === 'squad' && s
        ? await submitFind({ mode: 'squad', promptId, image: b64, submissionId, code: s.code, playerId: s.playerId, secret: s.secret })
        : await submitFind({ mode: 'daily', promptId, image: b64, submissionId });
    if ('error' in res) {
      const again = ['network', 'ai_down', 'bad_response', 'rate', 'budget'].includes(res.error);
      setPhase({ k: 'error', uri, message: res.message, retry: again ? () => judge(uri, b64, submissionId) : undefined });
    } else if (res.accepted) {
      setPhase({ k: 'won', card: res.card, setsDone: res.setsDone });
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
      const { uri, b64 } = await toJpeg(pic.uri);
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
    // the result sits on the sky of the altitude it reached
    const zone = phase.k === 'won' ? TIERS[phase.card.tier].zone : phase.k === 'judging' ? 'cloudline' : 'foothill';
    const night = isNight(zone);
    return (
      <Screen zone={zone}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconButton icon="x" label="Close" onPress={close} tone={night ? 'light' : 'ink'} />
          {phase.k !== 'won' && (
            <Label numberOfLines={1} style={{ flex: 1 }}>
              {promptText}
            </Label>
          )}
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
          {phase.k === 'judging' && (
            <>
              <Pending width={cardW} />
              <Checking />
            </>
          )}
          {phase.k === 'won' && (
            <>
              <FlipReveal card={phase.card} width={cardW} onDark={night} />
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
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(244,247,252,0.35)' }]} />
                </View>
              ) : null}
              <Glass style={{ alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 16, alignSelf: 'stretch' }}>
                <H size={32} style={{ textAlign: 'center' }}>
                  {phase.k === 'error' ? 'Not judged yet' : phase.screen ? 'Find the real thing' : 'Not a match'}
                </H>
                <T style={{ textAlign: 'center', fontSize: 17, color: C.ink }}>{phase.k === 'nope' ? phase.verdict : phase.message}</T>
                {phase.k === 'nope' && phase.triesLeft != null && <T style={{ fontFamily: F.bodyBold, color: C.blaze }}>{phase.triesLeft === 0 ? 'No tries left' : `${phase.triesLeft} ${phase.triesLeft === 1 ? 'try' : 'tries'} left`} {mode === 'squad' ? (squad.room?.bingo ? 'on this square' : 'this round') : 'today'}</T>}
              </Glass>
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
  // on wide screens (desktop) the camera sits in a centred frame and the sky stays around it
  const framed = width >= 700;
  const frameH = Math.min(height - 48, 860);
  const frameW = Math.min(frameH * 0.75, 560);
  const view = (
    <View style={framed ? [styles.frame, { width: frameW, height: frameH }] : { flex: 1, backgroundColor: C.ink }}>
      {perm?.granted && <CameraView key={camKey} ref={cam} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => {
            setReady(true);
            setCamFailed(false);
          }}
          onMountError={() => {
            setReady(false);
            setCamFailed(true);
          }}
        />
      }
      <LinearGradient colors={['rgba(14,19,40,0.85)', 'rgba(14,19,40,0)']} style={[styles.topShade, { paddingTop: insets.top + 8 }]}>
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
  if (!framed) return view;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Sky zone="ridge" />
      {view}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: C.ink, borderRadius: 28, overflow: 'hidden', borderWidth: 3, borderColor: C.goldLight, boxShadow: '0px 18px 40px rgba(14,19,40,0.35)' },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 48 },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 40 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: C.goldLight, alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#FFF2C6' },
  rejected: { borderRadius: 18, borderWidth: 4, borderColor: C.white, overflow: 'hidden', transform: [{ rotate: '-3deg' }], boxShadow: '0px 14px 30px rgba(40,25,15,0.3)' },
  setDone: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 46, borderRadius: 999, backgroundColor: C.blaze },
  devChip:{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.18)' },
});
