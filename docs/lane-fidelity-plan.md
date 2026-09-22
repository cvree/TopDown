# THE LANE — League fidelity upgrade plan

Goal: the lane mode should work as real lane practice. A player who spends an
hour in it should find that their camera habits, click rhythm, last-hit timing,
level-up timing and trade windows carry over to Summoner's Rift unchanged. Where
the lane differs from League today, the difference should be removed. Anything
we cannot model yet should be named in the mode, not hidden.

This plan covers what is wrong now (with file references), what to build, the
order to build it in, and how to check that each piece matches League.

---

## 0. What is off today (audit)

Findings from reading the current code. Each item points to where it lives.

### Camera: the biggest problem (`src/gfx/camera.ts`, `src/ui/GameView.tsx`, `src/engine/session.ts`)

| # | Today | League | Effect |
|---|---|---|---|
| C1 | `locked = true` by default. Settings has no "camera mode" option, only `Y` to toggle mid-run. | Most players use **unlocked (free) camera**, with Space to go back to their champion. | Players train the wrong camera habit from the first second. |
| C2 | `edgePan: false` by default (`profile.ts:414`). | Edge pan is always on when the camera is unlocked. That is what makes a free camera usable. | An unlocked camera without edge pan is stuck in place. |
| C3 | `update()` clamps the camera so that **the whole arena stays in frame** (`slackX/slackZ`), and `ZOOM_MAX` is derived from the arena size (`recomputeBaseDistance` uses `bounds + 660`). On a 4400-wide lane the player can zoom out to see most of the lane. | The camera is clamped to the **map edges** only. Maximum zoom is a fixed distance, the same on every part of the map. | Too much information on screen. You never have to look away from your champion or scroll to see the enemy turret. |
| C4 | Cursor **lean**: the camera drifts 46–90 units toward the cursor (`leanAmount`). | No lean. The camera only moves when you move it (edge pan, Space, minimap, drag). | This is the main source of the "floaty" feel. Every mouse movement shifts the whole world slightly, which also throws off click placement. |
| C5 | Follow is a lerp (`dt * 17`), and the locked-mode pan offset springs back (`exp(-dt*3.2)`). | The locked camera is rigid: 1:1 with the champion, no smoothing. | The champion drifts off screen centre while moving, which makes movement feel wrong. |
| C6 | Shake, punch and kick on hits and casts (`addShake/addPunch/addKick`, `session.ts:759`). | League shakes the camera almost never (a few ultimates). | Distracting, and not League. |
| C7 | Edge pan triggers in the outer **6%** of the screen with a ramp (`EDGE = 0.94`). | Edge pan triggers only in the last few pixels, at a constant speed set by a "camera move speed" slider. | Resting the cursor near the edge (for example to click a far minion) pans the camera by accident. |
| C8 | Space is a **counted "range check"** that also recenters (`session.checkRange`). There is no hold-to-follow. | **Tap Space**: jump to your champion. **Hold Space**: follow your champion while held. The attack-range circle has its own toggle key. | Space in League is the most-pressed camera key. Here it is a penalised crutch. |
| C9 | No minimap camera control. `Minimap.ts` has no input handling. No middle-mouse drag. No arrow-key pan. | Left-click or drag on the minimap moves the camera. Middle-mouse drag pans. Arrow keys pan. F1 selects/centres on self. | Free cam cannot be used the way it is used in League. |
| C10 | `OPENING_VIEW_WIDTH = 2300` against `LEAGUE_VIEW_WIDTH = 2900`, and `CHAMPION_HEIGHT` scaling. Both are estimates. | Need to measure: units visible across the screen at max zoom, at 1920×1080, at the champion's screen row. | If the scale is wrong, every distance feels wrong: 330 move speed looks slow or fast, and 550 range looks short or long. This is most of "movement speed feels off". |

### Movement and input (`src/engine/world.ts`, `src/engine/input.ts`)

| # | Today | League |
|---|---|---|
| M1 | Right-click issues **one** move order per press. Holding the button does nothing more. | Holding right-click keeps re-issuing a move toward the cursor, about every 0.1–0.25s. Most players move by holding the button. |
| M2 | **Bare left click = attack-move** (`input.ts:629`). | Left click selects. Attack-move is A + left click, or "attack move on cursor". |
| M3 | `manualFire`: every basic attack needs its own command (`world.ts:367`, `:974`). | Right-clicking a unit starts **continuous auto-attacks** until another order is given. Idle champions also auto-acquire targets in range. |
| M4 | Pathing is a single probe with a ±70° steer (`world.ts:55`, `navigate`). | A* around terrain, and pathing around units (minions body-block champions). |
| M5 | No click indicator for move vs attack. | Green move marker, red attack marker. |
| M6 | No stop / hold position with League semantics in the lane. | S = stop, H = hold position (no auto-acquire). |
| M7 | Move speeds match League (Vayne 330, Caitlyn 325, minions 325). | Correct. The "wrong feel" comes from C3/C4/C5/C10 and M1, not from the numbers. Do **not** change the speed numbers. |

### Levelling (`src/drills/lanephase.ts:386-440`, `src/engine/lanebot.ts:233`)

| # | Today | League |
|---|---|---|
| L1 | Skill points are spent **automatically** from `VAYNE_SKILL_ORDER`, with a banner. | You choose with **Ctrl+Q/W/E/R** or the "+" on the ability bar. Choosing the point at the right moment (for example W or E at level 2 for an all-in) is part of the skill. |
| L2 | A big "LEVEL N · ABILITY" banner and sound on every level. | A small level-up sound and "+" markers. You are expected to track XP yourself. |
| L3 | No feedback on **when** you reached levels 2, 3 and 6 compared with the best possible time, or compared with the enemy. | Level-2 and level-3 timing decides early trades. This is the key skill to teach. |
| L4 | No rank limits enforced (R only at 6/11/16, basic max rank = ⌈level/2⌉). | Enforced. |
| L5 | The enemy level is not shown on her health bar. | Every health bar shows the champion's level. |

### Map, clock and economy (`src/drills/index.ts:166`, `lanephase.ts`)

| # | Today | League |
|---|---|---|
| G1 | A straight 4400×1400 lane, turret to turret about 3600 (mid-lane distance). | Vayne vs Caitlyn is a **bot lane** matchup. Bot outer turrets are about **4800** apart, the lane bends, and there are lane brushes plus a tri-brush and river entrance. |
| G2 | Respawn / recall puts you at `x = 60`, about 340 units behind your turret. | Fountain to bot outer turret is a long walk (around 25–30s at 330+ move speed). **Losing time walking back is the real cost of recalling or dying.** Today that cost is almost zero. |
| G3 | The clock starts at 1:05 with wave 1 already walking. | Check the current patch's first-minion spawn time and walk time. Keep the real timing, and allow "skip to first wave". |
| G4 | No shop: gold is only a score. | Starting items (Doran's Blade + potion) and first-back purchases decide who wins trades at 3–6 minutes. |
| G5 | 1v1 with no supports. XP is not shared, so both players level like solo laners. | Bot lane shares XP between two champions. This decides whether levels arrive at "duo" or "solo" times. Choose deliberately (see §4). |

### Champions (`src/engine/vayne.ts`, `src/engine/caitlyn.ts`)

Base stats and growth use League's formula, which is good. Things to verify against the current patch:
attack windup percentage, attack-timer resets (Tumble), missile speeds, spell
cast times, hitbox widths, Condemn wall-check distance, Caitlyn headshot counter
(including bush and trap headshots), Net self-knockback distance, and the
Peacemaker damage fall-off after the first target. Every value must come from a
patch-stamped reference table, not from memory.

---

## 1. Principles

1. **A fidelity switch, not a rewrite of the drills.** The other modes use
   deliberate non-League rules (`manualFire`, range checks, arena-clamped
   camera). Add one `fidelity: 'league' | 'trainer'` field on the session
   config. THE LANE uses `'league'`. The drills keep `'trainer'` unless the
   player opts in. This protects existing tests and drill scoring.
2. **One patch-stamped source of truth.** `src/engine/league/reference.ts`
   holds every League number with a comment giving the patch and source. Kits
   and the lane read from it. Tests compare against it.
3. **Measure, don't guess.** Camera scale, attack timings and level-2 times are
   checked by automated tests (`tools/simtest.ts`) against the reference table,
   and by one side-by-side recording against the real client (§9).
4. **Coaching fades by tier.** The existing `coach` levels (`full` / `marks` /
   `off`) also control the new level-timing and camera hints. At the highest
   tier the screen matches League.

---

## 2. Phase 1: Camera (do this first)

Files: `src/gfx/camera.ts`, `src/ui/GameView.tsx`, `src/engine/session.ts`,
`src/engine/input.ts`, `src/progression/profile.ts`, `src/ui/Settings.tsx`,
`src/ui/hud/Minimap.ts`.

1. **Free cam by default everywhere.**
   - New profile setting `cameraMode: 'free' | 'locked'`, default `'free'`,
     plus a migration for existing profiles (set it to `free` once, record
     that the migration ran, and respect the player's choice after that).
   - `RiftCamera.locked` is initialised from the setting at run start. `Y`
     still toggles it.
   - When the mode is free, edge pan is always on. The `edgePan` setting only
     affects locked mode (as in League, where edge pan in locked mode is a
     temporary offset).
2. **League camera model** (`camera.ts`, behind `fidelity === 'league'`):
   - Remove the cursor lean (C4). Set `leanAmount = 0` in league mode.
   - Rigid follow when locked: `smoothed.copy(target)`, no lerp, no pan
     spring (C5).
   - Clamp to **map bounds**, not "the whole arena must be visible" (C3). The
     look point can reach any point on the map. The frame can show off-map
     scenery at the edges, like League.
   - **Fixed zoom range** in world units, not based on arena size: max zoom =
     League max (from calibration, §9), min zoom around 70% of that.
     `recomputeBaseDistance` stops depending on `bounds` in league mode.
   - Default `motionScale = 0` in league mode (C6). Keep the setting.
3. **Edge pan like League** (C7):
   - Trigger zone of a few pixels (default 4px, with a setting), not 6% of the
     screen.
   - Constant speed from a **Camera Move Speed** slider (0–100, League's
     default of 50 maps to the calibrated units/s). No ramp.
   - Only while the window has pointer focus; pause when the pointer leaves
     the window.
4. **Space and camera keys** (C8, C9):
   - Tap Space: snap to champion. Hold Space: follow while held (locked
     behaviour), then release to return to free cam at that position.
   - Move the range check off Space in league mode. Add a separate
     **show attack range** control: a "Show attack range" setting plus a hold
     key (default unbound), the same pair League offers. Stop counting range
     checks in league mode.
   - Arrow keys pan at the edge-pan speed.
   - Middle-mouse drag pans (1:1 with ground movement).
   - F1: centre on self (same as a Space tap).
   - Minimap: left-click / drag moves the camera to that point. Right-click on
     the minimap issues a move order (League behaviour).
5. **Events**: on respawn and on recall arrival, do **not** move a free
   camera. League does not either, which is why players learn to press Space.
   Hint at `coach: 'full'` only: "SPACE: back to your champion".
6. **HUD**: the camera-mode indicator above the minimap already exists
   (`GameView.tsx:1105`). Show "FREE / LOCKED" with the key.

Acceptance:
- The default run starts in free cam with edge pan.
- Moving the mouse never moves the camera unless the cursor is within 4px of
  a screen edge.
- At max zoom, the world width visible at 1920×1080 matches the calibrated
  League value within ±3%.
- On the lane you cannot see both turrets at once at max zoom.
- Tests: new simtest cases for lean = 0, a rigid follow, the edge-pan trigger
  zone, and a zoom range independent of arena size.

---

## 3. Phase 2: Movement and input

Files: `src/engine/input.ts`, `src/engine/world.ts`, `src/engine/types.ts`,
`src/engine/session.ts`, `src/gfx/overlay.ts` (click markers).

1. **Hold-to-move** (M1): while the move button is held, re-issue a move to the
   current cursor ground point every 0.1s (and on any cursor movement over 8px,
   capped at 30 orders/s). Count these as one "held move" for APM, so the
   metrics are not inflated.
2. **League attack semantics in league mode** (M3):
   - `manualFire = false` for the player when `fidelity === 'league'`.
   - Right-click on an enemy = attack-target order that repeats until
     replaced. Kiting still works because any move order cancels the attack
     chain after the windup, exactly as today.
   - Idle auto-acquire: a stationary champion attacks the nearest enemy in
     range (League's "Auto Attack" setting, on by default, with a setting to
     turn it off).
   - Hold position (`H`) and Stop (`S`) with League behaviour.
   - Last-hit metrics stay correct: a last hit is credited by who landed it,
     not by the command count. Check the `lanephase.ts` counters for anything
     that assumes one command per attack.
3. **Left click** (M2): in league mode left click selects a unit (shows its
   stats panel: HP, AD, level). Attack-move is only `A` + left click, or
   "attack move on cursor" as a setting.
4. **Targeting helpers**: "target champions only" hold key (League default `~`)
   and League's attack-move targeting rule: closest enemy to the **cursor**
   within range when attack-move is used with "attack move on cursor".
5. **Pathing** (M4):
   - Replace the single-probe steer with grid A* over walls plus a
     string-pull (funnel) smoothing pass. The lane is small, so a 50-unit grid
     is cheap.
   - Champions path around minions. Minions do not push champions (League
     collision: units block each other, no soft push).
   - Clicking inside a wall moves to the nearest reachable point.
6. **Click markers** (M5): green chevron for a move, red for an attack on a
   target, fading over 0.4s.
7. **Speed numbers** (M7): leave them alone. Add a simtest that checks Vayne
   covers 330 ± 1 units in 1s of straight movement, and that slows and Night
   Hunter apply the way League applies them (flat bonus, then percentage,
   then the soft caps above 415 and 490).

Acceptance:
- Holding right-click and moving the mouse steers the champion continuously.
- Right-clicking a minion once lands repeated auto-attacks until the minion
  dies.
- Stutter-stepping (attack, move during backswing, attack) produces the same
  DPS curve as League for Vayne at levels 1, 6 and 9 (compare with the
  reference attack timer).
- The champion walks around a wall and around a melee minion line without
  getting stuck.

---

## 4. Phase 3: Levelling you have to learn

Files: `src/drills/lanephase.ts`, `src/engine/input.ts` (new bindings),
`src/ui/GameView.tsx` (ability bar), `src/engine/levels.ts`,
`src/engine/lanebot.ts`.

1. **Manual skill points** (L1, L4):
   - Bindings `levelQ/levelW/levelE/levelR`, default **Ctrl+Q/W/E/R** (the
     input layer already allows modifier bindings; add a chord matcher so
     Ctrl+Q does not also cast Q).
   - A "+" button above each ability slot when a point is available and the
     rank is allowed.
   - Rules: basic ability max rank = ⌈level / 2⌉ (capped at 5). R at levels 6,
     11 and 16. Unspent points accumulate.
   - Setting "Auto level-up": off by default in league mode, and used as the
     fallback for the lowest coach tier only if the player turns it on.
   - The lanebot keeps its fixed skill order, but spends points with a small
     human delay (0.2–1.5s by tier) instead of instantly.
2. **Quiet level-ups** (L2): League's small level-up sound plus the "+"
   markers. No banner at `coach: 'off'`. A small banner at `'marks'`. The
   current banner at `'full'`.
3. **XP visibility** (L3, L5):
   - XP bar around the champion portrait, like League.
   - Enemy level shown on her health bar.
   - At `coach: 'full'`: a small "level 2 in N minions" counter (for example
     "LV2: 1 MELEE") so the player learns what the counts are. At `'marks'`:
     only a tick on the XP bar. At `'off'`: nothing.
4. **Level-timing scoring** (new metrics in `lanephase.ts` and the results
   screen):
   - The time you reached levels 2, 3 and 6, compared with (a) the best time
     possible for that run's wave timings and (b) the time the enemy got there.
   - "Level-2 spike used": did you trade or all-in inside the window where you
     were level 2 and she was level 1? Did you back off in the window where
     she was ahead?
   - "Point spent late": seconds between a point becoming available and being
     spent, while an enemy was within 1000 units.
   - These feed the existing grading bands (`band`, `pct` in `base.ts`).
5. **XP model decision** (G5). Pick one and document it in the mode:
   - **Option A (recommended): solo-lane XP.** Keep 1v1 and keep the full
     (unshared) XP. Level 2 comes on the first melee minion of wave 2, which
     is what top/mid players learn. Label the mode as a 1v1 lane.
   - Option B: duo-lane XP. Keep Vayne vs Caitlyn in the bot lane and apply
     League's shared XP as if a support were present (level 2 after the full
     first wave plus the melee minions of the second, level 3 later). This is
     accurate for bot lane timings, but the missing support changes the
     trades a lot.
   - Longer term: add a support pair (Phase 7) and switch to Option B.
6. **Lanebot level awareness**: the bot already reads levels; add explicit
   "hit 2 first, then all-in" and "back off when the enemy is about to hit 2"
   behaviours so the timing is punished and rewarded the way it would be.

Acceptance:
- No point is ever spent without input when auto level-up is off.
- Ctrl+Q levels Q and does not cast Q.
- Test: with perfect farming and XP range, level 2 arrives at the exact minion
  the chosen XP model predicts (simtest against `levelFromXp` with the real
  minion XP values).

---

## 5. Phase 4: Map, clock and walk-back cost

Files: `src/drills/index.ts` (arena size), `src/drills/lanephase.ts`
(`terrain`, respawn, recall), `src/engine/lane.ts` (turret spacing, minion
path), `src/gfx/terrain.ts`, `src/gfx/walls.ts`, `src/gfx/brush.ts`.

1. **Bot-lane geometry** (G1): outer turret to outer turret about 4800 units,
   following the lane's real bend. Minions follow a waypoint path, not a
   straight line. Add both lane brushes, the tri-brush, the river entrance and
   the river brush. Walls follow the real outline closely enough that Condemn
   angles and flash-over spots are the real ones.
2. **Inner turret and base** (G2): add the inner turret (it holds a
   frozen wave and a dive against it looks like League). Model the walk back
   from the fountain, either by:
   - extending the map to the fountain (bigger world, the most accurate), or
   - (cheaper) a "walking from base" state with the real duration for your
     move speed, during which you are off the map; you then appear at the
     inner turret and walk the last part.
   Either way, death and recall must cost the real number of seconds.
3. **Clock** (G3): check the current patch's first-wave spawn and meeting
   times and put them in `reference.ts`. Start at the real 0:00 with an
   option "skip to first wave" (default on) that jumps the clock forward,
   including passive gold and cooldowns, so the numbers stay real.
4. **Fog and wards**: vision already exists. Check the ward trinket's charge
   and recharge rules and the ward's duration against the patch table. Brush
   vision rules should match League (see into brush only from inside or with
   a ward).
5. **Minion rules check**: aggro when you damage an enemy champion near enemy
   minions (range and duration from the patch table), target priority list,
   minion move speed catch-up rule, and cannon wave timing.

Acceptance:
- Dying at 5:00 costs the respawn timer plus the walk time, within 1s of
  League.
- Wave meeting point with equal pushing matches League's (checked in simtest
  from wave spawn time and path length).

---

## 6. Phase 5: Champion accuracy

Files: `src/engine/vayne.ts`, `src/engine/caitlyn.ts`,
`src/engine/league/reference.ts` (new).

1. Move every League number into the reference table with its patch.
2. For each champion check against the patch data:
   - Base stats and growth (HP, AD, AS, armour, MR, MS, range, HP5, MP5).
   - Attack windup percentage, attack missile speed, attack-timer reset
     behaviour (Tumble).
   - Every spell: cooldown per rank, cost per rank, cast time, missile speed,
     width, range, damage and ratios, and special rules (Condemn wall-check
     distance, Silver Bolts %max HP true damage, Headshot counter and bush
     and trap headshots, Net self-knockback, Peacemaker fall-off, Yordle
     Trap arm time).
3. Armour: today it is folded into health (`vayneAtLevel`). With a shop that
   sells armour or armour penetration this has to become real
   armour mitigation. Do it together with Phase 6.
4. Summoner spells: League cooldowns in league mode (Flash 300s is already in
   `summoners.ts`), plus Heal / Barrier / Cleanse / Exhaust / Ignite with the
   real numbers, chosen before the run.
5. Tests: one simtest per champion that compares every number used in a kit
   with the reference table. A patch change becomes one table edit and a
   failing test list.

---

## 7. Phase 6: Starting items and first back

Files: new `src/engine/shop.ts`, `src/drills/lanephase.ts`, HUD.

1. Start with 500 gold and a buy screen during the pre-wave time: Doran's
   Blade, Doran's Shield, Health Potion, Long Sword + potions, Cull (check
   what the current patch sells).
2. Shop opens only while in the fountain (P key, League default). Buying uses
   the real prices. Components for the usual first backs: Long Sword, B.F.
   Sword, Pickaxe, Dagger, Cloak of Agility, Noonquiver, Boots, Cloth Armour,
   Control Ward, Refillable Potion.
3. Items apply real stats (with the armour change from Phase 5). Consumables
   work like League (potion heal over time, stopped by nothing).
4. The bot buys a fixed build per tier.
5. Metric: gold spent at first back and the gold/time value of the back.

---

## 8. Phase 7: The opponent

Files: `src/engine/lanebot.ts`, `src/engine/lane.ts` (`RivalBrain`).

1. Behaviours to add, each gated by tier:
   - Last-hit priority with human reaction time and occasional misses.
   - Trades on cooldown windows: steps up when your Tumble or Condemn is on
     cooldown, backs off when it is up.
   - Level spikes (Phase 3).
   - Wave control: slow push into a cannon wave, freeze near her turret when
     ahead, crash and recall on timers.
   - Brush and trap use: traps in the brush and under minions, Net to escape
     an all-in.
   - Recall on low HP or a gold threshold, not only on HP.
2. Later: a support on each side (for example Lulu or Leona) with a simple
   brain, to make bot-lane XP and trades fully accurate.

---

## 9. Calibration: making sure it matches League

1. **Camera scale**: record the real client at 1920×1080, max zoom, default
   camera move speed. Measure:
   - screen pixels for a known distance (Vayne's 550 range circle, or Flash's
     400) at the champion's screen row;
   - edge-pan speed (time for a turret to cross the screen);
   - the camera pitch, from how a straight lane edge converges.
   Put the results in `reference.ts` (`VIEW_WIDTH_AT_MAX_ZOOM`,
   `EDGE_PAN_UNITS_PER_S_AT_50`, `PITCH`) and replace `LEAGUE_VIEW_WIDTH`,
   `OPENING_VIEW_WIDTH` and the `CHAMPION_HEIGHT` fudge with them.
2. **Model scale**: champion and minion models are sized to their League
   selection radius and height, so bodies take up the same share of the screen.
3. **Timing test**: record a real Vayne walking 1000 units and last-hitting a
   caster minion from full range. Compare frame counts with the trainer.
4. **Automated guards** in `tools/simtest.ts`:
   - camera: lean = 0, rigid follow, zoom range, edge-pan zone and speed;
   - movement: units per second, slow and soft-cap rules;
   - attack: attack timer and windup per level;
   - levels: level-2 and level-3 minion counts for the chosen XP model;
   - clock: wave spawn, meeting point, respawn and walk-back.
5. **Play check**: 10 minutes in the trainer, then 10 minutes in a League
   practice tool on the same champion. Write down every difference that is
   noticeable in `docs/lane-fidelity-log.md` and turn each into a ticket.

---

## 10. Order and size

| Phase | Work | Rough size | Why this order |
|---|---|---|---|
| 1 | Camera: free default, no lean, rigid follow, map clamp, fixed zoom, League edge pan, Space hold, minimap, calibration of scale | M | Biggest effect on feel, and every later check depends on the right scale. |
| 2 | Movement and input: hold-to-move, continuous auto-attack, left-click select, A* pathing, markers | M–L | Second biggest effect on feel. Needs the fidelity switch. |
| 3 | Manual levelling, level-timing metrics, XP model choice, bot spikes | M | The user-visible "learn your level timers" goal. |
| 4 | Bot-lane map, inner turret, walk-back cost, real clock | L | Makes recall and death decisions real. |
| 5 | Champion numbers audit and reference table | M | Correct trades. Can run in parallel with 2–4. |
| 6 | Starting items and first back | M | Needs Phase 5's armour change. |
| 7 | Smarter opponent, then supports | L | Uses everything above. |

Suggested release split (matching the repo's version style):
- **v2.22**: Phases 1 and the fidelity switch.
- **v2.23**: Phase 2.
- **v2.24**: Phase 3.
- **v2.25**: Phases 4 and 5.
- **v2.26+**: Phases 6 and 7.

---

## 11. Risks and decisions to make

- **Existing drill scoring** depends on `manualFire`, range-check counting and
  the arena-clamped camera. The fidelity switch keeps all of that for the
  drills. Only THE LANE (and any drill the player opts in) changes.
- **Free cam as a global default** changes how every drill opens. The arena
  clamp stays for the small drill arenas so a spawn can't be lost off screen.
  Only the lane gets the map-edge clamp.
- **XP model (solo vs duo)** has to be decided before the level-timing
  metrics are written, because the "best possible" level times depend on it.
- **Patch drift**: League numbers change every two weeks. The reference table
  plus its tests keeps this to a one-file update.
- **Pathing cost**: A* per order on a 4800×2000 map at 50-unit cells is about
  4000 cells. That is cheap, but re-pathing every 0.1s during hold-to-move for
  every champion should reuse the previous path when the goal moved less than
  one cell.
