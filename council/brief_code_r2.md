Review this repository: Rarefind, a mobile photo game built for a 24-hour hackathon (CodeJam 16; judged on the Touch Grass track: get people off screens and outside together).

How it plays: a prompt names a kind of thing ("something red"). Players go outside, find one, and photograph it in the app. A vision model (Gemini) checks the photo fits the prompt and labels what was found. Finds score by rarity: the AI's estimate at first, then the share of all players who found the same label as data accumulates. Daily mode (5 prompts a day, same for everyone, one answer each) and Squad mode (friends in a room, 5 timed rounds, a reveal after each).

This is a second review after fixes. Read SPEC.md first, then server/ (Node + TypeScript, express + ws, deployed on Railway with a volume) and app/ (Expo SDK 58, React Native; also exported to web at /play). Run the server tests (cd server && npx tsx --test src/*.test.ts) and the typechecks (npx tsc --noEmit in server/ and app/) if you can. Read-only: do not modify files.

Deliver:
1. A score out of 10 for the code and product as a hackathon entry.
2. A prioritized list of findings (bugs, exploits, failure modes on real phones and flaky networks, judge-demo risks, missing pieces), each with file:line and a concrete fix.
Keep it concise.
