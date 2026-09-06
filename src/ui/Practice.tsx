import { useState } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { PRACTICE_MODES, RUN_MODE_LIST, type RunMode } from '../drills/modes';
import { LANE_LENGTHS, LANE_TIERS, type LaneTier } from '../progression/lane';
import { CAITLYN_STATS, caitlynCd } from '../engine/caitlyn';
import { VAYNE_STATS, tumbleCdAt, condemnCdAt, condemnPracticeCdAt } from '../engine/vayne';
import type { Profile } from '../progression/profile';
import './practice.css';

interface Props {
  profile: Profile;
  onPlay: (id: DrillId, mode: RunMode, opts?: { difficulty?: number; duration?: number }) => void;
}

/** mm:ss, for a survival record. */
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Which keys a mode actually hands you, in the order they sit on the bar. */
const KIT_ORDER: { slot: string; name: string }[] = [
  { slot: 'Q', name: 'TUMBLE' },
  { slot: 'W', name: 'SILVER BOLTS' },
  { slot: 'E', name: 'CONDEMN' },
  { slot: 'R', name: 'FINAL HOUR' },
];

/**
 * THE MENU.
 *
 * There used to be seven sections, four ladders, a daily queue, a calibration
 * sequence and a course of gated stages, and between them they asked a player
 * roughly a dozen questions before anything happened on a screen. This asks
 * two: which part of the champion, and for how long.
 *
 * Every mode on it is played as Vayne. That is not a filter over a larger
 * catalogue — it is what the trainer is for. There are two deliberate
 * exceptions, at the two ends of the list:
 *
 *  - **RANGE** is about the one distance every champion has and no champion
 *    draws for you, so it hands you a body and nothing else. A mode that put
 *    you behind a body with no tumble could tell you about your hands in the
 *    abstract; it could not tell you anything about the quarter of a second at
 *    the end of a roll, which is where this champion is won and lost.
 *  - **SHERIFF** is the other half of a lane. Everything above it measures
 *    what your hands did; this one measures what you did about somebody
 *    else's, which is a skill that cannot be rehearsed alone — so it prints
 *    her kit under the list exactly as the champion's own is printed, because
 *    a window you are expected to beat has to be a number you can check.
 */
export function Practice({ profile, onPlay }: Props) {

  return (
    <div className="scroll">
      <div className="wrap practice fade-up">
        <header className="pr-head">
          <div>
            <div className="eyebrow">Night Hunter · practice</div>
            <h1 className="display pr-h1">VAYNE</h1>
            <p className="dim pr-lead">
              <b>LANE PHASE</b> is the game: League's wave clock, League's minions, League's
              turret, and somebody on the other side farming, trading and counting lethal.
              Pick who they are and how long a lane, and the mode does the rest. Everything
              under it is one part of that lane, rehearsed until it is automatic.
            </p>
            <p className="dim pr-lead">
              The parts come in two lengths. <b>PLAY</b> is a minute — the same minute every
              time, so the score means something next to the last one. <b>SURVIVE</b> has no
              clock: it gets harder the longer you last and ends when you die or make the
              mode’s own mistake three times.
            </p>
            <p className="dim pr-lead">
              <b>RANGE</b> comes first and hands you no abilities at all, because every mode
              under it already assumes the answer: how far you reach. Nothing in this client
              draws that ring for you any more — centring the camera paints it for under a
              second, and the mode counts every time you ask.
            </p>
            <p className="dim pr-lead">
              <b>SHERIFF</b> comes last and is the only one that is not about your hands. It
              puts a Caitlyn on the other side of the floor with her whole kit and asks the
              question no amount of solo practice reaches: what did you do about the thing
              somebody else just aimed at you.
            </p>
          </div>

        </header>

        <LaneCard profile={profile} onPlay={onPlay} />

        <div className="pr-modes">
          {PRACTICE_MODES.map((id) => (
            <ModeCard key={id} id={id} profile={profile} onPlay={onPlay} />
          ))}
        </div>

        <KitReference />
        <SheriffReference />
      </div>
    </div>
  );
}

/**
 * THE LANE.
 *
 * Every other card on this screen is a mechanic. This one is the game, and it
 * is first because it is the reason the rest of the screen exists: the modes
 * below it take one part of a lane and rehearse it until it is automatic, and
 * this is where you find out whether any of that survived contact with
 * somebody trying to stop you.
 *
 * It asks two questions the other cards never do, and both of them are the
 * player's to answer rather than the ladder's:
 *
 *  - **Who is on the other side.** Five opponents, and the difference between
 *    them is entirely behaviour: how late they see a minion, whether they
 *    punish the last hit you just committed to, whether they hold the wave,
 *    whether they can count lethal. None of them has more health than the one
 *    below it.
 *  - **How long a lane.** Two and a half minutes to run the same five waves
 *    over and over, or the whole first ten minutes when you want the levels,
 *    the ultimate and the wave state that only exist later.
 */
function LaneCard({
  profile,
  onPlay,
}: {
  profile: Profile;
  onPlay: (id: DrillId, mode: RunMode, opts?: { difficulty?: number; duration?: number }) => void;
}) {
  const meta = DRILLS.lanePhase;
  const [tier, setTier] = useState<LaneTier>(LANE_TIERS[1]);
  const record = profile.lane?.tiers?.[tier.id];

  return (
    <section className="pr-card panel pr-lane" style={{ ['--c' as string]: tier.accent }}>
      <div className="pr-card-head">
        <div>
          <div className="eyebrow">the whole job, end to end</div>
          <h2 className="display pr-name">{meta.name}</h2>
          <div className="pr-tag">{meta.tagline}</div>
        </div>
        <div className="pr-lane-record mono">
          {record && record.runs > 0 ? (
            <>
              <b>{record.bestCsPerMin.toFixed(1)}</b>
              <span>best CS/min vs {tier.label}</span>
              <i>
                {record.runs} lane{record.runs > 1 ? 's' : ''} · {record.wins} won on gold
              </i>
            </>
          ) : (
            <>
              <b>—</b>
              <span>no lane against {tier.label} yet</span>
            </>
          )}
        </div>
      </div>

      <p className="pr-brief">{meta.brief}</p>
      <p className="pr-transfers">
        <span className="eyebrow">In game</span>
        {meta.transfers}
      </p>

      <div className="pr-lane-tiers">
        {LANE_TIERS.map((t) => {
          const rec = profile.lane?.tiers?.[t.id];
          return (
            <button
              key={t.id}
              className={`pr-tier${t.id === tier.id ? ' on' : ''}`}
              style={{ ['--c' as string]: t.accent }}
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                audio.play('uiTab');
                setTier(t);
              }}
            >
              <b>{t.label}</b>
              <i className="mono">{t.expect.toFixed(1)} CS/min</i>
              {rec && rec.runs > 0 && <em className="mono">best {rec.bestCsPerMin.toFixed(1)}</em>}
            </button>
          );
        })}
      </div>
      <p className="pr-lane-blurb">{tier.blurb}</p>

      <div className="pr-buttons pr-lane-lengths">
        {LANE_LENGTHS.map((len) => (
          <button
            key={len.id}
            className="pr-go pr-go-play"
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiClick');
              onPlay('lanePhase', 'play', { difficulty: tier.difficulty, duration: len.seconds });
            }}
          >
            <span className="pr-go-label">{len.label}</span>
            <span className="pr-go-sub">{len.blurb}</span>
            <span className="pr-go-best mono">vs {tier.label}</span>
          </button>
        ))}
      </div>

      <p className="set-note">
        The lane opens at 1:05 with the first wave walking in, and every wave after it
        arrives thirty seconds apart with a cannon on every third — League's clock,
        untouched. Minions are League's: 477 health on a melee, 296 on a caster, 900 on a
        cannon, and 21, 14 and 60 gold. Your turret hits for 152 and ramps forty per cent a
        shot into a champion. You both start at level one on base statistics, take a point
        every time the wave pays for one, and regenerate at League's rate — which is to say
        hardly at all, so <b>F</b> to recall is a real decision and not a convenience. There
        is no shop, so gold is the scoreboard rather than a purchase, and no jungler, so
        nobody is walking out of the river.
      </p>
    </section>
  );
}

function ModeCard({
  id,
  profile,
  onPlay,
}: {
  id: DrillId;
  profile: Profile;
  onPlay: (id: DrillId, mode: RunMode) => void;
}) {
  const meta = DRILLS[id];
  const best = profile.bests[id];
  const survived = profile.survive[id];
  const uses = new Set(meta.abilities.map((a) => a.toUpperCase()));

  return (
    <section className="pr-card panel" style={{ ['--c' as string]: meta.accent }}>
      <div className="pr-card-head">
        <div>
          <h2 className="display pr-name">{meta.name}</h2>
          <div className="pr-tag">{meta.tagline}</div>
        </div>
        {/* A mode that hands you no kit prints no kit. Four dim letters would
            be answering "which abilities" with "none of them", at length. */}
        {meta.abilities.length > 0 && (
          <div className="pr-keys">
            {KIT_ORDER.map((k) => (
              <i key={k.slot} className={uses.has(k.slot) ? 'on' : ''} title={k.name}>
                {k.slot}
              </i>
            ))}
          </div>
        )}
      </div>

      <p className="pr-brief">{meta.brief}</p>
      <p className="pr-transfers">
        <span className="eyebrow">In game</span>
        {meta.transfers}
      </p>

      <div className="pr-buttons">
        {RUN_MODE_LIST.map((m) => {
          const record =
            m.id === 'play'
              ? best
                ? `best ${best.score.toLocaleString()}`
                : 'no score yet'
              : survived
                ? `best ${clock(survived.seconds)}`
                : 'never survived';
          return (
            <button
              key={m.id}
              className={`pr-go pr-go-${m.id}`}
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                audio.play('uiClick');
                onPlay(id, m.id);
              }}
            >
              <span className="pr-go-label">{m.label}</span>
              <span className="pr-go-sub">{m.tagline}</span>
              <span className="pr-go-best mono">{record}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * What the numbers actually are.
 *
 * A trainer that claims to feel like the champion owes the player the figures
 * it is claiming it with, because the only way to know whether the transfer is
 * real is to be able to check it against the game.
 */
function KitReference() {
  const rows = [
    {
      slot: 'Q',
      name: 'TUMBLE',
      body: `A ${VAYNE_STATS.tumbleRange} unit roll that takes ${VAYNE_STATS.tumbleTime}s, during which she cannot shoot. Cancels the backswing for free and throws the attack away if you take it in the windup. Cooldown ${tumbleCdAt(1)}s at one point, ${tumbleCdAt(5)}s maxed, halved inside Final Hour.`,
    },
    {
      slot: 'W',
      name: 'SILVER BOLTS',
      body: `Every ${VAYNE_STATS.boltsPerProc}rd hit on the same target detonates for a share of its maximum health as true damage. Stacks fall off ${VAYNE_STATS.boltsDecay}s after the last hit, and switching target at two throws them away.`,
    },
    {
      slot: 'E',
      name: 'CONDEMN',
      body: `${VAYNE_STATS.condemnRange} range, ${VAYNE_STATS.condemnCast}s of cast time standing still, then a ${VAYNE_STATS.condemnPush} unit knockback. Terrain at the end of it is ${VAYNE_STATS.condemnStun}s of stun and a second helping of damage; open ground is nothing. League's cooldown is ${condemnCdAt(1)}s falling to ${condemnCdAt(5)}s; every mode here charges ${Math.round(VAYNE_STATS.condemnPracticeShare * 100)}% of that — ${condemnPracticeCdAt(1)}s to ${condemnPracticeCdAt(5)}s — because it is meant to be practised.`,
    },
    {
      slot: 'R',
      name: 'FINAL HOUR',
      body: `A window rather than a button: more damage, half the tumble cooldown, ${VAYNE_STATS.finalHourStealth}s of invisibility on each roll, and a reset on every takedown.`,
    },
    {
      slot: 'D',
      name: 'WARD',
      body: `The one thing on the bar that is not hers. Thrown up to ${VAYNE_STATS.wardRange} units, it lights ${VAYNE_STATS.wardSight} around itself for ${VAYNE_STATS.wardLife}s, ${VAYNE_STATS.wardMax} at a time, and comes back every ${VAYNE_STATS.wardCd}s. Both of those are far shorter than League's, because holding a piece of the map for two minutes is a macro skill and spending vision on the next ten seconds is a habit — and the habit is the part a sixty second rep can build. Night Hunter is the mode with a fog for it to lift.`,
    },
    {
      slot: 'P',
      name: 'NIGHT HUNTER',
      body: `${VAYNE_STATS.huntBonusMs} movement speed whenever she is walking toward somebody within ${VAYNE_STATS.huntRange} units. It is why she closes ground she has no business closing.`,
    },
  ];

  return (
    <section className="panel pad pr-kit">
      <div className="panel-title">The kit, in numbers</div>
      <div className="pr-kit-rows">
        {rows.map((r) => (
          <div className="pr-kit-row" key={r.slot}>
            <i className="pr-kit-slot">{r.slot}</i>
            <b className="pr-kit-name">{r.name}</b>
            <span className="pr-kit-body">{r.body}</span>
          </div>
        ))}
      </div>
      <p className="set-note">
        Where League’s own answer depends on items, levels or runes — her health pool, her
        attack speed, her damage — the figure here stands for one specific Vayne rather than an
        average of every Vayne. Which one is a choice each mode makes and states: Tumble hands
        you a single point in Q, {tumbleCdAt(1)} seconds, because the rhythm is only a rhythm
        while the cooldown is long enough that spending it in the wrong place costs something.
        Condemn hands you a maxed E, {condemnCdAt(5)} seconds in League, because a mode about
        a positional ability has to give you enough casts to have positioned for. Night Hunter
        hands you the mid-game champion with all of it at once. Condemn is also the one
        cooldown deliberately shortened everywhere — {Math.round(VAYNE_STATS.condemnPracticeShare * 100)}% of
        League's, so a minute is eight or ten attempts at the wall rather than three.
      </p>
    </section>
  );
}


/**
 * What she throws, and how long you have.
 *
 * The same contract as the kit table above, pointed the other way: every
 * window the mode expects you to beat is printed as a number, because the only
 * way to know whether a dodge was late is to know what "on time" was. Nothing
 * on this list is a surprise mechanic — she is a champion, she has four
 * buttons, and all four of them are on the screen before you press PLAY.
 */
function SheriffReference() {
  const rows = [
    {
      slot: 'Q',
      name: 'PILTOVER PEACEMAKER',
      body: `A ${CAITLYN_STATS.qRange} unit line, ${CAITLYN_STATS.qWidth} wide, at ${CAITLYN_STATS.qSpeed} units a second — and ${CAITLYN_STATS.qCast}s of cast time before any of it happens, during which she cannot move and the direction is already locked. That six tenths of a second is the whole dodge: one step, early, at right angles to the lane on the floor. It pierces, so standing behind something is not an answer.`,
    },
    {
      slot: 'W',
      name: 'YORDLE SNAP TRAP',
      body: `Thrown up to ${CAITLYN_STATS.wRange} units, arms in ${CAITLYN_STATS.wArm}s, and deals no damage whatsoever — exactly as in League. What it costs is ${CAITLYN_STATS.wRoot}s of not being able to move and a free headshot, which means the Peacemaker that follows is one you cannot dodge. Three on the floor at a time, ${CAITLYN_STATS.wLife}s each. She puts them where you are going, and under you when you are not going anywhere.`,
    },
    {
      slot: 'E',
      name: '90 CALIBER NET',
      body: `${CAITLYN_STATS.eRange} range, ${Math.round(CAITLYN_STATS.eSlow * 100)}% slow for ${CAITLYN_STATS.eSlowFor}s, and it throws her ${CAITLYN_STATS.eSelfPush} units the other way. It is her answer to you closing the gap, and the slow is the dangerous half: a Peacemaker aimed at somebody moving at half speed is a Peacemaker aimed at somebody standing still.`,
    },
    {
      slot: 'R',
      name: 'ACE IN THE HOLE',
      body: `A ${CAITLYN_STATS.rChannel}s channel at up to ${CAITLYN_STATS.rRange} units, and then it simply hits you for ${CAITLYN_STATS.rDamage}. There is no movement that beats it. The only thing that does is terrain on the line at the moment it lands, so the channel is your second to find a wall — and there is one within a second's walk of anywhere on that floor.`,
    },
    {
      slot: 'P',
      name: 'HEADSHOT',
      body: `Every ${CAITLYN_STATS.headshotEvery}th basic attack lands for ${Math.round(CAITLYN_STATS.headshotBonus * 100)}% extra, and a trapped or netted target takes one immediately. It is the price of standing inside ${CAITLYN_STATS.attack.range} units of her — a hundred more than you reach — and it is why the answer to this matchup is never "stay at max range and trade".`,
    },
  ];

  return (
    <section className="panel pad pr-kit" style={{ ['--c' as string]: '#ffb02e' }}>
      <div className="panel-title">The Sheriff, in numbers</div>
      <div className="pr-kit-rows">
        {rows.map((r) => (
          <div className="pr-kit-row" key={r.slot}>
            <i className="pr-kit-slot">{r.slot}</i>
            <b className="pr-kit-name">{r.name}</b>
            <span className="pr-kit-body">{r.body}</span>
          </div>
        ))}
      </div>
      <p className="set-note">
        Her cooldowns are League's, and then every one of them is charged at{' '}
        {Math.round(CAITLYN_STATS.practiceShare * 100)}% of it — so the Peacemaker comes back
        every {caitlynCd(CAITLYN_STATS.qCd)}s rather than every {CAITLYN_STATS.qCd}, a trap
        every {caitlynCd(CAITLYN_STATS.wCd)}s, and the ultimate twice a minute rather than
        never. That is the same decision Condemn gets above, made for the same reason and
        pointed the other way: a minute against her real cooldowns is six dodges, and nobody
        has ever learned a read six repetitions at a time. Her health, her movement speed and
        every range on this list are untouched, and her basic attack is the one number bent
        downwards — a Sheriff who kills you with autos is a Sheriff who is testing your
        spacing rather than your dodging, and there is already a mode for that.
      </p>
    </section>
  );
}
