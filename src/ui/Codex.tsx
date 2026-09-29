import { useState } from 'react';
import { audio } from '../engine/audio';
import { PATCH } from '../engine/patch';
import { CAITLYN_STATS } from '../engine/caitlyn';
import { FLASH_LEAGUE_CD, FLASH_PRACTICE_CD, FLASH_RANGE } from '../engine/summoners';
import { VAYNE_STATS, tumbleCdAt, tumblePracticeCdAt, condemnCdAt, condemnPracticeCdAt } from '../engine/vayne';
import { TWISTED_STATS } from '../engine/twistedfate';
import { KATARINA_STATS } from '../engine/katarina';
import { katarinaStage } from '../drills/katarina';
import { twistedStage } from '../drills/twistedfate';
import { AccuracyReport } from './AccuracyReport';
import { Why } from './components/Why';
import './practice.css';

/**
 * CHARACTER — every number PLAY is built from.
 *
 * It was the fourth tab of PLAY, and it was the one thing on that screen you
 * could not play: reference, sitting between cards you start. It lives under
 * STUDY now, beside the rest of the reading, word for word and figure for
 * figure as it was.
 */
// ===========================================================================
// 03 — THE CODEX
// ===========================================================================

/**
 * The reading.
 *
 * Four kits, and they used to sit in the middle of the screen between the
 * champion cards and the lab — a thousand words of reference wedged between
 * two things you were there to click. They are here instead, together, behind
 * one switch, because they are the same kind of object pointed at three
 * champions: every number a mode is built from, printed, so a claim about
 * transfer is one the player can check rather than take.
 */
type CodexId = 'vayne' | 'twisted' | 'katarina' | 'sheriff' | 'accuracy';

const CODEX: { id: CodexId; label: string; sub: string; accent: string }[] = [
  { id: 'vayne', label: 'VAYNE', sub: 'the one you play', accent: '#c86bff' },
  { id: 'twisted', label: 'TWISTED FATE', sub: 'the card one you play', accent: '#ffcf5c' },
  { id: 'katarina', label: 'KATARINA', sub: 'the dagger one you play', accent: '#ff4057' },
  { id: 'sheriff', label: 'CAITLYN', sub: 'the one shooting at you', accent: '#ffb02e' },
  // Not a kit: the receipt for all three. Every League figure the lane runs,
  // the patch it was checked against and where each one came from.
  { id: 'accuracy', label: 'ACCURACY', sub: `patch ${PATCH.league}, with sources`, accent: '#4fd47c' },
];

export function CodexPanel() {
  const [who, setWho] = useState<CodexId>('vayne');
  const active = CODEX.find((c) => c.id === who) ?? CODEX[0];

  return (
    <>
      <Why label="what this is">
        <p className="dim pr-lead pr-panel-lead">
          Reference only — nothing to click. If a drill expects you to dodge something in under a
          second, this is where you can look up exactly how long you had.
        </p>
      </Why>

      <div className="pr-seg" role="tablist" aria-label="Which kit">
        {CODEX.map((c) => (
          <button
            key={c.id}
            className={`pr-seg-btn${c.id === who ? ' on' : ''}`}
            style={{ ['--c' as string]: c.accent }}
            role="tab"
            type="button"
            aria-selected={c.id === who}
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              if (c.id === who) return;
              audio.play('uiTab');
              setWho(c.id);
            }}
          >
            <b className="display">{c.label}</b>
            <i>{c.sub}</i>
          </button>
        ))}
      </div>

      <div key={who} className="fade-in" style={{ ['--c' as string]: active.accent }}>
        {who === 'vayne' ? (
          <KitReference />
        ) : who === 'twisted' ? (
          <TwistedReference />
        ) : who === 'katarina' ? (
          <KatarinaReference />
        ) : who === 'sheriff' ? (
          <SheriffReference />
        ) : (
          <AccuracyReport />
        )}
      </div>
    </>
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
      body: `A ${VAYNE_STATS.tumbleRange} unit roll that takes ${VAYNE_STATS.tumbleTime}s, during which she cannot shoot. Cancels the backswing for free and throws the attack away if you take it in the windup. League's cooldown is ${tumbleCdAt(1)}s at one point falling to ${tumbleCdAt(5)}s maxed, halved inside Final Hour; a practice run guarantees one roughly every ${VAYNE_STATS.tumblePracticeFloor}s, so a single point comes back in ${tumblePracticeCdAt(1)}s and anything already faster than the floor is left exactly where League leaves it.`,
    },
    {
      slot: 'W',
      name: 'SILVER BOLTS',
      body: `Every ${VAYNE_STATS.boltsPerProc}rd hit on the same target detonates for a share of its maximum health as true damage. Stacks fall off ${VAYNE_STATS.boltsDecay}s after the last hit, and switching target at two throws them away.`,
    },
    {
      slot: 'E',
      name: 'CONDEMN',
      body: `${VAYNE_STATS.condemnRange} range, ${VAYNE_STATS.condemnCast}s of cast time standing still, then a ${VAYNE_STATS.condemnPush} unit knockback. Terrain at the end of it is ${VAYNE_STATS.condemnStun}s of stun and a second helping of damage; open ground is nothing. League's cooldown is ${condemnCdAt(1)}s falling to ${condemnCdAt(5)}s; every mode here charges ${Math.round(VAYNE_STATS.condemnPracticeShare * 100)}% of that — ${condemnPracticeCdAt(1)}s to ${condemnPracticeCdAt(5)}s — because the thing worth rehearsing is not the cast, it is the roll that puts the wall behind them and the cast that follows it, and two cooldowns have to be up at once for that to happen at all.`,
    },
    {
      slot: 'R',
      name: 'FINAL HOUR',
      body: `A window rather than a button: more damage, half the tumble cooldown, ${VAYNE_STATS.finalHourStealth}s of invisibility on each roll, and a reset on every takedown.`,
    },
    {
      slot: 'D',
      name: 'WARD',
      body: `Thrown up to ${VAYNE_STATS.wardRange} units, and — as in League — thrown *over* terrain rather than stopped by it, because the eye you want is nearly always in the place you cannot walk to. It lights ${VAYNE_STATS.wardSight} around itself for ${VAYNE_STATS.wardLife}s, ${VAYNE_STATS.wardMax} at a time, and comes back every ${VAYNE_STATS.wardCd}s. Both of those are far shorter than League's, because holding a piece of the map for two minutes is a macro skill and spending vision on the next ten seconds is a habit — and the habit is the part a sixty second rep can build. Night Hunter is the mode with a fog for it to lift.`,
    },
    {
      slot: 'F',
      name: 'FLASH',
      body: `The other thing on the bar that is not hers, and the one button every champion in the game shares. ${FLASH_RANGE} units toward the cursor, instantly, straight over terrain — a wall stops you standing inside it and does not stop you crossing it. It costs the attack you were already winding up, and it goes on ${FLASH_PRACTICE_CD}s rather than League's ${FLASH_LEAGUE_CD}: five minutes is a decision about the next five minutes of a game, and what a rep can teach is the gesture underneath it — which wall is thin enough, and pressing it at all rather than dying with it up.`,
    },
    {
      slot: 'P',
      name: 'NIGHT HUNTER',
      body: `${VAYNE_STATS.huntBonusMs} movement speed whenever she is walking toward somebody within ${VAYNE_STATS.huntRange} units. It is why she closes ground she has no business closing.`,
    },
  ];

  return (
    <section className="panel pad pr-kit">
      <div className="panel-title">Vayne's abilities, in full</div>
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
        Two cooldowns here are shorter than League's, and both on purpose. Condemn is charged at{' '}
        {Math.round(VAYNE_STATS.condemnPracticeShare * 100)}% and Tumble never takes longer than{' '}
        {VAYNE_STATS.tumblePracticeFloor} seconds — so a minute gives you a dozen attempts at the
        thing worth practising rather than two. Everything else is League's exactly.
      </p>
    </section>
  );
}


/**
 * The deck, in figures.
 *
 * The same contract as Vayne's table, and it matters more here than anywhere
 * else in this client: his whole champion is a *clock*, and a clock you are
 * being graded against is one you are owed the reading of. Half a second a
 * card is not a feel, it is a number — and the difference between taking gold
 * on the first pass and the second is exactly a second and a half, which is
 * also exactly how long the stun lasts. Nothing about him is a coincidence
 * once the figures are next to each other, which is the argument for printing
 * them next to each other.
 */
function TwistedReference() {
  const rows = [
    {
      slot: 'Q',
      name: 'WILD CARDS',
      body: `Three cards in a fan ${Math.round(TWISTED_STATS.qFan * 2 * (180 / Math.PI))}° across, out to ${TWISTED_STATS.qRange} units at ${TWISTED_STATS.qSpeed} a second — the slowest missile in this client, and the only one that goes through what it touches rather than stopping on it. ${TWISTED_STATS.qCast}s of cast time roots you first, and the cooldown is the same ${TWISTED_STATS.qCd}s the wheel is on once both are maxed (${TWISTED_STATS.qLeagueCd}s at rank one) — which is what lets one fan arrive with every card. Aimed at a body it lands one card; aimed along a line of them it lands nine, and that difference is about fifteen degrees of wrist.`,
    },
    {
      slot: 'W',
      name: 'PICK A CARD',
      body: `Press once to start the wheel, again to take whatever is showing — whatever is showing, not whatever you meant. It turns at ${TWISTED_STATS.wCycle}s a card in the same order forever: blue, red, gold. So gold is exactly ${(TWISTED_STATS.wCycle * 2).toFixed(1)}s away the first time it comes round and ${(TWISTED_STATS.wCycle * 5).toFixed(1)}s away the second, and the whole champion is the habit of never paying the difference. The wheel gives up after ${TWISTED_STATS.wWindow}s. Cooldown is ${TWISTED_STATS.wCd}s, charged from the lock — League's once it is maxed, which is where every Twisted Fate has it by the time the wheel is deciding anything; at rank one it is ${TWISTED_STATS.wLeagueCd}s.`,
    },
    {
      slot: '—',
      name: 'THE THREE CARDS',
      body: `A locked card waits on your hand indefinitely and is spent by the next attack that lands, exactly as in League — which is why locking it before the fight is a habit rather than a flourish. Gold is ${TWISTED_STATS.goldStun}s of stun. Red is ${Math.round(TWISTED_STATS.redSlow * 100)}% slow for ${TWISTED_STATS.redSlowFor}s and splashes ${TWISTED_STATS.redSplash} units. Blue takes ${TWISTED_STATS.blueRefund}s off the wheel's own cooldown — this client has no mana, so the mana back arrives as the one currency it does have.`,
    },
    {
      slot: 'E',
      name: 'STACKED DECK',
      body: `Passive. Every ${TWISTED_STATS.deckEvery}th basic attack lands for ${TWISTED_STATS.deckDamage} extra, and the attack speed it grants is already folded into the ${TWISTED_STATS.attack.attackSpeed} attacks a second above — a passive with no condition on it is not something anybody should have to track. The counter is drawn as four pips under your feet, because the only thing worth knowing at a glance is whether the next one is the fourth.`,
    },
    {
      slot: 'R',
      name: 'DESTINY · GATE',
      body: `${TWISTED_STATS.rChannel}s of standing still for the reveal, ${TWISTED_STATS.rGateArmed}s in which the gate may then be taken, and ${TWISTED_STATS.rGateChannel}s of standing still again to cross up to ${TWISTED_STATS.rGateRange} units. ${TWISTED_STATS.rInterruptAt} damage inside either channel breaks it and the ultimate is gone. League charges this in minutes because the reveal is a macro tool and no sixty-second rep can teach one; here it is ${TWISTED_STATS.rCd}s, and ${twistedStage('tfGate').rCd}s on the stage about the gate, because what a rep can teach is the mechanic — choosing the place before the window opens, and holding still for it while being shot at.`,
    },
    {
      slot: 'F',
      name: 'FLASH',
      body: `The same object Vayne's is — literally the same, one implementation for the whole client. ${FLASH_RANGE} units toward the cursor, instantly, over terrain, on ${FLASH_PRACTICE_CD}s rather than League's ${FLASH_LEAGUE_CD}.`,
    },
  ];

  return (
    <section className="panel pad pr-kit" style={{ ['--c' as string]: '#ffcf5c' }}>
      <div className="panel-title">Twisted Fate's abilities, in full</div>
      <div className="pr-kit-rows">
        {rows.map((r) => (
          <div className="pr-kit-row" key={r.name}>
            <i className="pr-kit-slot">{r.slot}</i>
            <b className="pr-kit-name">{r.name}</b>
            <span className="pr-kit-body">{r.body}</span>
          </div>
        ))}
      </div>
      <p className="set-note">
        One cooldown here is shorter than League's and it is the ultimate, for the same reason
        Condemn is charged at {Math.round(VAYNE_STATS.condemnPracticeShare * 100)}%: a minute has
        to contain enough attempts at the thing worth practising to be a rep rather than an
        anecdote. The wheel's half a second, its order, the fan's spread, the stun's second and a
        half and the count of four are all League's exactly — and all five of them are the
        champion.
      </p>
    </section>
  );
}

/**
 * The daggers, in figures.
 *
 * The same contract as the other two tables, and it matters for her in a
 * particular way: every number she is built from is a *delay* or a *distance
 * from somewhere else*. A second and a quarter until Preparation lands, three
 * hundred and fifty units past the first body for the blade, four seconds on
 * the floor, three hundred and forty around her for the slash. The whole
 * champion is doing arithmetic on those five figures faster than the fight
 * changes, so they are printed next to each other.
 */
function KatarinaReference() {
  const K = KATARINA_STATS;
  const rows = [
    {
      slot: 'P',
      name: 'VORACITY · SINISTER STEEL',
      body: `The passive, and most of the champion. A dagger on the floor lasts ${K.daggerLife}s; walk within ${K.pickupRadius} units of it and she takes it, slashing everything within ${K.slashRadius} of her — not of the dagger — for ${K.slashDamage}. Taking one also takes ${Math.round(K.pickupRefund * 100)}% off Shunpo's remaining cooldown, League's figure at level six. And a champion who dies within ${K.voracityWindow}s of her touching them takes ${K.voracityRefund}s off every basic ability, which in practice is all of it.`,
    },
    {
      slot: 'Q',
      name: 'BOUNCING BLADE',
      body: `Targeted, ${K.qRange} range: the body nearest the cursor, and it does not miss. It bounces to ${K.qBounces} more within ${K.qBounceRange} units of the last, and the dagger comes down ${K.qLandBehind} units past the first body, along the line she threw it, ${K.qLandAfter}s after it hit. Cooldown ${K.qCd}s — League's maxed, and it is the one every Katarina maxes first; ${K.qLeagueCd}s at rank one.`,
    },
    {
      slot: 'W',
      name: 'PREPARATION',
      body: `A dagger straight up from where she stands, landing ${K.wDaggerAfter}s later on the same spot, and ${Math.round(K.wHaste * 100)}% bonus speed that decays to nothing over ${K.wHasteFor}s — exactly long enough to carry her out of reach of the thing she meant to slash with it. Cooldown ${K.wCd}s maxed, ${K.wLeagueCd}s at rank one; the two stages about it charge ${katarinaStage('katPrep').practice?.w}s and ${katarinaStage('katDance').practice?.w}s, because a minute of eleven-second gaps is four attempts.`,
    },
    {
      slot: 'E',
      name: 'SHUNPO',
      body: `A blink of up to ${K.eRange} units onto whatever is nearest the cursor: a landed dagger, a minion or a champion. Onto an enemy she arrives on the side you pointed at and strikes them for ${K.eDamage}; onto a dagger she takes it and strikes whoever is within ${K.eStrikeRange}. ${K.eCd}s cooldown, League's at rank three (${K.eLeagueCd}s at rank one) — and rarely the number that matters, because a dagger taken is most of it back.`,
    },
    {
      slot: 'R',
      name: 'DEATH LOTUS',
      body: `${K.rChannel}s of daggers at the ${K.rTargets} nearest champions within ${K.rRange} units, six a second, ${K.rDamage} each. A move command ends it — under WASD a held key does, after ${Math.round(K.rMoveGrace * 1000)}ms to let go — and so does Shunpo, which is the one way to leave it on purpose. League charges it at ${K.rLeagueCd}s; here it is ${K.rCd}s, and ${katarinaStage('katLotus').practice?.r}s on the stage about it, because a thirty-second run has to hold more than one.`,
    },
    {
      slot: 'F',
      name: 'FLASH',
      body: `The same object everybody else's is. ${FLASH_RANGE} units toward the cursor, instantly, over terrain, on ${FLASH_PRACTICE_CD}s rather than League's ${FLASH_LEAGUE_CD}.`,
    },
  ];

  return (
    <section className="panel pad pr-kit" style={{ ['--c' as string]: '#ff4057' }}>
      <div className="panel-title">Katarina's abilities, in full</div>
      <div className="pr-kit-rows">
        {rows.map((r) => (
          <div className="pr-kit-row" key={r.name}>
            <i className="pr-kit-slot">{r.slot}</i>
            <b className="pr-kit-name">{r.name}</b>
            <span className="pr-kit-body">{r.body}</span>
          </div>
        ))}
      </div>
      <p className="set-note">
        Three cooldowns here are shorter than League's, and all three for the reason Condemn's is:
        the ultimate, and Preparation on the two stages that are about nothing else. Every delay
        and every distance — the second and a quarter, the three hundred and fifty units, the four
        seconds, the slash — is League's exactly, because those five figures are the champion.
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
      <div className="panel-title">What Caitlyn throws at you</div>
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
        Her cooldowns are League's, charged at {Math.round(CAITLYN_STATS.practiceShare * 100)}% —
        so she throws things at you often enough to actually practise dodging them. Her ranges,
        her health and her movement speed are untouched. Her basic attack hits softer than
        League's, because this mode is testing your dodging rather than your spacing.
      </p>
    </section>
  );
}

