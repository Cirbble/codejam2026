# Squall

## Inspiration
Most phone games keep you on the couch. We wanted one you can only play by walking around outside with friends. Bullet hell games are about reading danger and moving out of it. We moved that onto a real field, with GPS as the controller and your legs as the joystick.

## What it does
A storm moves across your park, and your phone becomes a storm spotter's radar.
- **Walk out:** a cell forms where you stand and heats up on the radar, green to magenta, over a few seconds. Your phone says out loud which way to walk and how far ("walk 12 metres to your left, 8 seconds"). Be outside it when it lands.
- **Lives and revives:** three hits and you are down. A teammate has to physically walk over to revive you.
- **Pickups:** probes for points and kits for a life, placed out in the field so you keep moving.
- **Five levels:** cells form faster and grow as the storm rises.
- **Win together:** if anyone is still standing when the storm passes, the crew wins. The storm report shows dodges, hits, revives, the peak level and the distance walked.

The big-screen view puts the live radar on a projector: the zone, every cell, every player and an event log.

## How we built it
- **Expo (React Native, SDK 58)** for iOS and Android:
  - expo-location for GPS and the compass heading. The radar rotates so up is the way you face, and directions are body-relative.
  - expo-speech for voice coaching, which plays even in silent mode through expo-audio, plus expo-haptics.
  - react-native-svg for the radar itself.
- **Node + TypeScript server** on Railway:
  - An authoritative engine that ticks at 4 Hz and broadcasts over WebSockets at 2 Hz.
  - Room snapshots on a volume, so redeploys don't kill games.
- **Big screen and landing page:** plain HTML canvas, drawing the same scope.

## Challenges
- **GPS is noisy.**
  - We never punish a stale or inaccurate fix.
  - A hit needs `distance + accuracy/2 ≤ radius`.
  - Revives allow for the combined error of two phones.
- **A bullet hell you can play at a walk.**
  - Every cell's warning time comes from the real exit distance of each player inside it, walked at 1.3 m/s plus reaction time.
  - One shared rule computes the server's timing and the phone's arrow, so they always agree.
  - It is unit-tested, including at the zone edge.
- **Fair hits.** You can only be hit by a cell you were warned about in time, never right after a reconnect or a GPS jump.
- **Never losing a game to infrastructure.** Rooms survive a server redeploy mid-storm.

## What we learned
Players looking at their phone means the design has failed. The voice and the compass-relative arrow carry the game, and the screen is there to confirm what you heard.

## What's next
- Storm tracks that sweep across the park instead of forming on people.
- Weekly community storms.
- Accessibility modes with shorter walks and longer warnings.

## Built with
expo · react-native · react-native-svg · typescript · node.js · websockets · railway
