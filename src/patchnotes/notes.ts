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
    version: '2.8.0',
    name: 'THE BENCH MOVES',
    date: '2026-09-06',
    headline:
      'The APM lab was thirteen benches of circles bolted to the floor and one pair of hands. Every pad on every bench now travels, and the minimap in the corner spends the whole run dropping something you have to get out of the way of.',
    sections: [
      {
        tag: 'added',
        items: [
          'Every pad in every lab mode moves. A bench is a formation of drifting circles rather than a diagram: the row is still a row and the ring is still a ring, but nothing inside them holds still, and the field swings wider and runs faster with the level you picked and with your own flow. The press was never the hard part of a prompt \u2014 finding which of six circles is lit, while your hands are already busy, is, and a bench that stood still let your eyes stop working about ten seconds into every run.',
          'FIELD\u2019s pads cross the floor and bounce off it rather than blinking on and waiting to be clicked, which turns the mouse mode from a click test into a tracking one. They still shrink as you chain, so the mode goes on asking for the smallest moving target you have just proved you can hit.',
          'The minimap is a second task, in all thirteen modes. Two lanes in the bottom-right corner, your blip in one of them, and a bad orb falling slowly down one of them \u2014 usually yours. The two summoner keys are which lane you stand in, printed on the board in your own bindings. It is deliberately slow: an orb takes between a second and a half and nearly four to fall, so one that lands on you is never \u201Ctoo fast\u201D, it is \u201Cnever looked\u201D.',
          'An orb that lands costs the flow tier your hands spent the last minute building, which is exactly what a gank you did not look up for costs. Getting out of the way early pays more than getting out of the way late; swapping lanes with nothing in the air is an input that bought nothing and is charged as one; and an orb falling down the lane you are *not* in pays you for leaving it alone, because on a board where standing still is usually wrong, the times it is right are the whole test.',
          'Above about level five the orb can step across once on the way down, so the lane you read is not always the lane it lands in and a dodge made too early is a dodge you have to make again.',
          'The results screen prints the map ledger under the mode\u2019s own numbers \u2014 orbs dodged, orbs taken, how fast you answered and your best clean streak \u2014 and the coach will tell you outright when a run was lost in the corner rather than on the bench.',
          'THE LAB is on the practice screen. Thirteen benches, ten levels each, one record per level, and the section opens every mode on the lowest rung you have not cleared. The number on the rung is the difficulty the bench is played at \u2014 it scales the prompts, the pads and the orbs together \u2014 and clearing a level opens the next, or two of them if you cleared it outright.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'The summoner bank belongs to the map now, in every mode: your ability row plays the bench and D and F play the corner. That is one sentence for all thirteen modes rather than a rule per mode, and it is why the two keys are never a prompt on the floor any more.',
          'SEQUENCE and CHORD are the four ability keys rather than six. A queue you read two ahead and a pair your fingers land together are both intact; what left them is the pair of keys that now belongs to the board.',
          'SWITCH measures the same thing over the near bank, the far bank and the mouse \u2014 Q and W, E and R, and a click pad that no longer holds still, so arriving at the mouse is a journey rather than a change of mind.',
          'SPLIT is rebuilt around the corner instead of around the rim of the arena. It runs the board at double rate behind a centre queue that never stops, which is what the mode always claimed to be about: the rim of the floor is somewhere your eyes already are, and the corner of the screen is not. That is exactly why the game puts the minimap there.',
        ],
      },
    ],
  },
  {
    version: '2.7.0',
    name: 'LANE PHASE',
    date: '2026-09-06',
    headline:
      'The first ten minutes of a game of League, at League\u2019s own numbers, against somebody farming and trading on the other side of the wave. Everything else in this client is a piece of it.',
    sections: [
      {
        tag: 'added',
        items: [
          'LANE PHASE, and it is the mode the rest of the client has been building toward. A lane opens at 1:05 with the first wave walking in, waves arrive every thirty seconds with a cannon on every third, and you play it end to end against an enemy laner doing exactly the job you are. Two and a half minutes when you want to run it again immediately, five and a half to get through level six, or nine minutes for the whole thing.',
          'Every number in it is League\u2019s. Melee minions have 477 health and pay 21 gold; casters 296 and 14; the cannon 900 and 60. Experience is 59.06, 29.5 and 92.4, which is why a full first wave leaves you fourteen short of level two and the first minion of the second wave gives it to you. Your outer turret reaches 775 units, hits a minion for 152 \u2014 so a caster dies to two shots and a melee to four \u2014 and ramps forty per cent a shot into a champion, which is what puts a clock on a dive.',
          'Both champions start at level one on base statistics and grow off League\u2019s own curve, taking a point every time the wave pays for one. Nothing is handed to you: at level one you have a single ability and a trinket, the ultimate arrives at six if the lane got you there, and the difference between your level and hers is a number on the HUD because it is the number that decides the next fight.',
          'Mana, for the first time anywhere in this client, and only here. It is what stops a Peacemaker every ten seconds from being a Peacemaker every ten seconds for the whole lane \u2014 an opponent who opens with four of them has nothing left for level six, and that trade is most of what early poke actually is. Condemn costs 90 of your 232, so it is a decision rather than a button.',
          'Recall, on F. Eight seconds of standing still, broken by a step or a hit, for a full health bar and every minion that died while you were gone. Health regenerates at League\u2019s rate \u2014 about one a second \u2014 so being chipped is a state you have to do something about rather than one you wait out, and knowing when to go is a lane skill this client could not previously contain.',
          'A death is a respawn timer and a walk back, not the end of the run. League\u2019s base respawn table, exactly, which before fifteen minutes is exactly the wait you know.',
          'Five opponents, and the difference between them is entirely behaviour. An IRON laner sees a killable minion nearly half a second late, throws away one attack in two on a healthy one and shoves its own wave into your turret. A CHALLENGER one is on the minion the instant the window opens \u2014 predicting the damage already in the air, exactly as the plate on the health bar teaches you to \u2014 punishes four out of five of the last hits you commit to, sets minions up under its own turret so the shot leaves them in its window, holds the wave on its own side when it is ahead, saves the Peacemaker for a target that cannot step out of it, counts lethal before it walks at you, and will come under your turret to finish you when the arithmetic says it survives. None of them has a point more health or damage than any other.',
          'The lane is a lane: two walls to condemn somebody into and four bushes to break vision in, with the fog on. The results screen leads with creep score a minute against what that opponent farms, then the differences \u2014 creep score, gold, level \u2014 because a lane is a comparison and not a solo run, and names the missed farm by cause: too late, too early, or given to your own turret.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'The practice screen opens on the lane. Everything under it is one part of that lane rehearsed until it is automatic, which is what the modes were always for, and the screen now says so in that order.',
          'The results screen keeps one record per opponent rather than one for the mode. A creep score set against IRON and one set against CHALLENGER are not the same number measured twice, and folding them together would retire a real record with an easy one.',
          'The in-run HUD has a sixth figure, because a lane is read on six at once: the game clock, creep score and its rate, your level, your mana, the gold difference and the scoreline.',
          'LAST HIT is unchanged. It is a ninety second drill about one gesture and its smaller numbers are the right numbers for that; the lane keeps League\u2019s, and the two now share one wave engine with two rulesets rather than one set of compromises.',
        ],
      },
    ],
  },
  {
    version: '2.6.0',
    name: 'THE SHERIFF',
    date: '2026-09-06',
    headline:
      'There is somebody on the other side of the floor now. Caitlyn, her whole kit, and a mode about the half of a lane you cannot rehearse alone — plus a roster you can actually pick from again.',
    sections: [
      {
        tag: 'added',
        items: [
          'SHERIFF, a sixth mode, and the first one that is not about your hands. It puts a Caitlyn on the other side of the arena with all four of her abilities and asks what you did about them. Everything above it on the menu measures your execution; this measures your reading, and no amount of solo practice reaches it.',
          'Her kit is modelled the way the champion path is modelled. Piltover Peacemaker draws its lane on the floor for the whole 0.625 seconds of its cast time, locks its direction the instant it starts, and pierces — so it is beaten by one step taken early and by nothing taken late. Yordle Snap Trap deals no damage at all, exactly as in League: what it costs is a second and a quarter of not being able to move and the Peacemaker she throws at you the moment she notices. 90 Caliber Net slows you by half and throws her out of your reach, which is what makes closing the gap a decision. Ace in the Hole is a lock-on: nothing you do with your feet beats it, and there is a wall within a second of anywhere on that floor.',
          'She has Headshot, so time spent inside her 650 units is never free — a hundred more than Vayne reaches, which is the whole physical problem of the matchup — and she reloads a few seconds after you put her down, because killing her has to be worth something and killing her permanently would end the rep.',
          'The results screen leads with your Peacemaker dodge rate and then prints the ledger behind it: Peacemakers taken, traps stepped in, ultimates broken on terrain against ultimates taken, headshots taken, takedowns, and the share of everything she aimed at you that never landed. It separates the Peacemakers that hit you while you were already held from the ones you simply missed, because those are two different mistakes and only one of them happened when the missile was in the air.',
          'SURVIVE on the Sheriff ends on the third Peacemaker that lands, and sends her a deputy as the pressure ramps, so the far corner of the arena stops being somewhere you can stand.',
          'The practice screen prints her kit in numbers under the champion’s own, for the same reason the champion’s is printed: a window you are expected to beat has to be a figure you can check against the game.',
          'CAITLYN joins the roster as a body you can wear — top hat, long coat and a rifle longer than she is tall, which is the furthest-reaching outline on the list and the only one carrying either of those two things.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'The champion picker is back. Settings opens on a roster of eight, each card leading with the silhouette rather than a stat line — because there is no stat line: every hero shares one attack profile, one health pool and one move speed, and a pick changes what you are looking at and nothing else. The Vayne modes still always spawn her, because they are about her specific numbers.',
          'A “fix this” button on a dodging diagnosis now starts SHERIFF rather than TUMBLE. Moving late, or standing in something that was drawn on the floor the whole time, is a problem with reading an opponent — so it should hand you an opponent.',
          'Her cooldowns are League’s, charged at 45% of them, which is the same decision Condemn already gets and made for the same reason: a minute against her real figures is six Peacemakers, and nobody has ever learned a read six repetitions at a time. Her health, her movement speed and every range in her kit are untouched, and her basic attack is the one number bent downwards — a Sheriff who kills you with autos is testing your spacing rather than your dodging, and there is already a mode for that.',
          'Difficulty changes how well she reads you and how fast she reacts, and nothing else: she throws the same number of Peacemakers at every setting, so a dodge rate set on one difficulty is comparable with a dodge rate set on another.',
        ],
      },
    ],
  },
  {
    version: '2.5.0',
    name: 'THE EDGE',
    date: '2026-09-06',
    headline:
      'Your attack range is not drawn any more. Centring the camera checks it for under a second, and there is a new mode built entirely out of what that changes.',
    sections: [
      {
        tag: 'changed',
        items: [
          'The ring around your feet is gone. Centring the camera — Space, or whatever you have moved it to — now paints your attack range for eight tenths of a second and then takes it away again. A permanent ring is a readout, and a readout is the reason nobody ever learns the distance: you read it off the floor for a hundred hours and then queue into a game where reading it off the floor is exactly what you are doing wrong. Every mode in the client is played this way now.',
          'The setting that used to be "Show attack range" is now three answers rather than two: on a check, always, or never. Always is the old behaviour, kept for calibrating a champion you have never played, and it is worth turning off again afterwards. A profile that had the ring switched off keeps it off; every other profile gets the check.',
          'The hint row and a new chip beside the camera lock both print the key the check is actually bound to, and the chip burns down while a check is live — so how long one lasts is something you watch rather than something you are told.',
        ],
      },
      {
        tag: 'added',
        items: [
          'RANGE, a mode about one thing: where the edge of your reach is when nothing is drawing it. A mark appears, never at the distance you should shoot from, and the rep is to put yourself on your own edge and fire. The instant your windup starts it measures the gap in units, tells you which way you were wrong, and draws the circle you should have been standing on.',
          'It is five phases, in the order they have to be learnt. MARK is calibration and its checks are free. STEP spawns marks too close as often as too far, because walking backwards to your edge is half the skill and no drill ever asks for it. DRIFT moves the mark. TRADE gives it a shorter reach and a weapon, so every unit of depth is paid for in health. SHIFT changes your own reach every rep and tells you the new number and nothing else — which is the phase that proves you learnt a distance rather than a screen position.',
          'Ordering an attack you cannot take voids the rep under the click scheme. The champion walks you into range to make the order legal, so the shot that follows is the pathfinder’s judgement rather than yours — and that walk is how people actually die in a game. Under WASD nothing can walk you, so the shot is always yours and the number is simply where you stopped.',
          'The results screen leads with the share of your shots that were both on the edge and taken without a check, and it names which way you are wrong: the average depth you fire from inside your own range, how far your error swings from rep to rep, and how many checks a rep you spent. An average that good with a spread that wide is a coin landing well, and it now says so.',
          'RANGE is the first card on the practice screen, and it hands you no abilities at all. Tumbling to a good position, condemning from one and holding a stack through a trade are the same sentence with the same missing word in it.',
        ],
      },
    ],
  },
  {
    version: '2.4.0',
    name: 'EYES',
    date: '2026-09-05',
    headline:
      'A trinket on the bar, a condemn that comes back before you have forgotten what you were practising, bots that walk around walls instead of into them, and abilities that answer to a mouse button when you put them on one.',
    sections: [
      {
        tag: 'added',
        items: [
          'A warding trinket, on D, in every Vayne mode. It throws 600 units, lights 1100 around itself for eight seconds, and comes back every twelve — two out at once, and a third replaces the oldest. Both of those clocks are far shorter than League\u2019s on purpose: holding a piece of the map for two minutes is a macro skill, and what a sixty second rep can actually build is the habit of spending vision on the ground the next ten seconds happen on.',
          'The ward is drawn as the three things a ward is: the circle it holds, a ring counting down what is left of it, and a pip that blinks through its last two seconds so going blind is something you see coming. It shows on the minimap over the fog, because a pip the fog could dim would be answering "is it still lit" with "look harder".',
          'Night Hunter — the mode with a fog to lift — puts wards on the HUD as how many are out and how long the shortest has left, counts them on the results screen, and has something to say about the ones that burned down without lighting anybody.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'Condemn comes back in 45% of League\u2019s cooldown in every mode: 5.4 seconds on a maxed E instead of twelve, nine instead of twenty in Night Hunter. Rank still shapes it and the practice screen still prints both figures. Three casts a run is not a number of attempts anybody learns a positional ability from.',
          'Scoring no longer measures Condemn usage against its own cooldown, so shortening it hands you more attempts rather than raising the bar for taking them.',
          'Bots notice when they are getting nowhere. A unit that has spent a third of a second pushing into terrain now turns, picks the way round with room in it, commits to that for long enough to actually leave, and drops it the moment its own approach opens up again. Nothing else about how they fight has changed — they still commit to a charge, and they still end up with their backs to walls.',
          'Dashes stop at walls. A diver leaping at somebody standing behind a rock arrives at the rock instead of inside it and being shoved back out somewhere it never aimed at.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'Putting an ability on a mouse button now casts it. Every row in the rebind list has always accepted one, and every ability bound to one did nothing at all — only the keyboard consulted the ability bindings — so Tumble on right click cost you the move order that lived there and gave you no tumble for it. A mouse-bound ability quick-casts at the cursor whatever the quick-cast setting says, because a press that is already a click at a point has nothing left to confirm.',
        ],
      },
    ],
  },
  {
    version: '2.3.0',
    name: 'CONTRAST',
    date: '2026-09-05',
    headline:
      'The fog is fog again rather than a black sheet over half the map, the bloom stopped washing the stone out, and the whole arena is now graded for contrast instead of against it.',
    sections: [
      {
        tag: 'changed',
        items: [
          'Fog of war is lit, not blacked out. Ground you have no vision of keeps a little over half its brightness and is tinted cold rather than crushed toward black, so the paving, a wall and a bush all stay separable in the dark. You still cannot see what is standing in it — that has not moved and never will — but you can navigate it, which is the difference between a map you are learning and a map that has been switched off.',
          'The dark drifts. Two layers of slow world-space noise ride the shroud, so the part of the arena you are not holding reads as weather rather than as a dimmer switch.',
          'A cool rim sits exactly where your sight stops. The edge of vision is the thing the whole mode is about, and it is now a line you can see rather than a gradient you infer.',
          'Bloom only blooms lights. The threshold used to sit low enough that the lit floor cleared it, so every frame carried a milky glow over the entire playfield and every edge in it was soft. Now the braziers, the ability flashes and the accent inlays glow and the stone stays sharp.',
          'The grade was rewritten to work in linear light. Its contrast pivot, split tone and shoulder were all placed as if they were display values, which quietly tinted the whole frame as shadow; corrected, warm light reads warm, the fog reads cold, and the two stop fighting.',
          'Vibrance in place of flat saturation: colour is pushed hardest where there is least of it, so abilities and team rings sing without the stonework turning to poster paint.',
          'The lighting rig trades fill for shape — a stronger key, a stronger cool rim behind, and a hemisphere that exists mainly to keep the camera-facing side of a wall readable.',
          'The edges of the screen warm as a clean chain builds, and go out the moment you drop it. It is the one thing in the frame that answers a streak.',
          'Impacts carry a hot white core inside the coloured spray, and a kill throws a second ring and an ember cloud that outlives the flash.',
          'Menus sit on a veil rather than a wall. The live arena behind every screen was buried under a near-opaque plate; it is dimmer than the arena and always will be, but it is a place again.',
          'Practice cards are lit by their own accent colour and lift under the pointer, so four modes of one champion read as four things before a word has been read.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'The countdown and the round banner no longer lay a black slab across the arena. Their drop shadows were tight and nearly opaque, and under letter-spaced display type they merged between the glyphs into one solid bar.',
          'A wall facing the camera is stone rather than a black rectangle. Neither the key light nor the rim reached that face, and the fill was too low to save it.',
          'The minimap paints the fog in the same colour the arena does, from one shared value, so the two pictures of the same grid can no longer drift apart.',
        ],
      },
    ],
  },
  {
    version: '2.2.0',
    name: 'REBINDS',
    date: '2026-09-05',
    headline:
      'Escape is the settings key everywhere — including inside a run — and the binding list underneath it now guarantees that the key you pressed is the key that fires.',
    sections: [
      {
        tag: 'added',
        items: [
          'Escape opens Settings. From any menu it opens and closes the screen; inside a run it pauses and puts the same screen over the paused arena, so the moment a binding fails you is the moment you can fix it. Everything you change there is live the instant you go back to the run — bindings included — so a rebind is tested by closing the panel and pressing the key.',
          'A SETTINGS button on the pause screen, next to Resume, and the pause screen now prints the key that actually restarts the drill rather than assuming it.',
          'Conflict resolution in the binding list. Take a key another action already had and that action loses it: the row is left unbound and named out loud, instead of two actions fighting over one press and one of them silently doing nothing.',
          'Unbound as a real state. Backspace clears a slot, cleared slots read UNBOUND, and nothing fires them.',
          'A ↺ on every binding row, which restores that one row to its default without touching the rest of a layout you have tuned.',
          'The alternate slot is editable on the actions that have one — the attack-move confirm button and reset’s Enter — so the confirm click can move as well as the modifier.',
        ],
      },
      {
        tag: 'fixed',
        items: [
          'Modifiers can be bound at all. Shift, Ctrl and Alt used to be swallowed by the guard that keeps the browser’s own shortcuts working, which made every one of them permanently dead as a binding — attack-move’s own default under WASD among them.',
          'Escape always pauses a run, whatever Pause is bound to. A rebind can no longer lock you inside a drill with no menu to undo it from.',
          'Resume on the pause screen no longer depends on Escape still being bound to pause. It used to synthesise an Escape keypress, so rebinding pause quietly broke the button.',
          'Instant reset follows its binding rather than the letter R, and an ability that is unbound no longer answers to the key it used to be on.',
          'A binding rebound back to the key it shipped with stops counting as changed, so the changed-from-default dots and the reset buttons tell the truth.',
          'Escape reaches the settings during the three-second countdown too, and resuming from there puts the countdown back rather than dropping you into a live run you were not watching.',
          'A key held down when a menu opens over a run is no longer still held when you come back to it, so the champion does not resume walking into a wall.',
          'Stored bindings are repaired on load: a rebind naming an action this build no longer has, or one that is not a binding at all, is dropped rather than carried into the arena.',
        ],
      },
    ],
  },
  {
    version: '2.1.0',
    name: 'FOG OF WAR',
    date: '2026-09-05',
    headline:
      'Night Hunter is played in the dark: the map is only lit where something of yours can see, terrain throws shadows you cannot look into, and the fight has to be found before it can be won.',
    sections: [
      {
        tag: 'added',
        items: [
          'Fog of war in NIGHT HUNTER. The arena is dark everywhere your champion cannot see, terrain casts real sight shadows, and an enemy that walks into one is gone — not dimmed, not ghosted, gone. Its health bar, its threat ring, its missiles and even the dust it kicks up go with it.',
          'Bushes. Walkable terrain that blocks sight from outside and hides whoever is standing in it, exactly as League’s do. Standing in one tells you so, and Final Hour opened out of a bush is now a thing you can practise.',
          'The bots have eyes of their own. Break their line — behind a wall, into a bush, under Final Hour — and they lose you, walk to the last place they had a read on, and start searching. The guesses tighten the longer you hide, so breaking vision buys time rather than safety.',
          'The minimap became an instrument: terrain and bushes are always drawn, the fog is drawn over them, bodies appear only where you have vision, an enemy you can see but are not looking at pulses, and the position of one you have just lost fades out inside a ring that grows at walking speed.',
          'A VISION read-out on the HUD — the share of them you have eyes on right now, BLIND when that is none of them, and IN BRUSH while a bush is hiding you — plus VISION HELD on the results screen and a coach that names damage taken from places you never looked.',
          'A fog of war switch in Gameplay settings, for a player still learning the kit who would rather not learn two things at once.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'NIGHT HUNTER opens zoomed in, so the arena no longer fits on one screen. A camera pinned to the middle of the map makes vision a decoration; a camera you have to drive makes the minimap the instrument it is in a real game.',
          'Its score has a vision term in it: how much of the run you held eyes on the fight, and how much of the damage you took arrived from somewhere you had not looked.',
          'Waves spawn clear of the wall across the top of the map rather than inside its footprint, where the collision pass used to shove them — the one place on the floor that can never be looked into from your own side.',
        ],
      },
    ],
  },
  {
    version: '2.0.0',
    name: 'ONE CHAMPION, TWO BUTTONS',
    date: '2026-09-05',
    headline:
      'The trainer is a Vayne trainer now, the menu is four cards with a PLAY and a SURVIVE on each, and the tumble is a roll rather than a teleport.',
    sections: [
      {
        tag: 'added',
        items: [
          'SURVIVE. No clock. It ramps — more of them, and harder ones, the longer you last — and it ends when you die or when you have made the mode’s own mistake three times. The result is how long you lasted.',
          'A strike budget on the HUD, and one named mistake per mode: a windup thrown away in TUMBLE, a stack abandoned in SILVER BOLTS, a condemn into open ground in CONDEMN. Night Hunter has no strikes because it has a health bar.',
          'Night Hunter, the passive: thirty movement speed whenever she is walking toward somebody nearby. It was missing, and it is most of why a real Vayne closes ground she has no business closing.',
          'Condemn has its cast time. A quarter of a second, standing still, and the knockback resolves against where they actually are when it lands — so the floor indicator now leads the target, and so must you.',
          'The kit written out in numbers on the menu, including which Vayne each mode hands you: one point in Q where the rhythm is the lesson, a maxed E where the reps are.',
        ],
      },
      {
        tag: 'changed',
        items: [
          'PLAY is one minute. Every mode, every time, including Night Hunter — clearing the floor sends the next wave rather than ending the run, because a minute that finishes in eleven seconds is not a minute.',
          'The tumble is a three hundred unit roll that takes a quarter of a second, not a teleport. She cannot shoot during it, which is what makes the timing a timing question at all.',
          '“Free” now means what it means in League: a tumble costs you an attack when the attack timer would come up before the roll ends. The backswing is free because a whole cycle has to run, which the model works out rather than asserting.',
          'Her attack windup is League’s sixth of the cycle rather than a quarter, and Silver Bolts, Condemn and Final Hour read their numbers off rank tables instead of one invented middle value.',
          'Tumble placement is graded rather than counted. A three hundred unit roll usually leaves their reach and usually keeps hers, so two yes/no answers rated a tumble straight backwards nearly as well as one taken sideways; the mark is now how close the landing was to just inside her own range and outside theirs.',
          'The client is four screens: practice, progress, setup and the patch notes. The daily plan, the calibration sequence, the champion course, the WASD academy, the APM lab, the skill tests and the records room are gone, along with the seven-tab bar that held them. Everything that was really a way of choosing a run is two buttons on a card.',
          'There is no champion select. There is one champion, and every mode is about her.',
          'Your rank arrives from your first three runs rather than from a calibration sequence you had to sit through before the trainer would talk to you.',
        ],
      },
    ],
  },
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
          'Coming back to a profile saved by an older build no longer lands on “TODAY FAILED TO LOAD”. The lab replaced thirteen in-game APM modes with thirteen bench modes under new names, and every run, record and mistake stored against the old names read back as a drill that no longer exists — which the home screen died on, on the way in, with nothing to click but two buttons that led straight back to it. A saved profile is now checked against the catalogue as it loads: anything naming a drill that is gone is dropped, and the ladder itself — your rating, your rank, your peak, every per-axis reading and your streak — is kept, because none of it was ever stored per drill.',
          'The champion paths, the academy and the lab are all repaired on load rather than trusted: a half-written record, a missing section or a stage saved by a build that shaped it differently comes back playable instead of coming back as a crash.',
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
