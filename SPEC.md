# Rarefind

A photo game played outside. A prompt names a kind of thing ("something red"). You go out, find one and photograph it. The AI checks that the photo fits the prompt and names what you found ("red cardinal"). Your find scores by rarity. If almost nobody else found the same thing, it scores high. A fire hydrant for "something red" scores low because everyone finds one.

Inspired by the team's idea "a Krillion-style rarity game, but you have to physically go and photograph it". Original name, look and content. Nothing is copied from Krillion.

## Rarity

Each accepted find has a **label**: a short lowercase singular noun phrase from the AI ("fire hydrant", "red cardinal"). Finds with the same label for the same prompt are the same answer.

- The AI also returns `aiRarity` (0 to 100), its estimate of how uncommon the find is for that prompt.
- The crowd count comes from every accepted find for that prompt, across all players, days and squads: `crowd = 100 * (1 - sameLabel / total)`, where `sameLabel` includes this find.
- Blend: `w = min(0.5, (total - 1) / 25)` and `rarity = round(w * crowd + (1 - w) * aiRarity)`. So the AI decides at first, and the crowd count blends in (up to half of the score) as data arrives.
- The AI judge gets the 40 most common labels found so far for that prompt. When the find is the same thing as one of them, it reuses that exact label, so counts don't split over wording.

| Tier | Rarity | Points |
|---|---|---|
| Common | 0 to 39 | 10 |
| Uncommon | 40 to 64 | 30 |
| Rare | 65 to 84 | 60 |
| Epic | 85 to 96 | 85 |
| One of One | 97+, or the first-ever find of a label whose `aiRarity` is 80 or more | 100 |

A card's tier is fixed when it is found. Later finds of the same label do not lower old cards. Stats on the card, such as "3 of 412 finds", show the counts at the moment it was found.

## Modes

**Daily**
- Everyone gets the same 5 prompts each day, picked deterministically from the date in America/Toronto.
- There is no timer. You hunt all day.
- One answer per prompt: the first accepted photo locks that prompt. A rejected photo doesn't count, so you can try again (up to 6 tries per prompt per day).
- Max score is 500.

**Squad**
- Friends play in a room. The host creates it, and the others join with a 4-letter code.
- Same 5 prompts for everyone, one at a time, 180 s each. In quick mode (indoor demo) prompts run 60 s and come from the indoor set.
- While a prompt runs, others only see whether you have found something. When everyone has locked a find, or time runs out, an 8 s reveal shows every card from that round, rarest first.
- Rarity inside the room counts too. If two squad members found the same label in a round, both cards say "same as Sam".
- After round 5 the results screen shows totals, each player's best card and the round winners.

**Unique only (squad option)**
- The host turns on "Unique only" in the lobby (it can't be combined with Bingo). Rounds run as usual.
- A find scores its points only if nobody else in the squad found the same label that round. If two or more players found the same thing, all of those finds score 0; their cards still go into each player's collection.
- The reveal crosses out the points of a duplicate and says "Scores 0 · same as Sam". A round is won by the best card that scored.
- A late card that lands during the reveal can also cancel an earlier one with the same label.

**Impostor (squad option)**
- The host picks "Impostor" in the lobby's mode picker (Classic, Bingo, Unique, Impostor are exclusive). Needs at least 3 players. Rounds use only prompts that have a twin (`TWINS` in `prompts.ts`, e.g. "something red" / "something orange").
- Each round one random player (not the same as last round, when possible) is the impostor. Their phone shows the twin prompt, marked "You're the impostor", plus the crew's prompt so they can try to blend in. The AI judges their photo against the twin. No other phone ever receives the twin or who has it: in impostor games the server sends each player their own room view.
- After the hunt, a 45 s vote shows every card wearing the real prompt, with the judge's line and the counts hidden. Each player taps the card of who they think it was (not their own; they can change their mind). The vote closes when everyone connected has voted, on the timer, or when the host skips.
- Scoring: finds score their tier points as usual, landing when the vote closes. Each player who voted for the impostor gets +50. The impostor is caught only if they alone got the most votes; otherwise they get +100.
- A 10 s result names the impostor and their prompt and shows every vote. The results screen lists impostors spotted and rounds fooled.

**Bingo (squad option)**
- The host turns on "Bingo card" in the lobby. Instead of 5 rounds there is one 3×3 card of 9 prompts (all different categories), every square open at once, against one clock: 5 minutes outdoors, 3 minutes with indoor prompts.
- Each square takes one find (up to 6 tries per square). A find's tier points count only if its square is on a completed row, column or diagonal (once, however many lines it is on). Finds off every line score nothing.
- Every completed line also adds +50. The first player in the squad to complete any line gets +100 more ("BINGO!"); the line's time is its last find's time.
- During the hunt everyone sees which squares each player has marked and their line count, never the cards. Totals and cards appear when time runs out, or as soon as every player has filled the whole card.
- An 8 s reveal shows your card and the standings, then the results show each player's card.

**Ghost race (Quick play).** Every team gets the same three prompts on a given day, so a new run races the day's best counted run (visible teams only). Finished runs store their splits: per round, how many ms into the hunt the find landed and its points. Under the timer, a bar shows when the ghost found its item this round and a running score against it; the results say whether you beat it. If your own team holds today's best, you race "Your team's best". No ghost on the day's first run.

**How to play.** Each squad mode and Quick play has a 3-step how-to sheet (`app/src/components/HowTo.tsx`). It opens the first time a phone meets that mode (also when the host switches to it) and from the "How to play" link or the ? in the mode picker.

**Collection.** Every card you have found, from both modes, stored on the server by device id.

**Collection sets.** Themed groups of prompts (`server/src/sets.ts`): Rainbow, Shapes, Patterns, Textures, Materials, Into the wild, Read the street, Time travel, On wheels, Light and shade, and Full spectrum (one card of each tier). A slot is filled by any card for one of its prompts, from any mode; the indoor and outdoor versions of a prompt fill the same slot. The Sets tab of the collection shows each set's slots with your best card in each. The find that completes a set says "Set complete" on its reveal.

## Anti-cheat

- In-app camera only; no photo library.
- The AI rejects photos of screens and printed pictures with `screen: true`, and the reply says "Find the real thing".
- Images are resized to 768 px JPEG on the device. The server caps upload size (2 MB), rate-limits each device (one judge request every 4 s), keeps a rolling hourly AI budget and caches by image hash.

## API (server)

Base URL from `EXPO_PUBLIC_SERVER_URL`. JSON everywhere. A device identifies itself with `device`, a random 32-char hex string generated on first launch and stored on the device. The server treats it as a bearer secret and never lists device ids.

```ts
type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'one';
type Card = {
  id: string;            // card id
  promptId: string;
  promptText: string;
  label: string;         // "red cardinal"
  title: string;         // display form: "Red cardinal"
  tier: Tier;
  points: number;
  rarity: number;        // 0..100 at find time
  sameCount: number;     // finds with this label for this prompt, including this one, at find time
  totalCount: number;    // all finds for this prompt at find time
  verdict: string;       // one short line from the judge, plain and specific, no emoji
  photo: string;         // relative URL: /p/<id>.jpg
  mode: 'daily' | 'squad';
  day?: string;          // YYYY-MM-DD for daily
  playerName?: string;   // squad
  at: number;            // ms epoch
};
type Prompt = { id: string; text: string; examples?: string };   // examples: e.g. "fire hydrant, stop sign, a red door"

GET  /api/daily?device=D
  -> { day: string, prompts: Prompt[], cards: Record<promptId, Card>, tries: Record<promptId, number>, score: number, resetsAt: number }
POST /api/find   body { device, promptId, image: base64 jpeg, submissionId, mode: 'daily' }
              or { device, promptId, image, submissionId, mode: 'squad', code, playerId, secret }   (bingo: promptId picks the square)
  -> { accepted: true, card: Card }
   | { accepted: false, reason: 'no_match' | 'screen' | 'unclear', verdict: string, triesLeft?: number }
   | { error: 'rate' | 'locked' | 'closed' | 'budget' | 'ai_down' | 'bad_request', message: string }   (HTTP 4xx/5xx)
  Same submissionId again returns the same response (idempotent).
GET  /api/collection?device=D        -> { cards: Card[], sets: { id, name, blurb, done, have, slots: { name, card: Card | null }[] }[] }   cards newest first
  An accepted find also returns setsDone: { id, name }[] when it completed a collection set.
GET  /api/prompt/:id/top             -> { total: number, top: { label: string, count: number }[] }   top 10, for the reveal and summary
GET  /p/:cardId.jpg                  -> the photo (card ids are unguessable, 16+ chars)
GET  /health                         -> { ok: true }

WS /rt   (squad)
client -> { t: 'create', name, quick?: boolean, device }
        | { t: 'join', code, name, device }
        | { t: 'resume', code, playerId, secret }
        | { t: 'settings', quick?: boolean, bingo?: boolean, unique?: boolean, impostor?: boolean }   host only, lobby only (the modes turn each other off)
        | { t: 'vote', target }     impostor games, during the vote: who you think it was
        | { t: 'start' }            host only, lobby only, needs at least 1 player
        | { t: 'skip' }             host only: end the current prompt now
        | { t: 'again' }            host only, from ended: back to lobby, same players
        | { t: 'kick', id }         host only, lobby only
        | { t: 'leave' }
server -> { t: 'welcome', playerId, secret, code }
        | { t: 'state', room: RoomView }
        | { t: 'error', code: 'no_room' | 'full' | 'in_progress' | 'kicked' | 'rate' | 'other', message }

type RoomView = {
  code: string;
  phase: 'lobby' | 'countdown' | 'hunting' | 'reveal' | 'ended';
  hostId: string;
  now: number;                       // server ms, for clock skew
  quick: boolean;
  round: number;                     // 1-based, 0 in lobby
  totalRounds: number;               // 5 (1 in bingo)
  prompt: Prompt | null;             // null in bingo
  bingo: boolean;
  huntMs: number;                    // length of a hunt
  grid: Prompt[] | null;             // bingo, after the lobby: the 9 squares, row by row
  bingoBoard: { marks: Record<playerId, promptId[]>, lines: Record<playerId, number>, first: playerId | null, lineBonus: number, firstBonus: number } | null;
  endsAt: number | null;             // end of countdown / hunting / reveal
  players: { id: string; name: string; score: number; connected: boolean; found: boolean }[];  // found = locked a card this round
  reveal: Card[] | null;             // this round's cards, rarest first, only during reveal
  rounds: { prompt: Prompt; cards: Card[] }[];   // finished rounds
};
```

Max 12 players per room. A lobby room with nobody connected for 30 minutes is removed. Rooms are snapshotted to the volume so a redeploy resumes them.

## Content

There are about 60 outdoor prompts and about 15 indoor quick prompts. Each one is open-ended enough to produce many different answers, and each has an `examples` line. Good prompts:
- something red
- something older than you
- a sign with a number on it
- something that holds water
- a living thing that isn't a plant or a person
- something with wheels
- a pattern made of squares
- something someone lost
- something round
- a texture you want to touch

Avoid prompts that have only one sensible answer.
