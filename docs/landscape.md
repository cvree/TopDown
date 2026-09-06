# The out-of-game practice landscape for League of Legends

*Research notes for APEX — what already exists, what the community says about it,
what the evidence says, and the gaps a trainer like this one can actually fill.*

Compiled September 2026. Every claim below carries a source. Two caveats about
the method, stated up front because they change how much weight some lines
deserve:

- **The research was done through web search, not direct browsing.** The egress
  policy on this machine blocks nearly every third-party domain, so product
  pages (loldodgegame.com, skillgap.pro, eloascend.com, dignitas.gg, the PLOS
  and ACM PDFs) were read through search summaries rather than opened. Feature
  lists and prices below are therefore *as reported*, and anything load-bearing
  should be re-checked against the live page before it goes into marketing copy.
- **Reddit is not reachable from here at all** — neither by fetch nor by search.
  So "what the community says" is assembled from second-hand sources that quote
  the community (Dignitas, Esports News UK, zleague's community round-ups,
  GameFAQs boards, dev trackers, coaching-site guides) rather than from threads
  read directly. The themes are consistent enough across those sources to trust;
  the individual quotes are not first-hand.

---

## 1. Two things called "skill gap"

The phrase is doing double duty, and both meanings matter here.

**Skill Gap (skillgap.pro)** is a real product — a Spanish-made League mechanics
trainer that markets itself as "the AimLab for League of Legends" and is the
closest direct competitor APEX has. It is covered in §2.2.

**The skill gap** is the thing every one of these tools claims to close: the
distance between the player you are and the player you are trying to be. The
useful finding from the data is that it is *not one gap*, and the composition
changes as you climb:

- Low-to-mid ranks are gated on execution and economy. CS benchmarks quoted
  across coaching sites put Iron–Gold around 6–7 CS/min, Platinum–Emerald around
  8, and high ranks near 10, with 7–8 described as "healthy" for a solo laner
  and 9+ as comfortably ahead of most opponents
  ([HighGround](https://www.highgroundgaming.com/good-cs-per-minute-lol/),
  [LOL Brain](https://www.lol-brain.com/blog/what-is-a-good-cs-per-minute)).
- Gold→Diamond is repeatedly described as the hardest jump, and explicitly *not*
  a mechanics jump: "the players who reach Diamond aren't the ones with the best
  mechanics or the highest KDA — they're the ones who play the map, minimize
  mistakes, and consistently make better decisions"
  ([Dodge.gg](https://www.dodge.gg/en-US/lol/news/how-to-climb-gold-to-diamond-2026)).
  Gold players lane until a fight happens; Diamond players play the map.

That split is the strategic fact of this whole landscape. **Mechanics trainers
serve the bottom two-thirds of the ladder and stop mattering somewhere around
Platinum, which is exactly where the macro-puzzle products start.** Any roadmap
for APEX has to decide, deliberately, which side of that line it is on.

---

## 2. The complete inventory

### 2.1 Riot's own tools — the baseline everything else is measured against

| Tool | What it gives you | Where it stops |
| --- | --- | --- |
| **Practice Tool** | Sandbox on Summoner's Rift: cooldown/mana refresh, level up, gold, item copying to bots, spell shields, invulnerable turrets, instant jungle respawn, game reset ([Wiki](https://wiki.leagueoflegends.com/en-us/Practice_Tool)) | No scoring, no drill structure, no progression, no feedback. It is a sandbox, not a coach |
| **Practice Tool multiplayer** (patch **25.S1.1**, Jan 2025) | Up to **10 players** in one lobby, up to **9 bots**, per-bot difficulty Intro/Beginner/Intermediate ([Wiki](https://wiki.leagueoflegends.com/en-us/Practice_Tool), [patch notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-s1-1-notes/)) | Fixed the single-player complaint that dominated community feedback for eight years. Bot quality is still Intro→Intermediate — nothing that punishes you |
| **Custom games vs bots** | Full game shape, free | Bots do not pressure you; habits learned against them do not survive contact |
| **Tutorial** | Onboarding only | Not practice |

**This is the single most important recent change in the space.** The loudest,
longest-running community request against the Practice Tool — "let more than one
person in" — was granted in 2025. Anything built on the premise "Riot's practice
tool is single-player" is now out of date.

The complaints that *survive* the 25.S1.1 update, per community round-ups
([zleague](https://www.zleague.gg/theportal/improvement-desires-for-league-of-legends-practice-tool-community-insights/),
[Dexerto](https://www.dexerto.com/league-of-legends/riot-updates-league-of-legends-practice-tool-with-brand-new-features-2483501/),
[dev tracker](https://devtrackers.gg/leagueoflegends/)):

1. **Dummies can't be itemized** — you cannot test damage against a specified
   defensive build. Named repeatedly as the top remaining pain point.
2. **Dummies behave unlike champions** — immune to Grievous Wounds, odd
   interactions with certain abilities, so results don't always transfer.
3. **Bot AI ceiling** — Intermediate is the top, and it is not a sparring partner.
4. **No measurement of any kind.** You can practise in it; it cannot tell you
   whether you got better. This is the gap the entire third-party category
   exists to fill.

Riot's stated position on why the tool stayed limited so long is server cost and
priorities — League is server-hosted, so every practice lobby is a real game
instance ([Yahoo/Riot](https://sports.yahoo.com/riot-games-explains-league-legends-practice-tool-limited-single-player-working-adding-ai-bots-222030221.html)).

### 2.2 Dedicated League mechanics trainers — the direct competitive set

| Tool | Platform | Price | Scope |
| --- | --- | --- | --- |
| **[LoL Dodge Game](https://loldodgegame.com/)** | Browser + Overwolf app | Free | The category leader. Skillshot, Skill+Dodge (Dodge V1 linear/off-screen projectiles, V2 enemies casting at you), **Insec** (Lee Sin Q→flash/ward→R), last-hitting, duels vs AI or players, condensed teamfight sims, knowledge tests, and a Slay-the-Spire-styled roguelike. Easy/Medium/Hard/**Ranked**, with leaderboards on Ranked. Has its own subreddit for dev contact. Overwolf build lets you drill *during queue and loading screens* |
| **[Skill Gap](https://skillgap.pro/)** | Browser | 3 free tasks; **€4.99/mo**, €3.99 quarterly, €2.99 annual | The "AimLab for League" positioning ([Esports News UK](https://esports-news.co.uk/2024/12/27/skill-gap-lol-training-tool-aimlab/)). Free: aim+map, dodge, shootvival. Premium: ~25–27 tasks across **14 champion styles**, plus a **personalised daily routine**. Tasks are typed as *Isolated* (one mechanic), *Combined* (several at once), and *Warm Ups* — a taxonomy worth stealing. Sells coaching bundles on top |
| **[MOBA Trainer](https://www.mobatrainer.com/)** | Overwolf + desktop | Free tier; **€9.99/mo** premium | Built by LEC/ERL coaches and players; sponsored the LPL English broadcast. **Daily macro puzzles** — chess-tactics format, multiple choice on real game states with a full explanation of the right play — over a [**51-pattern macro map**](https://www.mobatrainer.com/patterns): Economy (7), Vision (8), Map Movement (14), Fighting (12), Game State (10). Puzzles are recommended by role and rank, with streaks. Mechanical minigames are the *secondary* feature. Publicly endorsed by pros (TL Lourlo, Wakz) |
| **[EloAscend Mechanics Trainer](https://www.eloascend.com/lol-mechanics-trainer)** | Browser | Free | Last hit, orbwalk, skillshot aim, skillshot dodge. **10 difficulty levels**; play as Ezreal, Caitlyn or Vayne |
| **[Smiterino](https://smiterino.com/)** | Browser + mobile + extension | Free | Single-purpose and does it properly: **130 rounds reconstructed from real D1/Master/Challenger matches** — dragons, barons, heralds, elders. The best example in the space of "one skill, real scenarios" |
| **[LEAGuess Combos](https://leaguess.com/combos/)** | Browser | Free | 100+ champion-specific combos (Riven, Zed, Yasuo…), plus custom sequences. Keypress-sequence practice, not a simulation |
| **[LoLComboTrainer](https://classicq.itch.io/lolcombotrainer)** | itch.io | Free | QWER + right-click warm-up with configurable spawn rate and area. Deliberately minimal |
| **[League of Trainer](https://maxtigames.itch.io/league-of-trainer)** | itch.io, browser | Free | Small indie practice game |
| **[MOBA Dodge Trainer](https://store.steampowered.com/app/3170880/MOBA_Dodge_Trainer/)** | Steam | Paid | Positioning/dodging with MOBA camera perspective |
| **[MinionForce](https://zadirion.itch.io/minionforce)** | Windows | Pay-what-you-want | Offline last-hitting for LoL/HotS/Dota |
| **[LoL Last Hit](https://www.torxentertainment.com/lollasthit/)** (Torx) | iOS + Android | Free | Mobile CS trainer: caster/melee waves every 30s, gold, shop, items, XP. The only serious mobile entry |

### 2.3 Adjacent generic trainers players actually use

- **[Aim Lab](https://aimlabs.com/)** — partnered with Riot and Ubisoft for official FPS training solutions; no first-party League mode. Players use generic click/track tasks as warm-up.
- **[KovaaK's](https://kovaaks.com/)** — thousands of scenarios and deep customisation; the community consensus is it wins on breadth, Aim Lab on partnerships ([ONE Esports](https://www.oneesports.gg/valorant/aim-lab-vs-kovaak/)).
- **[3D Aim Trainer](https://www.3daimtrainer.com/)** — browser, low-friction, named alongside the above in the [aim-trainer literature](https://en.wikipedia.org/wiki/Aim_trainer).
- **[osu!](https://osu.ppy.sh/)** — the perennial League warm-up. Players match osu! and League sensitivities to keep one cursor feel across both; it trains click precision and rhythm, nothing about windups.
- **[Human Benchmark](https://humanbenchmark.com/tests/reactiontime)** — the free reaction-time baseline everyone quotes.

### 2.4 Client-adjacent scripts and lobby tools — the risky tier

- **[BluePot](https://github.com/j4n7/bluepot)** — spawns jungle camps early inside Practice Tool and adds a clear chronometer. Explicitly **not Riot-approved**; its own docs say Practice Tool only, to reduce risk.
- **[Jungle-clear-timer](https://github.com/Kyariban/Jungle-clear-timer)** — press C at clear start, get timings and mistakes.
- **[5v5 Practice Tool lobby scripts](https://github.com/lowyiyiu/League-of-Legends-5v5-Practice-Tool)** and similar bot-adders — largely obsoleted by 25.S1.1.

**The rules these live under** ([Riot developer policies](https://developer.riotgames.com/policies/general)):

- Prohibited: automating actions on the player's behalf — ward jumps, complex
  combos, "impossible" dodges; any keyboard/mouse feature that fires sequences
  automatically.
- Prohibited: reading game memory outside the **Live Client Data API** — treated
  as unauthorised third-party software, on par with cheats.
- Prohibited since **13 March 2025**: enemy ultimate-ability alerts.
- Permitted: apps built strictly on the official API; policy-compliant companion
  apps are not flagged.

**This is a moat, and APEX is already on the right side of it.** A trainer that
never touches the client, reads no memory, needs no account and makes no network
calls during play is outside the risk surface entirely. Anything that reaches
into the client to make practice better is one policy update from deletion.

### 2.5 Analytics, overlays and AI coaches — a different product, often confused for one

Not practice tools; they tell you what happened rather than giving you reps. Worth
knowing because they own the "improvement" mindshare and the install base.

- **[Porofessor](https://porofessor.gg/)** — best-in-class champ-select opponent
  profiling; 9M+ users claimed; Overwolf-based with a newer standalone.
- **[Blitz.gg](https://blitz.gg/)** — standalone Electron; auto runes/builds;
  recurring complaints about RAM use.
- **[Mobalytics](https://mobalytics.gg/)** — deepest post-game analytics via GPI;
  runs on Overwolf.
- **[iTero](https://www.itero.gg/)** — AI drafting coach, 500k+ users, acquired by
  GIANTX; several 2026 round-ups call it the best-in-class companion app.
- **[Hexgate](https://hexgate.app/)**, **buildzcrank**, **[statup.gg](https://statupgg.itch.io/statupgg)**
  (AI voice coach reading the screen), **Hakko AI** — the 2026 AI-coach wave.
- **U.GG / OP.GG / LeagueOfGraphs** — stats and benchmarking.

### 2.6 Courses and human coaching

- **[Skill Capped](https://www.skill-capped.com/)** — deep theory, homework,
  progress tracking; the "understand the game" option.
- **[ProGuides](https://www.proguides.com/)** — shorter lessons, more games, live
  coaching, active community. [Trustpilot reviews](https://www.trustpilot.com/review/proguides.com)
  carry recurring complaints about price and subscription auto-renewal practices.
- **[Agurin.gg](https://agurin.gg/)** and similar creator courses — role-specific
  macro courses.
- Skill Gap and MOBA Trainer both bolt coaching onto their tools; coaching is the
  monetisation layer of choice in this space.

---

## 3. What the community says

Sourced second-hand, per the caveat at the top. The themes are consistent.

**"The Practice Tool is a sandbox, not a gym."** Players like that it exists —
one commonly quoted line is that its existence since Season 7 is itself progress
— but the frustrations are stable and specific: no dummy itemization, dummy
interactions that don't match champions, weak bots, and no feedback of any kind.
The multiplayer request was the loudest, and it was granted in 2025
([zleague](https://www.zleague.gg/theportal/improvement-desires-for-league-of-legends-practice-tool-community-insights/)).

**Aim trainers are for warming up, not for improving at League.** The most
common community position, and it is well-argued: League skillshots each have
their own hitbox width, travel speed and cast animation, none of which a generic
FPS trainer reproduces; isolated-movement training risks a false sense of
improvement; the counter-advice is to spawn dummies in the Practice Tool and
train in the game's own environment. The moderate position — aim trainers and
osu! are good for warming the hands — is where most people land
([GameGrin](https://www.gamegrin.com/articles/five-ways-to-improve-your-aim-in-league-of-legends/),
[Dignitas](https://dignitas.gg/articles/how-to-improve-your-skillshots-in-league-of-legends)).

**Isolated browser drills have a real constituency.** LoL Dodge Game shows up on
"resources to improve" lists next to the Wiki and op.gg
([Vanta](https://www.vanta.gg/post/top-10-resources-to-use-to-improve-at-league-of-legends)),
and Dignitas published a full guide on using it deliberately. The framing that
sticks is *isolation*: "practice isolated skills such as dodging, farming and
hitting skillshots."

**Fidelity is the standing objection to every out-of-client trainer.** Browser
zoom and scaling change hitbox feel; animation and damage-point sync is hard to
get right; sensitivity, camera zoom and resolution differ from the client. Riot's
own designers have said out loud that even *in* League, perfectly accurate
skillshot indicators felt wrong to players and had to be tuned
([dev tracker, Riot August](https://devtrackers.gg/leagueoflegends/p/607b8255-riot-august-on-why-skill-shots-indicators-aren-t-perfectly-accurate)).
Any trainer claiming transfer is making a fidelity claim, and it will be tested.

**Mechanics are increasingly framed as trainable, not innate.** The 2026 coaching
guides converge on the same language: mechanics are "repeatable micro-actions —
cursor placement, spacing, timing, inputs — that you can train like a sport,"
practised as flash-dodge / skillshot / combo drills with weekly routines and
benchmarks ([Boosteria](https://boosteria.org/guides/lol-mechanics-drills-2026-flash-dodges-skillshots-combos)).
That is the market APEX is in, and it is growing.

**Macro was the thing "you can only learn by playing" — and that assumption just
broke.** The traditional answer was VOD review and asking "why did they recall
there." MOBA Trainer's daily puzzle format, endorsed on-record by pros, is the
first credible counterexample: chess-style tactics puzzles over real game states.
Expect this format to spread.

**Pro warm-ups are unglamorous.** Stretching, then last-hitting or a custom game
to warm the hands, then goal-setting and VOD review. No pro routine in the
sources leans on a third-party mechanics trainer as its centrepiece.

---

## 4. What the evidence actually supports

This is the part almost nobody in the space uses, and it is the most defensible
material available.

**Spacing beats cramming, at enormous scale.** *Mind the gap: Distributed
practice enhances performance in a MOBA game* (PLOS ONE, 2022) analysed
**162,417 League players**: players who cluster games into short windows reach
lower performance than those who space the same games over longer windows, and
**the timing of intense periods doesn't matter — total spacing does**
([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0275843)).
Direct product implication: a trainer that pushes *short daily sessions and stops
you* is aligned with the evidence, and a grind ladder is not.

**Input skill is measurable, multi-dimensional, and rank-discriminating.**
*Characterizing and Quantifying Expert Input Behavior in League of Legends*
(CHI 2024) logged **4,835 matches from 193 players including 18 professionals**,
derived **eight input-skill indices**, and found all eight differ significantly
between rank groups — with the top group behaviourally distinct from everyone
else. The paper's explicit position is that **APM is "very limited"** as a
statistic. A three-week follow-up in which players were shown a visualisation of
their own input-skill levels produced meaningful behaviour change
([ACM](https://dl.acm.org/doi/10.1145/3613904.3642588)).
This is close to an academic validation of APEX's whole thesis: measure
*correct* actions along multiple named axes, show the player where they sit, and
behaviour moves.

**Expertise is partly a looking skill.** Expert League players show **wide
horizontal gaze distribution and consistently short fixation durations** — they
sample a wider area and need less time per glance
([PLOS ONE, 2023](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0288770)).
And in an 80-participant lab study, experts beat regulars and non-players on
**visuospatial working memory and attention control**
([Frontiers in Human Neuroscience, 2022](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.933331/full)).
APEX's Map Recall test — photograph the minimap, play off the photograph — is
sitting directly on top of both findings and is one of very few drills anywhere
that trains the glance rather than the hands.

**Practice-behaviour research exists and is thin on the ground.**
*Perceptions of Effective Training Practices in League of Legends* (JEGE, 2022)
and *The Practice Behaviors of Expert League of Legends Players* (2025) both note
that esports players learn in a largely **unstructured, self-regulated**
environment — which is precisely the vacuum a structured trainer fills.

**The one efficacy claim in the commercial space is vendor-run.** Skill Gap
reports a University of Barcelona pilot: 30 minutes/day for three weeks, with
in-game skill up **23% (Gold) to 138% (Iron)**, and 33% for Platinum/Diamond
([Esports News UK](https://esports-news.co.uk/2024/12/27/skill-gap-lol-training-tool-aimlab/)).
Treat as marketing until the protocol is published — no sample size, control
condition, or definition of "skill" is available. **Nobody in this category has
independent evidence of transfer.** That is a wide-open door.

---

## 5. The gaps

Ranked by how open they are, i.e. how badly the existing set covers them.

1. **Proof of transfer.** Zero independent evidence anywhere. A trainer that ran
   an honest pre/post against rank-linked in-game metrics — CS@10, deaths,
   skillshot hit rate — and published the protocol would own the only real
   credibility in the category.
2. **The windup/backswing asymmetry, scored.** Everyone has "kiting" or
   "orbwalking" as a *label*. Nothing found in the entire inventory scores the
   thing that actually makes it a skill: a move order in the windup cancels the
   attack, the same order in the backswing is free. APEX models it and scores
   it, and the headless suite asserts that spamming scores near zero. This is
   the single clearest technical differentiator.
3. **Champion kits as rules, not keystrokes.** Combo trainers (LEAGuess, ClassicQ)
   drill *key sequences*. LoL Dodge Game's Insec mode is the one exception that
   models a real combo's geometry. Nobody found models a kit's *logic* — bolt
   stacks that only pay on three consecutive hits on the same target, a condemn
   that only stuns because you chose where to stand. APEX's Vayne path is
   effectively alone here, and it is the hardest thing in the space to copy.
4. **Lanes instead of health bars.** Most last-hit trainers are a countdown bar.
   Real lane pressure — turret shots you have to count, an enemy laner taking
   the same farm, minion aggro that punishes you for touching the champion, wave
   state that punishes free pushing — is rare. APEX has it; Skill Gap and LDG
   have last-hit modes but nothing in the sources indicates this depth. **As of
   v2.7 this gap is closed rather than narrowed:** LANE PHASE is the first ten
   minutes end to end at League's own minion, turret, experience, level, mana
   and respawn figures, against a laner that farms on prediction, punishes the
   last hits you commit to, manages the wave and counts lethal — with the whole
   ladder between Iron and Challenger expressed as behaviour rather than
   statistics. Torx's mobile *LoL Last Hit* is the nearest thing in the
   inventory and it has no opponent in it at all.
5. **Macro is a one-horse race.** MOBA Trainer's 51-pattern map plus daily
   puzzles is the only serious macro-training product, it is pro-endorsed, and it
   addresses the part of the ladder where mechanics stop deciding games. APEX has
   nothing here, and — see §6 — that is a deliberate scope decision, not an
   oversight: it is a different product built on decision review, not the arena
   simulation this trainer is.
6. **Settings fidelity as a feature.** The standing objection to browser trainers
   is that the feel doesn't match the client. Nobody has answered it properly —
   mirroring in-game sensitivity, camera zoom and scale, resolution, attack-move
   and target-champions-only bindings, and saying so loudly. Whoever does this
   first gets to make a transfer claim the community can't wave away.
7. **Session design that follows the spacing evidence.** Skill Gap has a daily
   routine; nobody builds around the PLOS finding — short, spaced, and *stopping
   you*. A trainer that says "that's enough, come back tomorrow" and cites the
   study is differentiated and, on the evidence, correct.
8. **Vision and jungle tracking.** Smiterino owns smite. Warding, vision denial,
   camp timers and enemy-jungler tracking are covered only by timer overlays and
   unapproved client scripts. No drill, no scoring, no ladder — and jungle
   tracking in particular is a *quantifiable inference* task that would fit a
   test format cleanly.
9. **Contested objectives beyond smite.** Smiterino proves the format works with
   real recorded scenarios. Nobody has generalised it: dragon setups, baron
   dances, herald timings as decision puzzles under a closing window.
10. **Cross-tool benchmarking.** Every tool has its own score. Nothing maps a
    trainer score to anything a player recognises. APEX's Iron→Challenger ladder
    is the right instinct and is careful to disclaim that it isn't a ranked
    prediction; the missing half is calibration against real in-game data.

---

## 6. Where APEX actually stands

**Uncontested, or nearly:**

- Windup/backswing cancellation modelled and *scored*, with headless proofs that
  correct play beats spam (§5.2).
- A champion path that teaches a kit's rules rather than its key order (§5.3).
- **A modelled *opponent*, not a pattern generator.** SHERIFF fields a Caitlyn
  with League's own ranges, cast times and trap behaviour — including the trap
  dealing no damage, which is the whole reason it is dangerous — and scores
  what the player did about each ability separately. Every dodging trainer in
  the field throws shapes; this one throws a champion's kit for a reason, at
  the moment that kit is most likely to land, and the results screen names
  which of her four buttons you are losing to.
- **A whole lane phase, not a last-hit drill.** LANE PHASE plays the first ten
  minutes at League's own numbers — 477/296/900 health minions, 21/14/60 gold,
  59.06/29.5/92.4 experience, a 775-unit turret hitting for 152 and ramping into
  champions, thirty-second waves with a cannon on every third, League's level
  curve, mana, health regeneration, recall and respawn table — against a laner
  doing the same job. Underneath it the original last-hit drill is unchanged: a
  ninety-second rep about the gesture, on numbers scaled for that (§5.4).
- Twelve isolated skill tests including **Map Recall** and **Cooldown Tracker** —
  the gaze and working-memory findings in §4 say these matter, and essentially
  nobody else trains them.
- A thirteen-bench APM lab that leaves the game behind entirely — pads, gates
  and clocks rather than minions and camps — and scores *correct* actions per
  minute, with a verb for the press you were right not to make. A random masher
  scores under 5%: precisely the critique CHI 2024 makes of raw APM.
- Deterministic 240Hz simulation, so a 60Hz laptop and a 240Hz monitor score the
  same. No competitor makes this claim.
- No client contact, no account, no network during play: entirely outside Riot's
  third-party risk surface (§2.4).

**Where the field is ahead of us:**

- **Macro** — MOBA Trainer, comprehensively (§5.5), and **out of scope on
  purpose.** Macro puzzles are a decision-review product: a static game state,
  a multiple-choice question, an explanation. APEX is a real-time arena
  simulation measuring what your hands do under a clock. Bolting a puzzle
  screen onto it would not close the gap, it would build a second, worse
  product next to a good one. Leave macro to the tool built for it and stay
  the best answer to "make me mechanically better," which is a full lane on
  its own.
- **Champion breadth.** Skill Gap advertises 14 champion styles; EloAscend has
  three champions; APEX has one champion path (Vayne), one modelled opponent
  (Caitlyn) and a second path (Ezreal) built but not surfaced in the client.
- **Distribution.** LoL Dodge Game's Overwolf build lets players drill *inside
  the queue and loading screen* — the highest-intent practice moment there is.
  APEX is a web app you have to remember to open.
- **Social proof.** Leaderboards (LDG), pro endorsements (MOBA Trainer),
  a published pilot study however soft (Skill Gap). APEX has none of the three.
- **Session framing.** Skill Gap's Isolated / Combined / Warm-Up taxonomy is a
  better shelf for a drill library than a flat list, and APEX now has 30 drills
  + 13 lab benches + 12 tests to shelve — though the client itself no longer
  shows a flat list at all: it shows one lane and the six pieces of it.

**What I would do next, in order:**

1. **Ship the fidelity claim.** Mirror the client's settings surface —
   sensitivity, camera zoom and scale, attack-move and target-champions-only
   bindings — and document the constants (attack cycle split, missile speeds,
   cancellation rules) in public. It converts the category's standing objection
   into our strongest argument, and most of the model is already built.
2. **Say the spacing finding out loud, in the product.** The daily programme
   already exists; give it a stop point, and cite the 162k-player result on the
   screen where it stops. Cheap, honest, differentiating.
3. **Stay mechanics, deliberately.** Not macro puzzles, not MOBA Trainer's
   pattern map — a different product for a different part of the ladder. Spend
   the effort macro would have cost on depth in the lane already staked out:
   more skill tests, a wider lab roster, a second champion path (§6.5). Every
   drill, test and mode in APEX is something your hands do against a clock;
   keep it that way and be the best version of that, rather than a worse
   version of two products at once.
4. **Generalise the Smiterino trick.** Real recorded scenarios beat synthetic
   ones for credibility. Objective-contest decisions under a closing window sit
   next to Execute Check in the existing rack.
5. **Second champion path, chosen for contrast.** Vayne teaches windup discipline.
   A second path should teach something else entirely — combo buffering under
   pressure, or a mobility kit where the skill is *where you land*. The Ezreal
   path in `src/drills/ezreal.ts` is that second path, already built and
   already covered by the harness; surfacing it is a menu decision rather than
   an engineering one.
6. **More modelled opponents, one matchup at a time.** Caitlyn proved the
   shape: a kit whose telegraphs are the curriculum, an enemy-side kit class
   that owns its own abilities while the existing bot brain owns its feet, and
   a score that reads per-ability rather than per-hit. Every subsequent
   opponent is that pattern again with different numbers, and each one is a
   matchup a player can name — which is a far easier thing to want than
   "dodging practice".
7. **Get one leaderboard and one external number.** A Ranked-difficulty
   leaderboard per axis (LDG's model) plus, eventually, an honest pre/post study
   — even a small, transparent one — buys credibility nobody else in the
   category currently has.

---

## 7. Source list

**Riot / official** — [Practice Tool wiki](https://wiki.leagueoflegends.com/en-us/Practice_Tool) ·
[Patch 25.S1.1 notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-s1-1-notes/) ·
[Riot developer policies](https://developer.riotgames.com/policies/general) ·
[Riot on the single-player limit](https://sports.yahoo.com/riot-games-explains-league-legends-practice-tool-limited-single-player-working-adding-ai-bots-222030221.html) ·
[Riot August on skillshot indicators](https://devtrackers.gg/leagueoflegends/p/607b8255-riot-august-on-why-skill-shots-indicators-aren-t-perfectly-accurate)

**Trainers** — [LoL Dodge Game](https://loldodgegame.com/) ·
[Skill Gap](https://skillgap.pro/) · [Skill Gap task list](https://skillgap.pro/pages/tasks) ·
[MOBA Trainer](https://www.mobatrainer.com/) · [51 macro patterns](https://www.mobatrainer.com/patterns) ·
[EloAscend](https://www.eloascend.com/lol-mechanics-trainer) ·
[Smiterino](https://smiterino.com/) · [LEAGuess combos](https://leaguess.com/combos/) ·
[LoLComboTrainer](https://classicq.itch.io/lolcombotrainer) ·
[League of Trainer](https://maxtigames.itch.io/league-of-trainer) ·
[MOBA Dodge Trainer](https://store.steampowered.com/app/3170880/MOBA_Dodge_Trainer/) ·
[MinionForce](https://zadirion.itch.io/minionforce) ·
[Torx LoL Last Hit](https://www.torxentertainment.com/lollasthit/) ·
[BluePot](https://github.com/j4n7/bluepot) ·
[Jungle-clear-timer](https://github.com/Kyariban/Jungle-clear-timer)

**Community and coverage** — [Dignitas: using loldodgegame](https://dignitas.gg/articles/going-above-and-beyond-a-guide-on-using-loldodgegame-to-practice-league-of-legends-mechanics) ·
[Esports News UK on Skill Gap](https://esports-news.co.uk/2024/12/27/skill-gap-lol-training-tool-aimlab/) ·
[zleague: practice tool improvement desires](https://www.zleague.gg/theportal/improvement-desires-for-league-of-legends-practice-tool-community-insights/) ·
[Vanta: top 10 resources](https://www.vanta.gg/post/top-10-resources-to-use-to-improve-at-league-of-legends) ·
[Boosteria: mechanics drills 2026](https://boosteria.org/guides/lol-mechanics-drills-2026-flash-dodges-skillshots-combos) ·
[Dodge.gg: gold to diamond](https://www.dodge.gg/en-US/lol/news/how-to-climb-gold-to-diamond-2026) ·
[GameGrin: improving aim](https://www.gamegrin.com/articles/five-ways-to-improve-your-aim-in-league-of-legends/) ·
[ONE Esports: Aim Lab vs KovaaK's](https://www.oneesports.gg/valorant/aim-lab-vs-kovaak/)

**Research** — [Mind the gap: distributed practice in a MOBA (PLOS ONE 2022)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0275843) ·
[Characterizing and Quantifying Expert Input Behavior in LoL (CHI 2024)](https://dl.acm.org/doi/10.1145/3613904.3642588) ·
[Esports experts' gaze distribution (PLOS ONE 2023)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0288770) ·
[Visuospatial WM and attention control (Frontiers 2022)](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.933331/full) ·
[Perceptions of effective training practices (JEGE 2022)](https://journals.humankinetics.com/view/journals/jege/1/1/article-jege.2022-0011.xml) ·
[Practice behaviours of expert LoL players (2025)](https://www.tandfonline.com/doi/full/10.1080/10447318.2025.2527842)

**Analytics / coaching** — [Porofessor](https://porofessor.gg/) · [Blitz](https://blitz.gg/) ·
[Mobalytics](https://mobalytics.gg/) · [iTero](https://www.itero.gg/) · [Hexgate](https://hexgate.app/) ·
[Skill Capped](https://www.skill-capped.com/) · [ProGuides Trustpilot](https://www.trustpilot.com/review/proguides.com)
