**7/10 as built.** The Touch Grass case is weakened by phone-out Rage and a joystick-led demo. Judge appeal depends on showing a real locked-phone hunt, followed by a reliable, brief Rage interaction.

Read-only review. All 15 engine tests and both TypeScript checks pass; native lifecycle behavior was reviewed from code.

1. **P1 — Switching out of demo can break the arena.** [Lobby.tsx:32](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Lobby.tsx:32) switches guests into simulation, but line 114 switches only the host back. [game.ts:275](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:275) then averages real and simulated coordinates. **Fix:** synchronize location mode across the room in both directions; reject mixed or geographically dispersed starts.

2. **P1 — The default demo can omit its main interaction.** [game.ts:416](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:416) randomly targets humans or bots. In 300 local simulations of one stationary presenter plus two bots, **66 never warned the presenter during the first Rage**. **Fix:** make the first demo strike target the presenter deterministically; rehearse two successful photo rounds within the 110-second preset.

3. **P1 — Photo capture can cross attempts.** [Snap.tsx:97](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Snap.tsx:97) awaits capture and manipulation, then submits using mutable target/session refs. Closing and reopening during those awaits can attach an old capture to a new attempt. **Fix:** freeze round, session, and attempt generation before capture; check generation after every await.

4. **P1 — Reminder scheduling can survive leaving or winning.** [coach.ts:139](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/game/coach.ts:139) asynchronously cancels, then schedules notifications without checking whether the game ended meanwhile. A later scheduling completion can undo the exit/end cancellation. **Fix:** serialize scheduling, invalidate it with a game generation, and cancel notification IDs created by stale operations.

5. **P1 — Spectator photos remain after reset or hiding.** [watch.html:177](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/public/watch.html:177) updates only when the photo ID changes. Resetting the photo list leaves the previous game’s image visible; hiding photos with the same ID also leaves it displayed. **Fix:** clear the feature when empty or hidden, and include visibility in its render key. Consider `no-store` for [photo responses](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/index.ts:158).

6. **P2 — The Grass Report undercounts the intended activity.** [LocationProvider.tsx:91](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/net/LocationProvider.tsx:91) uses foreground-only tracking, while the pocket screen invites locking. A locked out-and-back walk can contribute almost no distance. [Expo confirms this foreground restriction](https://docs.expo.dev/versions/v58.0.0/sdk/location/#locationwatchpositionasyncoptions-callback-errorhandler). **Fix for this hackathon:** present distance as recorded movement, avoid claiming complete activity tracking, and demonstrate the locked-phone notification flow on the actual device.

7. **P2 — Spectator reconnect can stall behind an overlay.** [watch.html:124](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/public/watch.html:124) detects silence but never replaces the silent socket; reconnect depends on `onclose`. **Fix:** add the app’s silence watchdog, close the previous socket, and ignore messages from replaced connections.

8. **P2 — Indoor joiners hit an unnecessary permission barrier.** [Home.tsx:24](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Home.tsx:24) requires location permission before discovering the destination room uses simulated locations. **Fix:** allow joining first; resolve demo mode and location readiness in the lobby.

9. **P2 — Escaping farther loses dodge credit.** [game.ts:476](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:476) awards a dodge only within eight metres of the zone boundary. Reproduced: a warned player safely 25 metres from a 10-metre strike receives zero dodges. **Fix:** credit previously warned, trusted players who escaped, regardless of final distance.

10. **P2 — Malformed settings poison authoritative state.** [game.ts:246](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:246) clamps values without runtime type validation. String inputs produced `NaN` duration and radius locally. **Fix:** validate WebSocket messages and require finite numeric settings before mutation.

With 27 hours left, prioritize **1–5 and a physical-device dress rehearsal** over additional features.
