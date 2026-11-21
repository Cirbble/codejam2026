# Rarefind

A photo game you play outside. A prompt names a kind of thing, like "something red". You go find one and photograph it. The AI checks the photo and names what you found. Your find becomes a card, and its tier depends on how few other players found the same thing.

| | |
|---|---|
| Live | https://rarefind-production.up.railway.app |
| Play in a browser | https://rarefind-production.up.railway.app/play/ |
| Code | `server/` Node + TypeScript, `app/` Expo SDK 58 (iOS, Android, web) |

## How rarity works

The judge (Gemini vision) returns a short label for the find ("red bicycle") and an estimate of how unusual it is for that prompt. Every accepted find is counted per prompt and label. The score blends the two:

- `crowd = 100 × (1 − same label / all finds for the prompt)`
- `w = min(0.5, (all finds − 1) / 25)`
- `rarity = w × crowd + (1 − w) × AI estimate`

The AI decides while there is little data; as finds come in, the crowd count blends in, up to half of the score. The judge gets the most common labels found so far, so "fire hydrant" and "red hydrant" count as the same answer.

| Tier | Rarity | Points |
|---|---|---|
| Common | under 40 | 10 |
| Uncommon | 40 to 64 | 30 |
| Rare | 65 to 84 | 60 |
| Epic | 85 to 96 | 85 |
| One of One | 97 and up, or the first find of something the AI rates 80+ | 100 |

## Modes

- **Daily.** Five prompts a day, the same for everyone, picked from the date in Toronto. There's no timer, and you get one answer per prompt. A rejected photo doesn't use up your answer, and you get up to 6 tries.
- **Squad.** Friends join with a 4-letter code. There are five rounds of 3 minutes each, or 60 seconds in quick indoor mode. After each round, every card is revealed, rarest first, and duplicates are marked "same as". A lock-screen reminder fires 30 seconds before a round ends, so phones can stay in pockets.

- **Quick play.** One player, three 60-second indoor rounds that start right away, with the same three prompts for every team that day. The score goes on the team board: https://rarefind-production.up.railway.app/board.html (QR code on screen, or `/q`). Only a team's best of its first 3 runs counts.

## Run it

```bash
cd server && npm i && npm run dev        # port 8787. Needs GEMINI_API_KEY (env or ../../.secrets/GEMINI_API_KEY)
npm test                                 # engine tests
npx tsx scripts/e2e.ts http://localhost:8787

cd app && npm i
npx expo start                           # Expo Go, or w for web
EXPO_PUBLIC_SERVER_URL=http://<lan-ip>:8787 npx expo start
bash scripts/export-web.sh               # web build into server/public/play
```

## Fairness and cost

- **Real photos only.** Photos come from the in-app camera only; there is no photo library. The judge rejects photos of screens, prints and renders.
- **Hard-to-game rarity.** A find counts toward rarity once per device, prompt and label, and once per image.
- **No stolen wins in squads.** A photo sent before the round ends is still judged after time runs out.
- **Low AI cost.** Photos are resized to 768 px on the phone. Judgments are cached by image hash, and there is an hourly AI budget. One judgment is about 1.5k tokens.
