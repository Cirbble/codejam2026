**8/10 as a 24-hour hackathon entry** — code **7.5**, product **8.5**. Strong Touch Grass fit: a clear cooperative mechanic, thoughtful GPS safeguards, and an indoor demo. Health is less compelling because the results omit movement metrics.

**Validation:** both typechecks passed; **17/17 engine tests passed** using an in-memory runner after `npm test` encountered sandbox `spawn EPERM`. No files changed. Physical-device behavior remains untested.

Prioritized findings:

1. **P1 — Spoken directions can violate the safe escape route.** [coach.ts:32](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/game/coach.ts:32) reduces eight compass directions to four relative directions; [Game.tsx:23](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Game.tsx:23) ignores heading accuracy. I reproduced a safe calculated exit becoming an out-of-bounds walk when following “straight ahead.” **Fix:** retain exact bearings, validate compass quality, and verify the route implied by the spoken instruction.

2. **P1 — “Warned” means sent, not received.** [game.ts:427](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:427) starts the escape allowance before delivery. Delayed downstream traffic can leave GPS uploads fresh while warnings arrive too late. Discarding warning events still produced damage. **Fix:** acknowledge warning IDs and require sufficient escape time after acknowledgment; otherwise exempt that hit.

3. **P1 — Leaving the arena guarantees safety without preventing victory.** Cells are clamped inside the arena at [game.ts:399](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:399), but victory ignores `oob` at [game.ts:351](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:351). Reproduced an unharmed win outside the zone. **Fix:** make out-of-bounds players ineligible to satisfy victory, with a return grace period.

4. **P2 — Poor GPS grants a scoring advantage.** At [game.ts:450](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:450), 30 m accuracy makes normal cells effectively harmless, while the player remains trusted and earns survival points. Reproduced at a cell’s center. **Fix:** calibrate playable accuracy to hazard size; suspend scoring and victory eligibility when location cannot support fair gameplay.

5. **P2 — Locking the phone breaks cooperative play.** [LocationProvider.tsx:111](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/net/LocationProvider.tsx:111) uses foreground-only tracking. The storm continues; a locked, downed teammate becomes unrevivable after the freshness window at [game.ts:518](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:518). **Fix:** send explicit inactive/resume state and provide a fair pause/rejoin policy; make foreground operation clear before starting.

6. **P2 — Bots can replace physical teammates in real games.** [game.ts:156](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:156) permits bots regardless of mode; [game.ts:519](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:519) lets them revive humans. Reproduced a bot rescue with `simulated: false`. **Fix:** restrict bots to practice rooms and consistently mark those results as practice.

7. **P2 — Redeploy recovery can immediately declare defeat.** [game.ts:660](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:660) restores absolute deadlines but disconnects humans. A restart spanning the deadline finishes as a loss before anyone reconnects. **Fix:** persist remaining duration, pause restored games, and resume after a bounded reconnect window.

8. **P2 — The judge report undersells movement and obscures bots.** [Results.tsx:21](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Results.tsx:21) omits already-computed distance/activity; [Results.tsx:50](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Results.tsx:50) ranks bots without labeling them. **Fix:** show approximate meters walked and label bot rows explicitly.
