# Next: elegance, calm and motion

> **Done in v2.24.0 — ONE VOICE.** The measurements, the recordings and what
> was removed are in [`v2.24-proof.md`](v2.24-proof.md).

*Written after v2.23.0. The prompt at the bottom is meant to be pasted as-is
into the next session.*

## Where the client is

The substance is there: a patch-audited lane, rewind, a lane that explains
itself, warm-up, benchmarks, reaction tests, 60+ modes, all of it tested. The
*feel* has not caught up. Measured on v2.23.0:

| What | Now | Why it matters |
| --- | --- | --- |
| Motion system | 28 keyframes, 113 one-off `transition:` rules, 3 easing tokens, no duration tokens | Every surface moves at its own speed; nothing feels like one product |
| Screen changes | Instant swap plus a generic `fade-up` | No sense of place; tabs feel like reloads |
| Results screen | Up to 19 panels, revealed on a fixed timer (0–1.6 s) | A wall of cards; the one number that matters competes with eighteen others |
| In-run banners | ~40 `setBanner` call sites, all firing on their own | Messages overwrite each other; the arena reads as a notification feed |
| Floating text | ~60 `micro()` call sites (+20, NO MANA, 3 HITS…) | Numbers pile up over the fight they are describing |
| Prose | A paragraph under nearly every panel, card and tab | Reading instead of playing; the design voice is lovely but everywhere |
| Shared-element motion | None | A card you click does not *become* the run; a score does not *fly* to its record |

## The principles

1. **One voice at a time.** At most one banner on screen, a priority queue,
   and a rule that anything under ~1 s of relevance is not a banner.
2. **Numbers are earned, not sprayed.** Floating text is budgeted (per
   second, per actor), merged when it repeats (+20 +20 +20 → +60) and reserved
   for things the player caused.
3. **Motion explains cause and effect.** Everything that moves is going
   *from* somewhere *to* somewhere: a card grows into the run, a score rolls
   into its record, a rank emblem is struck, not faded.
4. **One motion language.** A handful of duration and spring tokens used
   everywhere; nothing hand-tuned per component.
5. **Say it once.** Explanations live behind a single "why" affordance; the
   default screen is picture, number, button.
6. **Compositor-only, 60 fps, reduced-motion respected.** Transform and opacity
   only; `prefers-reduced-motion` and the low-effects setting get a calm,
   complete alternative rather than a broken one.

## The plan, biggest first

1. **Motion foundation** — tokens (`--dur-1…5`, `--ease-out`, `--ease-spring`,
   `--stagger`), a tiny `motion.ts` (springs, stagger helper, reduced-motion
   switch), the View Transitions API for route changes with a fade fallback.
2. **The run's front door** — clicking a card morphs the card's picture into
   the arena (shared-element transition), the countdown becomes a single
   struck numeral with a ring that closes, and GO lands with a short hit-stop.
3. **Results as a ceremony** — three acts instead of nineteen panels: *the
   number* (score rolls up with easing, the personal-best line is drawn
   through), *the verdict* (one sentence, one limiter, one next step), *the
   evidence* (everything else, folded, one click away). Choreographed to the
   existing `resultsReveal` / `personalBest` sounds.
4. **A calm arena** — a banner queue with priorities and cooldowns; a
   floating-text budget with merging; the HUD fades its secondary fields
   while you are fighting and brings them back in quiet moments.
5. **Rank-up and records** — the emblem is forged (edge light sweeps, facets
   settle with a spring), the old rank breaks away; a new record flies from the
   results number into its row on PROGRESS the next time you open it.
6. **Say it once** — every explanatory paragraph moves behind one consistent
   "?" / WHY disclosure; headers become one line; the WARM UP screen leads with
   the button and nothing else above the fold.
7. **Micro-interactions** — press depth on every button, card hover parallax
   on the clip, tab underline that slides rather than jumps, number tickers
   everywhere a number changes, a satisfying streak increment.
8. **Proof** — Playwright recordings (video) of the six key moments before and
   after, a frame-time check, and simtest assertions on banner and float
   budgets so the calm cannot quietly regress.

---

## The prompt

> Paste everything below this line into the next session.

You are working on APEX (repo `cvree/TopDown`), a browser League of Legends
mechanics trainer built with React 19 + three.js, currently v2.23.0. Read
`README.md`, `docs/next-polish.md` and `src/styles/global.css` first. The
simulation, scoring and tests are solid; this session is **only** about how the
client feels. Goal: make APEX feel elegant, calm and deeply satisfying — the
kind of client people show to other people because of how it moves — without
adding noise. Nothing you change may alter a score, a rating or the
simulation; `npm test` must stay green throughout.

**Taste rules — apply them to every decision:**

- One voice at a time. Never two banners, never a toast over a banner, never
  a paragraph where a number would do.
- Motion must mean something: everything moves *from* a cause *to* a result.
  No decorative looping, no bounce for its own sake, no motion on things the
  player is not looking at.
- Restraint over quantity. If an effect is not clearly better with it than
  without it, remove it. Removing noise counts as progress.
- Fast in, gentle out: entrances ~180–320 ms with a strong ease-out, exits
  ~120–200 ms. Nothing blocks input while it animates.
- Transform and opacity only; hold 60 fps; respect `prefers-reduced-motion`
  and the existing low-effects setting with a calm but complete alternative.
- Keep the existing visual identity (antique gold on black-blue, cyan for live
  state, Cinzel/Chakra Petch) and the project's writing voice — just far less
  of it on screen at once.

**Work in this order. Commit and push after each numbered step, with the
repo's changelog voice, and keep a before/after record.**

1. **Baseline and proof harness.** Build the production bundle, serve it, and
   write a Playwright script (Chromium is preinstalled at
   `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; use
   `--use-angle=swiftshader`) that records *video* of: boot → WARM UP; opening
   a mode card; the countdown; a banner-heavy lane minute; the results screen;
   a rank-up. Save the "before" clips. Software WebGL is slow here, so use a
   temporary short `PLAY_SECONDS` build for recording and never commit it.
   Add simtest assertions that count banners and floating texts per minute
   in a lane and a Sheriff run, and record today's numbers.
2. **Motion foundation.** Add duration, easing and spring tokens to
   `global.css` and a small `src/ui/motion.ts` (spring stepper, stagger
   helper, reduced-motion switch). Replace ad-hoc durations and easings across
   the CSS with the tokens. Route changes use the View Transitions API
   (`document.startViewTransition`) with a fade fallback; the top-bar tab
   indicator slides between tabs.
3. **Calm the arena.** Replace direct `setBanner` usage with a banner queue in
   `Session`: priorities (critical > teaching > flavour), a minimum dwell, a
   cooldown per message key, and teaching banners shown once per profile
   rather than once per run. Put floating text (`micro`) behind a budget: merge
   repeats (+20 ×3 → +60), cap per actor per second, and drop flavour text
   during fights. Secondary HUD fields dim while the player is in combat and
   return in quiet moments. The simtest budgets from step 1 must go down
   substantially and then become assertions.
4. **The run's front door.** Clicking a card morphs its picture into the
   arena with a shared-element transition; the countdown becomes one struck
   numeral with a closing ring; GO lands with ~60 ms of hit-stop and a camera
   settle. Rewind gets a proper effect: a brief desaturated scrub of the arena
   backwards, not just a progress bar.
5. **Results as a ceremony.** Restructure `Results.tsx` into three acts: *the
   number* (a count-up that eases in, a personal-best line drawn through, the
   delta to your last run); *the verdict* (one sentence, one limiter, one
   button); *the evidence* (every existing panel, folded behind a single
   disclosure, nothing deleted). Choreograph it to the existing
   `resultsReveal` and `personalBest` sounds so sound and motion land
   together. Space still continues, R still retries, instantly, at any point.
6. **Rank-up and records.** Rework `RankUp.tsx` so the emblem is forged: an
   edge-light sweep, facets settling on a spring, the old rank breaking away.
   A new personal best animates into its row on PROGRESS the next time the
   player opens that screen, then never again.
7. **Say it once.** Move explanatory paragraphs on PRACTICE, THE LAB,
   WARM UP and PROGRESS behind one consistent WHY/"?" disclosure. Headers
   become one line. WARM UP leads with the button and the streak above the
   fold and nothing else. Keep every sentence — just not all at once.
8. **Micro-interactions.** Press depth on every button, a subtle parallax on
   card pictures under the cursor, number tickers wherever a number changes
   on screen, and a satisfying streak increment on the warm-up summary.
9. **Proof and release.** Re-record the six clips, compare them against the
   before clips, check frame times, run `npm test` and the build, write the
   v2.24.0 patch notes (only what a player would notice) and regenerate the
   changelog, update the README, then push. Merge to `main` only when asked.

**Report back with** the before/after banner and float counts, a frame-time
number for the heaviest screen, and a short list of anything you deliberately
removed.
