**Code: 8/10. Product: 8/10 for a 24-hour hackathon.** Strong visual identity, complete gameplay, and thoughtful retry handling. Quick play suits table visits; the judged demo should also show people playing outside together.

Both typechecks pass. **28 engine tests pass** using an in-process loader. The requested full test command was blocked by `spawn EPERM`; persistence tests remain unverified. No files modified.

Prioritized findings, including the concurrent edits:

1. **P1 — Anyone can exhaust another team’s leaderboard attempts.** [index.ts:606](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:606), [board.ts:71](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/board.ts:71). Team identity is just a typed name. Three deliberately skipped runs can consume a rival’s three counted attempts and lock its score at zero. **Fix:** issue organizer-controlled team tokens and require them for ranked runs.

2. **P1 — Quick play starts despite denied camera permission.** [Solo.tsx:60](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Solo.tsx:60). The permission result is discarded, then the timed game starts even after denial or failure. **Fix:** require a granted result before creating the room; otherwise remain on setup with a recovery action.

3. **P2 — The event QR link traps navigation in Quick play.** [Home.tsx:47](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Home.tsx:47). Returning home remounts `Home`, resets `opened`, and processes `?solo=1` again. Back/Done immediately reopen Quick play. **Fix:** consume the parameter once at application startup and remove it with `history.replaceState`.

4. **P2 — Table order materially changes leaderboard scores.** [rarity.ts:19](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/rarity.ts:19). With identical AI rarity 70, the first occurrence scores **60**, while the fourteenth identical-label find scores **10**. Earlier scores stay fixed. **Fix:** use a frozen event scoring baseline for ranked Quick play; keep evolving crowd rarity for ordinary play.

5. **P2 — Pocketed-phone reminders become wrong after early reveals.** [squad.tsx:160](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/squad.tsx:160), [notify.ts:43](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/notify.ts:43). Notifications predict the next round from the original hunt deadline; entering reveal neither cancels nor reschedules them. Backgrounded players can miss the next round. **Fix:** reschedule from the actual reveal deadline and cancel obsolete warnings.

6. **P2 — Squad persistence still has a crash window.** [index.ts:412](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:412). Find metadata commits before the room snapshot. A crash between writes leaves a collected card and used-photo mark without room credit; retrying that photo is rejected. **Fix:** journal the room/submission result with the find and reconcile it during startup, or commit both atomically.

7. **P2 — The rarity explanation contradicts the implementation.** [rarity.ts:5](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/rarity.ts:5), [SPEC.md:13](C:/Users/Benjamin/Desktop/Codejam16/rarefind/SPEC.md:13). Crowd weight caps at **50%**, so it never “takes over,” contrary to the spec and demo script. **Fix:** align the formula or update the spec, README, and judge narration to describe the intentional cap.
