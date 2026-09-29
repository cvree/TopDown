# Next: fewer, bigger moves

*Written after v2.30.0 — ONE JOB, which did the first three items of the
23-item list (PLAY as one screen, score-first results, records and champion
modes fixed for thirty seconds). The prompt at the bottom is meant to be
pasted as-is into the next session.*

## Where the other twenty items were too complicated

| Item(s) | The trap | The simpler version |
| --- | --- | --- |
| 16 ghost race, 17 PNG card, 18 "beat my score", 20 daily seed | Four features, four share flows, and a full input tape in a URL | **One share button.** A link that carries your scores and each run's ghost *path* (the ~120-point path the best record already stores, not the input tape). The friend's results say "you beat Alex on 2 of 3" and the replay draws Alex's ghost. The daily is the same link, made by the client from the date. The PNG card waits until links show they get used. |
| 9 weekly story, 10 per-run trend | Two new screens reading the same history | **One trend line.** After a run: "3rd best of 20 · +6% vs your average". PROGRESS opens on the same thing for the week: one chart, one sentence, one button. |
| 22 usage counts | No server exists; "privacy-friendly analytics" means building and running one | **Cut.** Judge changes with `tools/uxshots.mjs`, which already counts words above the first card, controls, and clicks to a running drill. Add "seconds from load to first run" to it. |
| 7 champion signature art | Three full-bleed illustrations to commission or draw, per champion, forever | **Cut the art, keep the idea.** The champion's accent as a colour field behind the PRACTICE switch. No new assets. |
| 19 hit-stop | A fourth "moment" system | **Fold into the results screen** that exists: a short hit-stop and sound on NEW BEST and on playlist complete only. |
| 4, 5, 6, 8, 13, 14, 15, 21, 23 | Nine separate polish tickets | **One cleanup release** (below): each is small once the rest is out of the way. |
| 11 touch devices, 12 first run | Fine as written | Keep both. They decide whether a new player ever sees a drill. |

## The order

1. **SHARE**, the thing people talk about: challenge links with scores and
   ghosts, head-to-head results, and the daily as a link.
2. **TREND**, whether people get better: the trend line after every run, and
   PROGRESS opening on the week.
3. **CALM**, the cleanup: one "More modes" menu per card, the edit dialog
   showing time, speed and size (the rest under More), "?" folded into setup,
   the last explainer paragraphs replaced by icons, two fonts and one accent
   (self-hosted, one weight preloaded), the arena sized to the screen, touch
   devices opening on STUDY with a "send to your computer" link, no Enter gate
   for returning players, colour-blind-safe targets with focus rings, and
   three.js plus STUDY's data loaded lazily.

## The prompt

> Read `docs/next-focus.md`. Ship release 1, SHARE, and nothing else from the
> list:
>
> - One SHARE button on a playlist and on a results screen. It makes a link
>   that carries the playlist, the sender's name, their score on each item and
>   each item's ghost path (the downsampled path `BestReplay` already stores).
>   Keep the link under 2,000 characters for a three-item playlist; measure it
>   in a test.
> - Opening the link plays the playlist. Each results screen draws the
>   sender's ghost in the replay and says, in one line, whether you beat them.
>   The playlist-complete screen says "you beat {name} on N of M".
> - DAILY: a playlist the client builds from the date (same three drills and
>   seeds for everybody that day), with the same head-to-head line against
>   your own best, and a one-tap copyable result grid. No streak.
> - A short hit-stop and sound on NEW BEST and on playlist complete. Never on
>   a routine run.
> - Tests: the link round-trips, the ghost path decodes to what was encoded, a
>   daily is identical for two profiles on the same date, and the words and
>   click counts from `tools/uxshots.mjs` do not go up on PLAY or RESULTS.
