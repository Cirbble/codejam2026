**8/10 as a 24-hour hackathon entry.** Strong Touch Grass concept, distinctive rarity mechanic, and unusually thoughtful retry handling and server state management. Remaining risks cluster around phone lifecycle and unreliable connections.

Both typechecks pass. The requested test command hit sandbox `spawn EPERM`; all **21 engine tests passed** through an in-memory loader. Storage tests and live phone/Gemini flows remain unverified. No files modified.

Prioritized findings:

1. **P1 — Full-resolution photo decoding risks phone crashes.** [Shoot.tsx:26](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:26): capture uses unrestricted resolution, then `manipulateAsync` decodes the full bitmap before resizing. High-resolution cameras can exhaust memory. **Fix:** cap capture resolution and use the contextual manipulator’s decode-time `maxWidth`/`maxHeight` options.

2. **P2 — Leaving offline creates a ghost squad member.** [squad.tsx:156](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/squad.tsx:156): `leave` silently drops its message unless the socket is open, then deletes the credentials. The server retains that player, preventing early reveals; mid-game kicks are unavailable. **Fix:** persist a pending leave and retry an authenticated, idempotent leave operation until acknowledged.

3. **P2 — Round changes destroy the photo retry UI.** [Shoot.tsx:50](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:50): if HTTP fails while WebSocket state advances, switching from `judging` to `error` immediately navigates back. The retained image and submission ID disappear. **Fix:** persist unresolved submissions and reconcile their outcomes before dismissing the screen.

4. **P2 — Camera permission recovery stays stale.** [Shoot.tsx:35](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:35): after granting permission through “Open settings,” returning leaves the mounted screen showing its previous denial. The installed permission hook does not refresh on foregrounding. **Fix:** use its third getter and refresh permission when `AppState` becomes active.

5. **P2 — Exact-photo replay still earns points.** [index.ts:188](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:188): deduplication suppresses crowd increments, but still mints and scores another card. Replaying an old accepted image with a new submission ID works in later games without another hunt. **Fix:** reject previously accepted device/prompt/image combinations while preserving same-submission retries.

6. **P2 — Pocketed phones can miss subsequent rounds.** [Squad.tsx:204](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Squad.tsx:204): only the current round’s reminder is scheduled. Suspended JavaScript cannot schedule reminders for automatically advancing rounds. **Fix:** send round-start push notifications, or require a ready step between rounds.

7. **P2 — Failed persistence can still return success.** [store.ts:45](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/store.ts:45): flush errors are logged and swallowed, allowing acknowledged cards/progress to disappear after restart. **Fix:** propagate write failures and commit card, progress, and room state transactionally before acknowledging acceptance.
