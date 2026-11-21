**Code: 8/10. Product: 8/10 for a 24-hour hackathon.** Strong core loop and thoughtful recovery work; the new demo flow still has several rough edges.

Both typechecks pass. The requested test command hit sandbox `spawn EPERM`; an in-process fallback passed all **28 room tests**. Store/board tests remain unverified. No files modified.

Prioritized findings:

1. **P1 — Camera denial still starts Quick play.** [Solo.tsx:60](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Solo.tsx:60) ignores the permission result and creates a timed run even after denial or failure. **Fix:** require `granted` before creating the room; keep permission recovery on the start screen.

2. **P2 — QR visitors cannot reliably return home.** [Home.tsx:47](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Home.tsx:47): the “already opened” ref resets whenever Home remounts. With `?solo=1`, Back or Done immediately opens Quick play again. **Fix:** consume the query parameter once in the navigation provider and remove it with `history.replaceState`.

3. **P2 — Failed saves can make “Send again” impossible.** [room.ts:345](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:345): when the last find triggers early reveal, `unsettle()` removes the card but leaves the phase as reveal. I reproduced the retry returning **409 closed**. **Fix:** roll back the phase transition with the card, or explicitly permit that submission’s retry during recovery.

4. **P2 — Pocket reminders drift after early reveals.** [squad.tsx:156](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/squad.tsx:156) schedules reminders during hunting but ignores reveal transitions. If everyone finishes early, the scheduled next-round reminder still follows the original hunt deadline—potentially minutes late. **Fix:** reschedule from the actual reveal deadline and cancel the previous warning.

5. **P2 — Team standings have no team ownership.** [index.ts:577](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:577) accepts arbitrary team names; [board.ts:61](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/board.ts:61) merges matching names and keeps the best repeat. Anyone can submit under another team’s name, and unlimited event retries undermine “play once.” **Fix:** issue team codes for scored runs; make subsequent attempts practice-only.

6. **P2 — The advertised scoring differs materially from implementation.** [rarity.ts:19](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/rarity.ts:19) caps crowd influence at **50%**, while SPEC, README and demo narration say the crowd takes over. **Fix:** reconcile the formula and presentation before judging; if the cap is intentional, update the claims and examples.
