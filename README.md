# APEX — MOBA Mechanics Trainer

A browser-based Vayne trainer, built around one idea: the thing that feels
rewarding should be the thing that actually makes you better.

It plays in a real 3D arena — a locked overhead camera, champions with
silhouettes you can read at a glance, and every piece of gameplay information
drawn on the ground where the thing it is about actually is. One champion, four
parts of her, and two ways to play each of them:

- **PLAY** — one minute. The same minute every time, so a score means something
  next to the one before it.
- **SURVIVE** — no clock. It ramps as you last, and it ends when you die or
  when you have made that mode's own mistake three times. The result is how
  long you lasted.

That is the whole menu. There is no daily plan to opt into, no calibration to
sit through, no course to unlock and no champion to choose — the ladder places
you from your first three runs, and every mode puts you behind the same
champion, because the quarter of a second at the end of a tumble is not a thing
you can practise in the abstract.

Behind it is a ranked mechanical skill system driven by measured performance
rather than time played, and a results screen designed so you can see exactly
what you did and what it cost you.

It can be driven either way: League's click-to-move, or WASD. Both obey the
same windup law, so a run scores identically under either — and the modes know
which hand you are using, because the mistakes are not the same ones.

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

Four modes, each one part of the same champion, and each one with a PLAY and a
SURVIVE on it.

| Mode | Keys | Measures | The habit it builds |
| --- | --- | --- | --- |
| **Tumble** | Q | Tumble rhythm, windups thrown away, where the roll put you | Q in the backswing — Vayne's whole movement game |
| **Silver Bolts** | Q W | Bolt efficiency, stacks dropped | Finishing the third hit instead of switching at two |
| **Condemn** | Q E | Wall stun rate, angles you made rather than found | Standing on the right side of the wall *before* the fight |
| **Night Hunter** | Q W E R | Kit execution and vision held, against a floor that refills | Playing Vayne rather than an ADC who owns her abilities — in the dark |

### Fog of war

Night Hunter is played under League's own rule about what you are allowed to
know: the map is lit only where something of yours can see, terrain throws sight
shadows you cannot look into, and bushes hide whoever got there first. An enemy
that walks out of your vision is *gone* — no body, no health bar, no threat
ring, no missiles, not even the dust it kicks up — and the bots lose you the
same way, walk to the last place they had a read on you, and start searching.

That changes what the mode trains. The camera opens zoomed in, so the arena no
longer fits on one screen and driving it is the only way to see what is
happening; the minimap draws terrain always, the fog over it, and the position
of an enemy you have just lost inside a ring that grows at walking speed. The
results screen answers the two questions that follow: how much of the run you
held eyes on the fight, and how much of the damage you took came out of ground
you never looked at.

It can be turned off in **Gameplay** settings, for a player still learning the
kit who would rather not learn two things at once.

### The two run modes

**PLAY is one minute.** Every mode, every time. Night Hunter included: clearing
the floor sends the next wave rather than ending the run, because a minute that
finishes in eleven seconds is not a minute and cannot be compared with one that
did not.

**SURVIVE has no clock.** Two things end it:

- **Dying.** Real for every mode with something that can kill you.
- **Three strikes.** Each mode names one mistake, and it is the mistake the
  mode exists to stop: a windup thrown away in Tumble, a stack abandoned in
  Silver Bolts, a condemn into open ground in Condemn. Night Hunter has no
  strikes, because it has a health bar. The budget is three pips under the
  clock and they only ever go out.

And it ramps. Difficulty climbs from the mode's opening figure to its hardest
over two and a half minutes, and it reaches the spawner rather than only the
scoreboard: the wave that arrives at two minutes has more bodies in it, and
harder ones, than the wave that opened the run. Which is why the number it gives
back — how long you lasted — is a number that can be beaten rather than
outlasted.

A survive run keeps its own record, separate from the play score, because a
score that grows simply by lasting is not the same measurement twice.

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

## The coach

The rating says how good you are. The coach says what is wrong, why, and what
to do about it — and everything it says is derived from telemetry a run already
recorded, so it can never disagree with the score.

### Error intelligence

Fourteen named mistakes, detected from the same metrics the rating consumes:

| Code | What it is | Fixed by |
| --- | --- | --- |
| `EARLY_MOVE` | Moved before the attack released; the windup was thrown away | Kite |
| `HELD_FIRE` | Off cooldown, in range, and a movement key still down | Kite |
| `OVERSTEP` | Entered enemy threat range and stayed there | Spacing |
| `RANGE_LOSS` | Drifted outside your own range and stopped being a threat | Spacing |
| `ROOTED` | Stood still through windows where moving was free | Kite |
| `LATE_DODGE` | Reacted to a telegraph after it was too late to move | Dodge |
| `HAZARD_STAND` | Stayed in a ground hazard that was visible the whole time | Dodge |
| `TARGET_DROP` | Too slow to commit when the priority target changed | Target Switch |
| `CURSOR_OVERTRAVEL` | Commands landing off-target and needing a correction | Aim |
| `PANIC_CLICK` | The same command repeated instead of issued once | Movement |
| `MISSED_SHOT` | Shots that did not connect — wrong lead, or already gone | Skillshot |
| `CS_MISS` | Killing blows started and not landed | Last Hit |
| `INCONSISTENT` | Reactions spread wide: a steadiness problem, not a speed one | Aim |
| `CHIP_DAMAGE` | Finished low without one big mistake — it came off in pieces | 1 v 1 |

The "fixed by" column names the drill in the wider catalogue that isolates the
mechanic. The menu offers four Vayne modes, so a fix button starts the one that
trains the same thing — kiting, movement and dodging problems land on Tumble;
targeting and last-hitting on Silver Bolts; spacing and skillshots on Condemn;
anything else on Night Hunter. The mapping is one function, `practiceFor` in
`src/drills/modes.ts`, so it is a single place to argue with.

Thresholds sit deliberately above noise. One cancelled attack in a sixty-second
run is not a habit, and a system that called it one would not be worth
trusting. Each detection records how often it happened *and* what share of the
opportunities to make it that was, because the second number is the one that
trends: a rate falling 16% → 14% → 12% → 6% is a habit visibly disappearing,
and that is the chart the trainer most wants to be able to draw.

### Pressure retention

Every drill is classified by how much pressure it puts a mechanic under:
`isolated` (a bench, nothing fighting back), `applied` (in context, scripted
threat) or `live` (an opponent that moves, targets and punishes). Retention is
your live performance over your isolated performance, per axis.

It exists because "I can do it in the practice tool" is the most common thing a
player believes about themselves, and it is the only claim on any of these
screens that can check it. A mechanic at 91% isolated and 72% live has been
rehearsed, not learned, and the trainer says so in those words.

### Transfer readiness

Foundation → isolated → combined → pressure → transfer, each scored from your
best three runs in that context. It is what turns "you know this mechanic" into
"you perform this mechanic well in isolation and it degrades under combat
pressure", which is a far more useful sentence.

### Plateau detection

Six or more recent runs of one drill with no trend and no wild swings is a
plateau. The answer to a plateau is not "try again" — the limiting skill is
usually somewhere else — so the coach names the mistake that is capping it and
recommends a detour into the drill that trains *that*.

### The session planner

A day's training is a shape, not a list: warmup on a strength, the primary
weakness, a supporting skill on a different axis, the same mechanic back in
context, and a transfer test against something that fights back. It is drawn
once per day and then left alone, because a plan that reshuffles between two
drills is not a plan and the numbers either side of it stop being comparable.

### The recommendation engine

Candidates come from recurring mistakes, untrained axes, mechanics that collapse
under pressure, plateaus and the weakest measured axis — each with the number
that justifies it. Anything played in the last couple of hours is pushed down
the list, because the same drill recommended every day stops being a
recommendation.

## The ranked system

**This is a trainer rank.** It measures mechanical execution in these drills. It
is not a prediction of anyone's League ranked tier, and the UI says so wherever
the rank appears.

Ten axes are rated independently — Movement, Aim, Skillshot, Dodging, Kiting,
Spacing, Targeting, Combat, Last Hitting, APM — and blended into an overall
rating on a Foundation → Apex ladder of APEX's own proficiency classes:
Foundation, Developing, Proficient, Calibrated, Refined, Advanced, Expert,
Elite, Peerless, Apex. They are deliberately not League's tier names — "my
mechanics are Platinum" is a claim about a ranked ladder these drills have
never measured, and a trainer that invites it is not being honest with you.

**Rank comes from performance, not attendance.** Each run produces a
performance in 0..1 and the difficulty it was played at. Those give an *expected
rating* — what a player who performs like that consistently deserves — and your
rating moves a fraction of the way toward it. Grinding runs at your current
level converges on your current rating and then stops. The only ways up are to
perform better or to perform well at a higher difficulty; a flawless run at the
lowest difficulty tops out around Calibrated.

There is no calibration sequence. The first run on an axis is allowed to place
you outright, and after three runs the profile is placed and the rank appears;
from then on the per-run cap tightens sharply, so a rank becomes something you
hold rather than something you walk into. A screen that made you play five
drills before it would tell you anything was a toll gate, and the two-button
menu exists precisely so that the first thing a new player does is press
PLAY.

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
- **The same Vayne rhythm scores the same under either hand**, with the cursor
  parked on the pursuer throughout the WASD run. On that identical seed the
  `hands` dash aim sends 0% of tumbles into the fight and the `cursor` aim
  sends 100%; a clean release measures 8ms of held fire and never releasing
  measures the whole run.
- **Every drill scores under 30% for a player who does nothing.** No drill can
  be passed by presence alone.
- 1v1 is winnable; 1v2 and 1v3 cost progressively more health; all three are
  winnable, averaged across seeds.
- The same policy performs worse at higher difficulty.
- **Every lab bench rewards playing it, refuses to reward idling, and reports a
  real actions-per-minute figure.** One policy plays all thirteen off each
  bench's own `solution()`, so a new bench is covered the moment it exists. A
  bot that mashes at random produces the highest raw APM in the suite and
  scores under 5%, against 100% for the same bot playing properly — the check
  that keeps an APM trainer from degenerating into a click-speed test.
- **Restraint is measured and is not a rate.** In Go / No-Go a bot that holds
  the barred pads scores 100% at 127 APM; a bot that presses everything reaches
  nearly 500 APM and scores under 5%, and the held prompts are reported
  separately from the pressed ones.
- **The APM ladder is monotonic and honest.** Rungs get harder in order, a
  fresh ladder opens on level 1 only, a run short of the gate opens nothing, a
  clear opens one rung and an outright clear opens two, a worse run cannot
  lower a record, an endurance run can set a rate record but never a score, and
  calibration opens rungs without scoring any of them.
- **Every academy module is driven with the keys, pays for playing it and
  refuses to pay for standing there** — and every module is covered, so adding
  one without a check fails the suite rather than shipping untested.
- **The academy measures what it claims to.** A run whose hands point different
  ways reads 60% opposed against 0% for one whose cursor rides along with its
  feet; a run that respects the windup keeps every attack while one that never
  releases the keys lands none; a careful run stops within 12 units of the node
  centre; and holding max range while chasing is visible as its own number.
- **An unmeasured thing scores nothing, not everything.** Every "lower is
  better" figure in the academy — step delay, trigger held, wasted travel —
  starts at zero, which would otherwise make a run in which nothing happened
  look like a flawless one.

The same command then runs `test:profile`, which covers the other thing every
session depends on: reading a saved profile back and drawing the client with
it. It loads a profile written by a build whose catalogue has since moved on —
one full of drills that no longer exist — and a profile that is wrong in every
way an object can be wrong, and asserts that neither can take a screen down:

- **Nothing stored can name a drill that is gone.** Every drill reference in a
  loaded profile — history, records, recent bests, the error log, today's
  completed list — is checked against the catalogue, because the client is
  entitled to assume a stored id still means something.
- **A returning player comes back to the rank they left with.** Rating, peak,
  every per-axis reading and sample count, lifetime totals and the streak all
  survive a catalogue change, because none of them are stored per drill.
- **Every screen that reads a profile draws all three of them.** Practice and
  Progress are each rendered against a new profile, a legacy profile and a
  hostile one.

Several of those checks name drills the menu does not offer. The engine still
carries the whole catalogue the ratings, the coach and the error log were built
on — the foundation drills, the WASD academy, the APM lab and the Ezreal path —
and the harness still holds all of it to the same standard; the client simply
does not put them in front of you, because it is a Vayne trainer. A diagnosis
that names one of them is translated into the mode that trains the same thing
(`practiceFor`, in `src/drills/modes.ts`), so a "fix this" button always starts
something you can actually play.

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
| Screen edge | Edge pan, if it is switched on in Settings — in locked mode the offset springs back |
| Mouse wheel | Zoom. The camera follows your champion once you are zoomed past the arena bounds |
| `` ` `` / `Enter` | Instant reset |
| `Esc` | Pause, and open Settings — from a run or from any menu |

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

**Dash aim** is a WASD-only setting, and Vayne's Tumble is the ability it
decides: *the keys* (default — the dash goes where you are holding, and to the
cursor when nothing is held) or *the cursor* (League's literal behaviour). It
is a genuine fork only under WASD: the mouse is holding your target and the
keys are holding your direction, and those point opposite ways exactly when it
matters, which is while you are kiting something.

All bindings are remappable in Settings, along with quick cast, and each scheme
keeps its own rebinds so switching never breaks a layout you tuned. In drills
with no ultimate bound, `R` also acts as instant reset.

### Rebinding

`Esc` is the way in, from anywhere: it opens Settings from a menu, and inside a
run it pauses and puts the same screen over the paused arena — because the
moment you want to change a binding is the moment it just failed you, which is
always mid-drill. Everything you change there is live the instant you go back
to the run, bindings included, so a rebind can be tested by closing the panel
and pressing the key.

Click a slot, press what you want. Any key, any mouse button, `Shift` and
`Ctrl` included. `Esc` cancels the capture, `Backspace` clears the slot, and ↺
puts a single row back to its default without touching the rest.

Four rules hold the list together:

- **One key belongs to one action.** Take a key that another action already had
  and it *loses* it: the row is left unbound and named out loud, rather than two
  actions quietly fighting over one press and one of them silently losing.
- **Unbound is a real state**, shown as such, and reachable on purpose.
- **`Esc` always pauses a run**, whatever `Pause` is bound to. No rebind can
  lock you inside a drill with no menu to undo it from.
- **Nothing is a one-way door.** Every row restores itself, every scheme
  restores all of its own, and the whole screen restores as it shipped.

Actions that ship with an alternate — the attack-move confirm button, reset's
`Enter` — expose that second slot too, so the confirm click can move as well as
the modifier.

## Settings

One subject on screen at a time, listed down the left in the order a player
meets them — **Movement**, **Controls**, **Gameplay**, **Camera & video**,
**Audio** — rather than every control in the app in three tall columns,
which is how the previous version managed to make a volume slider and a keybind
list neighbours.

The whole screen is built from a registry rather than from markup, and three
things fall out of that:

- **Search.** Type anything (or press `/` from anywhere on the page) and the
  sections collapse into a flat list of matching controls. Each result is the
  real, fully operable control — not a link to it — still labelled with the
  section it came from, so nobody has to remember whether "shake" is a video
  setting or a gameplay one. It matches labels, explanations, option text,
  binding names.
- **Changed-from-default marks.** Every row knows its own default, so a changed
  setting carries a dot, a section carries one in the nav when anything inside
  it has moved, and both a single section and the entire screen can be put back
  exactly as they shipped.
- **Honest scope.** Each row says what it does *and* what it does not: the
  camera and video controls state outright that they never touch the
  simulation, so scores stay comparable across machines.

| Setting | What it does |
| --- | --- |
| **Movement scheme** | Click to move, or WASD |
| **Dash aim** | WASD only: a dash goes where your keys are held, or to the cursor |
| **Bindings** | Every action, per scheme — one key to one action, conflicts resolved as you make them |
| **Quick cast** | Abilities fire at the cursor on press, rather than press-then-confirm |
| **Show attack range** | The dashed range ring and the attack timer arc |
| **Show unit names** | Name plates above champions. Health bars are never hidden |
| **Edge pan** | Pushing the cursor to the screen edge slides the camera. Off by default |
| **Reduced camera motion** | Stops shake, punch-in and impact kick. Anything you drive stays |
| **Reduced effects** | No shadows, no bloom, no live arena behind the menus |
| **Audio** | Mute, plus master, effects and ambience buses |

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

Four screens: **Practice**, **Progress**, setup, and the patch notes. The last
two live in the corner of the top bar, which leaves a navigation bar with two
words in it.

### Practice

The menu is the whole of the first screen. Four cards, one per part of the
champion; each carries what the mode asks of you, the League habit it builds,
the slice of the bar it hands you drawn as four keys — the ones you do not get
are shown greyed rather than hidden, so the four cards read as four slices of
one champion — and two buttons, PLAY and SURVIVE, each with the record it is
asking you to beat printed under it.

Under the cards is the kit in numbers: the roll's distance and how long it
takes, the bolt count and what the third one does, Condemn's cast time and
knockback, Final Hour, and the passive. It also says which Vayne each mode
hands you and why — one point in Q where the rhythm is the lesson, a maxed E
where the reps are — because a trainer claiming to feel like the champion owes
you the figures it is claiming it with.

There is nothing else on it. No plan to accept, no course to unlock, no
calibration to pass first: your rank arrives from your first three runs, and
until then the chip in the corner says UNRANKED rather than inventing a number.

### Progress

The other screen, and the only one that is a page of content: your rating and
its trend, your weakest axes with what each one is, the mistakes the error log
has actually caught you making, and your history. Anything on it that offers to
fix something starts one of the four modes.

Screens that are pages sit on a darkened plate, so the arena behind them shows
through as depth rather than competing for the same pixels as the text.

## Versions and patch notes

The release history lives in one place — `src/patchnotes/notes.ts`. The client
reads it (the version chip in the top bar, with a mark on it when there is
something you have not read), the build takes its version number off the top of
it, and [`CHANGELOG.md`](CHANGELOG.md) is rendered from it by `npm run
changelog`. Two hand-maintained copies of a release history diverge within one
release; one source and a renderer cannot.

Every entry says what was **added**, what **changed** under you, and what was
**fixed** — in that order, because the middle category is the one that costs a
player their muscle memory and the last is the one that explains why something
they reported is finally behaving. Anything that moves a control, a camera or
the meaning of a score is written down.

Versions before 1.2.0 are assigned retroactively from the commit history: the
project shipped continuously before it started numbering itself.

## Architecture

```
src/engine/     simulation: world, combat, AI, metrics, audio, input, paint
src/engine/vayne.ts   the champion kit: tumble, bolts, condemn, final hour, passive
src/drills/modes.ts   PLAY and SURVIVE, and which drills the menu offers
src/drills/vayne*.ts  the four modes; each owns its rules and its scoring
src/drills/     the wider mechanics catalogue the ratings were built on. Still
                simulated, still tested, not on the menu
src/gfx/        the 3D renderer: scene, terrain, walls, champions, decals, VFX
src/progression/ rating maths, rank ladder, champion path, coach, error log,
                persistence
src/patchnotes/ the release history: the client, the version number and CHANGELOG.md
src/ui/         React shell, HUD, Practice, results, profile, rank-up, settings
tools/          headless test harnesses
docs/           research notes: the out-of-game practice landscape
```

The champion kit lives in `engine` rather than in the drills because all four
modes share it: there is exactly one implementation of what a tumble is, and
the modes only decide what to spawn, which parts of the bar to hand over, at
what rank, and how to score the result.

The run mode is a property of the run rather than of the drill. `Session` owns
the clock, the strike budget and the ramp; a mode reads `liveDifficulty` when
it spawns something and `pressure` when it decides how much to spawn, and
names its own defining mistake by handing the kit's running count of it to
`chargeStrikes`. Nothing else in the client knows the difference between the
two run modes.

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
