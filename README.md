# APEX — MOBA Mechanics Trainer

A browser-based MOBA mechanics trainer, built around one idea: the thing that
feels rewarding should be the thing that actually makes you better. Three
champions, chosen because they ask different questions — Vayne grades a
*distance* from perfect on everything she does, Twisted Fate grades a *choice*
you either made in time or did not, and Katarina grades a *place* you either
reached before the dagger did or did not.

It plays in a real 3D arena — a locked overhead camera, champions with
silhouettes you can read at a glance, and every piece of gameplay information
drawn on the ground where the thing it is about actually is.

The client is two places to play and one place to read about it. **PRACTICE**
is the champions, in three sections behind one rail. The first is **THE LANE**:
the first ten minutes of a game of League, at League's own numbers, against an
enemy laner farming and trading on the other side of the wave. You pick the
opponent and the length; everything else is the game. The second is
**PRACTICE** — the parts of that lane, rehearsed one at a time, behind a switch
between the three champions: one distance, four pieces of Vayne and the opponent
who shoots at her; nine stages of Twisted Fate's wheel; and nine stages of
Katarina's daggers.
Each mode has two ways to play it:

- **PLAY** — one minute. The same minute every time, so a score means something
  next to the one before it.
- **SURVIVE** — no clock. It ramps as you last, and it ends when you die or
  when you have made that mode's own mistake three times. The result is how
  long you lasted.

The third is **THE CODEX** — every figure all three champions are built from,
printed, so a claim about transfer is one you can check.

**THE LAB** is the other section in the top bar, and it is not a champion at
all: thirteen benches of drifting pads, ten levels each, measuring correct
commands a minute and nothing else. It is separate because it is the layer
underneath every champion there will ever be. Every level of every bench is
open to everybody from their first run — the ladder suggests and never gates —
and a level is one unchanging thing: one speed, one palette and one roster of
keys, held for the whole minute, so two scores at level six are two scores of
the same thing and the only ways to beat one are to be faster, cleaner and more
precise. A rung is a roster as well as a pace: level one is two fingers, and
each rung after it hands over another piece of your layout — the rest of the
ability row, then the summoner bank and the board in the corner at four, then
the three orders that are not abilities at all — so that by level seven every
command the bench can grade is being asked for. The floor that used to move
with your streak has a mode of its own, **SURGE**, where moving it is the
point.

**STUDY** is the fourth tab, and the only one that asks nothing of your
hands. It is every champion in League — all of them, straight from Riot's
Data Dragon — as the things League never prints where you can see them
mid-game: what each passive does, what each ability does, how long it is down
once you have watched it go, how far it reaches, and Riot's own tips for
playing against them. It asks until you know them. A fact you miss comes back
a few questions later; a fact you know waits a day, then three, then a week,
then longer. Behind the quiz is the reference: every champion's card, so a
question you got wrong can be looked up instead of guessed at again.

**WARM UP** is the first tab, and the one a returning player opens on. It is
one button: ten minutes, built fresh each day out of your own mistakes, ending
on one sentence to take into your next ranked game. It shares the screen with
the four reaction tests, the benchmark sheet and a box for pasting a scenario
code — the measurements the routine is built on. It is a button rather than a
plan: nothing in the client waits on it, and skipping it costs nothing but the
streak.

That is the whole menu. There is no calibration to sit through and no course
to unlock — the ladder places you from your first three runs, and every mode with a champion in it puts you behind the same one,
because the quarter of a second at the end of a tumble is not a thing you can
practise in the abstract. The roster in Settings is a silhouette and nothing else: not one
number in the simulation moves behind any of the ten bodies on it.

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

The title card is six of them, one cast at random per launch and never the
same one twice running, over an identity that never moves. The bar under it
measures the arena reporting real milestones rather than a timer, keeps
creeping when one of them takes longer than expected, and is drawn by handing
the compositor a target a second ahead — so it carries on moving through the
main-thread stalls that building an arena causes, which is the one moment a
frozen bar reads as a crash. Press anything while it is still loading and the
client opens the instant it is ready, without asking again.

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

One lane, and twenty-four modes made out of the pieces of it — six on Vayne,
nine on Twisted Fate and nine on Katarina, with the distance all three of them
assume at the top of each list.

The three champions are not three flavours of the same trainer, and that is the
reason there are three. Everything Vayne asks is *analogue*: the roll a little
early, the wall a little off the angle, the third bolt a little stale, and
every one of her modes grades one of those distances. Everything Twisted Fate
asks is *discrete*: Pick a Card is showing exactly one of three faces at any
instant, you take the one you needed or you do not, and the price of not is
counted in whole revolutions of a wheel that turns at two cards a second
whether or not you have decided. There is nowhere in that for a bad habit to
hide, which is what makes it the sharpest thing here to practise and the one
thing none of her six can teach. And everything Katarina asks is *in the
future*: a dagger thrown now lands a second from now somewhere else, lies there
for four seconds, and is worth nothing unless you are standing on it — with
somebody inside the slash — when it does. Neither of the others can ask where
you are going to be.

### Lane phase

**LANE PHASE** is the job rather than a piece of it, and it is the mode the
rest of the client exists to feed. Minions leave the base at 0:30 (patch
26.1 moved it from 1:05), so a lane opens at 0:55 with the first wave meeting,
waves arrive every thirty seconds with a cannon on every third, and you play it
end to end against an enemy laner doing exactly what you are doing.

Every number in it is League's, at patch **26.18**, because the whole of laning
is arithmetic and arithmetic against invented numbers transfers to nothing:

| | Health | Gold | Experience | Bonus into minions |
| --- | --- | --- | --- | --- |
| **Melee minion** | 430 | 20 | 62 | 2% of current health |
| **Caster minion** | 284 | 14 | 31 | 3.5% |
| **Cannon minion** (every third wave) | 920 | 50 | 75 | 5% |

Read the experience column against the level curve — 280 for level two, a
hundred more for each level after — and the facts every solo laner plays around
fall straight out: a full first wave is 279, one short, so level two arrives on
the seventh minion, and level three on the fourteenth — the second melee of the
third wave, the one the cannon rides in with. Experience is shared to 1,500
units. The outer turret reaches 775 units, hits a minion for 152 — a caster
dies to two shots, a melee to three — and ramps fifty per cent a shot into a
champion, to 250%, which is what puts a clock on a dive.

None of those figures is typed into the simulation. They live once, in
`src/engine/patch.ts`, each with its source and a confidence label, and the
lane imports them from there — which is also what the **accuracy report** in
CHARACTER prints, row by row, including the ones no current source publishes
(the turret's shot into a minion and the camera's geometry among them). See
[The accuracy report](#the-accuracy-report).

Both champions start at level one on base statistics, grow off League's own
curve, and take a point every time the wave pays for one. Two resources exist
here and nowhere else in the client, because both of them shape the first ten
minutes and neither belongs in a sixty-second rep:

- **Mana.** 232 growing 35 a level, regenerating about 1.4 a second. Condemn
  costs 90 of it. It is also what stops the Peacemaker opposite from being a
  Peacemaker every ten seconds all lane — an opponent who opens with four of
  them has nothing left at level six.
- **Health that does not come back.** League's regeneration is about one a
  second, so being chipped is a state you have to answer. **F** recalls: eight
  seconds of standing still, broken by a step or a hit, for a full bar and
  every minion that died while you were gone. A death is a respawn timer and a
  walk back, on League's own table, not the end of the run.

Five opponents, and the difference between them is **entirely behavioural** —
not one of them has a point more health or damage than any other:

| Tier | Farms | What it does |
| --- | --- | --- |
| **Iron** | 3.4 CS/min | Sees the minion late, swings at healthy ones, shoves its own wave into your turret |
| **Silver** | 5.2 | Farms most of what it can reach, occasionally notices you walking up |
| **Gold** | 6.8 | Takes its farm, punishes the last hits you telegraph, stops walking into your wave to do it |
| **Diamond** | 8.4 | Near-perfect farm, holds the wave on its own side, spends the Peacemaker on targets that cannot dodge it |
| **Challenger** | 10.2 | Misses nothing, punishes everything, freezes you off the wave, counts lethal, and dives you when it is right |

The thing that actually separates them is one number: how much of the damage
already in the air they count when deciding to attack. A laner with no
foresight fires when the bar is *already* under their damage and is therefore
always half a second late; one with full foresight fires when the bar *will
be*, and takes the minion every time. It is the same arithmetic the mode draws
on the health bar for you at the lower tiers — the bot is not doing anything a
person cannot, it is doing the thing the plate is teaching.

Three lengths: 2:30 for five waves and a cannon, 5:30 to get through level six,
9:00 for the whole first ten minutes. The results screen leads with creep score
a minute against what that opponent farms, then the differences — creep score,
gold, level — because a lane is a comparison rather than a solo run, and it
names missed farm by cause: too late, too early, or given to your own turret.
Records are kept per opponent, because a creep score against Iron and one
against Challenger are not the same number measured twice.

What is deliberately *not* modelled, and stated rather than hidden: there is no
shop, so gold is the scoreboard rather than a purchase; there is no jungler, so
nobody walks out of the river; and resistances are folded into the health pools
rather than simulated, because both champions in this lane deal physical damage
and one multiplication is exact where two systems would be theatre.

### The pieces

| Mode | Keys | Measures | The habit it builds |
| --- | --- | --- | --- |
| **Range** | — | Units between where you fired and where your edge actually was | Knowing where your reach ends when nothing is drawing it |
| **Tumble** | Q D F | Tumble rhythm, windups thrown away, where the roll put you | Q in the backswing — Vayne's whole movement game |
| **Silver Bolts** | Q W D F | Bolt efficiency, stacks dropped | Finishing the third hit instead of switching at two |
| **Condemn** | Q E D F | Wall stun rate, angles you made rather than found | Standing on the right side of the wall *before* the fight |
| **Night Hunter** | Q W E R D F | Kit execution, vision held and wards placed, against a floor that refills | Playing Vayne rather than an ADC who owns her abilities — in the dark |
| **Sheriff** | Q W E R D F | Peacemaker dodge rate, traps stepped in, ultimates broken on terrain | Reading a whole champion while spending a whole champion |
| **1 v 1 / 1 v 2 / 1 v 3** | Q W E R D F | Combat score, health kept, orbwalk efficiency, target priority | Everything at once, with everything: kiting and spacing while a kit is being spent |

**LAST HIT** still exists underneath the lane and is unchanged: a ninety second
drill about one gesture, with health totals scaled so that a caster is a
one-attack last hit off a turret shot. Its smaller numbers are the right
numbers for a mode about the gesture; the lane keeps League's. Both are built
on one wave engine with two rulesets rather than one set of compromises.

**D and F are the summoners**, and they are on every mode that fields a
champion because neither of them is part of one: not levelled, not hers, and on
the same key at level one as at eighteen.

D is the trinket. A ward throws 600 units, *over* terrain rather than into it —
which is both League and the whole point of the item, since the eye you want is
nearly always on ground you cannot walk to. What a wall still decides is that
nothing comes to rest inside one, so a throw aimed at the middle of a block
settles against its nearest face. It lights 1100 around itself for eight
seconds and comes back every twelve, two out at a time. Both clocks are far
shorter than League's on purpose — holding a piece of the map for two minutes
is a macro skill, and what a sixty second rep can build is the habit of
spending vision on the ground the next ten seconds happen on. Night Hunter is
the mode with a fog for it to lift, and it counts them.

F is Flash: 400 units toward the cursor, instantly, straight through terrain,
and it costs the attack you were already winding up. It comes back every five
seconds rather than League's three hundred, and the reason is the same one the
rest of this section keeps making. Five minutes of cooldown is a decision about
the next five minutes of a game, which is macro; the gesture underneath it —
which wall is thin enough, and pressing it at all rather than dying with it up
— is a mechanic, and a mechanic needs a dozen attempts a minute rather than
one. The lane is the exception and keeps F for the recall, because a ten minute
mode's most important decision is backing.

Two of Vayne's own cooldowns are shortened, and both for the same reason: the
thing worth rehearsing is the *pair*. Rolling to the side of somebody the wall
is behind and then pinning them to it needs two abilities up at once, which is
a far rarer event than either of them being up. So Condemn charges 30% of
League's figure everywhere — a maxed E is 3.6 seconds rather than twelve — and
Tumble is floored at one roughly every three seconds wherever League's own
figure is slower than that, which takes a single point from six seconds to 3.7
and leaves the mid-game champion the fighting modes field exactly where League
leaves her. Rank still shapes both, and the practice screen prints League's
number next to the trainer's.

### The card path

Nine stages, each gated on the one before it, and every one of them is Pick a
Card with one more thing taken away.

| Stage | Keys | Measures | The habit it builds |
| --- | --- | --- | --- |
| **Pick a Card** | W F | Card-slots burned per lock, and whether it was the card asked for | Arriving at an appointment rather than waiting for one |
| **Gold Card** | W F | Gold cards that reached a champion | The walk that has to carry the card to somebody who minds |
| **Wild Cards** | Q F | Cards connecting per cast, casts that went through two or more | Reading a skillshot as a line through a crowd, not a point on a body |
| **Stacked Deck** | Q F | Fourth attacks that landed on the marked champion rather than a minion | Counting to four without looking |
| **Loaded** | W F | Approaches entered with gold already on your hand | Locking before the fight rather than inside it |
| **Cold Deck** | Q W F | The same wheel, with zones landing on your feet | Choosing while being shot at, which is the only condition anybody chooses in |
| **The Set-up** | Q W F | Stuns followed up with a fan *and* an attack inside the window | Finishing the sentence a gold card starts |
| **Gate** | Q W R F | Gates that arrived on the mark, channels broken | Starting the ultimate on the telegraph rather than on the window |
| **The Table** | Q W E R F | All of it, against a hunter, a duelist and a wave | Playing Twisted Fate rather than owning his abilities |

**The number the path leads with is not accuracy.** The wheel starts on blue
and turns at half a second a card, in the same order forever, so gold is always
exactly two slots away the first time it comes round. Every extra three slots
is a whole revolution — a second and a half of standing in front of somebody
deciding — and that is what WHEEL WASTE counts. A player who takes the card the
first time it appears reads 0.0 on every run they ever play; a player who lets
it come round again reads 3.0, and the gap between their scores is the only
thing the path is really measuring.

His numbers are League's, and two of them are League's *maxed* rather than
League's at rank one, for the reason the rest of this README keeps giving. Wild
Cards and Pick a Card both come down to four seconds as they are levelled, and
every Twisted Fate has them there long before the wheel is deciding his fights
— so four is the figure the champion is actually played on, and it is also what
lets one fan arrive with every card, which is what the set-up is made of. The
ultimate is the one genuine discount: League charges Destiny in minutes because
the reveal is a macro tool and no sixty-second rep can teach one, so it is
twenty-two seconds here. Everything else is untouched: the half-second a card
lasts, the six-second window before the wheel gives up, the twenty-eight
degrees the fan spreads across 1450 units, the second and a half a gold card
buys, the four that Stacked Deck counts to, and the three seconds of standing
still that Destiny and the Gate cost between them.

The wheel is drawn on the floor under the champion rather than in a corner of
the HUD, because it is a *tempo* and a tempo belongs where your eyes already
are: three arcs in the order the cards come, a head sweeping them at two a
second, and the spin window draining above his head. The ability bar
deliberately does not track the spinning face — it is drawn from a HUD snapshot
and the wheel turns twice a second, so a bar that tried would spend half its
life telling you GOLD while the floor said BLUE.

### The dagger path

Nine stages, each gated on the one before it, and every one of them is a dagger
you have to meet.

| Stage | Keys | Measures | The habit it builds |
| --- | --- | --- | --- |
| **Preparation** | W F | Daggers taken, how long each lay on the floor, slashes that reached the target | Being where the dagger lands rather than where you were when you dropped it |
| **Bouncing Blade** | Q F | Slashes on the champion, bodies per throw | Choosing the first bounce for where the dagger will fall |
| **Shunpo** | E F | Daggers taken, and taken by blinking | The blink as a route between daggers, not a gap-closer you wait fourteen seconds on |
| **Blade, then Blink** | Q E F | Blade daggers taken by Shunpo on the beat they land | Katarina's short trade — all timing, no aim |
| **The Dance** | W E F | Trades completed: in, drop, take, with them still in the slash | Not letting the haste carry you away from your own dagger |
| **Reset** | Q W E F | Resets, against three fragile champions who hit back | Arriving at the next target with the kit already back |
| **Death Lotus** | E R F | Lotuses kept, champions per tick, lotuses cancelled by moving | Letting go of the mouse for two and a half seconds |
| **The Entry** | Q W E R F | Fights joined under half health rather than at full | Joining a fight rather than starting one |
| **The Spin** | Q W E R F | All of it, against a hunter, a duelist and a wave | Playing Katarina rather than owning her abilities |

**The number the path leads with is DAGGERS TAKEN**: of the daggers that
reached the floor, the share you were standing on in time. Picking one up is
the slash, most of Shunpo's cooldown back and the reason she has a combo at all,
so a dagger nobody takes is a cast that did nothing. A player who routes reads
close to 100% on every stage; a player who fights the body — throws at the
champion, blinks at the champion, follows them with the haste — reads well
under that, and the gap between their scores is the claim the path rests on.
The headless suite plays every stage both ways and checks it.

Her delays and distances are League's exactly, because they are the champion:
the second and a quarter before Preparation lands, the three hundred and fifty
units past the first body that a Bouncing Blade comes down, the four seconds a
dagger lies there, the hundred and fifty units you have to get within, the
three hundred and forty around *her* — not the dagger — that the slash
reaches, and the three seconds Voracity allows. Bouncing Blade is League's
seven seconds maxed, Shunpo League's ten at rank three and a taken dagger
removes 84% of whatever is left on it. The discounts are Death Lotus (twenty
seconds rather than ninety, fourteen on its own stage) and Preparation on the
two stages that are about nothing else, for the reason Condemn is discounted: a
minute has to hold enough attempts to be a rep.

Daggers are drawn where they are rather than counted in a corner: a ring closing
on the spot while one is in the air, then the blade and the pickup reach with
its four seconds running down. On the early stages the spot a Bouncing Blade
would land on is drawn under the cursor before you throw, and the slash's reach
is drawn around you whenever a dagger is close enough that taking it is the next
thing you do. Death Lotus ends on a move command — under WASD a held key ends it
after a hundred and fifty milliseconds to let go — and Shunpo is the one way out
of it that is not a mistake.

### The Sheriff

Everything above this line measures what your hands did. **SHERIFF** measures
what you did about somebody else's, which is a different skill and the one
half of a lane that no amount of solo practice reaches.

It puts a Caitlyn on the other side of the floor with her whole kit, and hands
you the whole of yours to answer her with — the net is answered by a Condemn,
the trade you have to win to kill her is won with Silver Bolts, and the only
thing that makes standing inside 650 range survivable is Final Hour. A player
given one button against four learns to run away. She is
modelled the way the champion path is modelled — League's ranges, League's
cast times, League's trap that deals no damage — because a mode about reading
an opponent is worth nothing if the opponent is an approximation. The matchup
is the reason it is her: 650 range against Vayne's 550 means she is allowed to
stand where you cannot reach and you are not, so every unit of that gap has to
be taken with a tumble timed off the end of an attack.

Four answers, and no two of them are the same movement:

| Ability | The window | The answer |
| --- | --- | --- |
| **Q Piltover Peacemaker** | A 1250 × 90 lane, drawn on the floor for the whole 0.625s of the cast, direction already locked | One step, early, at right angles. It pierces, so cover is not an answer |
| **W Yordle Snap Trap** | Arms in a second, then sits there for twelve | Read the ground you are walking *onto*. It deals no damage — what it costs is 1.25s of not moving and the Peacemaker that follows |
| **E 90 Caliber Net** | Short, fast, and it throws her 390 units out of your reach | Do not be there. The 50% slow is the dangerous half: a Q aimed at somebody moving at half speed is a Q aimed at somebody standing still |
| **R Ace in the Hole** | A one second channel, then it simply hits you | Terrain. Nothing you do with your feet beats it, and there is a wall within a second of anywhere on that floor |

Her passive is in too, so time inside her range is never free: every sixth
attack is a Headshot, and a trapped or netted target takes one immediately.

The mode refuses to be a corner. She has to die for a good score and the only
way to kill her is to stand inside her reach on purpose and leave again — so
the run is scored on the reading *and* on the pressure, and neither half can
carry it. SURVIVE ends on the third Peacemaker that lands and sends her a
deputy as it ramps.

Her cooldowns are League's, charged at 45% of them — the same decision Condemn
gets, for the same reason. A minute against her real figures is six
Peacemakers, and nobody learns a read six repetitions at a time. Her health,
her movement speed and every range in the kit are untouched. Her basic attack
is the one number bent downwards: a Sheriff who kills you with autos is testing
your spacing rather than your dodging, and there is already a mode for that.

Difficulty changes how well she leads you and how quickly she reacts, and
nothing else — she throws the same number of Peacemakers at every setting, so a
dodge rate set on one difficulty means the same thing as a dodge rate set on
another.

### The range check

Nothing draws your attack range. Centring the camera — `Space`, or whatever you
have moved it to — paints it on the floor for eight tenths of a second and then
takes it away again, and that press is called a *check*.

The reason is the whole product in one decision. A permanent ring is a readout,
and a player who has one reads their spacing off the floor rather than knowing
it; then they queue into a game where reading it off the floor is precisely
what is going wrong. So the ring becomes something you spend rather than
something you have, the modes count what you spend, and the distance ends up
where it has to be, which is in your head.

The setting has three answers rather than two — on a check, always, or never.
*Always* is the old behaviour and it is worth a few runs on a champion you have
never played; it is worth turning off again afterwards.

**RANGE** is the mode built out of what that changes, and it trains one act:
put yourself on the outside edge of your own reach and fire from there. A mark
appears — never at the distance you should be shooting from — and the instant
your windup starts the run measures the gap in units, says which way you were
wrong, and draws the circle you should have been standing on. Five phases, in
the order they have to be learnt:

| Phase | What it adds |
| --- | --- |
| **Mark** | A still target and free checks. Calibration: look at the ring, then at the ground |
| **Step** | Marks placed too close as often as too far, because walking *backwards* to your edge is half the skill |
| **Drift** | The mark moves — across you, away from you, at you |
| **Trade** | It shoots back from a shorter range, so every unit of depth is paid for in health |
| **Shift** | Your own reach changes every rep and you are told the new number and nothing else |

Ordering an attack you cannot take voids the rep under the click scheme: the
champion walks you into range to make the order legal, so the shot that follows
is the pathfinder's judgement rather than yours — and that walk is how people
die in a real game. Under WASD nothing can walk you, so the shot is always
yours and the number is simply where you stopped.

The run is scored on the share of shots that were both on the edge *and* taken
without a check, on how far your error swings from rep to rep, and on how much
depth you gave away. An average that looks good with a spread that wide is a
coin landing well, and the results screen says so.

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

These are the two shapes of a *rep*, and every mode below the lane has both.
The lane itself has neither: it has an opponent and a length, both chosen on
its card, because a lane is not a rep — the thing being measured is what
happens over ten minutes rather than what your hands did in sixty seconds.

**PLAY is one minute.** Every mode, every time. Night Hunter included: clearing
the floor sends the next wave rather than ending the run, because a minute that
finishes in eleven seconds is not a minute and cannot be compared with one that
did not.

**SURVIVE has no clock.** Two things end it:

- **Dying.** Real for every mode with something that can kill you.
- **Three strikes.** Each mode names one mistake, and it is the mistake the
  mode exists to stop: a shot taken from far inside your own edge in Range — or
  an order you could not take at all — a windup thrown away in Tumble, a stack
  abandoned in Silver Bolts, a condemn into open ground in Condemn. Night Hunter has no
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

## Warm up

The research this client is built on is blunt about three things. In League's
own new-player data, practice spread across days went with better outcomes than
the same practice crammed (PLOS ONE, 2022 — observational, so an association
rather than a proof). A mechanic is learnt fastest in a block of the same thing
and kept best when it has to survive among other demands. And feedback is worth
most when it names one thing to do. The warm-up is those three findings with a
button on them.

### The routine

| Step | What | Why |
| --- | --- | --- |
| **Calibrate** | SEE IT: five reactions to light | A thermometer. Measured the same way daily, reaction time moves with sleep and tiredness far more than with skill |
| **Fix · set 1** | One minute of the mode that fixes the mistake you made most in the last two days | Yesterday's error, re-shown before anything new |
| **Fix · set 2** | The same minute again | Blocked practice; the one score that matters today is this one against the last |
| **Hands** | A lab bench at the rung you have not beaten — a different bench each day | The layer under every champion |
| **Under pressure** | The same champion, with somebody against you | The only place the habit has to work |

It ends on a summary — set two against set one, today's focus against the last
warm-up on it, the thermometer against your normal — and one sentence written
for the mistake in question, phrased as something to *do* in a ranked lane:
*"Step off the line when the cast starts, not when the missile is in the
air."*

**The stop rule.** If set two is clearly worse than set one (twelve performance
points or more) *and* the calibration was ten per cent or more off your own
normal, the routine ends there and says so. Either half alone is ordinary —
variance, or a cold morning — and together they are rehearsing tiredness. Both
thresholds are ours; no paper hands them over, and the code says so.

**The streak** counts any finished warm-up, including one that stopped early
and one you left after the two sets. Every seven days in a row banks a freeze,
up to two, and a freeze covers a missed day without asking. A streak that
punishes hard enough to compete with ranked games is working against its owner.

### Reaction tests

| Test | The cue | The answer |
| --- | --- | --- |
| **SEE IT** | The screen lights | Anything |
| **HEAR IT** | A tone, with nothing on screen | Anything |
| **CHOOSE IT** | One of your four ability inputs lights, as you have them bound — a mouse button under WASD | That one |
| **CLICK IT** | A target somewhere on the screen | Click it |

Each is a median and a median absolute deviation over five or eight trials. The
wait before the cue is random; a press inside it is a false start, thrown away,
counted and repeated. The light is timed from the frame it was painted on and
the tone from the audio clock, and every figure still includes your screen,
browser and mouse — so it compares you with yourself on one setup, and the
screen says exactly that.

### Benchmarks

KovaaK's answer to "is my score good" is a benchmark: fixed scenarios at fixed
settings with published thresholds. This is that, for the pieces of a lane.
Seven one-minute runs — RANGE, TUMBLE, SILVER BOLTS, CONDEMN, SHERIFF, PICK A
CARD, PREPARATION — each on one seed at difficulty 0.5, plus SEE IT and CHOOSE
IT. Six tiers, ROOKIE to APEX; you hold one once six of the nine rows reach it,
and a points total out of 54 moves with every row.

The thresholds are **provisional** and the sheet says so. MASTER is exactly what
the trainer's scripted reference player scores on each scenario, pinned in
`benchmarks.ts` and held there by a test that re-plays every scenario — so a
change that moves what competent play scores fails the build instead of
quietly re-grading everyone. They should be cut from real players'
distributions, and will be once there are enough. The names are deliberately
not League's: this is a benchmark of this trainer, not an estimate of anybody's
rank.

### Scenario codes

Every results screen prints a code for the minute just played —
`vayneTumble-P50-fl4ma-J`: the mode, PLAY or SURVIVE with its difficulty, the
seed, and a check letter. Paste it into WARM UP and you get the same start: the
same spawns, the same wave, the same opening move from whoever is on the other
side. After that they answer what *you* do, so two players on one code are on
the same course rather than watching the same recording. A benchmark's code is
the benchmark, and records as one.

## Rewind

Press **Backspace** (rebindable), or ⟲ 3s / ⟲ 10s on the pause screen, and the
run goes back to that moment and hands it to you — Tekken's replay takeover,
for a lane. The count before your hands come back is a second and a half, and
pause works during it.

There is no save state behind it, because there does not need to be one. The
simulation is deterministic: one seed, a fixed 240 Hz step, every random
number from a seeded generator. So every simulated step's inputs are written
to a tape — the cursor, the held direction, and each command with its screen
position already turned into ground — and a rewind remounts the run on the
same seed and plays the tape back to the moment asked for. The session never
sees a pixel, which is what keeps the camera out of the replay.

`npm test` proves the property the whole feature rests on: seven modes are
rebuilt from their tapes and compared with the original run, bit for bit, at
5, 20 and 45 seconds, and the final scores are compared too. A practice mode
rebuilds a full minute in about 120 ms; the lane costs more (about 13 ms per
simulated second, with the fog grid — which only the renderer reads — skipped
during the rebuild) and rebuilds in slices. While it does, the screen shows
what is happening: the arena as it was when you asked, drained of colour,
scrubbing backwards while the clock counts back to your moment — then the
still lets go and the live arena is under it, in colour.

**A rewound run is practice.** A run you can go back inside is a run whose
score could be edited, so it is scored against a copy of your profile — the
results screen shows everything — and written to nothing: no record, ladder,
rating or benchmark moves. The HUD and the results screen both say so, and
RUN AGAIN starts a fresh attempt that counts.

## The lane, read back

A lane's results lead with totals, and under them the lane is read back in
the order it happened:

- **The level race.** When each of you reached two, three and six, and by
  how much you were first or late.
- **Trades.** Every exchange between the two champions, from the first hit
  to three quiet seconds, with everything you took split by who dealt it —
  her, her wave, her turret — and a one-line lesson named after the biggest
  cost. The five most expensive are shown.
- **What she was doing, and why.** The opponent chooses a plan before she
  presses a button — farm, freeze, shove, back off, all in — and records the
  reason: she counted lethal, her wave was three bigger and on her side, she
  was under 28%. The spans that mattered are listed with those reasons.

## The accuracy report

CHARACTER has a fourth tab, **ACCURACY**: every League figure the lane is built
from — sixty-four rows — with the patch it was audited against (26.18, Data
Dragon 16.18.1), League's figure beside the one this client runs, and one of
five labels:

| Label | Means |
| --- | --- |
| **VERIFIED** | Read off Riot's own patch notes or data |
| **REPORTED** | A current secondary source: probably right, not Riot's word |
| **INFERRED** | Arithmetic from the rows above, or a judgement where sources are silent |
| **NOT FOUND** | Nobody publishes it that we could find; the value run is ours and says so |
| **TRAINER** | Deliberately not League's, for the reason on the row |

Every VERIFIED and REPORTED row links its source, and every row whose two
columns differ says why — both enforced by tests. The report and the simulation
read the same file, so they cannot drift apart. What it does *not* claim: the
default camera zoom, pitch and field of view, the edge-pan constants, the server
tick rate and the turret's shot into a minion are all NOT FOUND, because a
plausible number printed as a fact is worse than a gap.

## Free, non-commercial, and not affiliated with Riot Games

APEX is a free fan project and will stay one: no price, no ads, no paid tier,
no donations, and none planned. That is also what Riot's fan-content policy
("Legal Jibber Jabber") allows without separate approval, which is part of why
it is the rule here rather than a phase.

APEX isn't endorsed by Riot Games and doesn't reflect the views or opinions of
Riot Games or anyone officially involved in producing or managing Riot Games
properties. Riot Games, League of Legends and all associated properties are
trademarks or registered trademarks of Riot Games, Inc. The notice is also
printed in the client, on WARM UP and on the accuracy report.

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
| `RANGE_LOSS` | Drifted outside your own range and stopped being a threat | Range |
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
mechanic. The menu offers Range, four Vayne modes and the Sheriff, so a fix
button starts the one that trains the same thing — anything about the edge of
your own reach lands on Range; kiting and movement problems on Tumble; dodging
problems on Sheriff, because moving late and standing in a telegraph are
problems with reading an opponent and so they hand you one; targeting and
last-hitting on Silver Bolts; skillshots on Condemn; anything else on Night
Hunter. The mapping is one function, `practiceFor` in
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
- **The arena stays calm.** Banners and floating words per minute are held to
  budgets on a lane, the Sheriff, the card wheel and tumble, never more than
  three words over the arena at once; a rule taught in one lane is not taught
  again in the next; and the voice changes no score.
- **The lane is patch 26.18, and the receipt matches it.** The minion, turret,
  experience and champion figures are asserted at their 26.18 values; the first
  wave is asserted to be 279 experience, level two the seventh minion and level
  three the fourteenth; and the accuracy report is asserted to print the same
  numbers the simulation runs, to cite a URL on every VERIFIED and REPORTED
  row, and to explain every row where League and the trainer differ.
- **Benchmarks are anchored and deterministic.** Every benchmark scenario is
  re-played by the reference player: it must score exactly the pinned
  reference, land at MASTER, score the same twice on the same seed, and a
  player who stands still must not reach ROOKIE. Scenario codes round-trip,
  and a typo or a wrong check letter is refused.
- **The warm-up does what it says.** Reaction runs are medians that ignore
  wrong answers; the stop rule fires on a worse set *and* a slow day and on
  neither alone; seven days bank a freeze, a freeze covers a missed day, and a
  streak with no freezes left starts again at one; a first routine starts on
  RANGE, yesterday's most frequent mistake picks the focus, and every step is a
  mode the menu can start.
- **The Sheriff is beaten by reading her and by nothing else.** A reference
  player who moves on the telegraph dodges over 90% of the Peacemakers and
  scores in the seventies; the identical player with the telegraph ignored
  dodges three quarters of them and scores around fifty. A snap trap is
  asserted directly to deal no damage and to take 1.25 seconds of movement,
  the Peacemaker is asserted to be the shot she takes at a target who cannot
  move, and running away scores under 45%.
- **The card path is measured by the wheel, and the wheel by the slots it
  costs.** Every one of the nine stages is played three ways: properly, one
  beat late, and not at all. The good player wastes 0.00 card-slots a lock and
  the late one wastes 3.00 — a whole revolution, every time — and on every
  stage that hands you a wheel or an ultimate, being a beat late scores less.
  The two stages that hand you neither are asserted to be played *identically*
  by both, because they were deliberately built to have nothing to be late
  with. Underneath that: a gold card that lands is a stun, a fan lands more
  than one card a cast and goes through two or more bodies, the fourth attack
  lands on a champion more often than on a minion, locking early means arriving
  loaded where locking late means arriving empty-handed, over 40% of the stuns
  bought are actually spent inside the window, and the gate arrives on the mark
  — which it can only do if the ultimate was started on the telegraph, since
  the window is shorter than the two channels take.
- **A card cannot be in two places at once.** An attack cancelled mid-windup
  hands the card back, so the suite asserts that a run never locks more cards
  than it started wheels — the state where one sits on your hand while another
  turns is one League does not have.
- **The dagger path is measured by the daggers taken.** Every one of the nine
  stages is played three ways: routed, chased, and not at all. The router and
  the chaser press the same buttons on the same timer; the chaser simply fights
  the body instead of the floor, and on every stage she scores at least five
  points less. Underneath that: a dagger dropped where you stand is taken the
  moment it lands, throwing the blade at the wave puts more slashes on the
  champion than throwing it at the champion, a route of daggers buys more than
  twice the blinks the cooldown alone allows and every blink onto a dagger takes
  it, in-drop-take trades are completable and chasing does not complete them, a
  kill within the window resets the kit and never more than once, a lotus is
  kept by standing still and lost by walking, and waiting for a fight to bleed
  is an entry on time where diving it at full health is not.
- **Every drill's drawing pass runs in the suite.** The one part of a mode that
  only executes in a browser used to have no proof behind it, and a throw there
  is a black screen rather than a wrong number. The lane additionally asserts
  what it draws: the road, both turret circles, a plate on every enemy minion,
  the damage threshold at the coached tiers and none of it at Challenger — with
  the damage-already-in-the-air wash surviving both, because that is legibility
  rather than advice.
- **The lane is League's lane, and the ladder in it is behaviour.** Every
  minion's health, gold and experience is asserted directly, along with the
  turret's 775 units and 152 damage, the two-shot caster and four-shot melee,
  the thirty second wave clock and the 280 that is level two — so a number
  cannot drift without the suite saying so. Five opponents are then run
  unattended: each tier farms strictly more of its wave than the tier below it,
  the top takes over three quarters of it, and the Iron and Challenger laners
  are asserted to have *exactly* the same attack damage at the same level.
- **A lane you farm scores and a lane you stand in does not**, averaged over
  seeds — and a death in one is a respawn timer rather than the end of the run,
  which is asserted by leaving a player standing in front of a Challenger and
  checking the lane still runs to its clock. The dead-minion sweep is checked
  too, because twenty waves of thirteen bodies is what a ten-minute mode costs
  if nothing clears them up.
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
- **The bench moves, and it moves further on a higher rung.** Checked through
  the drawing contract rather than through a field on the drill — the suite
  watches the discs each mode actually paints and adds up how far they went
  between passes, in every mode that paints any, at level 1 and again at level
  10. "The targets move" is a claim about what is on the screen, so it is
  asserted where it happens.
- **A rung is a roster as well as a pace.** Level one asks for two commands
  and level ten asks for all nine, the ladder never takes one back on the way
  up, and the ability bar of a bench really does light more keys at the top of
  the ladder than at the bottom — checked off the bar the player reads rather
  than off a table.
- **The order line runs from level five and not before.** Every bench is
  checked for silence below the rung it arrives on and for a strip that a
  playing bot can actually answer at the top, and a mode whose whole subject is
  clicking pads is checked to still keep its own clicks while it runs.
- **SURGE moves the floor and PLAY does not.** On every bench, a bot that
  chains carries the floor three rungs above the one it opened on and a bot
  that does nothing moves it not at all; a PLAY run reports no surge; and a
  surge run writes its own ledger, never the rung's record and never a star.
- **The board in the corner is a second task in every mode.** Every bench runs
  the two-lane dodge and reports it. A bot that plays the bench perfectly and
  never touches the two lane keys takes seventeen orbs across three runs where
  the same bot watching the corner takes none, scores under three quarters of
  it, and holds under two fifths of the chain — and mashing the lane keys is
  worth nothing, because a lane swap with nothing in the air is an input that
  bought nothing.
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
does not put them in front of you, because it puts three champions in front of
you instead. A diagnosis
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
| `D` `F` | Summoners — the trinket and Flash |
| `S` | Stop |
| `Space` | Centre the camera on your champion — and check your attack range |
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

The first section is the roster — eight champions, compared as outlines rather
than as stat lines, because there is no stat line. Every hero shares one attack
profile, one health pool and one move speed, which is exactly what keeps a
rating earned behind one comparable with a rating earned behind another: the
ladder measures your hands, and your hands do not change when your cape does.
Two cards carry a badge. **PATH** is Night Hunter, the body the Vayne modes
spawn whatever the roster says; **FACED** is Caitlyn, the one you meet on the
other end of a telegraph in SHERIFF.

| Setting | What it does |
| --- | --- |
| **Champion** | Which of the ten bodies you wear. A silhouette and nothing else |
| **Movement scheme** | Click to move, or WASD |
| **Dash aim** | WASD only: a dash goes where your keys are held, or to the cursor |
| **Bindings** | Every action, per scheme — one key to one action, conflicts resolved as you make them |
| **Quick cast** | Abilities fire at the cursor on press, rather than press-then-confirm |
| **Attack range** | When your reach is drawn: on a check (default), always, or never |
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

Six screens: **Warm up**, **Practice**, **The Lab**, **Progress**, setup, and
the patch notes. The last two live in the corner of the top bar, which leaves a
navigation bar with four words in it — the daily button first, then the shape
of the whole trainer: a champion, and the bench underneath every champion.

### Practice

The menu is the whole of the first screen, and it is three sections behind one
sticky rail rather than one column two thousand pixels long. Every tab prints
how much is inside it and how far through it you are — five opponents and the
lanes you have played, twenty-four modes and how many are on the board, four
kits to read — so the shape of the screen is readable before you open any of it. The rail walks under the
arrow keys, and the tab you were last on survives a run. Every section on it is
the champion; the bench moved out to its own screen, because as a fourth tab
here it read as one more thing about Vayne.

**THE LANE** is one card: five opponents in a row under the question they
answer, and three lengths under theirs. The record it prints is per opponent,
because that is the only way a creep score means anything.

**PRACTICE** is a card per part of a champion, behind a switch between the three
of them. Her groups climb by *how much kit*: FOUNDATION, which hands you a body
and no abilities; THE KIT, one ability at a time; and ALL OF IT, which is the
whole champion and then the whole champion with somebody shooting back. His
climb by *how much is taken away*: FOUNDATION again, then THE WHEEL, THE REST
OF THE DECK, and WITH SOMEBODY THERE. Katarina's climb by *how far ahead you
have to think*: FOUNDATION, then THE DAGGER — one dagger and the two ways of
getting one somewhere — THE ROUTE, the daggers chained, and THE FIGHT. Each card carries what the mode asks of
you, the League habit it builds, the slice of the bar it hands you drawn as four
keys — the ones you do not get are shown greyed rather than hidden, so the cards
read as slices of one champion, and the names under those keys are that
champion's — and two buttons, PLAY and SURVIVE, each with the record it is
asking you to beat printed under it.

**Clicking a card starts it.** The button in the middle of the picture is
PLAY, and so is a click anywhere on the card that is not one of its own
controls — the level arrows, SURVIVE, SURGE, ENDLESS and the opponent picker
still mean what they say. On the lane card it starts the quick lane against
the opponent picked on it. Resting on a card still plays its clip, and a small
CLIP chip in the corner plays it on a screen with no cursor to rest.

**THE CODEX** is the reading: all four kits in numbers behind one switch — the
roll's distance and how long it takes, the bolt count and what the third one
does, Flash's range and what it crosses, Condemn's cast time, knockback and both
of its cooldowns, the trinket, Final Hour and the passive on the first; the
wheel's half-second, the fan's spread, the stun's second and a half and the two
channels of Destiny on the second; the dagger's delays and distances, the
slash, Voracity's window and the lotus on the third; every window the Sheriff
expects you to beat on the fourth. It also says which Vayne
each mode hands you and why — one point in Q where the rhythm is the lesson, a
maxed E where the reps are — because a trainer claiming to feel like the
champion owes you the figures it is claiming it with.

There is nothing else on it. No plan to accept, no course to unlock, no
calibration to pass first: your rank arrives from your first three runs, and
until then the chip in the corner says UNRANKED rather than inventing a number.

### The Lab

The thirteen benches, split into ONE THING AT A TIME and TWO AT ONCE, which is
the split that tells you what to play next. Every bench prints what it counts
and what makes it hard, the level it is set to, the ten-mark ladder that level
sits on — marked with the rungs you have starred and with where the board joins
— and the ∞ that plays it with no level at all.

Four rules hold across all thirteen, and they are the reason it is worth its
own screen:

- **Every level is open, to everybody.** All ten rungs of all thirteen benches
  are playable from your first run. Nothing here is earned or unlocked. The
  ladder still remembers — each rung keeps its own record, and a clear moves
  the suggestion up — but it is a suggestion, because the only person who knows
  which minute is worth your next minute is you.
- **A level is one unchanging thing.** The rung sets every window, every
  spacing and every clock, and holds them there for the whole minute; so does
  the palette, which used to climb through five colours with your streak and
  made a good run look like a different bench. Nothing accelerates because the
  run is going well: what your form moves is the reward — the chain, the tier,
  the multiplier — not the floor. Which leaves exactly three ways to score
  better, and they are the right three.
- **A rung is a roster.** Level one is Q and W. Two adds E, three adds R, four
  adds the summoner bank and the board in the corner, and five, six and seven
  add the orders — move, attack-move, stop — which are commands to the champion
  rather than keys on the console, and are graded as themselves on a strip
  along the bottom of the floor. The screen prints the whole table.
- **The floor moves in two modes, and only in two.** **SURGE** is a minute at
  your rung with your chain wired to the floor: hold one and the bench climbs
  up to three rungs above you and the colours climb with it, break it and both
  settle back. **INFINITE** has no clock and no rung and hunts for the level
  you can just hold. Neither writes the rung's record, because a run whose
  difficulty moved is not a rep of the rung it opened on.

### Study

A quiz about every champion in the game, and the reference behind it.

**What it asks about** is five topics, each switchable: **PASSIVES** (whose
is this, what does it do), **ABILITIES** (which button is this, whose is it,
what does it do), **COOLDOWNS** (rank one, as a number or as "which comes back
sooner"), **RANGES** (as a number, as "which reaches farther", and on the
floor — a top-down field where you click where the ability stops, with a
distance you already know by eye drawn for scale) and **MATCHUPS** (Riot's
"playing against" tips with the name blacked out, whose basic attack reaches
farther, and whether an enemy ability outranges yours). **About who** is
everyone, one class, or your own list — the champions you face most. Wrong
answers always come from the whole roster, and lean towards champions of the
same class so they are ones you could believe.

**How it plays** is the client's own three ways:

- **PLAY** — one minute of questions. The clock only runs while a question is
  open: the answer, with the champion's card, stays up until you move on, and
  reading it is free.
- **SURVIVE** — no clock, three wrong and it is over.
- **REVIEW** — only what is due.

**What it remembers** is facts, not questions. Get Thresh's hook cooldown
wrong and the fact goes to the bottom box of a Leitner schedule: it is due
again at once, so it comes back a few questions later — while anything is
due, about a third of every PLAY and SURVIVE is spent on it. Each right answer moves it up a
box — a day, three days, a week, sixteen days, five weeks — and a fact
answered right the first time it is ever seen starts three days out, because
asking tomorrow about something you already knew wastes your time. It may come
back asked another way: "which comes back sooner, Thresh's hook or
Blitzcrank's?" rather than the same four numbers.

**Where the numbers come from** is Data Dragon, rebuilt with
`npm run champdata`, rank one unless a question says otherwise. Some of Data
Dragon's figures are placeholders — 25000 means "global" on Ezreal's ultimate
and "cast on yourself" on Hecarim's, a cooldown of 0 is a passive riding in an
ability slot, and a champion with two forms has one number standing in for
two abilities — and the quiz never asks about those. Their cards print "—"
instead. A name is blacked out of its own champion's text before that text is
asked about, and the test suite checks every champion for leaks.

The reference is every champion as a card: passive, four abilities with their
cooldown ladders and ranges, attack range and move speed, and the tips for
playing against them — with a button that drills that one champion for a
minute. Study keeps its own record under `apex.study.v1`; it moves no rating
and is untouched by a profile reset.

### Progress

The other screen, and the only one that is a page of content: your rating and
its trend, your weakest axes with what each one is, the mistakes the error log
has actually caught you making, and your history. Anything on it that offers to
fix something starts one of the four modes.

Screens that are pages sit on a darkened plate, so the arena behind them shows
through as depth rather than competing for the same pixels as the text.

### Motion, and how little is said

The client moves in one language and says each thing once.

- **One motion system.** Five durations (120–560 ms), a strong ease-out for
  entrances, a softer curve for exits, a stagger, and two springs sampled from
  the same physics the code uses to roll numbers — `--dur-1…5`,
  `--ease-out`, `--ease-exit`, `--ease-spring`, `--ease-forge` in
  `global.css`, and `src/ui/motion.ts`. Everything that moves goes from a
  cause to a result, and animates transform and opacity only.
- **The run's front door.** A card's picture grows into the run (the View
  Transitions API, with the card's picture and the arena as one named
  element); the countdown is one struck numeral with a ring closing on it;
  GO lands, holds for a heartbeat and the camera settles under it.
- **One voice in the arena.** Every banner states what it is for — critical
  news interrupts, a rule of the mode is said once per player and remembered
  on the profile, colour is dropped in a fight and never shown for under a
  second — and only one is ever on screen. Floating words are spent from a
  budget (`src/engine/calm.ts`): repeats merge, each body gets two a second,
  the arena three at once, and commentary waits out the fight. The HUD's
  secondary figures step back while you are trading.
- **Results in three acts.** The number, rolling up with a line drawn through
  your old best on the frame it passes it; the verdict — one sentence, one
  limiter, one button; and the evidence, every panel there has ever been,
  behind one “why”. Sound and motion land together.
- **A forged rank.** The old rank breaks away on the hit and the new one rings
  into place; a new best lands in its row on PROGRESS once.
- **Say it once.** Every explanation in the client lives behind the same “?”,
  word for word. Headers are one line; WARM UP opens on the streak and the
  button.
- **Calm is complete.** Reduced effects or the system's reduced-motion setting
  turns every move into a short fade — nothing travels, nothing is cut off.

None of it can change a score: the banner voice and the float budget are
presentation, and `npm test` holds them to budgets per minute on the same
seeds as every other check.

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
src/engine/patch.ts   the patch manifest: every League figure, its source and confidence
src/engine/vayne.ts   the champion kit: tumble, bolts, condemn, final hour, passive, trinket
src/engine/summoners.ts  Flash: the one button on the bar that belongs to no champion
src/drills/modes.ts   PLAY and SURVIVE, and which drills the menu offers
src/drills/vayne*.ts  the four modes; each owns its rules and its scoring
src/drills/     the wider mechanics catalogue the ratings were built on. Still
                simulated, still tested, not on the menu
src/gfx/        the 3D renderer: scene, terrain, walls, champions, decals, VFX
src/progression/ rating maths, rank ladder, champion path, coach, error log,
                persistence
src/progression/warmup.ts      the daily routine, reaction stats, streak and stop rule
src/progression/benchmarks.ts  benchmark scenarios, tiers and scenario codes
src/study/      STUDY's roster (Data Dragon, trimmed by tools/champdata.mjs), what is
                fit to be asked, redaction, and the question generators
src/progression/study.ts       STUDY's memory: the Leitner schedule, bests, choices
src/patchnotes/ the release history: the client, the version number and CHANGELOG.md
src/ui/         React shell, HUD, Warm up, reaction tests, Practice, accuracy report,
                results, profile, rank-up, settings
tools/          headless test harnesses, and champdata.mjs, which rebuilds the roster
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

Progress is stored in `localStorage` under `apex.profile.v1`, and STUDY's
facts under `apex.study.v1` — no account, no server, no network calls during
play. The roster ships inside the bundle rather than being fetched from Riot,
so STUDY works offline and from the single-file build.

## Deployment

Pushing to `main` builds, typechecks, runs the simulation checks, and publishes
to GitHub Pages via `.github/workflows/deploy.yml` — which puts the live client
at **https://cvree.github.io/TopDown/**. Enable it once under **Settings →
Pages → Source: GitHub Actions**. The build uses relative asset paths, so it
also works from any static host or subdirectory.

`npm run build:single` additionally emits `dist/apex-single.html` — the whole
trainer, arena included, inlined into one file for hosts that only take a
single document.
