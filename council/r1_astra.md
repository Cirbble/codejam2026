**6/10 as written.** Krillion has a memorable theme and a promising outdoor social loop, but I would not currently call it the clear Touch Grass winner. The design’s most ambitious mechanics undermine its strongest promise: putting the phone away.

Prioritized findings and recommended changes:

1. **Make “away from your phone” the core mechanic.** Dodge requires continuous directional attention; Siege adds camera use during urgent movement. **Make Hunt the main experience:** hear a prompt → pocket the phone → explore → stop and photograph → receive a verdict. Give accepted discoveries a shared boss-health payoff and an explicit win condition. Demonstrate a substantial uninterrupted pocketed interval.

2. **Cut scope aggressively for 30 hours.** AI can generate code quickly; device integration and outdoor validation still take time. **Ship one five-minute Hunt session**, room joining, 2–4 players, 15–20 curated prompts, photo judging, and a simple spectator results screen. Cut Siege, tides, orbs, bots, proximity revives, streaks, generated prompts, and elaborate reporting. Require a complete two-device round within six hours; reserve the final six for testing and rehearsal.

3. **The Dodge safety guarantee is mathematically inconsistent.** At 1.4 m/s, ten seconds allows **14 m**, versus the stated radius-plus-margin of **20–35 m**. A circular arena also says nothing about roads, walls, or accessible exits. **Defer live Dodge**, or constrain it to a physically inspected open field with slow, walking-only rounds. Remove first-arrival incentives that encourage rushing.

4. **The pocketed experience needs an explicit technical design.** Foreground location and a WebSocket do not establish reliable operation while suspended. **Download the Hunt schedule and pre-schedule local notifications before starting; resynchronize on resume.** Test locked physical phones immediately. Expo Go has background-location limitations, and Android remote notifications require a development build. [Expo location](https://docs.expo.dev/versions/latest/sdk/location/), [notifications](https://docs.expo.dev/versions/latest/sdk/notifications/).

5. **GPS scoring is unjustified and exploitable.** `accuracy` is an uncertainty **radius**, so dividing it by two understates uncertainty. Even `distance + accuracy < radius` is only a conservative heuristic, not a guarantee. **Suspend hit decisions on stale or poor fixes**, include sample age, and require sustained proximity for pickups. Cut the 8 m revive: both players’ uncertainties matter. “To your left” also requires trustworthy orientation that a pocketed phone cannot simply provide. [Expo location reference](https://docs.expo.dev/versions/latest/sdk/location/).

6. **The indoor demo must prove the real product.** Joystick movement demonstrates a screen game. **Let a judge complete a nearby Hunt prompt**, show the actual AI verdict and shared boss reaction, then show footage of the same loop outdoors. Stage timing: 15 seconds premise, 25 seconds outdoor evidence, 60 seconds live loop, 20 seconds payoff. Prepare a clearly labeled recorded fallback and one-tap demo reset.

7. **“Server authoritative” leaves critical rules unspecified.** Define server round deadlines, reconnect snapshots, player/session tokens, and idempotent photo submissions. **Remove the speed bonus**, or rank eligible submissions by server receipt time—not AI completion time. A 2 Hz broadcast is reasonable; it does not solve stale positions or timing fairness.

8. **Photo judging needs bounded failure behavior.** “Older than you” cannot reliably be established from an image; creativity scores are subjective. **Use visually verifiable prompts and binary acceptance**, with personality in the verdict. Validate structured output, set timeouts and spending limits, and provide a retry/skip path. Cache by image **plus prompt and judging version**. Treat screen-photo detection as a heuristic.

9. **Distribution is a deadline dependency.** External TestFlight testing requires review. **Demo on already-installed team devices; make external distribution optional.** Validate signing and installation immediately. [Apple TestFlight requirements](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).

10. **Privacy and reporting need honest boundaries.** A short room code should not expose live locations and faces to spectators. **Use a separate spectator token, explicit photo-sharing consent, and automatic room expiry.** Report completed discoveries and session duration; omit steps or distance until genuinely measured and validated.

No files were modified.
