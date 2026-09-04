/**
 * PATCH NOTES.
 *
 * One list, newest first, and the only place a version number is written down
 * in this project. The client reads it, `CHANGELOG.md` is rendered from it
 * (`npm run changelog`), and `VERSION` below is whatever sits at the top — so
 * a release can never ship with three different opinions about what it is.
 *
 * The rule for what goes in an entry: it must be something a player could
 * notice. Refactors, build plumbing and test harnesses do not belong here
 * unless they changed what happens on screen.
 *
 * Versions before 1.2.0 are assigned retroactively from the commit history —
 * the project shipped continuously before it started numbering itself, and
 * inventing a paper trail would be worse than saying so.
 */

export type PatchTag = 'added' | 'changed' | 'fixed';

export interface PatchSection {
  tag: PatchTag;
  items: string[];
}

export interface PatchEntry {
  version: string;
  /** The release's name, as printed on the entry. */
  name: string;
  /** ISO date, local. */
  date: string;
  /** One sentence: what this release is. */
  headline: string;
  sections: PatchSection[];
}

export const TAG_LABEL: Record<PatchTag, string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
};

export const PATCH_NOTES: PatchEntry[] = [
  {
    version: '1.4.0',
    name: 'THE COACH',
    date: '2026-09-04',
    headline:
      'The trainer stopped handing you a score and started telling you what went wrong, what it costs, and what to do about it.',
    sections: [
      {
        tag: 'added',
        items: [
          'Error intelligence. Fourteen named mistakes, read straight off a run’s telemetry: Early Move, Held Fire, Overstep, Range Loss, Rooted, Late Dodge, Hazard Stand, Target Drop, Cursor Overtravel, Panic Click, Missed Shot, CS Miss, Inconsistent and Chip Damage. Each one carries what it means, when it happens, what it costs and the drill that trains it away.',
          'Pressure retention. The same mechanic measured on a bench and again with something fighting back, stated as a percentage. “I can do it in the practice tool” is now a number rather than a belief.',
          'Transfer readiness: foundation, isolated, combined, pressure, transfer — each scored from your best three runs in that context, so a skill can be shown as learned but not yet transferred.',
          'Plateau detection. Six or more runs of a drill going nowhere is named as a plateau, with the mistake that is capping it and a detour into the drill that trains that instead of another attempt at the same wall.',
          'Insights: findings drawn from real comparisons — a habit fading, a habit returning, a mechanic that does not survive contact, an axis climbing fast. Nothing fires on an empty profile.',
          'RECORDS. Every personal best in one place, by category, with the score it beat, the date it was set and its trend. Plus the champion path, the lab ladder and the test bests.',
          'A replay on the results screen: play, pause, 0.25×/0.5×/1×, and every attack, cancel, dodge and hit marked on the clock. Click a marker and it says what happened — a cancelled attack reports how far into the windup you moved, and every event reports the health it left you with.',
          'A personal-best ghost inside the replay: the run holding the score record, drawn on the same clock, with how many attacks each of you had landed by any given moment.',
          'Fast navigation on Ctrl/Cmd+K: drills, tests, screens and the two actions worth a shortcut.',
          'Focus mode (F2, or a setting): strips the HUD to the clock, the task, your health and the score. Everything analytical waits for the results screen.',
          'A session summary: time, quality reps, what moved, records beaten, the most common mistake of the day, and what tomorrow is for.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'Between two drills in a session you get a card, not a page: the score, the one thing that cost you, and what is next. The full breakdown is one key away.',
          'The results screen leads its read with the primary limiter, how often that mistake used to happen, and the drill that trains it away.',
          'A difficulty change states the movement and the reason for it rather than announcing a number.',
          'The assessment ends on a verdict — strongest, weakest, and the drill to start on — rather than only a rank.',
          'The ladder wears APEX’s own proficiency classes rather than League’s tier names: Foundation, Developing, Proficient, Calibrated, Refined, Advanced, Expert, Elite, Peerless, Apex. Same bands, same divisions, same thresholds, same emblems — but “my mechanics are Platinum” is a claim about a ranked ladder these drills have never measured, and the trainer should not be putting that sentence in your head.',
          'A drill whose difficulty is an opponent prints what that opponent does at this level — reaction, aim error, prediction, dodging, spacing discipline — and what the next level changes.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'A black screen after choosing a champion. Clicking through the roster rebuilt the portrait’s renderer every time, each one taking over a graphics context whose resources the last one had just released — twenty-eight clicks meant twenty-nine renderers over one increasingly broken context. The portrait now builds once and swaps the body inside it.',
          'The arena behind the menus survives losing its graphics context: it stops drawing to a dead one and the painted background takes over, rather than leaving a black rectangle behind the whole client.',
          'Anything that fails now lands on a screen that says what happened and offers a reload. Nothing in the app can leave you on a blank page any more.',
          'A champion saved by a build whose roster has since changed no longer leaves the settings roster with nothing selected in it.',
          'A personal best’s date was the date the drill was last played, not the date the record was set, so “set this week” meant “played this week”.',
          'A first run of a drill was congratulated as a personal best. It writes a baseline, and the summary says so.',
          'A skill measured for the first time inside a window was reported as having grown by its entire rating. Growth is now only counted where both ends were measured; a new reading is named as a new reading.',
          'The skill radar clipped its own axis labels against the panel edge.',
          'The top bar could push the rank chip off the end of itself on a narrower display.',
        ],
      },
    ],
  },
  {
    version: '1.3.0',
    name: 'HANDS',
    date: '2026-09-03',
    headline:
      'A place to learn the keys, a place to start each session, an attack command for WASD, an attack cycle that is actually measured, and Ezreal.',
    sections: [
      {
        tag: 'added',
        items: [
          'The WASD Academy. Nine modules in the order the skills stack: the four keys, cursor independence, strafing, aiming while moving, attack cadence, kiting, offensive kiting, defensive kiting, and a very small teamfight. The scheme switch existed already; somewhere to learn the scheme did not, and the two are not the same thing.',
          'Today: a first screen that opens on what to do next rather than on a list of everything you could do — the plan, where you last left off, and what has moved recently.',
          'The Ezreal path. Ten stages from a target that does not move to a fight that will not stop moving: the missile, the lead, Q while strafing, threading a wave, the auto-Q weave, max-range poke, kiting with something on you, the blink, the transfer, and all of it at once. Each stage is gated on the one before it, and the range indicators are drawn plainly on the first and not at all by the last.',
          'Q Mystic Shot refunds every cooldown when it lands, so an accurate Ezreal simply has more of a kit than an inaccurate one. Pressed in the attack windup it throws the auto away; pressed in the backswing it is free.',
          'An attack command under WASD. You no longer have to let go of the keys to shoot — the mouse can buy a shot while you drive. Timed onto the tick it is free; pressed early it plants your feet until the shot leaves, which is exactly what an early attack-move click costs you in League.',
          'ATTACK TIMING and ATTACK LATENCY. Every shot is now stamped with how long it sat available before you took it, backswing seconds are split into moving and standing, and the kite drill leads with the result — because "you did less damage" is a consequence and "your shots go out 240ms late" is a cause.',
          'ADVANTAGEOUS SPACING: the share of a fight spent where you can hit them and they cannot hit you. Reported by every combat drill, and the number the spacing drill now leads with.',
          'Eight bot behaviours — chase, retreat, strafe, tether, diver, bait, erratic and controlled-irregular — replacing one movement policy that could only approach, back off, or circle on a timer.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'Direction changes are instant. Rolling A into D used to cancel the axis to zero and leave you standing still for as long as both keys were down; the newer key now owns the axis and hands it back when released.',
          'Spacing runs in three stages across one run: both reaches drawn, then only as you cross them, then nothing at all. The blind third is weighted more than double the first and reported separately, because it is the only one that resembles a game.',
          'The kite drill runs in three phases: something walking at you, something running from you, and something doing neither. Kiting forwards and kiting backwards are two skills with one name, and the drill is graded on the weaker of the two — a player who can only orbwalk away from things has not learnt to orbwalk.',
          'The dodge drill has enemies in it. The patterns come out of emitters that can be killed, and the score reads DAMAGE AVOIDED and DAMAGE DEALT — running to an empty corner is still credited with what it avoided and can no longer pass.',
          'Vayne’s tumble is scored on where it puts her, not only on when it was pressed: out of their reach, and out of their reach while they are still inside hers. Condemn now weighs how narrow the wall angle was and whether it existed before you walked into it.',
          'Academy modules are gated on having played them. Almost every number the academy keeps is a share of time spent moving, and all of them were free to a player holding one key down: uptime reads 1.0, every mark is taken "on the move", and a cursor chasing marks while the feet run straight even reads as independent. Six of the nine modules scored over half that way and one scored 87%. Scores now need the module’s prompts answered and the feet making decisions — a turn or a fresh press, so the release-and-repress rhythm counts as readily as constant turning.',
          'Stop clears your target as well as your order. It is how you stop attacking, not merely how you stop walking — and it still cannot take back a committed windup.',
          'The duel arenas grade attack timing and advantageous spacing, so winning by standing still no longer reads like winning by kiting.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'Unit separation ran after everything else and answered to nothing: two bodies shoving each other against terrain could push one straight through it, and a crowd against the arena edge leaked bodies off the floor.',
          'The dodge drill’s spiral pattern staggered its shots on the wall clock, so it kept firing through a pause, landed on different frames at different frame rates, and made two runs of the same seed different runs.',
          'Three drills could be passed without playing them: Condemn paid 66% for pressing E at random, the Ezreal stages counted "landed while moving" as a share that anybody who never stands still gets for free, and the new attack-timing read scored 0.88 for a run that cancelled 98% of its own attacks.',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    name: 'CHAMPION SELECT',
    date: '2026-09-03',
    headline:
      'You pick who you are before you train, and settings became a screen you can actually find things in.',
    sections: [
      {
        tag: 'added',
        items: [
          'Champion select. Seven champions — Sentinel, Warden, Huntress, Arcanist, Revenant, Berserker and the Night Hunter — each a different silhouette off the same rig. Picking one is the first thing a new profile does, on a full-screen select where the champion stands turning at full height, animated by the same code that draws it in a drill.',
          'Your champion is the body you play in every drill that does not name its own, the figure standing front and centre in the live arena behind the menus, and a chip in the top bar one click from changing it.',
          'Settings search. Type anything, or press “/”, and the sections collapse into a flat list of matching controls — each one the real control, still labelled with the section it came from. It matches labels, explanations, option text, binding names and champion names.',
          'Changed-from-default marks, per setting and per section, with a restore that works on one section or the whole screen.',
          'Show unit names: name plates above champions can be switched off. Health bars are never hidden by it.',
          'Edge pan: pushing the cursor to the screen edge slides the camera, as League does. Off by default, and live only while a run is actually running.',
          'Patch notes: a release history in the client, reached from the version chip in the top bar, with a mark on it when there is something you have not read.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'Settings is six sections down the left instead of three tall columns, in the order a player meets them: Champion, Movement, Controls, Gameplay, Camera & video, Audio.',
          'Bindings say out loud which scheme they belong to, and mark every key you have moved off its default.',
          'No champion is stronger than another, deliberately: same speed, same windup, same range, same health. The choice reaches the renderer and stops there, so a rating earned behind one is worth exactly a rating earned behind another. The Vayne path still always spawns Vayne — those drills are about one champion with her own numbers.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'Reduced camera motion did nothing. The setting existed and was saved, but was never handed to the renderer — shake, punch-in and impact kick all played anyway.',
          'Unit name plates and edge panning were likewise wired up to nothing.',
          'One keypress at the boot gate both entered the arena and launched calibration: the client stayed mounted underneath the title card, so its Enter handler fired alongside the gate’s. The client is now unmounted rather than covered while a full-screen screen is up.',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    name: 'THE APM LAB',
    date: '2026-09-03',
    headline:
      'The APM section leaves the Rift: thirteen benches of pads, gates, wheels and clocks, measuring hands rather than teaching the game a second time.',
    sections: [
      {
        tag: 'added',
        items: [
          'Thirteen new modes replacing thirteen old ones — PULSE, SEQUENCE, CHORD, GO / NO-GO, BUFFER, CANCEL, VECTOR, FIELD, HANDOFF, SPLIT, UPKEEP, SWITCH and SUSTAIN. Eight isolate one thing; five combine.',
          'A fourth engine verb: the command you were right *not* to make. Withholding pays score and protects the chain without putting a number into “correct actions per minute” that no finger produced — so a mode about restraint can finally reward restraint.',
          'Every bench says which in-game moment it is a slice of. Applicability is bought back by naming it rather than by simulating a lane around it.',
          'A lab arena: the same floor and kerb — the geometry must not move — with the terraces, props, torches and banners not drawn, cold instrument lighting, and a measured grid where the rune ring was.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'The old APM modes were the game with a stopwatch on it: a lane to farm, camps to smite, a duelist to kite. Minions, health bars, range checks and pathing are all noise in a measurement of whether a finger went down at the right moment, so they are gone from the section.',
          'A bench with no health pool prints no health bar rather than a permanently full one.',
          'The ladder, the records and the flow tiers are untouched: your rungs and your bests carry straight over.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'A WASD command arriving inside the engine’s rate limit was dropped rather than deferred, which silently lost every command a mode asked for in quick succession.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    name: 'THE PRACTICE LANDSCAPE',
    date: '2026-09-03',
    headline: 'A written account of what else exists, what it does not do, and why APEX stays mechanics.',
    sections: [
      {
        tag: 'added',
        items: [
          'Research notes on the out-of-game practice landscape, and the gaps this trainer is aimed at.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'Macro training ruled out on purpose: the scope is mechanical execution, and saying so in writing is what keeps it that way.',
        ],
      },
    ],
  },
  {
    version: '0.9.0',
    name: 'THE APM LADDER',
    date: '2026-09-03',
    headline: 'The APM trainer gets its own section, and every mode gets ten explicit levels.',
    sections: [
      {
        tag: 'added',
        items: [
          'An APM section: thirteen modes, ten levels each, with stars per level and an endurance run at double length.',
          'A rung is a difficulty rather than a suggestion — calibration opens the ladder somewhere sensible instead of starting everyone at the bottom.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'Launching an APM mode from the drill rail plays the same rung the section would have put you on.',
        ],
      },
    ],
  },
  {
    version: '0.8.0',
    name: 'THE BENCHMARK RACK',
    date: '2026-09-03',
    headline: 'Twelve skill tests, sitting beside the ladder rather than inside it.',
    sections: [
      {
        tag: 'added',
        items: [
          'Twelve skill tests — reaction, flick, prediction, tracking, map recall, cooldown tracking and more — each with its own record, grade and trend.',
          'Live animated previews on every card in the gallery.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'A test never moves your drill rating: a twenty-second reaction instrument should not be able to promote you.',
        ],
      },
    ],
  },
  {
    version: '0.7.0',
    name: 'VAYNE ON KEYS',
    date: '2026-09-03',
    headline: 'The champion path stops merely allowing WASD and starts teaching it.',
    sections: [
      {
        tag: 'added',
        items: [
          'Dash aim: under WASD, a tumble goes where your keys are held, or to the cursor — League’s literal behaviour — whichever you ask for.',
          'The hint row on a champion drill prints the key each ability is actually on, read from your live bindings.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'The APM modes count WASD commands properly, so the two schemes are scored on the same footing.',
        ],
      },
    ],
  },
  {
    version: '0.6.0',
    name: 'ACTIONS PER MINUTE',
    date: '2026-09-03',
    headline: 'Thirteen APM modes over one flow engine.',
    sections: [
      {
        tag: 'added',
        items: [
          'An APM trainer counted in correct actions a minute, not keystrokes: aim, keys, smite, last hit, spacing, kiting, dodging and the rest.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'Last Hit became a real lane — a wave, a turret, and a reason to count its shots — instead of a metronome.',
        ],
      },
    ],
  },
  {
    version: '0.5.0',
    name: 'TWO HANDS',
    date: '2026-09-02',
    headline: 'A WASD control scheme, and a champion path that teaches one champion properly.',
    sections: [
      {
        tag: 'added',
        items: [
          'WASD as a first-class scheme: the left hand steers, the mouse only ever targets, and releasing the keys is the same commitment a click is.',
          'The Vayne path: four stages in the order they have to be learned — the tumble rhythm, the third hit, the wall, then all of it at once.',
          'Each scheme keeps its own rebinds, so switching never breaks a layout you tuned.',
        ],
      },
    ],
  },
  {
    version: '0.4.0',
    name: 'THE COLD OPEN',
    date: '2026-09-02',
    headline: 'It stops opening like a page and starts opening like a game.',
    sections: [
      {
        tag: 'added',
        items: [
          'A boot sequence: black screen, a struck crest, a load bar over the work that is genuinely happening, and a key to press.',
          'A real HUD, and a camera you can drive — centre, lock, zoom.',
          'A Skillshot drill: four travel-time skillshots on a target actively juking them.',
          'Involuntary camera motion got its own switch, separate from everything you drive.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'Opera’s mouse gestures — right-drag and the right+left rocker — could unload the page mid-run and take the run with it. A back guard now swallows them, and the trainer says so on browsers that ship them.',
          'A reclaimed GPU used to leave a black canvas and a run that had quietly stopped meaning anything; it now freezes, says what happened, and lets you restart.',
          'Stale focus rings on the last thing clicked, which read as a second selection.',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    name: 'THE RIFT, IN MINIATURE',
    date: '2026-09-01',
    headline: 'Rebuilt from a flat canvas into a real 3D arena.',
    sections: [
      {
        tag: 'added',
        items: [
          'A sunken amphitheatre with real terrain, real shadows and champions built from primitives and animated by hand — the attack windup you see is the windup timer the scoring reads.',
          'Every piece of gameplay information drawn on the ground, where the thing it is about actually is.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'A projectile trail leak, resize thrash, and a game loop that kept running after a run had ended.',
          'The ability bar now shows only what the drill actually gives you.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    name: 'FIRST LIGHT',
    date: '2026-09-01',
    headline: 'The trainer itself: drills, measured performance, and a rank that comes from it.',
    sections: [
      {
        tag: 'added',
        items: [
          'The drill set, the nine skill axes, adaptive difficulty and a ranked ladder driven by measured performance rather than time played.',
          'A results screen built to show exactly what you did and what it cost you.',
          'A single-file bundler, for hosts that want one HTML document.',
        ],
      },
    ],
  },
];

/** The version this build is. Always the newest entry — there is no second source. */
export const VERSION = PATCH_NOTES[0].version;
export const VERSION_NAME = PATCH_NOTES[0].name;
