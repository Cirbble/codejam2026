**8/10 overall — code 8.5, product 7.5.** Strong core loop and careful handling of retries, scoring, and room recovery. Quick play helps event adoption, but an indoor solo demo gives judges limited evidence of the “outside together” promise.

Prioritized findings:

1. **P1 — Venue Wi-Fi can exhaust the demo quotas.** [server/src/index.ts:548](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:548), [judge.ts:36](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/judge.ts:36). Defaults allow only 10 solo starts per network per 10 minutes and 200 provider attempts per hour across everyone sharing that IP. Rejections and fallbacks consume attempts too. **Fix:** configure event-sized IP limits and enforce tighter limits per device/team instead.

2. **P1 — A lost HTTP response can consume the next Quick play round.** [app/src/screens/Shoot.tsx:67](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:67). The screen refuses to leave while judging, even when WebSocket state confirms acceptance and advances the game. Two HTTP attempts can hold it for roughly 40 seconds. **Fix:** recover accepted cards from room state and exit obsolete judging screens when the round advances.

3. **P2 — Certain team names silently disappear from the board.** [server/src/board.ts:53](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/board.ts:53). Reproduced with `constructor` and `__proto__`: both return a null standing and create no visible entry; the latter mutates the object prototype. **Fix:** use `Map`, or null-prototype dictionaries with own-property checks, including after loading JSON.

4. **P2 — Leaderboard recording is not durable or crash-idempotent.** [server/src/board.ts:38](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/board.ts:38), [room.ts:289](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:289). Save errors are swallowed while the room permanently marks the run recorded. Conversely, crashing between board and room saves can count it twice. **Fix:** persist a unique run ID, deduplicate recordings, propagate save failures, and retry until committed.

5. **P2 — Pocket reminders can announce the wrong round time.** [app/src/squad.tsx:155](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/squad.tsx:155). Reminders assume the hunt lasts until its original deadline; early reveals and extensions do not reschedule them. **Fix:** update notifications from each actual hunting/reveal deadline, cancelling superseded reminders.

6. **P2 — The event leaderboard compares unequal challenges.** [server/src/room.ts:184](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:184), [rarity.ts:15](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/rarity.ts:15). Teams receive different final prompts, while rarity changes as earlier teams play. Identical finds can earn different points. **Fix:** use one seeded event prompt set and a fixed event scoring baseline.

7. **P2 — Quick play ends without connecting players to the track’s main experience.** [app/src/screens/Solo.tsx:114](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Solo.tsx:114). Results offer the board, replay, or Done. **Fix:** add a direct “Start an outdoor squad” action and demonstrate that shared outdoor loop during judging.

Both typechecks pass. The requested test command was blocked by sandbox `spawn EPERM`; **27 room/scoring/prompt tests passed** using Node’s in-process loader. Board/store suites were not executed. No files modified.
