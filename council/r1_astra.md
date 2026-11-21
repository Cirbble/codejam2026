**7.5/10 overall: code 7/10, product 8/10.** Strong hackathon concept: exploration creates collectible rewards, and Squad gives friends a shared activity. The main weaknesses are network recovery and behavior that penalizes putting phones away.

Both typechecks pass. **17/17 tests pass** using `--test-isolation=none`; the original command hit sandbox `spawn EPERM`. No files modified. Real-phone camera behavior and live Gemini judging remain unverified.

Prioritized findings:

1. **P1 — Valid last-second finds lose their score.** [server/src/room.ts:210](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:210) advances after an 8-second reveal, although `settle()` allows 20 seconds and Gemini can take 17. Reproduced: submit one second before expiry, verdict nine seconds later → `closed`. **Fix:** wait for pending judgments, with a bounded deadline, before completing the reveal.

2. **P1 — Putting a phone away can end your round early.** [server/src/room.ts:234](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:234) excludes disconnected players from early completion. Reproduced: A finishes; unfinished B disconnects → immediate reveal. This directly undermines Touch Grass play. **Fix:** retain the round’s participants until they finish, explicitly leave, or the timer expires.

3. **P1 — A dropped join handshake leaves an endless reconnect loop.** [app/src/squad.tsx:51](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/squad.tsx:51) clears the pending request before `welcome`. Reproduced: disconnect between those messages → subsequent sockets send nothing. **Fix:** retain the request until acknowledgment; make create/join idempotent with a request ID, and expose a retryable connection timeout.

4. **P1 — Replayed photos can manipulate global rarity.** [server/src/index.ts:28](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:28), [server/src/store.ts:81](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/store.ts:81). Arbitrary device IDs plus no image-reuse check let one accepted JPEG count repeatedly; cached judgments make this cheap. On a fresh prompt, 28 copies of one label make a different ordinary label score 100. **Fix:** deduplicate accepted images per prompt, limit each identity’s statistical contribution, and rate-limit identity creation.

5. **P2 — A disconnected host strands the lobby/rematch.** [server/src/room.ts:104](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:104) changes connectivity but transfers hosting only on explicit removal. Reproduced: remaining players cannot start. **Fix:** transfer hosting to a connected player after a reconnect grace period.

6. **P2 — Camera initialization failure is a dead end.** [app/src/screens/Shoot.tsx:160](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:160) handles mount errors only by disabling the shutter. With permission granted, no error or recovery appears. **Fix:** show a camera-error state with a remount action and reset readiness on every mount.

7. **P2 — Flaky networks can leave loading indefinitely.** [app/src/api.ts:79](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/api.ts:79) gives reads no timeout; submission timeout is cleared before reading the response body at line 110. **Fix:** keep cancellation active through body parsing, clear timers in `finally`, and provide retry plus cached daily prompts.

8. **P2 — Successful finds aren’t durably committed together.** [server/src/store.ts:37](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/store.ts:37), [server/src/index.ts:168](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:168). Counts, cards, ownership and daily locks are saved independently after success; a crash can lose or split them. Daily idempotency replies also disappear on restart. **Fix:** transactionally persist the find, progress and submission response—SQLite on the volume would fit.

9. **P2 — Squad results omit promised features and confuse duplicate names.** [app/src/screens/Squad.tsx:316](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Squad.tsx:316) lacks per-player best cards and round winners; line 337 attributes cards by display name. **Fix:** store public `playerId` on squad cards and render those summaries by ID.
