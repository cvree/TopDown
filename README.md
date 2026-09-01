# APEX — MOBA Mechanics Trainer

A browser-based mechanics trainer for MOBA players, built around one idea: the
thing that feels rewarding should be the thing that actually makes you better.

Eleven drills, a ranked mechanical skill system driven by measured performance
rather than time played, and a results screen designed so you can see exactly
what you did and what it cost you.

```
npm install
npm run dev        # http://localhost:5173
npm test           # headless simulation + scoring checks
npm run build      # production bundle
```

---

## What it trains

| Drill | Measures | The habit it builds |
| --- | --- | --- |
| **Movement** | Path efficiency, command cleanliness | One click, the right point, no wandering |
| **Aim** | Reaction, click error, target discrimination | Landing your click on the champion you meant |
| **Dodge** | Hits per pattern, hazard exposure | One correct movement on the telegraph |
| **Spacing** | Time inside your free-trade band | Trading from max range, not drifting in |
| **Kite** | Orbwalk efficiency, cancels, DPS uptime | Attack → move → attack |
| **Last Hit** | CS accuracy, perfect (one-attack) kills | Reading a health bar against your windup |
| **Target Switch** | Switch latency and accuracy | Retargeting mid-fight without freezing |
| **Combos** | Sequence execution under a closing window | Ability order while your other hand is busy |
| **1v1 / 1v2 / 1v3** | All of the above, against live AI | Priority, cooldown awareness, not panicking |

## The mechanics model

The simulation reproduces the parts of League combat that matter for muscle
memory, and nothing else.

- **Attack cycle.** `1 / attackSpeed`, split into a windup, a damage release and
  a backswing. The attack timer starts at windup, so a cancelled attack costs
  you the whole cycle.
- **Cancellation.** A move order during the windup cancels the attack outright.
  The same order during the backswing is free. That single asymmetry is the
  entire kiting skill, and it is the axis the Kite drill scores.
- **Attack-move.** Walks to the point and attacks whatever enters range on the
  way; it never chases. Right-clicking a unit is an attack-on-target and does
  chase into range.
- **Projectiles.** Basic attacks track their target; skillshots fly straight and
  can be sidestepped. Near misses are detected against the swept segment, not
  the frame position, so a graze at 240Hz is a graze at 60Hz.
- **Determinism.** The simulation advances in fixed 1/240s steps and renders
  with interpolation, so movement, windups and travel time are identical on a
  60Hz laptop and a 240Hz monitor.

### Enemy archetypes

Six originals — Ranger, Diver, Artillery, Controller, Duelist, Juggernaut —
each existing to force a different habit. Difficulty changes **behaviour**, never
health: reaction delay (0.46s → 0.075s), aim error, movement prediction,
skillshot dodging, spacing discipline, ability frequency and tempo. A harder
Ranger reacts sooner and leads your movement better; it does not have a bigger
health bar.

The AI perceives you through a delayed snapshot buffer, so its reaction time is
a real latency rather than a fudge factor.

## The ranked system

**This is a trainer rank.** It measures mechanical execution in these drills. It
is not a prediction of anyone's League ranked tier, and the UI says so wherever
the rank appears.

Eight axes are rated independently — Movement, Aim, Dodging, Kiting, Spacing,
Targeting, Combat, Last Hitting — and blended into an overall rating on an
Iron → Challenger ladder.

**Rank comes from performance, not attendance.** Each run produces a
performance in 0..1 and the difficulty it was played at. Those give an *expected
rating* — what a player who performs like that consistently deserves — and your
rating moves a fraction of the way toward it. Grinding runs at your current
level converges on your current rating and then stops. The only ways up are to
perform better or to perform well at a higher difficulty; a flawless run at the
lowest difficulty tops out around Gold.

The first run on an axis is allowed to place you outright. After that the
per-run cap tightens sharply, so a rank becomes something you hold rather than
something you walk into.

### Adaptive difficulty

Each axis carries its own difficulty, nudged after every run to keep you in a
60–78% performance band. Struggling with attack timing eases the pressure on the
kiting axis without touching your aim difficulty.

## Verification

`npm test` runs the real `Session`, `World`, AI and drill code headlessly and
drives it with synthetic input policies. It asserts the properties the product
depends on:

- Correct orbwalking (attack, reposition in the backswing, repeat) reaches
  >90% orbwalk efficiency and beats both spamming and standing still.
- Spamming move commands produces cancels and scores near zero.
- Every drill rewards playing it correctly (>55% performance).
- **Every drill scores under 30% for a player who does nothing.** No drill can
  be passed by presence alone.
- 1v1 is winnable; 1v2 and 1v3 cost progressively more health; all three are
  winnable, averaged across seeds.
- The same policy performs worse at higher difficulty.

`npm run test:drill <drill> <difficulty>` plays a single drill headlessly and
prints a per-5-second trace — the fastest way to see why a tuning change
changed a score.

## Controls

| | |
| --- | --- |
| Right click | Move · right click a unit to attack it |
| `A` + left click | Attack-move (a bare left click also works) |
| `Q` `W` `E` `R` | Abilities (drills that use them) |
| `D` `F` | Summoners — blink in the arenas |
| `S` | Stop |
| `` ` `` / `Enter` | Instant reset |
| `Esc` | Pause |

All bindings are remappable in Settings, along with quick cast. In drills with
no ultimate bound, `R` also acts as instant reset.

## Architecture

```
src/engine/     simulation: world, combat, AI, metrics, renderer, audio, input
src/drills/     one file per drill; each owns its rules and its scoring
src/progression/ rating maths, rank ladder, profile persistence
src/ui/         React shell, HUD, results, profile, rank-up
tools/          headless test harnesses
```

React renders menus and the results screens. It never touches the simulation
during play: the game loop owns the canvas, and the HUD is written to through
DOM refs at ~20Hz, so a React render can never sit between your click and the
game reacting to it.

Progress is stored in `localStorage` under `apex.profile.v1` — no account, no
server, no network calls during play.

## Deployment

Pushing to `main` builds, typechecks, runs the simulation checks, and publishes
to GitHub Pages via `.github/workflows/deploy.yml`. Enable it once under
**Settings → Pages → Source: GitHub Actions**. The build uses relative asset
paths, so it also works from any static host or subdirectory.

`npm run build:single` additionally emits `dist/apex-single.html` — the whole
trainer inlined into one file, for hosts that only take a single document.
