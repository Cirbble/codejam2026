import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed/800ExtraBold';
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Label, T } from './src/components/ui';
import { cancelScheduled, handleEvent, initAudio } from './src/game/coach';
import { GameProvider, useGame } from './src/net/GameProvider';
import { LocationProvider } from './src/net/LocationProvider';
import { Game } from './src/screens/Game';
import { Home } from './src/screens/Home';
import { Lobby } from './src/screens/Lobby';
import { Results } from './src/screens/Results';
import { C } from './src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Router() {
  const { session, room, status, onEvent, leave, error } = useGame();
  useEffect(() => onEvent((ev) => handleEvent(ev)), [onEvent]);
  // Notifications must never outlive the game, whichever screen we're on
  const phase = room?.phase;
  useEffect(() => {
    if (!session || phase === 'ended' || phase === 'lobby') cancelScheduled();
  }, [session, phase]);

  if (!session) return <Home />;
  if (!room)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={C.amber} />
        <Label>{status === 'reconnecting' ? 'Reconnecting' : 'Joining'}</Label>
        {error && <T style={{ color: C.danger, textAlign: 'center', paddingHorizontal: 24 }}>{error}</T>}
        <Button title="Back to home" kind="quiet" onPress={leave} />
      </View>
    );
  if (room.phase === 'lobby') return <Lobby />;
  if (room.phase === 'ended') return <Results />;
  return <Game />;
}

export default function App() {
  const [fontsOk, fontErr] = useFonts({ BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold, Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, JetBrainsMono_500Medium, JetBrainsMono_700Bold });
  const loaded = fontsOk || !!fontErr; // a font failure falls back to system fonts instead of a stuck splash
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);
  useEffect(() => {
    initAudio();
  }, []);
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <GameProvider>
        <LocationProvider>
          <Router />
        </LocationProvider>
      </GameProvider>
    </SafeAreaProvider>
  );
}
