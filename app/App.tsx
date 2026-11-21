import { BricolageGrotesque_600SemiBold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { Feather } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavProvider, useNav } from './src/nav';
import { Collection, CardView } from './src/screens/Collection';
import DailyScreen from './src/screens/DailyScreen';
import Home from './src/screens/Home';
import Shoot from './src/screens/Shoot';
import Squad from './src/screens/Squad';
import { Board, SoloStart } from './src/screens/Solo';
import { useSquad } from './src/squad';
import { SquadProvider } from './src/squad';
import { C } from './src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Quick play shows its own start screen until a solo room exists, then the shared room screens. */
function SoloGate() {
  const squad = useSquad();
  if (squad.session && (!squad.room || squad.room.solo)) return <Squad />;
  return <SoloStart />;
}

function Router() {
  const { route } = useNav();
  switch (route.name) {
    case 'daily':
      return <DailyScreen />;
    case 'shoot':
      return <Shoot key={route.promptId + route.mode} promptId={route.promptId} promptText={route.promptText} examples={route.examples} mode={route.mode} />;
    case 'collection':
      return <Collection />;
    case 'card':
      return <CardView card={route.card} />;
    case 'squad':
      return <Squad />;
    case 'solo':
      return <SoloGate />;
    case 'board':
      return <Board />;
    default:
      return <Home />;
  }
}

export default function App() {
  const [ok, err] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_500Medium,
    ...Feather.font,
  });
  const ready = ok || !!err; // a font failure falls back to system fonts instead of a stuck splash
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: C.paper }} />;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <SquadProvider>
          <NavProvider>
            <Router />
          </NavProvider>
        </SquadProvider>
      </View>
    </SafeAreaProvider>
  );
}
