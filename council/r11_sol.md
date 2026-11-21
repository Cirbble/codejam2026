**7.5/10.** The main judging risk is that an indoor joystick/photo demo communicates “phone game” more clearly than “time away from your phone.”

I made no file changes. All 18 engine tests and both TypeScript checks pass. Native camera, locked-phone notifications, and device reconnect behavior remain unverified in this review.

Prioritized findings:

1. **P1 — Make the track benefit the demonstrated interaction.** Hunts initially show the map; pocketing is optional ([Game.tsx:46](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Game.tsx:46)). **Fix:** default hunts to the pocket view with a direct “Found it” camera action. Demonstrate locking a physical phone and receiving its reminder; use a short outdoor clip to establish what the joystick simulates.

2. **P1 — Late-entry strikes violate the advertised walking allowance.** Initial warnings use 1.3 m/s plus three seconds’ reaction; late-entry protection uses 1.6 m/s plus one second ([game.ts:540](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:540)). I reproduced damage after a 12-second warning despite walking at the stated pace after the reaction allowance. **Fix:** calculate both protections from the same pace, reaction time, and escape margin.

3. **P1 — Locked phones can receive obsolete instructions.** Reminders are scheduled locally for the current deadline ([coach.ts:176](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/game/coach.ts:176)), but another player can shorten a demo hunt or finish the game while that phone is suspended ([game.ts:737](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:737)). It can later announce “ENRAGED” after victory. **Fix:** use neutral “Check your squad” reminder wording immediately; server push is needed for timely changes while suspended.

4. **P1 — AI failure can exceed the stage budget.** Judging can consume 17 seconds per attempt, and missing the first demo hunt adds 75 seconds ([judge.ts:89](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/judge.ts:89), [game.ts:670](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:670)). **Fix:** rehearse actual camera shots of prepared red/round props, preflight permissions and sound, and prepare a clearly labeled recording of a complete successful run.

5. **P2 — Demo-to-real switching can strand the squad.** Automatically enabled demo location is disabled only when location permission is already granted ([Lobby.tsx:40](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Lobby.tsx:40)). Demo users commonly skipped that permission. They can remain simulated while others switch to GPS, causing Start to fail. **Fix:** make location mode an explicit room setting; switching to real mode should request permission on every phone and expose readiness.

6. **P2 — GPS readiness has three conflicting definitions.** The lobby requires accuracy ≤30 m and age <8 seconds; Start accepts ≤50 m/<15 seconds; damage requires ≤30 m/<6 seconds ([Lobby.tsx:70](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Lobby.tsx:70), [game.ts:319](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:319), [game.ts:276](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:276)). **Fix:** expose server-derived readiness per player and use a shared policy for Start eligibility.

7. **P2 — Escape guidance can point outside the arena.** Strike centers are clamped to `radius − strikeRadius/2`, allowing zones to cross the boundary; escape guidance generally points radially outward ([game.ts:511](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:511), [game.ts:524](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:524)). **Fix:** reserve the full strike radius plus escape margin and validate suggested exit points against the arena.

8. **P2 — Photo sharing cannot be revoked from the active-game UI.** Sharing controls exist only in Lobby ([Lobby.tsx:172](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Lobby.tsx:172)), although the server supports mid-game privacy changes. **Fix:** expose photo visibility and spectator-link revocation in an in-game host menu.

9. **P2 — Replayed Start messages bypass the room photo allowance.** The handler clears `roomJudged` even when `Room.start()` returns because a match is already running ([index.ts:293](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/index.ts:293)). **Fix:** validate the phase before resetting allowances, or make `start()` report whether it actually started a new game.
