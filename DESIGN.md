# Squall: design

## Idea
The team's raw idea was "a physical bullet hell where you need to run to dodge attacks, tracked using GPS". In Squall, a storm cell forms where you stand and you walk out of it. The interface is a **daylight storm chart**, because people play outdoors in the sun.

## Visual identity
- **Ground:** a pale storm sky (`#D8E0E6`, cool blue-grey) with faint isobars across every screen.
- **Ink:** deep slate (`#16212A`) for text, primary buttons and your dot. Other players get muted slate-family tints.
- **Reflectivity is the only bright colour, and it always means danger.** Cells are drawn as radar bands: green, yellow, orange, red, magenta. The hot core grows as a cell nears landing. The instruction panel takes the same colour, so urgency reads at a glance.
- **Type:**
  - Unbounded for the big words: the wordmark, the instruction, the crew code, results.
  - Figtree for everything else.
  - JetBrains Mono only for real numbers: the clock and cell countdowns.
- **Shapes:** pill buttons that press down like keys (ink with a slate shadow, or outlined), rounded surfaces with a soft bottom edge, and a circular scope.
- **Icons:** Feather and inline SVG only. There are no emoji and no unicode glyph icons.

## Screens
- **Home:** the wordmark, a live scope with a quiet storm, your name, Start a crew, Join by code and Demo mode.
- **Lobby:** a large crew code, the crew with a status for each player, the storm length, the zone, bots and the big-screen link.
- **Game:** the radar, and one huge instruction such as "Walk 9 m" with the direction and a countdown. Lives, clock and level stay small at the top.
- **Results:** an ink reward card with the outcome headline and three stats, the crew ranking, then Run it again.
- **Big screen:** the scope on the left and the crew, level and clock on the right, sized to read from across a room.
- **Landing:** the name, one sentence, Play in browser (`/play`), Android, a live radar and three short cards.

## Rules that keep it fair and safe
Warning time comes from walking pace. Hits allow for GPS error. You are only ever hit by a cell you were warned about, and only one hazard is aimed at you at a time. There are no camping spots at the zone edge. See JUDGE_QA.md.
