# Brillion

Find the one nobody else found.

## Inspiration
Daily rarity games, where the obvious answer scores nothing and the obscure one scores big, are fun, but you play them on your phone. We wanted the same feeling with your feet: the answer has to be out there, and you have to go find it.

## What it does
A prompt names a kind of thing: "something red", "an animal", "something that plugs in". You go outside, find one and photograph it. An AI judge checks the photo fits the prompt and names what you found. The find becomes a card with a tier from Common to One of One: a fire hydrant for "something red" is Common, a rotary payphone is Epic. A One of One gets its own "Absolutely Brillion" title card.

Every reveal is a climb: the flag on the rarity ridge goes up the mountain, and the sky behind the app climbs with it, from a golden dawn over the foothills to an aurora night at the summit.

- **Daily:** five new prompts a day, the same for everyone.
- **Quick play:** three prompts, sixty seconds each, as a table. Your best run goes on the team board, and you race the ghost of the day's best run.
- **Squad:** friends join with a code. Four modes: Classic, Bingo (a 3x3 card, first line wins), Unique (match anyone and you both score zero) and Impostor (one player secretly has a different prompt).
- **Collection:** every card by tier, plus themed sets to complete.

Plays on the web with no install (scan the QR), and on iPhone and Android.

## How we built it
- **App:** Expo (React Native, SDK 58) for iOS, Android and the web, with expo-camera (pinch and 1x/2x/4x zoom), expo-image-manipulator, expo-haptics and expo-notifications. The skies are layered SVG scenes animated on the native driver.
- **Server:** Node and TypeScript on Railway, with express for the API and WebSockets for squads. State is saved to a volume, so a redeploy resumes games.
- **Judge:** Gemini Flash with a strict JSON schema. It returns whether the photo matches, whether it is a screen or a print, a canonical label and a rarity score on a rubric mapped to the five tiers. Photos are resized on the phone, and results are cached by image hash.

## Challenges
- **Rarity with no data yet.** The first players have nobody to compare against, so the score starts as the AI's estimate and blends in crowd counts as finds arrive.
- **Same thing, different words.** "Red hydrant" and "fire hydrant" have to be one answer. The judge sees the labels already found for that prompt and reuses one when it fits.
- **Fair rounds.** Judging takes a few seconds, so a photo sent before the buzzer still counts after it.
- **Cheating.** Photos come from the camera only, and screens, prints and renders are rejected, while a photo of a device itself still counts.

## What we learned
The best moment in the app is when you put it away and start looking around.

## What's next
Location-aware prompts, weekly community hunts and shared squad albums.

## Built with
expo, react-native, typescript, node.js, express, websockets, gemini, railway, svg

## Links
- Play: https://rarefind-production.up.railway.app
- Code: https://github.com/Cirbble/codejam2026
