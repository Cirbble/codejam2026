# Squall

A GPS game for friends, played outside. A storm moves across your park. Cells form where people are standing, warm up on the radar from green to magenta, and land a few seconds later. You walk out before they land. Your phone tells you which way and how far, out loud.

- **Walk out:** each cell gives you a direction and a distance ("walk 12 metres to your left") and a countdown. Be outside the cell when it lands.
- **Lives:** you have three. A normal cell costs one and a supercell costs two. With none left you are down until a teammate walks to you.
- **Pickups:** probes are worth points and a kit restores a life. Each one is placed somewhere you have to walk to.
- **Levels:** the storm rises through five levels. Cells form faster and grow larger as it goes.
- **Win:** if anyone in the crew is still standing when the storm passes, the crew wins. The storm report shows dodges, hits, revives, the peak level and the distance walked.

The big-screen page (`/watch/CODE?t=TOKEN`) shows the same radar for a projector: the zone, every cell, every player, the crew's lives and an event log.

| | |
|---|---|
| Live server, landing page and big screen | https://krillion-production-ce39cedf.up.railway.app |
| Play in a browser | https://krillion-production-ce39cedf.up.railway.app/play (built with `app/build-web.sh`) |
| Spectator | `/watch/CODE?t=TOKEN` (the token comes from the lobby; it can't be guessed from the room code) |
| Repo | `server/` Node + TypeScript · `app/` Expo SDK 58 (iOS, Android, web) |

The service and project still use their original internal names (`krillion-production`, bundle id `com.benjamingurevitch.krillion`) so existing installs keep receiving updates. Everything a player sees says Squall.

## Run it

```bash
# server (port 8787)
cd server && npm i && npm run dev
npm test                 # engine simulation tests
npx tsx scripts/e2e.ts http://localhost:8787   # two bots-by-script play the demo storm end to end

# app
cd app && npm i
npx expo start           # scan with Expo Go, or press w for web
EXPO_PUBLIC_SERVER_URL=http://<lan-ip>:8787 npx expo start   # against a local server
```

**Demo mode** (the switch on the home screen) replaces GPS with an on-screen joystick for indoor judging. It sets up a 100-second storm in a 60 m zone with two practice bots. Bots walk out of cells, collect pickups and revive you, and they are labelled as bots everywhere. On localhost the web build is silent.

## Architecture

```
 phone (Expo)                          server (Railway)
 ┌───────────────┐  WS /rt  2 Hz state ┌──────────────────────────┐
 │ GameProvider  │◀───────────────────▶│ Room engine (4 Hz tick)  │
 │ Location 1 Hz │  pos, settings      │  levels, cells, pickups, │
 │ Coach: voice, │  personal events    │  revives, bots, results  │
 │ haptics       │                     │ /watch big screen        │
 │ Radar (SVG)   │                     │ snapshots on a volume    │
 └───────────────┘                     └──────────────────────────┘
```

- **Server-authoritative.** Phones only send position and intents. The server owns cells, warnings, hits, scores and results.
- **Escapable by construction.**
  - Each cell's warning time comes from the real exit distance of every player inside it, walked at 1.3 m/s plus 3 s to react.
  - One shared `escapeExit` rule gives both the server's timing and the phone's arrow and voice. It never points out of the zone, and at the zone edge it takes the short way around.
  - Each player faces one hazard at a time, and cells never overlap.
  - Unit-tested.
- **GPS honesty.**
  - No penalties on a stale fix (more than 6 s old), a weak one (accuracy worse than 30 m), right after a jump, or while disconnected.
  - A hit requires `distance + accuracy/2 ≤ radius`.
  - You can only be hit by a cell you were warned about in time to walk out of it.
  - Distance walked only counts plausible movement on foot.
- **Redeploy-safe.** Rooms are snapshotted every 2 s, on every phase change and on shutdown, so a server redeploy mid-storm resumes the game.
- **A daylight storm chart.** A pale sky with slate ink, readable in sunlight. Cells are drawn as radar reflectivity bands, the only bright colour, which always means danger. The same scope is used in the app, on the big screen and on the landing page. See DESIGN.md.

## Files

- `server/src/game.ts`: the engine (levels, cells, warnings, hits, pickups, revives, bots, results)
- `server/src/geo.ts`: distances and the shared escape rule (copied to `app/src/shared/geo.ts`)
- `server/src/index.ts`: HTTP, WebSocket, persistence, rate limits
- `server/public/index.html`, `watch.html`: landing page and big screen
- `app/src/components/Radar.tsx`, `GameMap.tsx`: the scope
- `app/src/game/coach.ts`: voice and haptics
- `app/src/screens/*`: Home, Lobby, Game, Results
