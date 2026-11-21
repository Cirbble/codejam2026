Review this repository: Squall, a mobile GPS game built for a 24-hour hackathon (CodeJam 16; candidate tracks: Touch Grass (get people off screens and outside together) or Health). Storm cells form where players stand; the phone says which way and how far to walk before each lands; three hits and you're down until a teammate physically walks to you. Demo mode replaces GPS with an on-screen joystick and bots for indoor judging.

Read README.md first, then server/ (Node + TypeScript, express + ws, deployed on Railway) and app/ (Expo SDK 58, React Native, also served on the web at /play). Run the server tests and typechecks if you can. Read-only: do not modify files.

Deliver:
1. A score out of 10 for the code and product as a hackathon entry.
2. A prioritized list of findings (bugs, safety and fairness issues, failure modes on real phones and flaky GPS or networks, judge-demo risks), each with file:line and a concrete fix.
Keep it concise.
