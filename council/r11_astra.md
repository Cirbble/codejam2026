**7.5/10.** The main judging risk is that the indoor demo looks like a joystick game with AI photos, while Touch Grass depends on convincing evidence of time away from the phone.

Prioritized findings:

1. **P1 — Native demo readiness remains unverified by the E2E.** [e2e.ts:45](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/scripts/e2e.ts:45) injects GPS; photo submissions bypass the camera. Rage explicitly instructs “phone out” ([coach.ts:91](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/game/coach.ts:91)). **Fix:** rehearse on the actual demo phones: camera capture → lock → audible reminder → reconnect → victory. Bring red/round physical props and a short outdoor dodge/revive recording. Make the locked-phone return part of the presentation.

2. **P1 — Kicking does not revoke access.** [index.ts:305](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/index.ts:305) only sends an error; an uncooperative client remains subscribed to exact locations/photos through `broadcast`, and even receives replacement spectator tokens. **Fix:** clear membership and close every kicked player socket; require current membership for broadcasts/token delivery; rotate the shared token after removal.

3. **P2 — Notification readiness can disagree with pocket behavior.** Readiness changes asynchronously in [coach.ts:197](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/game/coach.ts:197), but pocket reporting and keep-awake effects don’t subscribe to it ([Game.tsx:69](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Game.tsx:69), [Game.tsx:85](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Game.tsx:85)). Entering Pocket before scheduling finishes can leave the screen awake and pocket tracking off while the UI later says locking is ready. **Fix:** expose readiness as reactive state and include it in both effects.

4. **P2 — “Start game” can fail with the explanation offscreen.** [Lobby.tsx:208](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Lobby.tsx:208) checks only the host’s local GPS; the server also checks teammates and mixed simulation modes. Errors render below the scrolling settings at line 193. **Fix:** put the blocking error beside Start and derive squad readiness from authoritative state.

5. **P2 — Android gives conflicting directional cues.** Its radar ignores heading ([GameMap.web.tsx:8](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/components/GameMap.web.tsx:8)), while the escape HUD rotates relative to the phone ([Game.tsx:139](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Game.tsx:139)). Facing south can make the two arrows oppose each other. **Fix:** rotate the radar consistently with the HUD, or clearly distinguish map north from device direction.

6. **P2 — The headline Touch Grass metric counts network failure as success.** [game.ts:418](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/src/game.ts:418) credits every disconnected hunt interval as pocket time. I reproduced **100% pocketed with zero movement and no pocket action**. **Fix:** separate explicit pocket/background intervals from unknown disconnected time; don’t present unknown time as verified phone-away activity.

7. **P2 — Reviving disappears from the helper’s objective.** [Game.tsx:279](C:/Users/Benjamin/Desktop/Codejam16/krillion/app/src/screens/Game.tsx:279) says “Safe. Collect pearls.” even with downed teammates; the revive direction is a transient event. **Fix:** prioritize a persistent teammate direction/distance and revive progress, reconstructed from state after reconnect.

8. **P2 — Spectator results repeatedly recreate the photo collage.** [watch.html:210](C:/Users/Benjamin/Desktop/Codejam16/krillion/server/public/watch.html:210) replaces results HTML every broadcast; photos are served `no-store`. **Fix:** render only when results/photos change, avoiding repeated image loading during judges’ discussion.

Read-only verification: **18/18 engine tests passed; app and server typechecks passed.** No native-device session or live E2E rerun; no files modified.
