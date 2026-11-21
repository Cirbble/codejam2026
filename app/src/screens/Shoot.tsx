import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cap, Card, newSubmissionId, submitFind } from '../api';
import { FlipReveal, Pending } from '../components/Reveal';
import { Button, H, IconButton, Label, Mono, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { useSquad } from '../squad';
import { C, F, TIERS } from '../theme';

type Phase =
  | { k: 'aim' }
  | { k: 'judging'; uri: string }
  | { k: 'won'; card: Card }
  | { k: 'nope'; uri: string; verdict: string; triesLeft?: number; screen?: boolean }
  | { k: 'error'; uri?: string; message: string; retry?: () => void };

const DEV_PHOTOS = ['red_fire_hydrant', 'ball', 'pen', 'shoe', 'bench', 'laptop_screen'];

async function toJpeg(uri: string) {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 768 } }], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  return { uri: out.uri, b64: out.base64 ?? '' };
}

export default function Shoot({ promptId, promptText, examples, mode }: { promptId: string; promptText: string; examples?: string; mode: 'daily' | 'squad' }) {
  const nav = useNav();
  const squad = useSquad();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [perm, requestPerm] = useCameraPermissions();
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
    if (phase.k === 'judging') return; // the verdict is still on its way
    const t = setTimeout(() => nav.back(), phase.k === 'won' ? 2200 : 0);
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
    } else if (res.accepted) setPhase({ k: 'won', card: res.card });
    else setPhase({ k: 'nope', uri, verdict: res.verdict, triesLeft: res.triesLeft, screen: res.reason === 'screen' });
  };

  const shoot = async () => {
    if (!cam.current || !ready) return;
    tap('medium');
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.8, skipProcessing: Platform.OS === 'android' });
      if (!pic?.uri) throw new Error('no photo');
      const { uri, b64 } = await toJpeg(pic.uri);
      judge(uri, b64);
    } catch {
      setPhase({ k: 'error', message: "The camera didn't take the photo. Try again." });
      setCamKey((k) => k + 1);
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
  if (phase.k !== 'aim') {
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
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
          {phase.k === 'judging' && (
            <>
              <Pending width={cardW} />
              <Mono>Checking your find</Mono>
            </>
          )}
          {phase.k === 'won' && (
            <>
              <FlipReveal card={phase.card} width={cardW} />
              <View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
                <T style={{ fontFamily: F.bodyBold, fontSize: 18, color: TIERS[phase.card.tier].color }}>+{phase.card.points} points</T>
                <T style={{ textAlign: 'center', color: C.inkSoft }}>{phase.card.verdict}</T>
              </View>
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
                <Label style={{ color: C.blaze }}>{phase.k === 'error' ? 'Not judged' : phase.screen ? 'Find the real thing' : 'No match'}</Label>
                <H size={24} style={{ textAlign: 'center' }}>
                  {phase.k === 'nope' ? phase.verdict : phase.message}
                </H>
                {phase.k === 'nope' && phase.triesLeft != null && <Mono style={{ color: C.blaze }}>{phase.triesLeft} tries left</Mono>}
              </View>
            </>
          )}
        </View>
        <View style={{ gap: 12 }}>
          {phase.k === 'won' && <Button title={mode === 'squad' ? 'Back to the round' : 'Done'} onPress={close} />}
          {phase.k === 'nope' && (phase.triesLeft == null || phase.triesLeft > 0) && <Button title="Try again" icon="camera" onPress={() => setPhase({ k: 'aim' })} />}
          {phase.k === 'error' && (phase.retry ? <Button title="Send again" icon="refresh-cw" onPress={phase.retry} /> : <Button title="Try again" icon="camera" onPress={() => setPhase({ k: 'aim' })} />)}
          {phase.k !== 'won' && phase.k !== 'judging' && <Button title="Back" kind="quiet" onPress={close} />}
        </View>
      </Screen>
    );
  }

  // ---------- camera
  const denied = perm && !perm.granted;
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
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
      <LinearGradient colors={['rgba(18,21,15,0.85)', 'rgba(18,21,15,0)']} style={[styles.topShade, { paddingTop: insets.top + 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 20 }}>
          <IconButton icon="x" label="Close" onPress={close} tone="light" />
          <View style={{ flex: 1, gap: 6 }}>
            <H size={32} style={{ color: C.white }}>
              {cap(promptText)}
            </H>
            {examples ? <T style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>Like {examples}</T> : null}
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
      {(!perm || denied) && (
        <View style={styles.center}>
          <Feather name="camera-off" size={40} color={C.paper} />
          <T style={{ color: C.paper, textAlign: 'center', fontFamily: F.bodyBold }}>{!perm ? 'Opening the camera' : 'Rarefind needs the camera to see your finds.'}</T>
          {denied && (
            <Button
              title={perm?.canAskAgain ? 'Allow camera' : 'Open settings'}
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
}

const styles = StyleSheet.create({
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 48 },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 40 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.white },
  rejected: { borderRadius: 18, borderWidth: 2, borderColor: C.ink, overflow: 'hidden', transform: [{ rotate: '-3deg' }] },
  devChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.18)' },
});
