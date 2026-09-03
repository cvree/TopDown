# APEX — MOBA Mechanics Trainer

A browser-based mechanics trainer for MOBA players, built around one idea: the
thing that feels rewarding should be the thing that actually makes you better.

It plays in a real 3D arena — a locked overhead camera, champions with
silhouettes you can read at a glance, and every piece of gameplay information
drawn on the ground where the thing it is about actually is. Sixteen drills, a
ranked mechanical skill system driven by measured performance rather than time
played, a champion path that teaches one champion properly, and a results
screen designed so you can see exactly what you did and what it cost you.

It can be driven either way: League's click-to-move, or WASD. Both obey the
same windup law, so a run scores identically under either.

It opens like a game rather than a page: black screen, a crest struck out of
it, a load bar, and a key to press. That gate is not only theatre — the arena's
terrain, its noise-painted surfaces and its shaders are generated on the main
thread at startup, and browsers refuse to start an AudioContext without a
gesture. So the wait happens behind a title card instead of in front of you,
and the swell that carries you into the client is the first sound the app is
allowed to make.

Nothing is downloaded at runtime. The stone, the rock, the turf, the champions
and every effect are generated in code at load time, so the whole trainer still
fits in a single HTML file.

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
| **Skillshot** | Hit rate per ability, chain length | Landing a travel-time skillshot on a target trying to juke it |
| **Dodge** | Hits per pattern, hazard exposure | One correct movement on the telegraph |
| **Spacing** | Time inside your free-trade band | Trading from max range, not drifting in |
| **Kite** | Orbwalk efficiency, cancels, DPS uptime | Attack → move → attack |
| **Last Hit** | CS accuracy, attacks per CS, perfect (one-attack) kills | Farming a live lane: leading the windup, counting turret shots, not waking the wave |
| **Target Switch** | Switch latency and accuracy | Retargeting mid-fight without freezing |
| **Combos** | Sequence execution under a closing window | Ability order while your other hand is busy |
| **1v1 / 1v2 / 1v3** | All of the above, against live AI | Priority, cooldown awareness, not panicking |
| **Tumble** | Tumble rhythm, windups thrown away | Q in the backswing — Vayne's whole movement game |
| **Silver Bolts** | Bolt efficiency, stacks dropped | Finishing the third hit instead of switching at two |
| **Condemn** | Wall stun rate, chances missed | Standing on the right side of the wall *before* the fight |
| **Night Hunter** | Kit execution under a live 1v2 | Playing Vayne rather than an ADC who owns her abilities |

### Last Hit is a lane

The last-hit drill is a simulated lane rather than a health-bar countdown, and
the difference is the point. Six minions a side walk out of their gates, pick
targets by League's own priority table and fight; a turret behind each side
shoots whatever comes into reach; from the halfway difficulty an enemy laner
stands opposite you taking the same farm, and the HUD shows their CS next to
yours.

Nothing drains. Every point of damage in that lane was thrown by a body you can
watch wind up, which is what turns "click when the bar is short" into four
reads that transfer:

- **Lead the attack.** Your windup plus your missile's flight is about a third
  of a second, so the bar you are looking at is not the bar your arrow arrives
  at. Every minion's plate shows the damage already in the air as a pale wash,
  and your own damage as a tick — once the health crosses it, the minion is
  yours.
- **Count the turret.** A caster minion dies to one turret shot plus one of
  your attacks; a melee minion to two turret shots plus one. Those numbers are
  exact, so under-tower farming is practisable instead of mystical.
- **Don't touch the champion.** Auto the enemy laner with the wave on top of
  you and six minions turn around, by the same targeting rules the real game
  uses.
- **Don't push for free.** Attacks per CS is scored. A clean farmer sits at
  one; every extra swing at a healthy minion shoves the wave toward their
  turret and empties your timer for the minion that drops a second later.

How much the drill draws for you falls away as the difficulty rises: below the
halfway mark it marks the minion you can take and names the mistake you just
made, above it you keep the health-bar plates only, and at the top you get a
lane and the bars League would have given you.

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

## The Vayne path

The ladder above rates nine general axes and does not care which champion you
play. The champion path is the other thing: one champion, four stages in the
order they actually have to be learned, each gating the next.

| Stage | It teaches | Cleared at |
| --- | --- | --- |
| **1 · Tumble** | Q in the backswing, every time it is up, without throwing an attack away | 55% |
| **2 · Silver Bolts** | Finish every stack. Switching at two is the mistake that defines a bad Vayne | 58% |
| **3 · Condemn** | Position so terrain is behind them, then turn a knockback into a 1.5s stun | 58% |
| **4 · Night Hunter** | All of it at once, with Final Hour, against two opponents and real walls | 60% |

**The kit is modelled, not gestured at.** Tumble is a dash whose entire skill is
*when* you press it — mid-windup it throws the attack away and is counted
against you, in the backswing it is free distance and an empowered shot. Silver
Bolts is a counter that only pays on three consecutive hits against the *same*
target, and every stack you abandon is recorded. Condemn knocks a target 430
units along the line from you and only stuns if terrain is waiting at the end
of it, which makes it a question about where you chose to stand. Final Hour
shortens the tumble, adds damage, and hides you for a second on each tumble.

**Mastery is a ceiling, not a total.** Each stage stores your *best* run and
the difficulty you played it at; mastery is the weighted blend of those, so a
worse run never costs you anything and grinding at a level you have already
beaten converges and stops. Titles run from RECRUIT to **THE GREATEST VAYNE**,
which needs every stage at three stars at a difficulty with nothing left to
teach you — and the screen that awards it says plainly that it is a claim
about these drills, not about anybody's ranked ladder.

## The ranked system

**This is a trainer rank.** It measures mechanical execution in these drills. It
is not a prediction of anyone's League ranked tier, and the UI says so wherever
the rank appears.

Nine axes are rated independently — Movement, Aim, Skillshot, Dodging, Kiting,
Spacing, Targeting, Combat, Last Hitting — and blended into an overall rating
on an Iron → Challenger ladder.

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
- WASD orbwalking scores in the same band as click orbwalking, a direction
  taken mid-windup cancels the attack, one taken in the backswing does not,
  and a player who never releases the keys never attacks at all.
- Tumbling in the backswing beats tumbling on cooldown; finishing bolt stacks
  beats target-hopping; a wall-aware condemn player lands wall stuns and a
  wall-blind one does not.
- **Every drill scores under 30% for a player who does nothing.** No drill can
  be passed by presence alone.
- 1v1 is winnable; 1v2 and 1v3 cost progressively more health; all three are
  winnable, averaged across seeds.
- The same policy performs worse at higher difficulty.

`npm run test:drill <drill> <difficulty>` plays a single drill headlessly and
prints a per-5-second trace — the fastest way to see why a tuning change
changed a score.

## Controls

Two schemes, chosen in Settings. The default is League's.

### Click to move

| | |
| --- | --- |
| Right click | Move · right click a unit to attack it |
| `A` + left click | Attack-move (a bare left click also works) |
| `Q` `W` `E` `R` | Abilities (drills that use them) |
| `D` `F` | Summoners — blink in the arenas |
| `S` | Stop |
| `Space` | Centre the camera on your champion |
| `Y` | Toggle camera lock. Unlocked, the camera stays where you leave it |
| Screen edge | Edge pan, in both modes — in locked mode the offset springs back |
| Mouse wheel | Zoom. The camera follows your champion once you are zoomed past the arena bounds |
| `` ` `` / `Enter` | Instant reset |
| `Esc` | Pause |

### WASD

| | |
| --- | --- |
| `W` `A` `S` `D` | Move. Release to attack — a direction held through the windup cancels it, exactly as a click does |
| Left click | Attack the unit under the cursor, or take an attack-move stance. It never walks you anywhere |
| `Q` `E` `R` `F` | Abilities Q, W, E and R — the row moves one seat over, because W is spoken for |
| `1` `2` | Summoners |
| `X` | Stop |

Under WASD the mouse only ever targets, so it can never cancel an attack; the
keys are the only thing that moves you, and holding one is the same commitment
a click is. Everything else — camera, zoom, reset, pause — is unchanged.

All bindings are remappable in Settings, along with quick cast, and each scheme
keeps its own rebinds so switching never breaks a layout you tuned. In drills
with no ultimate bound, `R` also acts as instant reset.

## The arena

The renderer is a three.js scene built entirely from code.

- **Terrain.** Drills that need it place blocks the simulation treats as solid
  — you cannot walk through them and Condemn pins people against them — drawn
  as real geometry with real shadows, because the shadow is what tells you
  which side of a body the wall is on. A sunken amphitheatre: a dead-level paved playfield, a stone
  kerb, three terraces, then turf and cliffs. The playfield being perfectly flat
  is a gameplay decision, not a shortcut — it means every ground indicator can
  hug the floor without a height query and without z-fighting.
- **Surfaces.** Ashlar masonry, layered rock and turf are painted into canvases
  at load time from value, cellular and fBm noise, with normal maps derived from
  the same height fields. Terrain is sampled triplanar, so cliff faces do not
  wear vertically smeared grass.
- **Champions.** Hierarchies of primitives posed by a procedural animator rather
  than skinned meshes playing clips. That buys the thing that matters here: the
  attack pose is driven by the simulation's own windup timer, so the windup you
  see is frame-exact against the windup being scored. Each archetype has its own
  silhouette, because at this camera distance silhouette is all that survives.
- **Camera.** League's locked follow camera, with League's controls: a lock
  toggle, centre-on-champion, and edge panning. The follow is stiff rather than
  springy on purpose — a soft follow puts your champion somewhere your cursor
  is not, which would make every click-error measurement in the trainer a lie.
  The ground footprint is solved from the real frustum rays rather than assumed
  symmetric — a pitched camera sees far more ground away from itself than
  toward itself — so the whole arena stays framed at every aspect ratio, and no
  camera state, panned or unlocked, can put the playable rectangle off screen.
  Casts and heavy landings shove the camera along their own direction, because
  a directional kick reads as recoil where an omnidirectional shake reads as
  noise.
- **Indicators.** Ranges, click markers, telegraphs and drill markers are real
  geometry lying on the floor, drawn by one analytic shader. Health bars,
  nameplates and combat text are projected into a 2D overlay so they stay
  pixel-crisp and the same size near and far.
- **Grade.** One pass does the lot: an unsharp mask taken from the untouched
  sample (deriving it from already-split channels rings every stone edge),
  split toning with cold shadows and warm highlights, a filmic shoulder that
  only touches the top end, an elliptical vignette, chromatic aberration at the
  edges, grain, and a radial smear on damage that leaves the centre of the
  screen sharp — you must always be able to read what is about to hit you next.
- **Cost.** Shadows, bloom and the grade pass step down automatically if frame
  rate drops, and "Reduced effects" in Settings turns them off outright. The
  simulation is untouched by any of it, so scores never depend on the machine.
- **Motion.** "Reduced camera motion" damps shake, punch and the cast kick to
  zero and leaves everything you drive the camera to do — follow, zoom, edge
  pan — exactly as it was. It is a separate switch from "Reduced effects" on
  purpose: needing a still camera is not the same as needing a cheap one.

The menus are fronted by the same arena, rendered live at a capped frame rate.

## Sound

Every sound is synthesised on the fly. No asset loading, no first-play stutter,
and — the reason it is worth doing at all — pitch, timbre and space can track
gameplay state directly.

- **The room.** A generated impulse response: noise under an exponential decay
  with a handful of discrete early reflections stamped into the first 80ms,
  offset between channels so they do not collapse into a filter. That is enough
  to read as a stone amphitheatre without shipping a WAV.
- **Space.** Every voice is panned to where its source actually is, so a hit on
  your left is on your left and a telegraph behind you announces itself.
- **Abilities.** Q, W, E and R are one struck-metal instrument played four ways
  — a bell, a swelling pad, a rising sweep, a gong under a choir — so your
  hands learn which one fired without reading the bar. A slot that was already
  on cooldown gives a dull closed thud instead: the input was real, the ability
  was not.
- **Incoming danger.** Every telegraph, every hazard landing and every enemy
  projectile is audible and placed. Half of dodging in League is hearing a cast
  start while you are looking somewhere else, and a trainer that only ever
  *draws* the telegraph trains half of it.
- **The chain.** Clean orbwalk steps raise the pitch of your own attacks, and
  the arena's room tone swells with the streak — so a chain is audible before
  it is legible.

## The client

The front end is not a page. There is no scrolling column of cards: a list down
the left, the chosen drill standing in the live arena down the middle, your
record down the right, and one large button along the bottom. The empty middle
third is the point — the interface is a frame around a place rather than a
surface covering one, and the arena behind it is the same terrain, lighting and
champions you are about to play in, rendered live.

Screens that are genuinely pages of content — the daily programme, your
profile, settings — sit on a darkened plate instead, so the arena shows through
as depth rather than competing for the same pixels as the text.

## Architecture

```
src/engine/     simulation: world, combat, AI, metrics, audio, input, paint
src/engine/vayne.ts   the champion kit: tumble, bolts, condemn, final hour
src/gfx/        the 3D renderer: scene, terrain, walls, champions, decals, VFX
src/drills/     one file per drill; each owns its rules and its scoring
src/progression/ rating maths, rank ladder, champion path, profile persistence
src/ui/         React shell, HUD, results, profile, rank-up, the Vayne path
tools/          headless test harnesses
```

The champion kit lives in `engine` rather than in the drills because four
drills and the gauntlet share it: there is exactly one implementation of what
a tumble is, and the drills only decide what to spawn and how to score it.

The boundary between `engine` and `gfx` is deliberate and narrow. The
simulation knows nothing about three.js; the renderer knows nothing about
drills. Drills describe what they want to say — "a countdown ring around this
node", "a caret over the priority target" — as ground markers and billboards
(`src/engine/paint.ts`), and the renderer decides how that is realised. That is
what let the original flat 2D canvas renderer be replaced wholesale without
touching a line of scoring.

React renders menus and the results screens. It never touches the simulation
during play: the game loop owns the canvas, and the HUD is written to through
DOM refs at ~24Hz, so a React render can never sit between your click and the
game reacting to it.

Progress is stored in `localStorage` under `apex.profile.v1` — no account, no
server, no network calls during play.

## Deployment

Pushing to `main` builds, typechecks, runs the simulation checks, and publishes
to GitHub Pages via `.github/workflows/deploy.yml`. Enable it once under
**Settings → Pages → Source: GitHub Actions**. The build uses relative asset
paths, so it also works from any static host or subdirectory.

`npm run build:single` additionally emits `dist/apex-single.html` — the whole
trainer, arena included, inlined into one file for hosts that only take a
single document.
