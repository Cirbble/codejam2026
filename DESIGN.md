# Squall: design

## Idea
The team's raw idea was "a physical bullet hell where you need to run to dodge attacks, tracked using GPS". Squall makes it a storm. The phone is a storm spotter's radar. Danger is a storm cell forming where you stand. You escape by walking out of it.

## Visual identity
- **The radar scope is the interface everywhere.**
  - It has range rings with metre labels, bearing ticks, an amber N and a sweep with afterglow.
  - In the app, up is the way you face.
- **Reflectivity is the danger scale.**
  - Cells are drawn as concentric bands on the real radar dBZ palette: green, yellow-green, yellow, orange, red, magenta.
  - The hot core grows as a cell nears landing.
  - The 20 to 70 dBZ legend strip is the signature element on the home screen, the results and the landing page.
- **Amber is for actions and warnings.** Green means clear or alive, red means hit or impact.
- **Type:**
  - Barlow Condensed for headlines and the wordmark, like broadcast weather graphics.
  - Barlow for body text.
  - JetBrains Mono for instrument readouts: timers, codes, coordinates, ±m accuracy, labels.
- **One dark scope-glass ground** (`#071115`). The look is single-theme by choice.
- **Icons** are Ionicons or inline SVG only. There are no emoji and no unicode glyph icons.

## Screens
- **Home:** wordmark, live coordinate readout, an animated scope with a quiet storm, the dBZ legend, name, Start a crew, Join.
- **Lobby:** the crew code in large mono, a roster with per-player GPS accuracy, Storm length, Zone radius, bots and Big screen.
- **Game:**
  - Header: level, with a strip coloured on the dBZ scale; time to the end of the storm; lives; score; GPS accuracy.
  - The scope.
  - One panel for the single thing to do now. In order of priority: down, weak GPS, outside the zone, strike warning (an arrow plus "Walk 9 m" and the direction, and T-minus), hit or dodge, revive a teammate, clear.
- **Results:** a storm report bulletin with an outcome headline, a data table, the crew with a standing mark, and awards.
- **Big screen:** the scope on the left and a bulletin column on the right (level, clock, crew lives, a teletype event log), with overlays for the lobby, the countdown and the report.

## Rules that keep it fair and safe
Warning time comes from walking pace. Hits allow for GPS error. You are only ever hit by a cell you were warned about, with one hazard at a time. There are no camping spots at the zone edge. See JUDGE_QA.md.
