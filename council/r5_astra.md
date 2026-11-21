**7.5/10 overall — code 8/10, product 7/10 for Touch Grass.** Strong scope for 24 hours: server-authoritative rounds, idempotent submissions, reconnects, and meaningful tests. Quick play helps table visits, but its reliability and connection to outdoor group play need attention.

Both typechecks pass. The requested test command hit sandbox `spawn EPERM`; a read-only, in-process fallback passed **all 27 room tests**. Store/board suites remain unverified. No files changed; no live-phone testing performed.

Prioritized findings:

1. **P1 — Venue Wi-Fi can block the demo.** [server/src/index.ts:548](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:548) limits all solo players behind one public IP to **10 starts per 10 minutes**. [judge.ts:36](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/judge.ts:36) additionally defaults to 200 provider attempts/hour per IP. **Fix:** use per-participant limits with a configurable venue allowance, retaining the global spend cap.

2. **P1 — Quick play can open an unrelated Squad.** [app/App.tsx:26](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/App.tsx:26) accepts *any* existing session. Create a Squad, return home, tap Quick play: the old Squad opens instead of team entry. **Fix:** distinguish solo and squad sessions and provide an explicit mode-switch path.

3. **P2 — A delayed HTTP response consumes the next round.** [Shoot.tsx:67](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:67) refuses to leave while judging; [api.ts:130](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/api.ts:130) permits two 20-second attempts. The server can already have accepted the photo and advanced past the four-second solo reveal. **Fix:** reconcile accepted cards from WebSocket round state and leave stale capture screens when the round advances, preserving submission recovery separately.

4. **P2 — Team names can mutate the object prototype and disappear.** [board.ts:53](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/board.ts:53) indexes a plain object with user input. An isolated reproduction with `__proto__` mutated `Object.prototype.plays`, returned no standing, and omitted the team. **Fix:** use own-property checks and null-prototype dictionaries, including after loading JSON.

5. **P2 — Leaderboard persistence can silently lose completed runs.** [board.ts:38](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/board.ts:38) swallows save failures, while [room.ts:290](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:290) marks the run recorded before recording succeeds. **Fix:** persist an idempotent run ID successfully before marking completion; retry failed writes.

6. **P2 — Passing one demo phone between teams distorts crowd rarity.** [store.ts:120](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/store.ts:120) counts each device/prompt/label only once. Ten teams finding a red mug on your phone contribute one mug observation. **Fix:** give hosted demo participants separate server-issued identities for crowd counting while retaining per-participant deduplication.

7. **P2 — First-time camera setup spends the round timer.** [index.ts:556](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:556) auto-starts immediately, but camera permission is requested only inside [Shoot.tsx:55](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:55). **Fix:** preflight camera permission before creating the run and show remaining time inside the camera.

8. **P2, judging risk — The promoted experience is indoor and solitary.** [Home.tsx:137](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Home.tsx:137) promotes Quick play; [Solo.tsx:114](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Solo.tsx:114) ends with board/replay/done. **Fix:** add a direct outdoor Squad action after the demo and demonstrate two people hunting together to judges.
