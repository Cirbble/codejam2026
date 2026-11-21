# Judge Q&A cheat sheet

**Isn't a GPS bullet hell dangerous?**
It is designed for walking.
- Each cell's warning time is computed from the real exit distance of every player inside it, at 1.3 m/s plus 3 s to react. A brisk walk always escapes, and that is unit-tested.
- Each player faces only one cell at a time, and cells never overlap, so there is always a walkable exit.
- The voice says "walk".
- How it plays says to use parks and never step into a road.

**How do I know which way to go without staring at the screen?**
- The phone speaks every warning with a body-relative direction ("walk 12 metres to your left, 8 seconds"), using the compass.
- The radar rotates so up is the way you face.
- Haptics mark warnings, hits and dodges.

**GPS is noisy. How is a hit fair?**
Four rules:
1. No penalties on a stale fix (more than 6 s old), a weak one (accuracy worse than 30 m), right after a GPS jump, or while disconnected.
2. A hit needs `distance + accuracy/2 ≤ radius`, so you must be clearly inside the cell even allowing for the error.
3. You can only be hit by a cell you were warned about in time to walk out of it, so reconnecting inside a cell can't cost a life.
4. Every warned cell you escape counts as a dodge.

**What if I walk into a cell late?**
You get the same walk-out allowance as if you had been warned at that moment. Cutting through a cell is safe but scores nothing. We chose this so nobody feels pushed to run.

**Can I camp at the edge of the zone?**
No. Cells can form at the edge, and the escape route always stays inside the zone. At the edge it takes the short way around, not the long way through the cell. Tested.

**Why is the server authoritative?**
Phones only send position and intents (start, settings). The server owns cells, warnings, hits, scores and results. That keeps every phone and the big screen consistent and makes cheating hard.

**What if someone's phone dies mid-game?**
- Hosting hands over after 45 s.
- Rooms are snapshotted every 2 s, on every phase change and on shutdown, so a server redeploy mid-storm resumes the game (`scripts/redeploy-test.ts`).
- Warnings reset on reconnect, so nobody gets hit without a fresh warning.

**What would break at scale?**
Rooms live in memory in one Node process. At thousands of rooms you would shard by room code, since each room is self-contained. A broadcast is about 2 to 4 KB per room per tick at 2 Hz, which is fine for 8 players.

**Privacy?**
- There are no accounts, only a nickname.
- Location is shared with your crew only while a game is open, and the app never asks for background location.
- The big-screen link needs a separate random token, and the host can replace it at any time.
- Rooms expire after inactivity.
