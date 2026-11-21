**7.5/10.** Main deductions: mobile lifecycle gaps, uncertain lock-screen timing, and an indoor demo that can obscure the “away from your phone” benefit.

Prioritized findings:

1. **P1 — Switching Demo → real GPS can freeze location for the match.** [LocationProvider.tsx:152](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/net/LocationProvider.tsx:152) retains the simulated fix; [Lobby.tsx:70](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Lobby.tsx:70) treats it as ready. Starting before the first real fix locks the server into simulation; [game.ts:217](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:217) then rejects real updates. **Fix:** clear cached fixes on source changes and gate Start on server acknowledgment of the selected source.

2. **P1 — Android reminders can arrive after Rage has passed.** [coach.ts:186](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/game/coach.ts:186) schedules dates without checking exact-alarm capability, while the pocket screen promises a callback. SDK58 falls back to inexact delivery without permission. **Fix:** preflight capability, provide a foreground fallback, and rehearse a locked Android phone through hunt→rage. [Expo documentation](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/#getexactalarmpermissionsasync).

3. **P1 — The stage preset has no dependable two-minute ceiling.** [game.ts:680](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:680) adds 75 seconds after an unsuccessful hunt: 110 becomes 185 seconds, plus countdown and possible outstanding judging. **Fix:** separate a hard-capped stage preset from the forgiving table preset; rehearse with actual phones, camera permissions, red/round props, and venue networking.

4. **P1 — Track fit is weaker than the mechanics suggest.** [coach.ts:91](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/game/coach.ts:91) explicitly requires “phone out”; joystick combat demonstrates screen interaction. Foreground-only tracking also misses pocketed walking loops ([LocationProvider.tsx:111](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/net/LocationProvider.tsx:111)). **Fix:** make a real locked-phone hunt/reminder and short outdoor recording central to judging. Present distance as approximate tracked displacement, not total walking.

5. **P2 — Redeploy-safe games are not yet redeploy-safe photo retries.** Submission results live only in memory at [index.ts:73](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/index.ts:73). If a photo scores but its response is lost during restart, retry hits “already fed” at line 99 instead of recovering the verdict. **Fix:** persist submission IDs and responses alongside awards, and return the original result on retry.

6. **P2 — Kicking someone does not revoke spectator access.** [index.ts:314](/C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/index.ts:314) removes membership but leaves their previously issued watch token valid for photos and live positions. **Fix:** rotate the token on kick, disconnect existing watchers, and distribute the replacement only to remaining players.

7. **P2 — Results announce a winner even after defeat.** [Results.tsx:47](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Results.tsx:47) says “[name] wins” regardless of team outcome. **Fix:** use “Top scorer” and keep the cooperative victory/loss unmistakable.

8. **P2 — Font failure can strand startup permanently.** [App.tsx:47](/C:/Users/Benjamin/Desktop/Codejam16/krillion/app/App.tsx:47) ignores the font-loading error and dismisses the splash only on success. **Fix:** handle failure and render with system fonts.

Read-only verification: both typechecks and all 20 engine tests passed. No physical-device rehearsal; the reported live E2E does not exercise native camera, audio, or lock-screen behavior.
