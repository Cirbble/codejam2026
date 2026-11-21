**8/10 overall as a 24-hour hackathon entry.** Strong scope, thoughtful persistence and scoring safeguards, and a compelling shared reveal. Recovery on flaky networks still has gaps; the indoor solo demo also undersells Touch Grass.

Prioritized findings:

1. **P1 — Temporary refusals destroy upload grace.** [server/src/room.ts:368](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/room.ts:368), [index.ts:393](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:393). Reproduced: an eligible late upload passes precheck, gets aborted for a transient refusal, then its retry returns `closed`. **Fix:** preserve admission for the same submission ID and photo hash until its original grace deadline.

2. **P1 — A lost welcome can strand Quick play.** [app/src/squad.tsx:204](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/squad.tsx:204), [server/src/index.ts:619](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/index.ts:619). If the server creates the run but the welcome never arrives, the client discards its operation after 12 seconds. Subsequent starts are blocked by the existing run, whose credentials the client lacks. **Fix:** persist and retry the original operation; support recovering an active solo run using the device bearer secret.

3. **P1 — The buzzer can unmount an unfinished capture.** [app/src/screens/Shoot.tsx:65](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:65), [Shoot.tsx:95](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:95). Capture and resizing leave the phase as `aim`; a reveal immediately navigates back during those awaits, potentially interrupting capture. **Fix:** enter a `capturing` phase synchronously and defer navigation until capture/upload resolves.

4. **P2 — Unsent photos disappear on reload or navigation.** [app/src/screens/Shoot.tsx:73](C:/Users/Benjamin/Desktop/Codejam16/rarefind/app/src/screens/Shoot.tsx:73). “Send again” retains the image only in component state and closures. Closing the screen loses a find taken somewhere the player may have left. **Fix:** persist a pending JPEG, submission ID and mode credentials; restore retries with a bounded expiry for squads.

5. **P2 — Leaderboard attempt limits are easily bypassed.** [server/src/board.ts:89](C:/Users/Benjamin/Desktop/Codejam16/rarefind/server/src/board.ts:89). Three counted runs apply per client-controlled device ID; private browsing or another phone grants more. Team names also have no ownership check. **Fix:** give each visiting team an enrollment token and enforce its counted attempts server-side.

6. **P2 — The demo proves indoor photography more clearly than outdoor social play.** [DEMO.md:13](C:/Users/Benjamin/Desktop/Codejam16/rarefind/DEMO.md:13), [DEMO.md:29](C:/Users/Benjamin/Desktop/Codejam16/rarefind/DEMO.md:29). Both demonstrations stay indoors, and table visits are solo. **Fix:** include a brief recording of two people hunting outside and sharing the reveal; retain Quick play for audience participation.

Both typechecks passed. **34 room/scoring tests passed** with process isolation disabled. The requested full test command was blocked by sandbox process restrictions; board/storage tests additionally require prohibited temporary-directory writes. No files modified.
