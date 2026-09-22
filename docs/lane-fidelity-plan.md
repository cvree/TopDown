# THE LANE: the plan to become the most accurate League lane trainer that exists

> **Goal.** A player who practises in THE LANE should find that the camera,
> the clicks, the attack timer, the minion wave, the level timers, the trades
> and the recall decisions carry over to Summoner's Rift unchanged. They should
> not notice they have switched programs. We then prove that it carries over,
> in public, with numbers nobody else in the category has.
>
> **Standard to beat.** Skill Gap (skillgap.pro), the strongest paid competitor.
> The bar is not "better on most axes". The bar is that on every axis a player
> cares about there is no serious comparison, and that each claim is backed by
> a test that runs on every build.

This document is the whole plan: what is wrong today, what "identical to
League" means in measurable terms, every workstream needed to reach it, the
order to build it in, and how we will know we got there.

Contents

1. [Where we stand against Skill Gap](#1-where-we-stand-against-skill-gap)
2. [The fidelity contract: what "identical" means](#2-the-fidelity-contract)
3. [Audit: everything that is off today](#3-audit-everything-that-is-off-today)
4. [League reference facts (and how sure we are)](#4-league-reference-facts)
5. [Workstreams](#5-workstreams) (W1–W20)
6. [Milestones and exit criteria](#6-milestones-and-exit-criteria)
7. [The "no comparison" checklist](#7-the-no-comparison-checklist)
8. [Risks, policy and open decisions](#8-risks-policy-and-open-decisions)

---

## 1. Where we stand against Skill Gap

### 1.1 What Skill Gap is (as publicly described)

Sources: skillgap.pro search listings, its patch-note titles, Esports News UK
(Dec 2024) and our own `docs/landscape.md`. The site itself is blocked from
this environment, so this is **as reported, not hands-on**. Before any
marketing copy uses it, someone should play it for an hour and confirm.

- "The AimLab for League". Browser-based. More than 260K players claimed.
- **25–27 tasks**: aim, dodge, kiting, last hit, spacing, smite, "shootvival",
  hooks. Grouped as *Isolated*, *Combined* and *Warm-ups*. **10 difficulty
  levels** per task. Favourites, a **Custom Mode**, and a **personalised daily
  routine**.
- **14 "champion styles"** ("train with your main"), plus recent additions
  like hook champions and Sivir.
- Free tier with 3 tasks. Premium is €4.99/month (€2.99 on an annual plan).
  Paid coaching is sold on top.
- One efficacy claim: a vendor-run pilot with the University of Barcelona
  (30 minutes a day for 3 weeks, "+23% to +138%"). No protocol, sample size
  or control group has been published.

### 1.2 Where Skill Gap is structurally weak, and where we will win

| Axis | Skill Gap (as reported) | APEX after this plan | How we prove it |
|---|---|---|---|
| **Full lane phase** | Isolated tasks and "combined" tasks. No evidence of a full lane with a wave, turrets, levels, gold and an opponent playing the same lane. | 0:00–15:00 of a real lane: League minion AI, turret AI, XP, gold, items, recall, respawn and walk-back, against a laner bot that plays to win. | Conformance suite (§2). Side-by-side videos. |
| **Champion accuracy** | "Champion styles" (a look plus a projectile). | Real kits built from patch data: every cooldown, cost, cast time, missile speed, width, windup and reset. | Per-champion conformance tests generated from patch data. |
| **Game-feel parity** | Browser camera and controls. No published camera or tick model. | League camera geometry, free cam, edge pan, Space, minimap, 30 Hz server tick, simulated ping, League input semantics, and a settings import from your own League config files. | Published accuracy report with measured tolerances. |
| **Levelling and timers** | Not a lane, so none. | Manual Ctrl+Q/W/E/R, level-2/3/6 race scoring, XP counters that fade by tier, and the wave, cannon and recall clocks. | Level-timing tests against the patch data. |
| **Opponent** | Pattern generators and target dummies. | A behavioural laner with fog, reaction-time distributions, wave plans, trade logic and power-spike awareness; a support duo; your own ghost. | Bot benchmark suite: CS/min, trade win rate, level-2 race by tier, matched to real rank statistics. |
| **Retry the moment** | Restart the task. | **Rewind 5 seconds**, save/load any lane state, shareable scenario codes. Possible because our simulation is deterministic. | Rewind round-trip test: the same state produces the same future. |
| **Feedback** | Score and level. | Every last hit graded in milliseconds, a trade ledger, level-race chart, wave-state timeline, camera habits, and "retry this moment" from the review. | The review is built from the same telemetry the score uses. |
| **Proof of transfer** | Unpublished vendor pilot. | Optional Riot account link; before/after CS@10, level-2 difference and deaths before 10:00 from real games; a pre-registered public study. | The published protocol and results. |
| **Patch currency** | Unknown. | A data pipeline that regenerates every number each patch and fails the build when something moves. | Patch stamp shown in the client; changelog lists every number that changed. |
| **Price and policy** | Subscription. | Free core lane. No client contact, no account needed to play (already true). | n/a |

The line we are building to: **Skill Gap trains mechanics next to League.
APEX is League's lane, minus the other eight players.**

---

## 2. The fidelity contract

"Feels identical" is not testable. These are. Every item below becomes a named
test in `tools/simtest.ts` (the "Rift Conformance" suite, §W18), and the
in-client **Accuracy page** prints the current pass/fail and measured error for
each one.

| Area | Contract | Tolerance |
|---|---|---|
| Scale | Screen width in world units at max zoom, 1920×1080, measured at the champion's screen row | ±2% of the measured League value |
| Camera | Pitch and FOV match League's. No cursor lean. Locked follow is rigid. Edge-pan speed matches League's at the same slider value. | Pitch/FOV ±0.5°; pan speed ±3% |
| Tick | Game logic runs on League's 30 Hz server tick. Commands take effect on the next tick after the simulated ping. | Exact |
| Movement | Units per second, slow rules and soft caps (415/490) match | ±0.5 units/s |
| Attack timer | Attack time, windup (including the bonus-attack-speed windup modifier), missile speed, one-tick grace before release, reset timing | ±1 tick |
| Range | Measured edge to edge using both gameplay radii, like League | ±1 unit |
| Minions | Stats, growth, gold, XP, target priority, call-for-help rules (patch 26.10 rules), leash, formation and walking speed | Exact numbers; behaviour matches the scripted scenario tests |
| Turrets | Damage, ramp/heat, target rules, minion damage percentages, plating, fortification | Exact |
| Clock | First spawn 0:30, waves every 30s, cannon cadence, passive gold start and rate, walk time from spawn to the middle of the lane | ±0.5s |
| XP | Minion XP, sharing, 1400 range, kill XP, 2026 lane rules | Exact |
| Champions | Every number in a kit comes from patch data. Behaviours (resets, stun rules, headshots) have scenario tests | Exact numbers; behaviour tests pass |
| Economy | Starting gold, prices, item stats, role-quest progress | Exact |

A value we cannot model yet is **declared in the client** ("not modelled:
jungler"), never silently approximated.

---

## 3. Audit: everything that is off today

Findings from reading the code (v2.21.0). Each item points to where it lives.

### 3.1 Camera (`src/gfx/camera.ts`, `src/ui/GameView.tsx`, `src/engine/session.ts`, `src/progression/profile.ts`)

| # | Today | League | Why it matters |
|---|---|---|---|
| C1 | The camera starts **locked** and there is no camera-mode setting (only `Y` mid-run). | Most players use **free (unlocked) cam**. | Trains the wrong habit from the first second. |
| C2 | `edgePan: false` by default (`profile.ts:414`). | Edge pan is always on with a free cam. | A free cam without edge pan cannot move. |
| C3 | The camera is clamped so **the whole arena stays in frame**, and zoom is derived from arena size (`recomputeBaseDistance` uses `bounds + 660`). | Clamped to map edges only. Fixed max zoom everywhere on the map. | You see most of the 4400-unit lane. Nothing is ever off screen. |
| C4 | Cursor **lean** of 46–90 units (`leanAmount`). | No lean. | The main source of the "floaty" feel. Every mouse move shifts the world. |
| C5 | Follow is a lerp (`dt * 17`); the locked pan offset springs back. | Rigid 1:1 follow. | The champion drifts off centre while walking. |
| C6 | Shake, punch and kick on hits and casts (`session.ts:759`). | Almost never. | Distracting, and not League. |
| C7 | Edge pan in the outer **6%** of the screen with a ramp. | Last few pixels, constant speed from a slider. | Accidental panning whenever the cursor is near an edge. |
| C8 | Space is a **counted range check** that also recentres. No hold-to-follow. | Tap = snap to champion. Hold = follow. Range display is separate. | The most-pressed camera key in League is treated as a crutch here. |
| C9 | No minimap camera control, no middle-mouse drag, no arrow keys. | All three exist. | Free cam cannot be used the League way. |
| C10 | `FOV = 34`, `PITCH = 57.5°`, `OPENING_VIEW_WIDTH = 2300` against an assumed `LEAGUE_VIEW_WIDTH = 2900`, plus a `CHAMPION_HEIGHT` fudge. | Reported as about 40° FOV and 56° pitch. Needs measuring. | If the scale is off, 330 move speed and 550 range look wrong. This is most of "movement speed feels off". |
| C11 | In a browser the cursor can leave the window, so edge pan is unreliable outside fullscreen. | League confines the cursor to the game window. | Edge pan without cursor confinement fails on half the screen edges. |

### 3.2 Movement, input and combat (`src/engine/world.ts`, `src/engine/input.ts`, `src/engine/types.ts`)

| # | Today | League |
|---|---|---|
| M1 | One move order per right-click. Holding does nothing. | Holding right-click keeps issuing moves toward the cursor. |
| M2 | **Bare left click = attack-move** (`input.ts:629`). | Left click selects. Attack-move is A + click, or attack-move-on-cursor. |
| M3 | `manualFire`: every attack needs its own command (`world.ts:367`, `:974`). | Right-clicking a unit keeps auto-attacking until another order. Idle champions auto-acquire targets. |
| M4 | Pathing is one probe with a ±70° steer (`world.ts:55`). | A* over the navigation grid; units path around each other. |
| M5 | A soft separation pass pushes bodies apart (`world.separate`). | Units are solid obstacles for pathing. Minion blocks are a real thing ("body-blocked by my own wave"). |
| M6 | **Range is centre-to-edge**: `dist - target.radius <= range` (`world.ts:977`). Vayne's radius is 28. | Range is **edge to edge**: centre distance minus *both* gameplay radii (65 for most champions; minions smaller). Our effective reach is roughly 60–100 units short of League's. |
| M7 | 240 Hz deterministic simulation, and commands apply on the next 1/240 s step. | 30 Hz server tick, a one-tick grace before an attack releases, network latency, and client-side prediction for movement. |
| M8 | No click markers. | Green move marker, red attack marker. |
| M9 | Stop and hold position are not wired to League semantics in the lane. | S = stop, H = hold (no auto-acquire). |
| M10 | Armour is folded into health (`vayneAtLevel`, `hp × (1 + armour/100)`). | Real armour mitigation. It matters once items or penetration exist, and it changes turret and minion damage taken. |
| M11 | Move speed numbers (Vayne 330, Caitlyn 325, minions 325) match League. | Keep them. The wrong feel comes from C3–C5, C10, M1, M6 and M7. |

### 3.3 Levelling (`src/drills/lanephase.ts:415-470`, `src/engine/lanebot.ts:233`)

| # | Today | League |
|---|---|---|
| L1 | Skill points are spent **automatically** from `VAYNE_SKILL_ORDER`. | Ctrl+Q/W/E/R or the "+" button. Choosing the level-2 point is itself a decision. |
| L2 | A big "LEVEL N · ABILITY" banner and sound every level. | Small sound, "+" markers, an XP ring on the portrait. |
| L3 | No scoring of level-2/3/6 timing against the best possible or against the enemy. | The level-2 race decides the first trades. |
| L4 | Rank limits are not enforced (R at 6/11/16; basic rank ≤ ⌈level/2⌉). | Enforced. |
| L5 | The enemy level shows in a HUD field, not on her health bar. | On the health bar. |
| L6 | The bot levels instantly on its fixed order. | Humans take a moment, and sometimes change their order depending on the lane. |

### 3.4 Map, clock and economy (`src/drills/index.ts:166`, `src/drills/lanephase.ts`, `src/engine/lane.ts`)

| # | Today | League (current patches) |
|---|---|---|
| G1 | A straight 4400×1400 lane with turrets about 3600 apart (a mid-lane distance). | Vayne vs Caitlyn is a **bot lane**: outer turrets about 4800 apart, the lane bends, lane brushes, tri-brush and river entrance. |
| G2 | Respawn and recall put you at `x = 60`, about 340 units behind your turret. | Walking from the fountain to the bot outer turret takes about 25–30 s. Losing that time is the real cost of dying or recalling. Today it is almost free. |
| G3 | `START_CLOCK = 65`, and the comment says the first wave "leaves the base at 0:05". | **Minions now first spawn at 0:30** and take about 32 s to reach the middle of a side lane (about 22 s in mid). The comment is out of date. |
| G4 | No shop. Gold is a score. | 500 starting gold. Doran's Blade (450: 10 AD, 80 HP, 2.5% omnivamp), Doran's Bow (400; from 26.9, 8 AD from 26.10, 15% AS, 1.5% omnivamp), Cull (450), potions, first-back items. |
| G5 | 1v1 with no supports and unshared XP. | Bot lane shares XP between two champions (duo level 2 = 9 minions: the full first wave plus 3 melee from wave 2). |
| G6 | No 2026 systems. | **Role quests** (patch 26.1; bot lane earns quest points per minion, 1350 to complete) and **a 25% gold/XP penalty outside your assigned lane until level 3**. Not decisive in a 10-minute lane, but the quest bar is on screen in the real game and completing it changes gold. |
| G7 | Minion aggro includes "attacking a minion draws aggro" (`lane.ts` priority list). | **Patch 26.10 removed the aggro from attacking an enemy minion.** Call for help now fires only when you damage an enemy champion with basic attacks and most unit-targeted abilities. |

### 3.5 Champions (`src/engine/vayne.ts`, `src/engine/caitlyn.ts`)

- Base stats and growth use League's formula (good), but they are typed in by
  hand, with no patch stamp and no test comparing them to a source.
- Practice-mode shortcuts (`tumblePracticeShare`, `FLASH_PRACTICE_CD`) exist
  for the drills. The lane turns them off with `leagueCooldowns: true`
  (good). Keep that guaranteed with a test.
- Numbers to verify from patch data: windup percentages and modifiers, missile
  speeds, Tumble's attack-timer reset window, Condemn's wall-check distance and
  stun, Silver Bolts' true damage, the Headshot counter (including bush and
  trap headshots), Net's self-knockback, Peacemaker fall-off, trap arm time and
  cap, and Ace in the Hole's channel.
- **Trap to avoid:** search results mix Wild Rift numbers with PC numbers
  (for example "Vayne 575 range / 335 speed" is Wild Rift). The data pipeline
  (W1) reads PC game files only.

### 3.6 Presentation and feedback

- The HUD is a trainer HUD (score row, fields), not League's. There's no item
  bar, no gold counter in League's position, no portrait XP ring, no Tab
  scoreboard, and no minimap camera trapezoid.
- The results screen is good but general. There's no per-last-hit
  millisecond grade, trade ledger, level-race chart or "retry this moment".
- Replay is a quarter-speed telemetry path, not a state you can re-enter.

---

## 4. League reference facts

Everything the plan relies on, with a confidence level. **"Verify"** means it
must come from the data pipeline or a client measurement before code depends
on it. After W1 this table becomes generated output, not hand-written text.

| Fact | Value | Confidence |
|---|---|---|
| Server tick | 30 Hz (33.3 ms). One-tick grace before an attack releases, during which it cannot be cancelled. | High (wiki: Basic attack) |
| First minion spawn | 0:30, then every 30 s | High (wiki: Minion, 2025+) |
| Side-lane walk to the middle | about 32 s (mid lane about 22 s) | Medium, verify |
| Cannon cadence | Every 3rd wave before 15:00 (then more often) | High for the first 15 min |
| XP range | 1400 | High |
| Solo level 2 | Full first wave (265.7 XP) + first melee of wave 2 (280 needed) | High (arithmetic) |
| Duo level 2 | 9 minions: wave 1 + 3 melee of wave 2 | High (wiki: Experience) |
| Minion aggro | 26.10: attacking enemy minions no longer draws minion aggro. Call for help on damaging an enemy champion. Aggro lasts about 3 s. | High for the change; verify exact timings |
| Starting gold | 500 | High |
| Doran's Blade | 450 g: 10 AD, 80 HP, 2.5% omnivamp | Medium, verify current patch |
| Doran's Bow | 400 g: 8 AD (26.10), 15% AS, 1.5% omnivamp | Medium, verify |
| Cull | 450 g: 7 AD, +1 gold per minion kill up to 100, 350 bonus at the cap | Medium, verify |
| Role quest (bot) | Points per lane minion; 1350 to complete; 300 g plus bonuses on completion | Medium, verify |
| Lane penalty | 25% less minion gold/XP outside your assigned lane until level 3 | Medium, verify |
| Minion stats | Melee 477 HP / 21 g / 59.06 XP; caster 296 / 14 / 29.5; cannon 900 / 60 / 92.4 (in code today) | Verify growth over time |
| Turret damage to minions | Melee needs 2 shots plus a hit; caster 1 shot plus a hit (in code today) | Verify percentages |
| Camera | about 40° FOV, about 56° pitch | **Low**: must be measured (W3) |
| Vayne PC | 550 range, 330 MS | Verify (not the Wild Rift 575/335) |
| Gameplay radius | 65 for most champions; smaller for minions | Verify per unit |
| Passive gold | 20.4 gold every 10 s; start time needs checking after the 0:30 spawn change | **Verify** |

---

## 5. Workstreams

Twenty workstreams. Each one has goal, design, files, and "done when".

### W1. League data pipeline (the foundation)

**Goal:** no League number in the codebase is typed by hand.

- `tools/leaguedata/` is a Node script that pulls, for a pinned patch:
  - CommunityDragon `game/data/characters/<champ>/<champ>.bin.json` (base
    stats, growth, `attackDelayCastOffsetPercent`, the attack-speed ratio,
    gameplay and selection radii, missile speeds, spell data: cooldowns,
    costs, cast times, widths, ranges, missile speeds and damage calculations),
  - item and minion data,
  - map geometry (nav grid, brush, turret and spawn positions) for
    Summoner's Rift,
  - Data Dragon for names and version.
- The output goes to `src/engine/league/data/<patch>.json` plus a typed wrapper
  `src/engine/league/reference.ts`. The file is **committed**, so builds and
  the site never make network calls (this keeps the "no network during play"
  promise).
- It runs where network access exists (a dev machine or a scheduled CI job).
  This container's proxy blocks those domains, so the pipeline cannot run
  here.
- A **patch diff report** (`npm run leaguedata:diff`) lists every changed
  number and which tests and kits use it. It feeds the in-client patch notes
  ("26.19: Caitlyn Q cooldown 10→9").
- Hand-kept overrides live in one file with a reason for each (for example,
  behaviour the data does not describe).

**Done when:** Vayne, Caitlyn, minions, turrets and starting items read only
from `reference.ts`, and a CI job opens a PR when a new patch changes a number.

### W2. The fidelity switch and simulation model

**Goal:** League rules in the lane without breaking the drills' scoring.

- Add `fidelity: 'league' | 'trainer'` on the session config. THE LANE,
  Lane Lab (W13) and "League mode" versions of isolated drills use
  `'league'`.
- **30 Hz tick model** in league mode: the fixed-step loop still renders at the
  display rate and interpolates, but game logic (orders, attack start and
  release, damage, minion and turret decisions) is evaluated on 30 Hz
  boundaries, as the server does. Movement is shown with client-side
  prediction and correction, so it looks as smooth as League.
- **Simulated ping**: a setting from 0 to 150 ms, default 35 ms (a typical
  good connection). Commands reach the "server" after the ping. Movement is
  predicted locally. Attacks and casts wait for the server, exactly like the
  real client. "Practise at your real ping" is a feature no competitor has.
- **Determinism** stays (seeded RNG, fixed step), which makes rewind and
  scenario codes possible (W13).
- Split `lanephase.ts` (1152 lines) into `lane/state.ts`, `lane/economy.ts`,
  `lane/levels.ts`, `lane/recall.ts`, `lane/report.ts` before adding more.

**Done when:** every existing drill test passes unchanged in `'trainer'`, and
the tick and ping tests pass in `'league'`.

### W3. Camera parity (the first thing the user feels)

**Goal:** you cannot tell it apart from League's camera.

1. **Free cam by default**, everywhere.
   - New profile setting `cameraMode: 'free' | 'locked'`, default `'free'`,
     with a one-time migration for existing profiles.
   - `Y` toggles it, as in League.
   - Edge pan is always on with a free cam. The old `edgePan` setting becomes
     "edge pan while locked".
2. **League geometry** in league mode:
   - Pitch and FOV from measurement (steps 8–9).
   - No cursor lean.
   - Rigid follow when locked.
   - Clamp to the map rectangle, not "keep the whole arena visible".
   - A **fixed** zoom range in world units that does not depend on the arena.
   - `motionScale = 0` by default.
3. **Edge pan**:
   - A 3 px trigger zone (setting: 1–8 px) and a constant speed from a
     **Camera Move Speed** slider (0–100, League-style). No ramp.
   - Diagonal in corners.
   - Paused when the window loses focus.
4. **Cursor confinement** (C11), with two modes:
   - **Fullscreen**: native edges work.
   - **Pointer lock**: a software cursor drawn by us, using `unadjustedMovement`
     where supported and a **sensitivity calibration wizard** (move the
     cursor across a ruler and match the speed you feel in League). This
     makes edge pan and the cursor feel correct in a window.
5. **Keys**:
   - Space tap = snap to your champion. Space hold = follow while held. F1
     does the same as a Space tap.
   - Arrow keys pan. Middle-mouse drag pans 1:1 with the ground.
   - Range display is a separate hold key plus a "Show attack range" setting.
     Range checks are no longer counted in league mode.
6. **Minimap**:
   - Left-click or drag moves the camera.
   - Right-click issues a move order.
   - The camera view is drawn as a trapezoid.
   - League's minimap position, scale setting and flip option.
7. **No automatic camera moves** on respawn or recall in free cam. League does
   not do that either, and pressing Space is the habit. At the lowest coach
   tier only, a hint shows "SPACE: back to your champion".
8. **Calibration kit** (`tools/calibration/`):
   - A written procedure to record the League Practice Tool at 1920×1080, max
     zoom and default camera speed.
   - Measure: the pixel length of a known distance (Flash's 400 units, the
     550 range circle) at several screen rows (this gives pitch and FOV); the
     time for a turret to cross the screen during edge pan (pan speed); and
     how far out max zoom goes.
   - Record the values in `reference.ts` with the date and patch.
9. **Model scale**: champions and minions are drawn at their gameplay and
   selection radii and League-like heights, so bodies take up the same share
   of the screen.
   - Remove `CHAMPION_HEIGHT` and `OPENING_VIEW_WIDTH` guesswork.

**Done when:**
- The first run opens in free cam with edge pan.
- Moving the mouse never moves the camera unless the cursor is within the edge
  zone.
- Scale is within ±2% of the measured values.
- Both turrets are never visible at once in a bot lane.
- A blind test (W19) cannot reliably tell a camera clip from League.

### W4. Input and controls parity

**Goal:** a League player's hands work here with no retraining.

- **Full League control surface** in league mode:
  - move click, attack-move click, attack move on cursor, player attack move,
    target champions only (hold, default `` ` ``), stop S, hold H;
  - **cast modes** per slot: normal, quick cast, and quick cast with
    indicator; self-cast with Alt;
  - level up Ctrl+Q/W/E/R;
  - items 1–3 and 5–7, trinket 4, recall B, shop P, scoreboard Tab, select
    self F1, summoners D/F;
  - show attack range;
  - cursor size and style (League-like default).
- **Hold-to-move**: while right-click is held, re-issue a move to the cursor
  every tick (30 Hz), which is how League behaves. APM counts it as one held
  order.
- **Left click** selects a unit and shows its stats panel (HP, AD, armour,
  level and items).
- **Click markers**: green chevrons for a move, red for an attack.
- **Settings import**: drag in `Config/game.cfg`, `Config/input.ini` and
  `PersistedSettings.json` from the League install to import keybinds, cast
  modes, camera move speed, zoom, cursor scale, attack-move options and
  "show attack range". Parsing happens entirely in the browser and nothing is
  uploaded. **No competitor offers this, and it removes the standing "controls
  don't match" objection.**
- A **keyboard check** screen (the lab already has one) is extended to League
  bindings, including modifier chords (Ctrl+Q must level Q and must not cast
  Q).

**Done when:** a player who imports their config plays with zero binding
changes, and every League input semantic above has a scripted input test.

### W5. Movement and pathing parity

- **Nav grid A\*** on the imported map grid (W8), with string-pulling (funnel)
  smoothing. Clicking inside a wall walks to the nearest reachable point.
  - Re-path during hold-to-move only when the goal moves by more than one
    cell.
- **Unit collision like League**: units are solid for pathing. Champions path
  around minions and can be body-blocked. Minions path around each other.
  Ghosting effects (for example Tumble) ignore unit collision.
  - Replace the soft separation push in league mode.
- **Move speed**: League's formula (flat bonuses, then percentage bonuses,
  then multiplicative slows; only the strongest slow applies; soft caps at 415
  and 490; floor 110).
- **Turning**: League turns champions for movement almost instantly, and our
  model matches that. Facing the target during windup matches as well.
- **Dashes and knockbacks**: Tumble and Net use League speeds and distances
  and ignore unit collision. Condemn's wall check samples the path as League
  does.

**Done when:**
- Units-per-second, slow and soft-cap tests pass.
- Pathing tests pass: around the lane wall, through a gap in the minion line,
  and a click inside terrain.
- The body-block scenario reproduces.

### W6. Combat model parity

- **Attack timer**:
  - attack time = 1 / attack speed;
  - windup = base windup % × attack time, with League's windup modifier for
    bonus attack speed;
  - release on the tick boundary, with the one-tick grace;
  - the missile leaves from the champion's edge at League's missile speed;
  - resets (Tumble) behave like League: an instant reset, plus the Tumble
    empowered attack's timeout.
- **Edge-to-edge range** using gameplay radii (M6), for attacks, spell cast
  ranges and turret aggro.
- **Damage**: real armour and MR (fixing M10), flat and percentage
  penetration, omnivamp and lifesteal, on-hit order, and true damage (Silver
  Bolts).
- **Minions**:
  - stats and growth over time;
  - League's target priority list;
  - **patch 26.10 call-for-help rules** (G7);
  - aggro duration and leash;
  - formation, walking speed and the catch-up rule;
  - minion damage to champions and to turrets;
  - cannon cadence by time.
- **Turrets**:
  - outer turret damage and its ramp/heat stacks;
  - target priority (a champion that damages an enemy champion inside turret
    range pulls aggro);
  - minion damage percentages;
  - plating and gold per plate;
  - the 2026 turret changes (verify the plating timeline).
- Keep `LEAGUE_RULES` in `lane.ts`, but fill it from `reference.ts`.

**Done when:**
- The attack-timer test passes for every level 1–18 for Vayne and Caitlyn.
- Last-hit arithmetic tests pass: turret + auto on casters, and 2 turret shots
  + auto on melee, **at every level, including the break points where the
  pattern changes as your AD grows**.
- Minion AI scenario tests pass: aggro from a champion hit, no aggro from a
  minion hit, leash reset, and priority order.

### W7. Levelling and the level-timing trainer

This is the "level-up timers should be learned" goal.

- **Manual skill points** (L1, L4):
  - Ctrl+Q/W/E/R and "+" buttons.
  - Rank limits: basic rank ≤ ⌈level/2⌉, R at 6, 11 and 16.
  - Points can be banked.
  - "Auto level-up" exists only as an option at the lowest coach tier, and it
    is off by default.
- **League-quiet feedback** (L2):
  - A small sound and "+" markers.
  - An XP ring on the portrait.
  - The enemy level on her health bar (L5).
- **Coaching that fades by tier**:
  - `full`: a "LV2 IN: 1 MELEE" counter and a tick on the XP ring for each
    minion needed.
  - `marks`: ticks only.
  - `off`: League's own HUD.
- **Level-race scoring**:
  - The time you reached levels 2, 3 and 6, against (a) the earliest possible
    time for that run's waves and (b) the enemy's time.
  - "Spike used": did you trade or all-in inside your level advantage window?
  - "Spike respected": did you back off inside hers?
  - "Point latency": seconds from a point becoming available to spending it,
    while an enemy is within 1000 units.
- **Level-timing drill** (Lane Lab preset):
  - Wave 1 only. Press the level-up key on the exact minion that gives level
    2, and then take the trade.
  - Scored in milliseconds from the moment the level lands.
  - Also runs in duo-XP mode.
- **XP model choice** (see §8): support **both** solo-lane XP (1v1 top/mid, or
  1v1 bot marked as such) and duo XP (bot lane with supports, W11). The
  report says which one applied.
- The bot spends its points with a delay by tier, and at high tiers it picks
  its level-2 point based on the lane (the aggressive point when it will win
  the race).

**Done when:**
- No point is spent without input unless auto level-up is on.
- A test covers the level-2 minion for solo and for duo XP.
- The level-race panel appears in results.

### W8. The map: real Summoner's Rift lanes

- **Import the real geometry** (W1): the nav grid, brush polygons, and turret
  and spawn positions. Use it to build **bot**, **top** and **mid** lane
  arenas as crops of the real Rift, with the jungle entrances nearest the lane
  and the river.
- The lane arena includes:
  - **outer and inner turrets** (a frozen wave and dives near the inner turret
    need it);
  - the **fountain and base path**. Choose one of:
    - the full walk (a big world: most accurate, and the camera learning is
      real);
    - a "walking from base" state with the exact walk time for your move
      speed, then appearing at the inner turret.

    Pick the full walk if performance allows (§W17).
- Tri-brush, river and lane brushes use League vision rules (W10). Condemn
  walls are the real walls, so real Condemn angles and flash-over spots
  transfer.
- **Clock**: real 0:00 start, first spawn 0:30, and real walk-to-lane times.
  The option "skip to first wave" (default on) fast-forwards the state
  exactly, including gold and cooldowns.

**Done when:**
- The positions of turrets, brushes and walls match the Rift data within 10
  units.
- A death at 5:00 costs the respawn timer plus the walk, within 1 s of League.
- The meeting point for equal waves is within 50 units of League's.

### W9. Economy: gold, shop, items, role quests

- **Starting shop** before minions spawn:
  - League's recommended-items layout, 500 g.
  - Doran's Blade, Doran's Bow, Doran's Shield, Cull, Long Sword + potions,
    the trinket choice (ward or sweeper).
- **Shop in base** (P): components and first-back items for the champions in
  the roster (Long Sword, Pickaxe, B.F. Sword, Dagger, Cloak of Agility,
  Noonquiver, Vampiric Scepter, Boots, Cloth Armour, Null-Magic Mantle,
  Control Ward, potions, and the patch's AD-carry first items). The data comes
  from W1. Undo works while you stay in the fountain.
- **Items apply real stats and passives.** Consumables work like League
  (potion heal over time).
- **Gold**:
  - minion gold by type and time;
  - passive gold (verify the start time after the 0:30 change);
  - kill, assist and first-blood gold;
  - bounties (kept simple until 10:00);
  - plating gold.
- **Role quests and lane rules** (26.1): the bot-lane quest bar and rewards,
  and the 25% out-of-lane penalty before level 3.
- **Back timing** metrics:
  - gold banked when you recall;
  - wave state when you recall (crashed or not);
  - "back value": item power bought per second away from lane.
  - Coach message example: "You backed with 1,180 gold and a wave coming at
    you. It cost 3 melee minions and 1 cannon."

**Done when:**
- The item math tests pass.
- The bot buys a sensible build per tier.
- The recall report shows back value.

### W10. Vision and fog

- League brush rules: you see into a brush only from inside it or with a ward.
  Attacking from a brush reveals you. Revealed state lasts League's duration.
- Wards:
  - the stealth ward trinket's charges and recharge, duration by level, and
    ward cap;
  - the Control Ward and its disable;
  - the sweeper option.
- The bot has **no fog-free information**. It already asks `world.canSee`;
  extend that to memory with decay (last-seen position) and let it face-check
  at the right tiers.
- Minimap icons follow League's fog rules. The trainer view shows only what
  your team sees.

### W11. Bot lane is 2v2: supports

- A **support framework** on the same kit model:
  - first: one enchanter (Lulu or Karma) and one engager (Leona or Nautilus)
    per side;
  - later: Thresh, Braum, Milio and others.
- Support brains: zone, poke, engage on your level-2 spike, peel, ward
  tri-brush, and roam decisions switched off in lane training.
- Who plays: you are the AD carry. Your support is a bot with a
  "communication" layer: pings you can read ("engage in 3", "back"), and it
  answers your pings (ping wheel).
- Duo XP and gold-sharing rules apply automatically (the support item's gold
  rules come from the patch data).
- **Solo lanes** (top/mid) stay 1v1 with solo XP: top-lane matchups on the top
  map crop, mid-lane matchups on the mid crop.

### W12. Champion roster: real kits, fast

Skill Gap claims 14 champion "styles". We ship **real kits** and more of them.

- A **kit framework** (`src/engine/kits/`):
  - Declarative spell specs generated from W1 data: shape, range, width,
    speed, cast time, costs, cooldowns, damage and ratios.
  - Small hand-written behaviour hooks for the unusual parts (Headshot,
    Tumble's reset, the Condemn wall check).
  - The existing Vayne and Caitlyn kits are moved onto it first as the proof.
- **Per-kit conformance tests** generated from the specs, plus 3–10 hand-written
  behaviour tests per champion.
- **Roster order**, bot first, chosen for lane popularity and teaching value:
  1. AD carries: Caitlyn and Vayne (existing), Ezreal (a drill exists), Jinx,
     Kai'Sa, Ashe, Jhin, Miss Fortune, Lucian, Draven, Sivir, Varus.
  2. Supports: Lulu, Leona, Nautilus, Thresh, Karma, Braum, Milio, Rakan,
     Pyke, Senna.
  3. Mid: Ahri, Syndra, Orianna, Viktor, Yasuo, Zed, Annie, Lux.
  4. Top: Darius, Garen, Fiora, Camille, Jax, Renekton, Teemo, Sett.
  5. Target by M8: **40 real kits**, three times the 14 "styles" Skill Gap
     claims and at a different level of accuracy.
- **Matchup picker**: choose your champion and theirs, and for bot lane both
  supports. Each matchup gets a short "matchup card": ranges, power spikes by
  level, and cooldowns worth tracking. It is generated from data, with a
  written note for the top matchups.
- Models keep APEX's own silhouettes (policy, §8), readable at League scale.

### W13. Lane Lab: scenarios, rewind and practice-tool powers

This is how APEX wins on "retry the moment".

- **Rewind**: hold a key (default Backspace) to rewind up to **10 seconds**
  and replay from there. It works because the simulation is deterministic:
  snapshot the full world at 2 Hz, and replay inputs forward to the exact
  tick.
- **Save/load state** at any time. **Scenario codes**: a compact string
  (patch, champions, clock, wave states, HP, mana, cooldowns, items, levels,
  seed) that anyone can paste to play the same moment.
- **Curated scenario library** with a short "what good looks like" clip from
  the reference bot for each one:
  - Level-2 race (solo and duo).
  - Cannon wave under your turret (the turret last-hit patterns at levels
    1–9).
  - Freeze near your turret, and breaking the enemy's freeze.
  - Slow push into a crash, then recall.
  - Bouncing wave and back timing.
  - Level-6 all-in windows.
  - Their summoners down (Flash timer).
  - Dodging Peacemaker behind minions, and the trap in the brush.
  - Last-hitting while being harassed at 2 HP bars against 1.
- **Practice-tool controls** in the Lab (not in ranked lane runs):
  - Game speed 0.25×–1×.
  - Refresh cooldowns, set level, add gold.
  - Invulnerable turret toggle.
  - Minion spawning on/off and a manual wave spawn.
  - Freeze the enemy bot.
- **Isolated drills in League mode**: every existing drill (last hit,
  kiting, spacing, dodge and others) gets a "League fidelity" variant that
  uses the lane's camera, tick, input and data. This gives Skill Gap's
  isolated/combined/warm-up shape, with every piece on the same accurate
  engine.

### W14. The opponent: a laner, not a script

- **Perception**:
  - Fog-honest.
  - Reaction time sampled from a distribution per tier (not a constant).
  - Tracking noise, a click-accuracy model, and APM caps per tier.
- **Decision layers**:
  1. Survival.
  2. Kill check: lethal calculation including summoners, ignite and the
     turret.
  3. Farm, including under-turret patterns.
  4. Trade windows: your cooldowns are down, you commit to a last hit, you
     step into the minion wave, or you lose the level race.
  5. Wave plan: slow push, freeze, crash, bounce.
  6. Recall and base timing tied to gold and items.
  7. Positioning: at the edge of its range, outside the wave's aggro.
- **Matchup knowledge**: power spikes by level, item and cooldown come from
  the kit specs, so the bot plays Caitlyn like a Caitlyn player (long-range
  poke, traps on crowd control) and Draven like a Draven player.
- **Personalities**: bully, farmer, roamer-off (lane only), all-in merchant.
  Randomised per run or chosen.
- **Rank calibration**: tune each tier so its CS/min, CS@10, deaths before
  10:00 and trade rate match public rank statistics (Iron→Challenger). Publish
  the table. The existing `laneTuning` becomes the behaviour layer's inputs.
- **Ghost**: race a transparent replay of your own best run (the data already
  exists in `BestReplay`), or of the reference bot.
- **Bot benchmark suite** (`tools/botbench.ts`): N seeded lanes per tier against
  scripted player policies, reporting CS/min, level-2 race win rate, trade
  outcomes and kills. It runs in CI to catch AI regressions.
- **Later** (after M8): an imitation-learning bot trained offline on
  anonymised lane telemetry that players opt in to, shipped as a small ONNX
  model that runs in the browser.

### W15. Feedback, review and coaching

Every number a coach would read off your VOD, computed exactly.

- **Last-hit grades**:
  - Each minion you took, missed or lost gets a millisecond delta: how early
    or late your attack started compared with the ideal start, given the
    damage already in flight.
  - A histogram, plus a separate bucket for last hits under your turret.
- **Trade ledger**: every exchange with damage out and in, cooldowns spent,
  minion damage taken, and the net result in gold, XP and HP. Each is marked
  won, even or lost, with the reason ("you traded into 4 caster minions").
- **Level race chart**: XP over time for both players, with the level-up
  moments and each spike window shaded.
- **Wave timeline**: wave position and minion-count difference over time,
  labelled push, freeze or crash, with your recalls and deaths marked.
- **Camera habits** (unique):
  - % of time in free cam.
  - Space presses per minute.
  - Seconds your champion spent off-screen.
  - Seconds without looking at the minimap (a proxy: minimap clicks and camera
    jumps).
  - Edge-pan distance.
  - The camera data is compared by rank band where public data exists.
- **Input habits**: move-order rate, attack-move usage, cancelled windups,
  point latency, and misclicks (a click on empty ground next to a minion you
  then attacked).
- **"Retry this moment"**: every flagged event in the review opens Lane Lab at
  that exact state, 5 seconds earlier (W13).
- **Coach summary**: 3 bullet points, each tied to a timestamp, a number and a
  scenario to practise. It uses the existing `helped`/`hurt`/`advice` system,
  made event-specific.
- **Replay 2.0**: the full 3D replay (a deterministic re-simulation from
  inputs, not just a sampled path), with a free camera, speed control and a
  timeline of events.

### W16. HUD and presentation parity

- A **League-layout HUD** in league mode:
  - bottom-centre portrait with an XP ring and level;
  - ability bar with rank pips, "+" buttons, cooldown sweeps, mana costs and
    out-of-mana tint;
  - summoners; items and trinket; gold;
  - minimap bottom-right with the camera trapezoid;
  - top-right K/D/CS and clock;
  - Tab scoreboard.
  - The trainer overlay (score, fields) moves into a collapsible side panel
    and is hidden at the `off` coach tier.
- **Health bars**:
  - League segmentation (100 HP ticks, with thicker 1000 ticks);
  - the level badge;
  - shield and mana bars;
  - minion bars at League size;
  - the existing "damage in flight" plate becomes a coach-tier overlay.
- **Indicators**: attack-range ring, skillshot indicators in League's shapes
  (line, cone, circle), turret range when near, and the clickable area around
  units (selection radius).
- **Audio**: a last-hit coin, level-up, turret aggro warning, and an ability
  "ready" cue at coach tiers. Volumes follow League's defaults.
- **Readability**: colour-blind palette, HP bar colour options, and cursor
  size.

### W17. Performance and latency

- Frame budget: 144 fps or more on a mid-range laptop GPU with two full waves,
  turrets and four champions on the full bot-lane crop. Stable frame pacing.
- **Input-to-photon latency**:
  - Use `pointerrawupdate` (already used), the low-latency
    `desynchronized` canvas hint where supported, and no extra frame of
    buffering.
  - Show measured latency in the Accuracy page. A built-in click-to-flash
    test lets players measure it with a phone camera.
- Profile: a unit-count stress test in CI (headless timing of the simulation
  step) with a budget per tick.
- A web worker for simulation if the main thread is too busy (determinism
  preserved).

### W18. Rift Conformance suite and the Accuracy page

- `tools/simtest.ts` gains a **conformance section** generated from
  `reference.ts`, plus hand-written behaviour scenarios.
  - Every test has an ID (for example `CONF-TICK-003`) and a human sentence
    ("A move order in the last tick of the windup does not cancel the
    attack").
- **Accuracy page** in the client:
  - the patch, the number of tests passing, the measured camera/scale error,
    measured input latency, and anything declared "not modelled";
  - a link to this document and the calibration procedure.
- Make it public: publish the constants, the tests and the tolerances. Our
  answer to "does it feel like League?" is a report anyone can re-run.

### W19. Validation with real players

- **Side-by-side protocol**:
  - The same scripted actions (walk 1000 units; last-hit a caster from max
    range; kite back for 5 seconds; Flash over a wall) recorded in the League
    Practice Tool and in APEX at the same resolution and settings.
  - Compare frame counts and positions.
  - Record the differences in `docs/lane-fidelity-log.md`.
- **Blind test**:
  - 20 short clips (camera moves, last hits, trades), half League and half
    APEX, shown to players.
  - **Target: identification no better than chance** for camera and movement
    clips by M4.
- **Beta cohort by rank**:
  - 50 or more players from Iron to Master.
  - Weekly surveys ("what felt different?").
  - Telemetry of drop-off points (opt-in).
- **Transfer study** (the credibility no competitor has):
  - Optional link to the player's Riot account.
    - Uses the official API only: match-v5 timelines (CS@10, deaths before
      10:00, level-2 difference).
    - Needs a Riot production key and policy review first (§8).
  - A pre-registered protocol: a 3-week programme against a control group
    that simply plays normally, with measured outcomes.
  - Publish the protocol before the study and the results after, whatever
    they are.

### W20. Curriculum, progression and daily use

- **Shelves** (keeping the best part of Skill Gap's taxonomy):
  - **Warm-up** (3 min): a League-mode isolated drill matched to your weakest
    axis.
  - **Reps** (isolated, League mode).
  - **Scenarios** (Lane Lab).
  - **Full lane** (10 or 15 minutes).
- **Daily session**:
  - 20–30 minutes.
  - Built from your last review's weakest measurement.
  - **Stops you** when spacing research says to (PLOS ONE 2022, 162K players),
    and says why.
- **Lane Rating**:
  - Per-axis (last hitting, trading, level race, wave control, camera,
    recall).
  - Calibrated to the tier table (W14) so "your lane farms like Emerald"
    means something.
  - Existing rank emblems are reused.
- **Streaks and goals** tied to real skills ("hit level 2 first in 5 lanes in
  a row"), not to minutes played.
- **Leaderboards** per scenario code: same seed, same state, a fair
  comparison. Kept local-first, with an opt-in server later.

---

## 6. Milestones and exit criteria

Each milestone ships as a version, with a CHANGELOG entry and patch notes in
the client (existing flow: `npm run changelog`).

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M1 — v2.22 "It moves like League"** | W2 (fidelity switch and 30 Hz tick; ping later), W3 (camera parity, free cam default, calibration), the M-items from W4 (hold-to-move, attack semantics, left click, markers), edge-to-edge range (W6) | Camera conformance tests pass. Free cam default. Scale within ±2% once calibration is recorded. Hold-to-move and continuous auto-attack tests pass. |
| **M2 — v2.23 "Every number from the game"** | W1 data pipeline, W6 combat parity (armour, attack timer, minion 26.10 rules, turret), Vayne and Caitlyn moved onto the kit framework (W12), the Accuracy page (W18) | No hand-typed League number remains in the lane. Conformance suite green. Accuracy page live. |
| **M3 — v2.24 "Learn your timers"** | W7 levelling and the level-race trainer, the clock fix (0:30 spawn), W15 phase 1 (last-hit ms grades, level race chart, trade ledger) | Manual level-up. Level-2 tests pass for solo and duo. Results show the new panels. |
| **M4 — v2.25 "The real lane"** | W8 map import (bot/top/mid crops, inner turret, base walk), W5 pathing and collision, W10 vision, W16 HUD parity, W17 performance budget | Geometry within 10 units. Walk-back within 1 s. 144 fps budget met. Blind test on camera and movement clips at chance level. |
| **M5 — v2.26 "Retry the moment"** | W13 Lane Lab (rewind, save/load, scenario codes, library, practice-tool controls), League-mode variants of the isolated drills, W15 "retry this moment", Replay 2.0 | Rewind round-trip determinism test. 12 or more curated scenarios. |
| **M6 — v2.27 "Gold matters"** | W9 economy (shop, items, role quests, back timing), ping simulation, W4 settings import and cursor calibration | Item tests pass. A player plays with their imported League config and changes no bindings. |
| **M7 — v2.28 "It fights back"** | W14 new bot (perception, layers, personalities, rank calibration, bot benchmark), W11 supports (2 per side), duo XP | Bot tiers match the published rank table within tolerances. 2v2 bot lane playable. |
| **M8 — v3.0 "No comparison"** | W12 roster to 40 kits with matchup cards, W20 curriculum, Lane Rating, leaderboards, W19 transfer-study launch | Everything in §7 checked. |

Parallel work: W1 can start at once alongside M1. W12 kit additions run
continuously from M2 onward, about 2–4 kits per release.

---

## 7. The "no comparison" checklist

We are done when every line is true and demonstrable in under a minute:

- [ ] Opening THE LANE starts at 0:00 in **free cam**, with League camera
      geometry, edge pan, Space tap/hold, minimap control and no camera
      motion that you did not cause.
- [ ] A League player imports their config and plays with **their own binds,
      cast modes and camera speed**.
- [ ] The game runs on **League's 30 Hz tick at your chosen ping**, and the
      one-tick attack grace behaves the same.
- [ ] **Every number** is generated from patch data with a patch stamp. The
      Accuracy page shows the conformance suite green and the measured
      camera/latency error.
- [ ] Minions, turrets, XP, gold and the clock (0:30 spawn) match the
      **current patch**, including 26.10 aggro and 2026 lane rules.
- [ ] **Level-ups are manual** (Ctrl+Q/W/E/R). The level-2/3/6 race is scored
      against the best possible time and against the enemy.
- [ ] Real bot, top and mid lane geometry, inner turret, and **real
      walk-back cost**.
- [ ] Shop, starting items and back timing are real, and scored.
- [ ] **2v2 bot lane with supports**, and 1v1 top/mid, with behavioural bots
      calibrated to real rank statistics.
- [ ] **40 real champion kits** with matchup cards.
- [ ] **Rewind 10 s**, save/load, shareable scenario codes, and a curated
      library.
- [ ] A review where every mistake has a millisecond grade or a gold/XP cost,
      and a "retry this moment" button.
- [ ] A blind test where players cannot tell APEX camera and movement clips
      from League clips.
- [ ] A published, pre-registered transfer-study protocol.

---

## 8. Risks, policy and open decisions

**Decisions to make**

1. **XP model for the first release of the new lane.** Recommended: ship solo
   XP for 1v1 (labelled "1v1 lane") in M3, and duo XP with supports in M7. The
   level-timing drill supports both from M3.
2. **Base walk: full map or timed "walking from base" state.** Recommended:
   the full walk if M4's performance budget holds. It is more accurate and
   trains the camera.
3. **Free cam everywhere.** It becomes the global default (the user asked for
   it). The small drill arenas keep an arena clamp in `'trainer'` fidelity so a
   spawn can never be lost off screen. League-mode drill variants use the map
   clamp.

**Risks**

- **Riot policy.** Riot's fan-content ("Legal Jibber Jabber") and developer
  policies govern champion names and likenesses, monetisation and API use.
  Before any paid tier or the Riot account link (W19):
  - Review the current policy text.
  - Keep original models and art. Do not use Riot assets.
  - Apply for a production API key.
  - Keep the client untouched: no memory reading, no overlays in game
    (already true).
- **Data access.** CommunityDragon and Data Dragon are blocked from this
  container. The pipeline must run on a dev machine or CI with network
  access, and its output is committed.
- **Patch churn.** Numbers change every two weeks. The pipeline diff plus
  conformance tests keeps it to a single PR each patch. Pin the patch shown in
  the client.
- **Existing scoring.** Drill scores depend on trainer rules (`manualFire`,
  range-check counting, arena camera). The fidelity switch keeps them intact.
  League-mode scores are separate boards.
- **Scope.** 40 kits and supports is the largest item. The kit framework
  (W12) must land in M2 so each additional champion is data plus a few hooks,
  not a new 1,500-line file like `vayne.ts`.
- **Browser limits.** Cursor confinement needs fullscreen or pointer lock
  (W3). Some browsers do not support `unadjustedMovement`; fall back to the
  calibration wizard.
- **Performance** on the full-map walk (W8/W17). The fallback is the timed
  walk state.

**Sources used for this plan's League facts:** the League of Legends Wiki (Minion; Experience;
Basic attack; Doran's Blade; Doran's Bow), patch coverage for 26.1 role quests
and lane rules, patch 26.9/26.10 item changes and the 26.10 minion aggro change
(esports.gg, PCGamesN, GameRiv), Skill Gap's public site listings and Esports
News UK's coverage, and `docs/landscape.md`. Items marked "verify" in §4 must
be confirmed by the W1 pipeline or the W3 calibration before code depends on
them.
