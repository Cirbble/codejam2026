import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import { Unbounded_500Medium } from '@expo-google-fonts/unbounded/500Medium';
import { Unbounded_700Bold } from '@expo-google-fonts/unbounded/700Bold';
import { Unbounded_800ExtraBold } from '@expo-google-fonts/unbounded/800ExtraBold';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, T } from './src/components/ui';
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
      <View style={{ flex: 1, backgroundColor: C.sky, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <ActivityIndicator color={C.ink} />
        <T style={{ color: C.inkSoft }}>{status === 'reconnecting' ? 'Reconnecting' : 'Joining'}</T>
        {error && <T style={{ color: C.dbz[3], textAlign: 'center', paddingHorizontal: 24 }}>{error}</T>}
        <Button title="Back to home" kind="quiet" onPress={leave} />
      </View>
    );
  if (room.phase === 'lobby') return <Lobby />;
  if (room.phase === 'ended') return <Results />;
  return <Game />;
}

export default function App() {
  const [fontsOk, fontErr] = useFonts({ Unbounded_500Medium, Unbounded_700Bold, Unbounded_800ExtraBold, Figtree_400Regular, Figtree_500Medium, Figtree_700Bold, JetBrainsMono_500Medium, JetBrainsMono_700Bold });
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
      <StatusBar style="dark" />
      <GameProvider>
        <LocationProvider>
          <Router />
        </LocationProvider>
      </GameProvider>
    </SafeAreaProvider>
  );
}
