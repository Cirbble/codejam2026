# Demo script

## Table demo (indoors, 2 minutes)
1. On the home screen, turn on **Demo**, type a name and tap **Start a crew**. The lobby sets itself up: a 100-second storm, a 60 m zone and two practice bots.
2. Open **Big screen** on a laptop or projector (the lobby shares the link).
3. Tap **Start the storm**. Hand the judge the phone and point at the joystick.
4. The first cell forms on the human player within a few seconds. The bottom panel says "Walk 9 m south-east" with a countdown. Push the joystick that way and the panel turns to "Clear +10".
5. Let one cell land on you to show a hit. Lives drop from three bars to two, and the panel reads "Hit".
6. If you get knocked down, the panel says "Stay put" and shows how far away the nearest teammate is. A bot walks over and revives you.
7. When the storm passes, read the storm report: whether the crew won, the peak level, dodges, hits and revives.

Talking points:
- The phone speaks every direction, so outdoors you keep your eyes up.
- Up on the radar is the way you are facing.
- Every cell is escapable at a walk, and that is unit-tested.

## Outdoor clip (25 s)
- Two or three people in a park with real GPS and the Storm set to 5 min.
- Film one person hearing "walk 12 metres to your left" and walking out of a cell, with the radar visible.

## If something goes wrong
- **"Waiting for GPS"**: switch to Demo in the lobby.
- **No sound**: the iPhone ringer switch doesn't matter (the app plays in silent mode), but check the volume. The web build is silent on localhost by design.
- **The server redeployed mid-demo**: the room resumes by itself within a few seconds.
