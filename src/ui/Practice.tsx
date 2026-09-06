import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { PRACTICE_MODES, RUN_MODE_LIST, type RunMode } from '../drills/modes';
import { VAYNE_STATS, tumbleCdAt, condemnCdAt, condemnPracticeCdAt } from '../engine/vayne';
import type { Profile } from '../progression/profile';
import './practice.css';

interface Props {
  profile: Profile;
  onPlay: (id: DrillId, mode: RunMode) => void;
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
 * Everything under the first card is Vayne. That is not a filter over a larger
 * catalogue — it is what the trainer is for. The exception is deliberate:
 * RANGE is about the one distance every champion has and no champion draws for
 * you, so it hands you a body and nothing else. A mode that put you behind a body with no
 * tumble could tell you about your hands in the abstract; it could not tell
 * you anything about the quarter of a second at the end of a roll, which is
 * where this champion is actually won and lost.
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
              One number and four parts of one champion, and two ways to play each of them.{' '}
              <b>PLAY</b> is a minute — the same minute every time, so the score means
              something next to the last one. <b>SURVIVE</b> has no clock: it gets harder
              the longer you last and ends when you die or make the mode’s own mistake three
              times.
            </p>
            <p className="dim pr-lead">
              <b>RANGE</b> comes first and hands you no abilities at all, because every mode
              under it already assumes the answer: how far you reach. Nothing in this client
              draws that ring for you any more — centring the camera paints it for under a
              second, and the mode counts every time you ask.
            </p>
          </div>

        </header>

        <div className="pr-modes">
          {PRACTICE_MODES.map((id) => (
            <ModeCard key={id} id={id} profile={profile} onPlay={onPlay} />
          ))}
        </div>

        <KitReference />
      </div>
    </div>
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
