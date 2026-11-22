**Keep the title card.** It makes One of One feel like an event. The main problems are the competing orange button and the length of the interruption; the original reveal has clearer hierarchy.

Scores reflect the supplied images. Timing is estimated from the 300 ms sequence; exact easing, overshoot, and shimmer quality cannot be verified.

| Category | With title card | `0-before.png` alone |
|---|---:|---:|
| Typography | 8/10 | 8/10 |
| Color/contrast | 8/10 | 8/10 |
| Hierarchy | 6.5/10 | 8/10 |
| Spacing | 8/10 | 8/10 |
| Iconography | 7/10 | 7/10 |
| Consistency with screen | 8/10 | 8/10 |
| Motion/timing | 7/10 | N/A — still image |
| **Overall** | **7.5/10** | **8/10** |

The bold typography reads well on a phone. Matching the word’s holographic colors to the card frame is the strongest design decision: it connects the celebration to the rarity. The close icon and flag are understandable; the title introduces no new functional iconography.

The most important fixes, in order:

1. **The button competes with the celebration — `1-kicker.png`, `2-land.png`, `3-hold.png`.**  
   Everything becomes almost black except the orange “Back to the round” button. It remains a strong visual destination while the title asks for attention. **Put the button beneath the same dimming layer**, maintaining its position and exit behavior. Restore its brightness with the reveal. No extra skip label is needed.

2. **The entrance has an empty beat, and the whole interruption runs long — `seq.jpg`.**  
   Approximately: dimming at 0.3 s, kicker visible at 0.6 s, word landed at 0.9 s, fade around 3.0 s, reveal restored by 3.3 s. That is roughly three seconds of obscuring the result, after the flip and flag climb have already happened. **Start the kicker as the dimming begins and target about 1.8 seconds total:**

   - 0–150 ms: dim and introduce “ABSOLUTELY.”
   - 150–400 ms: land “BRILLION,” with the burst.
   - 400–650 ms: finish the light sweep and underline.
   - Hold the settled title until about 1,550 ms.
   - Fade out over roughly 250 ms.

   This preserves the one-second settled hold while trimming transition overhead.

3. **The card title ghosts through the celebration — `2-land.png`, `3-hold.png`.**  
   “Rotary payphone” sits immediately below “BRILLION” and behind the underline. That produces an accidental second line. **Fade the underlying card text out during the title**, restoring it on exit. Keep the card silhouette visible. Darkening the entire screen further would sacrifice more of the photograph.

4. **The particles look like ordinary confetti — `2-land.png`.**  
   The scattered colored squares celebrate success, but contribute little to the distinctive holographic treatment. **Replace them with roughly 8–12 small glints clustered around the word**, using the frame’s colors. Let them disappear before the settled hold. The clean `3-hold.png` composition is stronger.

5. **The settled title could be more tightly composed — `3-hold.png`.**  
   There is roughly 30 px between the kicker and main word, then another substantial gap before the underline. **Try 20 px between kicker and word, and 14 px between word and rule**, keeping the complete group centered. Preserve the current main-word size.

**Remove:** the empty dark lead-in, the button’s exemption from dimming, the background-text ghosting, and the broad square-confetti scatter.

Keep “ABSOLUTELY BRILLION,” the holo gradient, and the short underline. Keep the ridge and flag too: their climb gives the celebration a cause. Additional explanatory copy would weaken this moment.

No files were modified.
