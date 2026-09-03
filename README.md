# APEX — MOBA Mechanics Trainer

A browser-based mechanics trainer for MOBA players, built around one idea: the
thing that feels rewarding should be the thing that actually makes you better.

It plays in a real 3D arena — a locked overhead camera, champions with
silhouettes you can read at a glance, and every piece of gameplay information
drawn on the ground where the thing it is about actually is. Thirty-eight
drills — including a nine-module WASD academy and a thirteen-mode APM trainer
with ten explicit levels per mode — a ranked mechanical skill system driven by
measured performance rather than time played, a champion path that teaches one
champion properly, and a results screen designed so you can see exactly what
you did and what it cost you.

It opens on **Today**: one screen that answers what to train, what you are
worst at, what improved, where your champion is, and what to do next — with
today's ten-minute session already built and one click away.

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
| **WASD 01–09** | Nine modules, listed in their own section below | Learning the keys as a scheme rather than a setting |
| **Tumble** | Tumble rhythm, windups thrown away | Q in the backswing — Vayne's whole movement game |
| **Silver Bolts** | Bolt efficiency, stacks dropped | Finishing the third hit instead of switching at two |
| **Condemn** | Wall stun rate, chances missed | Standing on the right side of the wall *before* the fight |
| **Night Hunter** | Kit execution under a live 1v2 | Playing Vayne rather than an ADC who owns her abilities |

The APM trainer's thirteen modes, the WASD academy's nine modules and the
twelve skill tests are each listed in their own section below.

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

## The APM trainer

Thirteen modes over one engine (`src/drills/apm/`), all measured the same way —
**correct commands per minute** — and all played on a ladder of **ten explicit
levels**. It is its own section of the client (`APM` in the nav), because it is
the part of the trainer you open when your hands are the thing you want to work
on rather than your reads, and it is run differently from everything else here.

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

Modes are split the way the drill is built rather than by theme: **isolated**
modes ask one thing of one pair of hands, **combined** modes run two demands at
once and are worth opening once the isolated version of each has stopped being
interesting.

| Mode | Kind | The command it counts | What makes it hard |
| --- | --- | --- | --- |
| **Aim** | isolated | A click on the mark | Nothing but the rate. This is the ceiling on everything else |
| **Aim 2** | combined | A click on the *lowest-numbered* mark | Speed now costs you a read |
| **Aim + Map** | combined | Clicks in the middle, D or F at the rim | Two screens, one pair of hands |
| **Mouse Precision** | isolated | A click through the centre of a small drifting mark | Graded in pixels; the marks shrink as your chain grows |
| **Key Coordination** | isolated | The front key of a rolling queue | No mouse at all, and the window shrinks as you speed up |
| **Dodge** | isolated | A movement order | Charges pull you somewhere, telegraphs push you off it |
| **Dodge + Cooldown** | combined | A movement order, and four cooldowns spent on sight | Both hands, at once, neither allowed to wait |
| **Kiting** | isolated | The attack *and* the step | Holding a full attack cycle without throwing a windup away |
| **Defensive Kiting** | combined | The same pair, running backwards | Every step now has a direction it has to be in |
| **Last Hit** | isolated | An attack order on the right bar | The lane above, with the next wave already walking |
| **Last Hit 2** | combined | The same, contested | An enemy laner taking the same farm, and the HUD keeping score |
| **Spacing** | isolated | A reposition, on the beat | Max range → step in → disengage, and the beat accelerates |
| **Smite** | isolated | One key, in a window you do not control | Three objectives in three places and a rival reaching for the same key |

**Speed alone is not a score.** Every mode routes its inputs through three
verbs — a hit, a fumble, or a stray — and the number the score is built on is
*correct* actions per minute, not raw ones. The lane modes are the clearest
case: they run the same lane the Rhythm drill does, and an attack thrown at a
healthy minion is recorded as a stray, because pushing the wave for free is
precisely an input that meant nothing. Mashing the field raises the rate
on the HUD and leaves the scored rate exactly where it was; the headless suite
asserts it, and a random masher scores 2% where a player scores 100%. Repeating
an order you already gave is not an action either, so a macro cannot inflate
the count.

**The flow tiers are the feel and the read at the same time.** Chained correct
actions climb five tiers — IN RHYTHM, HOT HANDS, BLAZING, TRANSCENDENT — each
worth a bigger multiplier (×1.35 up to ×3.2) and each audibly different: the
confirmation pitch rises with the chain, the arena bed swells, and from the
second tier a metronome appears and accelerates with you. Losing the chain
takes all of it away in one sound. You can tell how a run is going with your
eyes shut, and the score is mostly made of the multiplier, so protecting a
streak matters more than any single input.

**Inside a rung, the drill paces itself to you.** Spawn rates, prompt windows
and target sizes read your current flow rather than a clock, so the mode sits
just past the edge of whatever you are doing at the time. The rung sets how far
past that edge it sits; nothing about it moves between runs.

**Both control schemes count.** Under WASD a movement command is a key going
down and a heading changing rather than a click on the ground, so the movement
modes count those instead — the step out of a backswing scores identically
whichever hand took it, and the key-coordination prompt prints the key your
hand is actually on rather than the slot's name.

Modes that ask you to survive something give you a deep health pool on purpose:
the cost of standing in a telegraph here is your multiplier, not the run.
Ratings from these modes feed a tenth skill axis, **APM**, alongside the nine
the rest of the trainer already measured — the ladder is how you train it, the
rank is what it is worth.

**The section shows the whole ladder at once.** Modes down the left with their
ten rungs compressed into ten pips; the open mode on the right with what it
counts, what makes it hard, the par rate a strong run holds, and every rung
laid out with its stars, its best, its rate and its score. The rung you have
not cleared yet is marked START HERE; the ones above it are visible and locked,
because seeing what is coming is half the reason to draw a ladder. The drill
rail on the home screen shows each mode's current rung instead of a score, and
the results screen says which rung you played, what it did to your record, and
what it opened.

## The WASD academy

Direct control is not clicking with extra steps. It is a different pair of
hands, with a different set of things that are possible and a different set of
things that are expensive — and the whole of its advantage is one sentence:
**where you are going stops deciding where you are looking.**

Nine modules teach that from the four keys upward, each gating the next,
because the dependencies are real rather than pedagogical. You cannot learn to
attack while moving until stopping is reliable; you cannot kite until you know
which stretch of an attack a key is free in; you cannot multitask until each of
the things being tasked runs without being watched.

| Module | It teaches | What it could not measure under a mouse |
| --- | --- | --- |
| **01 · Movement** | Cardinals, diagonals, snap reversals, terrain, and stopping *inside* the node | A held key has no destination in it — the release is the destination |
| **02 · Cursor independence** | Feet one way, cursor the other, for as much of the run as you can hold it | Under a mouse the two are one instruction; here they are two |
| **03 · Strafing** | Across the shooter's line, on no rhythm anything can lead | Direction changes cost a key, so they can be irregular in a way clicking never is |
| **04 · Aim while moving** | Acquire and commit without the pause, measured apart from accuracy | Your aiming hand is not your walking hand, so there is no reason left to stop |
| **05 · Attack cadence** | The four stretches of an attack, and which of them a held key destroys | A key does not only cancel an attack, it prevents one |
| **06 · Kiting** | The full cycle, scored on *when* each command landed | The step out of the backswing is a key — faster and far more repeatable |
| **07 · Offensive kiting** | Following a runner at the outer edge of your range, never a step deeper | You can chase with your feet while the cursor stays pinned to something leaving |
| **08 · Defensive kiting** | Damage dealt from outside their reach; the rest barely counts | Retreating and firing forward are one motion, not two competing clicks |
| **09 · Multitasking** | Feet, attacks, two cooldowns, telegraphs and a moving priority target | Everything above, at once, which is the only state a real fight is in |

**Every module is played on the keys whatever your profile is set to.** A
module about moving one way while aiming the other is not a hard version of
clicking — it is a sentence that does not parse under the click scheme — so the
academy forces the scheme for its own runs and offers the switch for the rest
of the client rather than assuming it.

### The cadence bar

Module 05 is the one everything after it depends on, and it is built around a
single drawing: the attack, laid out over your champion as four stretches of
time.

```
ATTACK START → [ WINDUP ] |release| [ BACKSWING ] [ READY ]
                 red        seam       green        grey
                committed              free        waiting
```

A held key in the red stretch destroys the attack outright and you get nothing
for the time already spent. A fifth of a second later, in the green, the same
key costs exactly nothing — the damage has already gone. Almost every
mechanical mistake an ADC makes is a misunderstanding of that one asymmetry,
and it is invisible in a real game: the attack simply does not happen and you
assume you misclicked.

So the module teaches it in four stages — watch the bar, move only on a cue,
move without one, then hold the whole cycle against something that walks — and
it names out loud which stretch every mistake happened in. Modules 06 to 09
keep the bar on screen.

### What the academy counts

Four measurements are shared by every module, mean the same thing everywhere,
and cannot be moved by an input that did not accomplish anything:

- **movement uptime** — how much of the run your feet were doing anything.
- **hands opposed** — the share of steered time your feet and cursor pointed
  different ways. Structurally zero under a mouse; a player whose two hands
  always agree has bought the scheme and left it in the box.
- **cursor economy** — how far the mouse travelled per thing it actually did.
- **irregularity** — whether the timing of your direction changes is readable.

Each module then adds its own — stop precision, bait rate, acquisition time,
free window used, step delay, trigger held, shots at max range, load carried —
and mastery weights the later modules more heavily with difficulty folded in,
so the number keeps moving for as long as there is a harder version of what you
can already do. The read at the bottom of the section names the single habit
costing you the most, in a sentence, with the module that fixes it attached.

## The Vayne path

The ladder above rates ten general axes and does not care which champion you
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

**It tells you which habit to go and fix.** Four stages produce twenty numbers
between them, and twenty numbers teach nothing. The path screen reads your
*last* run on each stage — deliberately the last rather than the best, because
"what should I work on" is a question about how you are playing now — measures
every habit against the value at which it stops costing you anything, and shows
the one that is furthest off, in a sentence, with the drill that fixes it
attached to a button.

**Mastery is a ceiling, not a total.** Each stage stores your *best* run and
the difficulty you played it at; mastery is the weighted blend of those, so a
worse run never costs you anything and grinding at a level you have already
beaten converges and stops. Titles run from RECRUIT to **THE GREATEST VAYNE**,
which needs every stage at three stars at a difficulty with nothing left to
teach you — and the screen that awards it says plainly that it is a claim
about these drills, not about anybody's ranked ladder.

### Playing her on WASD

Vayne is the champion the two control schemes disagree about, so the trainer
takes a position rather than leaving it to chance.

**Your keys aim the tumble.** Under click-to-move the question never arises:
the cursor is already where you asked to walk, so aiming a dash at it is the
same instruction twice. Under WASD it is a real fork — the mouse is holding
your *target* and the keys are holding your *direction*, and those point
opposite ways at exactly the moment it matters, which is while you are kiting
something. So by default the keys win: Tumble goes where you are holding, and
falls back to the cursor when your hand is off the keys. League's literal
behaviour is one setting away for anyone who wants the transfer to be exact —
**Settings → Dash aim** — and it changes nothing about scoring. The headless
suite runs the same seed both ways: with the cursor parked on the pursuer
throughout, every tumble under `cursor` goes into the fight and every tumble
under `hands` goes out of it.

**You can see where the dash ends.** While Tumble is up, a lane and a landing
ring lie on the floor showing where you would arrive, clipped by whatever
terrain would stop you first. It brightens in the backswing — the window the
whole champion is built on — and disappears the moment the cooldown starts, so
it never becomes furniture.

**The trigger is measured.** Under direct control the champion refuses to
attack while a direction is held, which means WASD has a mistake clicking
cannot make: holding the keys past the moment the shot was ready. Every one of
those seconds is damage a click player would already have dealt, and it is
completely invisible unless something counts it. So the HUD carries a
**TRIGGER** figure — milliseconds of held fire per attack — the floor says
`LET GO` when a hold outlasts a comfortable reaction time, and the results
screen prices it against your attack cycle. A clean release reads under 20ms;
never releasing at all scores zero, and the suite asserts both.

**The coaching knows which hand you are using.** The same lost attack is "you
clicked through the windup" with a mouse and "you never let go of the key" with
a keyboard, and only one of those sentences is any use to the person reading
it. Windups broken by a direction are counted separately from windups broken by
a click, tumbles that closed the gap instead of opening it are counted at all,
and the advice line names the fix that applies to your hands.

**Her kit is on different keys, and the client says so.** W, A, S and D are
spoken for, so the ability row moves one seat over: Condemn is on `R`, Final
Hour on `F`. A champion drill prints the key each ability is *actually* bound
to rather than a generic "abilities" hint, and the path screen carries the
whole row — read from your live bindings, so a rebound layout says what it
really is — alongside the three laws that scheme adds.

## Skill tests

Twelve short instruments that sit beside the drills rather than inside them.

The trainer now asks about your hands three different ways, on purpose. A
**drill** trains a habit over sixty seconds in the arena. The **APM trainer**
measures how much correct work those hands can sustain while the arena keeps
moving. A **test** measures a single event on a bare field with nothing else
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

Every test grades onto the same Iron → Challenger ladder as the drills, so
"Gold reaction, Diamond recall" is a sentence the app can say and mean. Your
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

## The ranked system

**This is a trainer rank.** It measures mechanical execution in these drills. It
is not a prediction of anyone's League ranked tier, and the UI says so wherever
the rank appears.

Ten axes are rated independently — Movement, Aim, Skillshot, Dodging, Kiting,
Spacing, Targeting, Combat, Last Hitting, APM — and blended into an overall
rating on an Iron → Challenger ladder.

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
- **Every APM mode rewards playing it, refuses to reward idling, and reports a
  real actions-per-minute figure.** A bot that clicks at random produces the
  highest raw APM in the suite and scores 2%, against 100% for the same bot
  playing properly — the check that keeps an APM trainer from degenerating into
  a click-speed test.
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

The [WASD academy](#the-wasd-academy) runs on this scheme whatever your profile
is set to, so the course is available before you commit to the switch — and the
switch itself is one button at the top of that section, and reversible.

**Dash aim** is a WASD-only setting, and Vayne's Tumble is the ability it
decides: *the keys* (default — the dash goes where you are holding, and to the
cursor when nothing is held) or *the cursor* (League's literal behaviour). See
[Playing her on WASD](#playing-her-on-wasd).

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

### Today

The home screen has one job: answer the five questions a player actually
arrives with, in the order they arrive in, and then get out of the way.

| | |
| --- | --- |
| What should I train today? | The session, built and sitting there |
| What am I currently bad at? | Named, with the gap in rating and what it costs |
| What improved recently? | The personal bests of the last week, and by how much |
| What champion am I training? | Where the path is, and what is next on it |
| What should I do next? | The button. One click, no choosing |

**The session is a run, not a list of buttons.** Five or six pieces, ten to
twenty minutes, in the order a coach would use: warm the hands, take the next
thing you are learning, attack the thing you are worst at, keep the champion
moving, then put it together against something that fights back. Every piece
says why it is there — *"Last Hitting — 580 rating behind your overall"*, *"32%
best, 56% to clear"* — because a plan you cannot argue with is a plan you will
not follow. It is rebuilt after every run, so finishing a piece changes what
the rest of it says, and any piece can also be run on its own.

The rest of the screen is facts rather than decisions: your rating and its
seven-day trend, your three weakest axes with what each one is, what got
better, the academy and the champion path with their next step one click away,
and a summary of your last sitting — including the drill that went worst, so
you can start the next one with it.

**The streak is deliberately quiet.** Fourteen days, one mark each, drawn as a
record of what happened rather than as something you can lose — and the screen
says so: *missing a day costs you nothing and takes nothing away.* A streak
that punishes you for a day off is a retention mechanic wearing a training
tool's clothes, and it makes people play tired, which is worse than not
playing.

### The catalogue

The full drill browser is a tab away, and it is not a page either. There is no
scrolling column of cards: a list down the left, the chosen drill standing in
the live arena down the middle, your record down the right, and one large
button along the bottom. The empty middle third is the point — the interface is
a frame around a place rather than a surface covering one, and the arena behind
it is the same terrain, lighting and champions you are about to play in,
rendered live.

Screens that are genuinely pages of content — Today, the academy, the daily
programme, your profile, settings — sit on a darkened plate instead, so the
arena shows through as depth rather than competing for the same pixels as the
text.

## Architecture

```
src/engine/     simulation: world, combat, AI, metrics, audio, input, paint
src/engine/vayne.ts   the champion kit: tumble, bolts, condemn, final hour
src/gfx/        the 3D renderer: scene, terrain, walls, champions, decals, VFX
src/drills/     one file per drill; each owns its rules and its scoring
src/drills/apm/ the APM trainer: one engine, thirteen modes over it
src/drills/wasd/ the WASD academy: one engine, nine modules over it
src/tests/      the twelve skill tests: one runner interface, one drawing kit
src/progression/ rating maths, rank ladder, champion path, APM ladder, WASD course,
                today's session planner, persistence
src/ui/         React shell, HUD, Today, results, profile, rank-up, Vayne, academy,
                tests, APM ladder
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
