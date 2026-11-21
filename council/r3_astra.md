**8/10 as a 24-hour hackathon entry.** Strong, complete game loop with unusually good server authority, retry handling, and room recovery. The main weaknesses are phone/network edge cases and fairness.

Both typechecks passed. The requested test command hit sandbox `spawn EPERM`; an in-memory loader ran all **21 room/scoring tests successfully**. Storage tests remain unrun. I modified no files.

Prioritized findings:

1. **P1 — Successful finds can disappear after restart.** [server/src/store.ts:42](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/store.ts:42) swallows write failures; separate JSON files also lack a transaction. Acceptance can reach the phone without durable cards, locks, or scores. **Fix:** commit find metadata, progress, and idempotency together in SQLite; propagate persistence failures before acknowledging success.

2. **P2 — Leaving offline strands the player.** [app/src/squad.tsx:156](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/squad.tsx:156) deletes credentials even when `leave` cannot reach the server. The ghost player remains, prevents early reveals, and cannot rejoin mid-game. **Fix:** persist a pending leave, resume and retry until acknowledged, then clear credentials and reconnect timers.

3. **P2 — Browser camera denial has no effective recovery.** [app/src/screens/Shoot.tsx:209](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:209) relies on `canAskAgain`, but the installed Expo web implementation always returns `true`. A blocked site keeps offering “Allow camera” without reopening the permission prompt. **Fix:** provide browser-specific site-permission recovery and recheck permission on return.

4. **P2 — Previously accepted photos can farm future games.** [server/src/store.ts:91](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/store.ts:91) suppresses duplicate crowd counts, but [server/src/index.ts:208](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:208) still mints and scores another card. Replaying cached JPEGs bypasses fresh exploration. **Fix:** reject previously accepted image hashes for new submissions, while preserving retries of the original submission.

5. **P2 — “Best card” and round winners conflict with tiers.** [server/src/room.ts:425](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:425) sorts numeric rarity before points; line 354 does likewise for best cards. Confirmed: an 85-point Epic beats a 100-point One of One with rarity 80. **Fix:** consistently compare tier/points first, then rarity and time.

6. **P2 — Pocketing phones can mean missing subsequent rounds.** [app/src/notify.ts:27](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/notify.ts:27) schedules only the current round’s warning, with no web notifications; [server/src/room.ts:248](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:248) advances automatically. This weakens the Touch Grass promise. **Fix:** add a host-ready transition between rounds, or reliable background round announcements.

7. **P2 — Points leak before the reveal.** [server/src/room.ts:340](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:340) broadcasts updated totals during hunting. Confirmed: opponents can infer a submitted card’s tier from the score delta. **Fix:** expose only completed-round totals until reveal.
