**7.5/10.** Track fit remains vulnerable: hunts support pocketed play, but Rage explicitly requires the phone out. An indoor joystick demonstration won’t establish the “Touch Grass” claim. Make the outdoor, phone-locked footage in `DEMO.md:4` mandatory and present hunts as the core experience.

I reran all 17 engine tests and both TypeScript checks successfully. Findings below combine source review and additional in-memory reproductions; native camera and lock-screen behavior remain unverified. No files modified.

1. **P1 — A living, pocketed teammate can’t prevent defeat.**  
   [game.ts:387](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:387) excludes disconnected humans after 30 seconds, while dropout handling waits four minutes. Reproduced: one connected player downed + one living player disconnected for 31 seconds → immediate loss. **Fix:** use a consistent roster for defeat and boss scaling, with a reconnect grace period when Rage starts.

2. **P1 — Lock-screen reminders can announce a Rage that never happens.**  
   [Game.tsx:68](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Game.tsx:68) treats every siege hunt as followed by Rage. However, [game.ts:430](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:430) skips Rage when insufficient time remains; final hunts end three seconds before time-up. Reminder synchronization also depends only on prompt ID. **Fix:** derive the next phase from authoritative remaining time, reconcile reminders on reconnect, and clear their armed state when the hunt ends.

3. **P1 — Passing E2E doesn’t establish a successful demo.**  
   [e2e.ts:69](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/scripts/e2e.ts:69) accepts a rejected photo as success; line 89 accepts either outcome, and no second winning submission occurs. The iOS installation link is also empty in [links.json:3](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/public/links.json:3). **Fix:** assert acceptance, awarded points, second-round submission and victory. Rehearse the complete sequence on two installed phones, including locking, reopening, camera permissions and a network interruption.

4. **P2 — Normal Hunt + Rage can finish without any Rage.**  
   [game.ts:277](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:277) gives a five-minute, two-human game two boss HP. Reproduced: both first-round photos land → victory before the first Rage. This removes the mechanic distinguishing the project from a photo scavenger hunt. **Fix:** ensure siege requires contributions across at least two hunts, with a Rage between them.

5. **P2 — Start readiness checks only the host’s usable location.**  
   [Lobby.tsx:63](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Lobby.tsx:63) gates Start on the local fix. [game.ts:291](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:291) accepts teammates with missing, stale or weak positions and includes stale coordinates in the centroid. **Fix:** validate the participating roster server-side; require fresh usable fixes and consistent demo/real-location mode before countdown.

6. **P2 — “Walked” distance is both incomplete and easy to inflate.**  
   [game.ts:204](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:204) applies speed quarantine only above 25 metres per update; line 221 counts every displacement below 60 metres. Reproduced: 20 m/s updates accumulated walking distance. Meanwhile, [LocationProvider.tsx:105](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/net/LocationProvider.tsx:105) uses foreground-only tracking, so locked-phone routes become missing segments or straight-line estimates. ([Expo documentation](https://docs.expo.dev/versions/v58.0.0/sdk/location/#locationwatchpositionasyncoptions-callback-errorhandler)) **Fix:** apply elapsed-time and accuracy-aware filtering to all movement; label the report “estimated tracked distance.”

7. **P2 — The spectator token doesn’t protect completed-room privacy from someone holding the room code.**  
   [index.ts:239](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/index.ts:239) permits new players into ended rooms, then issues the spectator token at line 247. That exposes retained photos and coordinates. **Fix:** require existing credentials for ended rooms; require host approval for new membership before exposing location or photo history.

8. **P2 — Retake retains the previous photo payload.**  
   [Snap.tsx:117](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Snap.tsx:117) clears the preview but retains `b64` and the submission ID. A subsequent camera failure can offer “Send again” for the discarded image; expiry detection also incorrectly sees a pending photo. **Fix:** clear both refs on Retake and distinguish captured-photo retries from camera failures.

9. **P2 — Silent-mode iPhones undermine the primary interaction.**  
   [coach.ts:26](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/game/coach.ts:26) assumes speech is audible. Expo explicitly documents that physical iPhones produce no speech in silent mode. ([Expo documentation](https://docs.expo.dev/versions/v58.0.0/sdk/speech/)) **Fix:** add a short audible voice check before the first game and include it in the table-demo preflight. Haptics alone cannot communicate escape direction.
