# APEX — MOBA Mechanics Trainer

A browser-based mechanics trainer for MOBA players, built around one idea: the
thing that feels rewarding should be the thing that actually makes you better.

It plays in a real 3D arena — a locked overhead camera, champions with
silhouettes you can read at a glance, and every piece of gameplay information
drawn on the ground where the thing it is about actually is. Twenty-nine
drills — including a thirteen-bench APM lab with ten explicit levels per
mode — a ranked mechanical skill system driven by measured performance rather
than time played, a champion path that teaches one champion properly, and a
results screen designed so you can see exactly what you did and what it cost
you.

Every screen is built to answer five questions: how good am I, what am I
currently bad at, why, what should I train next, and am I actually improving.
The trainer names your mistakes rather than only scoring them, plans a session
around the one that is costing you most, and shows you the habit disappearing
week by week. Where a number has not been measured yet, it says so and offers
the run that would measure it — nothing on any screen is estimated, inferred
from nothing, or invented for flavour.

You pick a champion before you train. Seven of them, each a different
silhouette, and none of them stronger than another — the choice reaches the
renderer and stops there, so a rating earned behind one is worth exactly a
rating earned behind another. It is the first thing you do on a new profile and
it is changeable forever after from a settings screen you can search.

It can be driven either way: League's click-to-move, or WASD. Both obey the
same windup law, so a run scores identically under either — and the champion
path knows which hand you are using, because the mistakes are not the same
ones.

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

The APM lab's thirteen benches are listed in their own section below, and the
twelve skill tests in theirs.

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

## The APM lab

Thirteen benches over one engine (`src/drills/apm/`), all measured the same way
— **correct commands per minute** — and all played on a ladder of **ten
explicit levels**. It is its own section of the client (`APM` in the nav)
because it is run differently from everything else here, and because it is
deliberately *not the game*.

### Why it left the Rift

The APM trainer used to be the game with a stopwatch on it: a lane to farm,
camps to smite, a duelist to kite. That taught the game a second time and
measured hands only incidentally — every mode carried minions, health bars,
range checks and pathing, and every one of those is noise in a measurement of
whether your fingers went down at the right moment.

So the section moved out. There is no champion to fight, nothing to kill and
nowhere to be: a bench of pads, gates, wheels and clocks, hit-tested as
geometry rather than spawned as units, with the body that the simulation needs
hidden outright in every mode but one. What is left in the measurement is the
thing the section is named after — **pressing**. How fast two fingers trade
off. How far apart your hands are when they think they are simultaneous. How
early you can commit to a window that has not opened. What it costs you to move
your hand from one bank of keys to another.

Distance from the game is the point; applicability is bought back a different
way. Every bench names the moment it is a slice of, and the transfer is stated
rather than simulated: a gate that eats an early press is the cast you buffer
into, a barred pad you have to leave alone is the cooldown you do not spend on
a bait, a hand change measured in milliseconds is the summoner key mid-combo.
The lab never shows you the moment. It drills the press the moment is made of.

### A level is a difficulty, not a suggestion

Every other drill hides its difficulty: an axis carries a number, the number
moves after each run, and you are never asked what you want to play at. That is
right for a ladder — it holds you where a rating is measurable — and wrong for
hand speed, where the activity *is* picking a rung and staying on it until it
is easy.

So the APM section inverts it. Ten rungs per mode, from difficulty 8 to 98,
each with its own record: your best performance, your best *correct* rate, and
your best score at standard length. Nothing adapts behind your back, so this
run and the last one on that rung are comparable — which is the only way a rate
record means anything.

- **Clearing a rung opens the next.** 60% clears; 74% and 88% are the second
  and third stars. Take a rung outright at 88% and it opens *two*, because
  making somebody grind a level they have just three-starred is exactly the
  busywork an explicit ladder exists to remove.
- **Calibration decides where the ladder starts.** A placement is a general
  mechanical reading, so it opens up to six rungs on every mode — nothing is
  awarded, the records stay empty; you simply do not walk up to the interesting
  part one run at a time.
- **A worse run takes nothing away.** Records are ceilings. A bad run on a rung
  you have already taken counts as a run, still feeds the general rating, and
  leaves the ladder where it was.
- **Mastery weights the top.** Three stars on level 10 is worth ten times three
  stars on level 1, so the number keeps moving for exactly as long as there is
  a harder rung left. Titles run UNMEASURED → **INHUMAN**.
- **Endurance is the custom run.** A double-length run of any rung. It can set
  a rate record — a rate is a rate — and never a score record, because a longer
  run scores more by construction.

Benches are split the way the drill is built rather than by theme: **isolated**
benches ask one thing of one pair of hands, **combined** benches run two demands
at once and are worth opening once the isolated version of each has stopped
being interesting.

| Bench | Kind | What it isolates | Why it is hard | What it is a slice of |
| --- | --- | --- | --- | --- |
| **Pulse** | isolated | Cadence, with one bit of choice | The light repeats about a third of the time, so a hand on autopilot answers the wrong pad | The trill under a combo: two abilities, two fingers, nothing travelling |
| **Sequence** | isolated | Ordered recall | Six keys roll, only the front one is legal, and the window shrinks as you speed up | A long combo arriving in order when you are not thinking about it |
| **Chord** | isolated | Simultaneity | Both keys inside a tolerance that closes to under 50ms; a split pair scores nothing | Flash plus an ability — the pairs that only work on one frame |
| **Go / No-Go** | isolated | Inhibition | Barred pads want *nothing*, and pressing one costs the chain | The cooldown you do not spend on a bait |
| **Buffer** | isolated | Anticipation | Be pressing before the window opens: early is eaten, late is only reacting | Queueing the next cast into the tail of the current one |
| **Cancel** | isolated | The second half of a pair | The cut has to land after the commit and before the tail ends, in a tenth of a second | Cutting a backswing the instant it is free |
| **Vector** | isolated | The movement command | A heading, on call, held long enough to mean it — nothing to dodge, nowhere to be | One aimed reposition instead of two corrections |
| **Field** | isolated | Cursor placement | Graded in units from the centre, and the pads shrink as you chain | The ceiling on every command that starts with the cursor being somewhere |
| **Handoff** | combined | The seam between your hands | Click, key, click, key — never twice in a row | Cast, then reposition: the pair that overlaps rather than queues |
| **Split** | combined | Divided attention | A centre queue that never stops and rim alerts on their own keys | Answering the minimap without the combo falling apart |
| **Upkeep** | combined | Self-paced pressing | Four clocks that do not divide into each other, nothing prompting you, and one of them locked | Never sitting on a cooldown because your attention was elsewhere |
| **Switch** | combined | The cost of a hand change | The prompt keeps moving between near bank, far bank and mouse | The summoner key mid-combo — a different hand shape, and the shape is the cost |
| **Sustain** | combined | The rate you can be *held* to | The beat accelerates every twelve seconds; two dropped inside one step ends the run | Minute three of a fight rather than second three of one |

**Speed alone is not a score.** Every bench routes its inputs through four
verbs — a hit, a **hold**, a fumble, or a stray — and the number the score is
built on is *correct* actions per minute, not raw ones. Mashing raises the rate
on the HUD and leaves the scored rate exactly where it was; the headless suite
asserts it, and a random masher scores under 5% where a bot playing properly
scores 100%. Repeating an order you already gave is not an action either, so a
macro cannot inflate the count.

**Restraint is paid for, and is not a rate.** `hold()` is the verb the lab
added, and it exists because a mode about withholding cannot pay for it with a
hit: that would put a number in "correct actions per minute" that no finger
produced. So a barred pad ridden out pays score, protects the chain, counts
towards how much of what was asked you answered — and moves the rate not one
action. In Go / No-Go a player who presses everything is very fast and scores
close to nothing, which is the correct outcome rather than a punishment.

**The flow tiers are the feel and the read at the same time.** Chained correct
actions climb five tiers — IN RHYTHM, HOT HANDS, BLAZING, TRANSCENDENT — each
worth a bigger multiplier (×1.35 up to ×3.2) and each audibly different: the
confirmation pitch rises with the chain, the bed swells, and from the second
tier a metronome appears and accelerates with you. Losing the chain takes all
of it away in one sound. You can tell how a run is going with your eyes shut,
and the score is mostly made of the multiplier, so protecting a streak matters
more than any single input.

**Inside a rung, the bench paces itself to you.** Prompt windows, tolerances,
pad sizes and clock rates read your current flow rather than a wall clock, so
the mode sits just past the edge of whatever you are doing at the time. The
rung sets how far past that edge it sits; nothing about it moves between runs.

**Both control schemes count.** The prompts print the key your hand is actually
on, read from your live bindings, and Vector — the one bench with a body to
steer — is judged on the heading a command sends you along, whether that
command was a click on the ground or a key going down. A WASD command deferred
by the engine's rate limit is now counted late rather than dropped, which it
previously was.

**Every bench can say what correct play is.** Each one implements a `solution()`
that names the keys, the click or the heading a perfect player would produce
this instant — including the modes where the answer is *nothing*. The headless
suite plays all thirteen through that one interface at a human-capped cadence,
so a new bench is covered the moment it exists, and a bench that cannot state
what correct play is does not ship.

Ratings from these benches feed a tenth skill axis, **APM**, alongside the nine
the rest of the trainer already measured — the ladder is how you train it, the
rank is what it is worth.

**The section shows the whole ladder at once.** Benches down the left with
their ten rungs compressed into ten pips; the open one on the right with what
it counts, what makes it hard, the par rate a strong run holds, and every rung
laid out with its stars, its best, its rate and its score. The rung you have not
cleared yet is marked START HERE; the ones above it are visible and locked,
because seeing what is coming is half the reason to draw a ladder. The drill
rail on the home screen shows each bench's current rung instead of a score, and
the results screen says which rung you played, what it did to your record, and
what it opened.

## Skill tests

Twelve short instruments that sit beside the drills rather than inside them.

The trainer now asks about your hands three different ways, on purpose. A
**drill** trains a habit over sixty seconds in the arena. The **APM lab**
measures the press itself with the game taken away — how much correct work your
hands sustain on a bare bench. A **test** measures a single event on a bare field with nothing else
happening — twenty to sixty seconds, one number, nowhere to hide. Reaction,
prediction, recall and arithmetic under a closing window: the parts of the game
nobody practises because nobody measures them.

| Test | Measures | Why it matters in a game |
| --- | --- | --- |
| **Flash Reaction** | Simple visual reaction, median ms | Burning Flash on a hook you only just saw |
| **Sound Cue** | Auditory reaction with decoys | Recognising an ultimate by its audio and moving before it renders |
| **Cast Reflex** | Choice reaction across Q/W/E/R/D/F | Casting the ability you meant, not the one next to it |
| **Dodge Read** | Spatial choice reaction, correct axis | Sidestepping *across* a skillshot instead of running down its line |
| **Flick** | Target acquisition, median ms | Right-clicking the champion rather than the minion beside them |
| **Prediction** | Skillshot hit rate against travel time | Leading a moving target instead of aiming at where they are |
| **Last Hit Clock** | Attack timing error against your own windup | CS under pressure, reading a falling bar against your animation |
| **Tracking** | Percentage of time the cursor holds a juking target | Keeping the cursor where your next command has to go |
| **Map Recall** | Positional recall from a shrinking glance | The minimap glance — you photograph it and play off the photograph |
| **Cooldown Tracker** | Correct up/down calls with nothing counting down | Knowing their Flash is down for forty more seconds |
| **Execute Check** | Kill/no-kill calls inside a closing window | The all-in decision, before the window shuts |
| **Combo Memory** | Sequence execution time, broken combos scored as broken | Casting your combo while your eyes are on the fight |

Every test grades onto the same Foundation → Apex ladder as the drills, so
"Calibrated reaction, Expert recall" is a sentence the app can say and mean. Your
**benchmark** is the mean of your best grade across the tests you have actually
attempted — a test you have never run reads as absent, not as zero, and the
page says how many are in the number.

**Tests do not move your drill rating.** A twenty-second reaction instrument
should not be able to promote you on a ladder that measures playing — not the
nine mechanical axes, and not the APM axis either — so they keep their own
bests, their own grades and their own trend lines. Each test
records every attempt, shows the shape of the run trial by trial, and tells you
the value you would need to reach the next tier in the test's own unit.

A few design rules hold across all twelve:

- **Anticipating is not reacting.** A key pressed before the cue is a false
  start; it costs the trial and is added back onto your score.
- **Nothing that leaks the cue.** Sound Cue's screen is identical before and
  after the sound fires, because the moment it is not, it stops being an ear
  test.
- **Windows shrink through a run.** Dodge Read, Last Hit Clock, Execute Check
  and Map Recall all tighten as they go, so the last trials are the ones worth
  reading.
- **Failure is scored as failure.** A dropped combo enters the median at the
  bottom of the ladder rather than being quietly discarded, so one lucky fast
  round cannot outrank eight dead ones.

## Champion select

The first thing a new player does here, before calibration and before anything
is measured: pick the body they train in. Seven champions, each one a different
silhouette from the same procedural rig — sword and helm, hammer, longbow,
staff and crown, twin daggers, greatsword and horns, and the Night Hunter the
Vayne path spawns. The one you pick stands turning on the select screen at full
height, animated by the same code that will draw it in the arena, running the
same windup and backswing poses.

| Champion | Role | Silhouette |
| --- | --- | --- |
| **Sentinel** | Fighter | Upright, caped, one-handed blade |
| **Warden** | Vanguard | Broad, low, two-handed hammer |
| **Huntress** | Marksman | Lean, hooded, longbow |
| **Arcanist** | Mage | Tall, crowned, staff held high |
| **Revenant** | Assassin | Compact, uncovered, paired daggers |
| **Berserker** | Juggernaut | Horned, massive, two-handed greatsword |
| **Night Hunter** | Marksman | Lean, hooded, cloaked, crossbow |

**No champion here is stronger than another, and that is deliberate.** Every one
of them moves at the same speed, attacks on the same windup, has the same range
and takes the same damage — the choice reaches the renderer and stops there.
Anything else would make a rating earned behind one champion incomparable with
a rating earned behind another, and the ladder exists to measure your hands.
The Vayne path is the single exception, and it overrides in the other
direction: those drills are about one champion with her own numbers, so they
always spawn her whatever the roster says.

The choice is never locked and never earned. It is changeable forever after
from **Settings → Champion**, which renders the same screen, and the champion
you are playing sits in the top bar of the client with a click to change it.

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

**Dash aim** is a WASD-only setting, and Vayne's Tumble is the ability it
decides: *the keys* (default — the dash goes where you are holding, and to the
cursor when nothing is held) or *the cursor* (League's literal behaviour). See
[Playing her on WASD](#playing-her-on-wasd).

All bindings are remappable in Settings, along with quick cast, and each scheme
keeps its own rebinds so switching never breaks a layout you tuned. In drills
with no ultimate bound, `R` also acts as instant reset.

## Settings

One subject on screen at a time, listed down the left in the order a player
meets them — **Champion**, **Movement**, **Controls**, **Gameplay**, **Camera &
video**, **Audio** — rather than every control in the app in three tall columns,
which is how the previous version managed to make a volume slider and a keybind
list neighbours.

The whole screen is built from a registry rather than from markup, and three
things fall out of that:

- **Search.** Type anything (or press `/` from anywhere on the page) and the
  sections collapse into a flat list of matching controls. Each result is the
  real, fully operable control — not a link to it — still labelled with the
  section it came from, so nobody has to remember whether "shake" is a video
  setting or a gameplay one. It matches labels, explanations, option text,
  binding names and champion names.
- **Changed-from-default marks.** Every row knows its own default, so a changed
  setting carries a dot, a section carries one in the nav when anything inside
  it has moved, and both a single section and the entire screen can be put back
  exactly as they shipped.
- **Honest scope.** Each row says what it does *and* what it does not: the
  camera and video controls state outright that they never touch the
  simulation, so scores stay comparable across machines.

| Setting | What it does |
| --- | --- |
| **Champion** | The body you train in. Look only — see [Champion select](#champion-select) |
| **Movement scheme** | Click to move, or WASD |
| **Dash aim** | WASD only: a dash goes where your keys are held, or to the cursor |
| **Bindings** | Every action, per scheme — the two never collide |
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

Six screens, in the order the questions get asked:

| Screen | What it is for |
| --- | --- |
| **Today** | The session, planned for you, and one button that starts it |
| **Train** | Every drill, the live arena, and the one you have chosen |
| **Champion** | One champion, learned in order, with where she stands |
| **Test** | Twelve standardised instruments, no coaching, no assistance |
| **Progress** | The analysis: shape, pressure, mistakes, trend |
| **Records** | Every personal best, what it beat, and when |

Setup and the patch notes live in the top bar; the APM lab is reached from the
drill rail that owns it. `Ctrl`/`⌘`+`K` opens a search over all of it.

**Train** is not a page. There is no scrolling column of cards: a list down the
left, the chosen drill standing in the live arena down the middle, your record
down the right, and one large button along the bottom. The empty middle third
is the point — the interface is a frame around a place rather than a surface
covering one, and the arena behind it is the same terrain, lighting and
champions you are about to play in, rendered live.

Screens that are genuinely pages of content sit on a darkened plate instead, so
the arena shows through as depth rather than competing for the same pixels as
the text.

### Focus mode

`F2` inside a run, or a setting for the default, strips the HUD to the clock,
the current task, your health and the score. The live figures, the difficulty
read-out and the frame counter are things to read *after* a run; focus mode is
the training room, and everything analytical waits for the results screen.

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
src/engine/vayne.ts   the champion kit: tumble, bolts, condemn, final hour
src/engine/heroes.ts  the playable roster: one silhouette per champion, look only
src/gfx/        the 3D renderer: scene, terrain, walls, champions, decals, VFX
src/drills/     one file per drill; each owns its rules and its scoring
src/drills/apm/ the APM lab: one engine and one bench, thirteen modes over them
src/tests/      the twelve skill tests: one runner interface, one drawing kit
src/progression/ rating maths, rank ladder, champion path, APM ladder, persistence
src/progression/errors.ts  the error taxonomy and its detection thresholds
src/progression/coach.ts   retention, plateaus, insights, recommendations
src/progression/plan.ts    the daily session planner
src/patchnotes/ the release history: the client, the version number and CHANGELOG.md
src/ui/         React shell, HUD, today, results, replay, progress, records
src/ui/HeroSelect.tsx champion select: the first run, and the Champion tab in settings
tools/          headless test harnesses
docs/           research notes: the out-of-game practice landscape
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

A test is a class with an `update(frame)` and nothing else — no React, no
simulation, no renderer. The shell in `src/ui/TestRun.tsx` owns the countdown,
the canvas and its device-pixel scaling, the input plumbing and the results
card, so adding a thirteenth test means writing one class and one catalogue
entry. The twelve live card previews in the gallery share a single animation
frame between them.

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
