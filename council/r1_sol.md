**8/10 as a 24-hour hackathon entry** — code **7.5**, product **8.5**. Strong track fit, distinctive rarity mechanic, and unusually complete multiplayer flow. Network and round-boundary behavior are the main demo risks.

Both typechecks pass. **17/17 tests pass** with `--test-isolation=none`; the requested command hit sandbox `spawn EPERM`. Read-only review; physical phones and live Gemini were not tested.

Prioritized findings:

1. **P1 — On-time photos lose to AI latency.** [room.ts:216](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:216), [room.ts:274](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:274): reveal advances after 8 seconds, defeating the 20-second grace. Reproduced: submission one second before expiry, verdict nine seconds later → rejected. **Fix:** drain pending judgments before advancing, with a bounded deadline.

2. **P1 — Pocketing a phone can end the round early.** [room.ts:234](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:234): disconnected players stop counting toward completion. Reproduced: one player finishes; the other disconnects → immediate reveal. This directly undermines outdoor play. **Fix:** retain disconnected participants until the deadline or an explicit withdrawal.

3. **P1 — Losing the initial welcome strands squad creation/join.** [squad.tsx:49](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/squad.tsx:49): the pending request clears before acknowledgment. Reconnection then has neither credentials nor a request to send. **Fix:** retain the request until `welcome`, make create/join idempotent, and add an acknowledgment timeout.

4. **P1 — Abuse limits have spoofable identities.** [index.ts:32](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:32), [index.ts:239](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:239): proxy headers are broadly trusted, and authenticated squad uploads rate-limit the caller-supplied device rather than `player.device`. **Fix:** derive squad identity from authentication and use one trusted-proxy IP extractor for HTTP and WS.

5. **P2 — Replaying photos can farm and poison rarity.** [judge.ts:67](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/judge.ts:67), [index.ts:168](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:168): cached acceptance still mints and counts new cards in subsequent games. **Fix:** track accepted image hashes across submissions and count distinct participants for crowd rarity.

6. **P2 — Accepted finds lack transactional durability.** [store.ts:39](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/store.ts:39), [index.ts:98](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:98): separate delayed JSON writes can lose or split cards, progress, and counts after a crash; daily idempotency disappears on restart. **Fix:** persist these together, including submission replies, in a transaction before acknowledgment.

7. **P2 — Busy-server responses force unnecessary retakes.** [Shoot.tsx:66](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:66): `rate` offers no resend, although a 12-player room exceeds the server’s 10 concurrent judgments. **Fix:** retain the captured photo and submission ID; offer delayed resend for transient refusals.

8. **P2 — Daily stays stale across midnight.** [Home.tsx:21](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Home.tsx:21): refresh happens only on mount/foreground. An open screen keeps yesterday’s prompts, which uploads reject. **Fix:** refresh at `resetsAt` and reconcile `closed` responses.

9. **P2 — Results misattribute duplicate names and omit promised highlights.** [Squad.tsx:337](/C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Squad.tsx:337): cards associate by display name; per-player best cards and round winners are absent. **Fix:** store immutable player IDs on cards and render those summaries.
