You are reviewing a hackathon project. Read-only: do not modify files.

The repo in the current directory is "Krillion", a multiplayer real-world game built for CodeJam 16 (McGill), targeting the "Touch Grass" track ("An application that supports you doing something away from your phone. The app may send notifications to bring you back."). Judging is at a table indoors (1:00-3:30 PM Sunday), plus a possible 2-minute stage demo for popular vote. About 27 hours of build time remain. This is an updated implementation since your last look; re-review from scratch. An end-to-end script (server/scripts/e2e.ts) passes against the live deployment, and server/src/game.test.ts has 20 passing tests, and a redeploy mid-game was verified to preserve the running game (server/scripts/redeploy-test.ts). The live E2E now plays the full demo preset to a victory.

Read DESIGN.md for the original intent (note: it has evolved; the code is the source of truth). Key code:
- server/src/game.ts (authoritative engine: hunt rounds -> rage phases, boss HP, GPS trust rules, revive, bots), server/src/index.ts (HTTP + WebSocket), server/src/judge.ts (Gemini photo judge), server/src/prompts.ts, server/src/game.test.ts, server/public/watch.html (spectator big screen)
- app/ (Expo SDK 58 React Native): App.tsx, app/src/net/GameProvider.tsx, app/src/net/LocationProvider.tsx, app/src/game/coach.ts (voice/haptics/local notifications), app/src/screens/*.tsx, app/src/components/*.tsx

Review the implementation as an experienced hackathon judge and a senior mobile/realtime engineer:
1. Track fit and judge appeal as built.
2. Correctness bugs (game logic, networking/reconnect, timers, GPS handling, notifications, camera/judge flow). Point to file:line.
3. UX problems a first-time user would hit.
4. Demo readiness and robustness at an indoor table.
5. Security/privacy issues worth fixing for a hackathon.

Give a score out of 10 for the project as it stands, then a prioritized list of concrete findings (most important first), each with a specific fix. Be concise. Skip praise.
