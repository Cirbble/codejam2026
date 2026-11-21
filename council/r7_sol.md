**8/10 overall — code 8.5, product 7.5.** Strong hackathon engineering: bounded AI spend, idempotent submissions, recovery, and a compelling collection loop. The remaining risks concentrate around Quick play and event presentation.

Reviewed the current working tree, including changes made during this review.

1. **P1 — “Play again” immediately fails.** [Solo.tsx:100](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Solo.tsx:100) starts another run after 300 ms; [index.ts:628](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:628) now requires 10 seconds after the previous run ends. **Fix:** remove the post-completion gap for normal replays, or return an eligibility timestamp and disable replay until then.

2. **P1 — Slow uploads miss the advertised grace period.** [index.ts:74](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:74) buffers the entire photo before [index.ts:382](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:382) checks the round. Starting an upload before the buzzer doesn’t protect it if transmission finishes afterward. **Fix:** reserve the submission ID over WebSocket before uploading, then allow a bounded upload/judgment grace period.

3. **P1 — Team scores depend heavily on visitation order.** [rarity.ts:19](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/rarity.ts:19) uses changing crowd counts and a first-ever bonus. Reproduced: identical label and AI rarity 85 scores **100 for the first find, 60 for the second**. **Fix:** use a frozen scoring baseline for the event leaderboard; retain evolving rarity for collectible cards.

4. **P2 — Anyone can exhaust another team’s hourly allowance.** [index.ts:630](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:630) charges a shared team-name limit on creation. Twenty requests with fabricated device IDs can block that team for an hour without submitting photos. **Fix:** require an organizer-issued team token before charging team-wide limits.

5. **P2 — Most teams eventually disappear from the projector.** [board.html:82](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/public/board.html:82) permanently slices the leaderboard to the first screenful. Lower-ranked teams never get their “name on the board” moment. **Fix:** rotate pages and briefly feature the latest completed team regardless of rank.

6. **P2 — Unsent photos disappear on reload or navigation.** [Shoot.tsx:73](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:73) retains the JPEG and retry ID only in component state/closures. A browser reload or phone process eviction loses the retry. **Fix:** persist pending JPEGs and submission IDs before uploading; restore them on launch.

7. **P2 — The primary entry flow weakens the track demonstration.** [Home.tsx:159](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Home.tsx:159) emphasizes solo indoor Quick play. It supports table visits but demonstrates neither outdoor activity nor playing together. **Fix:** retain it for voting outreach; make the judged demo a two-phone outdoor Squad hunt, with evidence from an actual outdoor session.

Both typechecks pass. All **30 room/rarity tests pass** with process isolation disabled. The full requested test command hit `spawn EPERM`; board/storage tests remain blocked by read-only temporary-file restrictions. No files modified.
