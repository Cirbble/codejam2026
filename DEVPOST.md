# Rarefind

## Inspiration
Daily rarity games, where the obvious answer scores nothing and the obscure one scores big, are fun, but you play them on your phone. We wanted the same feeling with your feet: the answer has to be out there, and you have to go find it.

## What it does
A prompt names a kind of thing: "something red", "something someone lost", "a pattern made of squares". You go outside, find one and photograph it. An AI judge checks the photo fits the prompt and names what you found. The find becomes a card. Its tier, from Common to One of One, depends on how few other players found the same thing. A fire hydrant for "something red" is Common, because everyone finds one. A cardinal on a branch is Epic.

- **Daily:** five prompts a day, the same for everyone, one answer each. You hunt whenever you are out.
- **Squad:** friends join with a code and play five timed rounds. After each round every card is revealed, rarest first, and duplicates are called out ("same as Sam").
- **Collection:** every card you have found, by tier.

## How we built it
- **App:** Expo (React Native, SDK 58) for iOS, Android and the web, using expo-camera, expo-image-manipulator, expo-haptics and expo-notifications. Lock-screen reminders mean the phone can stay in a pocket during a squad round.
- **Server:** Node and TypeScript on Railway, with express for the API and WebSockets for squads. State is saved to a volume, so a redeploy resumes games.
- **Judge:** Gemini 3.8 Flash with a strict JSON schema. It returns whether the photo matches, whether it is a screen or a print, a canonical label and a rarity estimate. Photos are resized on the phone, and results are cached by image hash.

## Challenges
- **Rarity with no data yet.** The first players have nobody to compare against. The score starts as the AI's estimate and blends in crowd counts, up to half, as finds arrive.
- **Same thing, different words.** "Red hydrant" and "fire hydrant" have to be one answer. The judge sees the labels already found for that prompt and reuses one when it fits.
- **Fair rounds.** Judging takes a few seconds, so a photo sent before the buzzer still counts after it.
- **Cheating.** Photos come from the camera only, and screens, prints and renders are rejected. Repeat photos don't move the rarity stats.

## What we learned
The best moment in the app is when you put it away and start looking around.

## What's next
Location-aware prompts, weekly community hunts and shared squad albums.

## Built with
expo, react-native, typescript, node.js, websockets, gemini, railway
