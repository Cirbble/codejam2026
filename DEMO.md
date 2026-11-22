# Demo script (3 minutes)

**Props**
- something red (a mug, a book or an apple)
- something that plugs in
- something round

**Setup**
- Two phones with the app installed, or https://brillion.up.railway.app/play/ open on a laptop.

1. **Home (15 s).** "Five prompts a day, the same for everyone. You photograph something real. The fewer people who found the same thing, the rarer your card."
2. **Squad (90 s).**
   - Phone A: Play with friends, Start a squad, turn on Quick indoor rounds.
   - Phone B: join with the code. Then Start.
   - Round 1 is always "Something red". One person photographs the obvious red thing; the other finds something less obvious.
   - The reveal shows both cards, rarest first. If both found the same thing, it says "same as".
3. **Rarity (30 s).** Open a card: "1 of 3 finds". The AI sets the rarity at first; crowd counts blend in, up to half, as finds come in.
4. **Collection (15 s).** Show the tier filter.
5. **Close (15 s).** "The app only matters for the seconds it takes to shoot. Everything else happens with your head up."

**If the Wi-Fi is bad**
- The phone keeps the photo and offers Send again.
- In squads, a photo sent before time runs out still counts.

# Table visits (People's Choice)

1. Put https://brillion.up.railway.app/board.html on a laptop or projector. Its QR code opens Quick play.
2. At each table, hand over a phone or have them scan: Quick play, then their team name, then Start.
3. Three 60-second rounds with things on their table: "something red" first. Their score lands on the board right away.
4. Ask for the vote while their name is on the board.

Before starting, clear test entries:
`curl -X POST "https://brillion.up.railway.app/api/board/reset?token=$(cat .secrets/STATS_TOKEN)"`
