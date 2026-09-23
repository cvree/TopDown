import { useMemo, useState } from 'react';
import { audio } from '../engine/audio';
import { CONFIDENCES, FACTS, FACT_GROUPS, PATCH, factTally, type Confidence } from '../engine/patch';
import './accuracy.css';

/**
 * THE ACCURACY REPORT.
 *
 * Every other trainer in this category says its numbers are real and prints
 * none of them. This prints all of them: the patch it was audited against,
 * every figure the lane runs, how sure we are of each one and the source it
 * came from — including the rows where the honest answer is that nobody has
 * published the number. A player who can read this can check the claim; one
 * who cannot has to take it on trust, and trust is the wrong thing to build a
 * habit on.
 *
 * It reads the same manifest the simulation does, so it cannot drift from
 * the lane it is describing.
 */

const TONE: Record<Confidence, string> = {
  VERIFIED: 'var(--good)',
  REPORTED: 'var(--accent-2)',
  INFERRED: 'var(--warn)',
  'NOT FOUND': 'var(--danger)',
  TRAINER: 'var(--violet)',
};

const MEANING: Record<Confidence, string> = {
  VERIFIED: 'read off Riot’s own patch notes or data',
  REPORTED: 'a current secondary source — probably right, not Riot’s word',
  INFERRED: 'our arithmetic from the rows above, or our judgement where sources are silent',
  'NOT FOUND': 'nobody has published it that we could find — the value run is ours, and says so',
  TRAINER: 'deliberately not League’s, for the reason on the row',
};

export function AccuracyReport() {
  const [only, setOnly] = useState<Confidence | null>(null);
  const tally = useMemo(() => factTally(), []);
  const modelled = FACTS.filter((f) => f.modelled).length;
  const shown = only ? FACTS.filter((f) => f.confidence === only) : FACTS;

  return (
    <section className="panel pad acc">
      <div className="panel-title">Accuracy report · patch {PATCH.league}</div>
      <p className="acc-lead">
        Every League figure THE LANE is built from, with its source. Audited against patch{' '}
        <b className="mono">{PATCH.league}</b> (Data Dragon <b className="mono">{PATCH.dataDragon}</b>) on{' '}
        <b className="mono">{PATCH.auditedOn}</b>. {modelled} of {FACTS.length} rows are simulated; the rest are
        known and printed so you can see what is left out.
      </p>

      <div className="acc-tally" role="group" aria-label="Filter by confidence">
        {CONFIDENCES.filter((c) => tally[c] > 0).map((c) => (
          <button
            key={c}
            type="button"
            className={`acc-chip${only === c ? ' on' : ''}`}
            style={{ ['--t' as string]: TONE[c] }}
            aria-pressed={only === c}
            title={MEANING[c]}
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiTab');
              setOnly((o) => (o === c ? null : c));
            }}
          >
            <b className="mono">{tally[c]}</b>
            <span>{c}</span>
          </button>
        ))}
      </div>
      <p className="acc-key dim">
        {only ? (
          <>
            <b style={{ color: TONE[only] }}>{only}</b> — {MEANING[only]}. Press it again to see every row.
          </>
        ) : (
          'Press a label to see only those rows. A row whose two columns differ says why.'
        )}
      </p>

      {FACT_GROUPS.map((g) => {
        const rows = shown.filter((f) => f.group === g);
        if (!rows.length) return null;
        return (
          <div className="acc-group" key={g}>
            <div className="acc-gh mono">{g}</div>
            <div className="acc-rows">
              <div className="acc-row acc-row-h mono" aria-hidden="true">
                <span>WHAT</span>
                <span>LEAGUE</span>
                <span>HERE</span>
                <span>HOW SURE</span>
              </div>
              {rows.map((f) => {
                const differs = f.league !== f.trainer;
                return (
                  <div className={`acc-row${f.modelled ? '' : ' off'}`} key={f.id}>
                    <span className="acc-what">{f.label}</span>
                    <span className="acc-val mono">{f.league}</span>
                    <span className={`acc-val mono${differs ? ' diff' : ''}`}>{f.trainer}</span>
                    <span className="acc-conf">
                      <i style={{ ['--t' as string]: TONE[f.confidence] }}>{f.confidence}</i>
                      {f.source.url ? (
                        <a href={f.source.url} target="_blank" rel="noreferrer noopener">
                          {f.source.name} · {f.source.date}
                        </a>
                      ) : (
                        <em>{f.source.name}</em>
                      )}
                    </span>
                    {f.note && <span className="acc-note">{f.note}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="set-note">
        How the unknowns get known: the camera rows need 240 fps captures of Practice Tool over a
        measured ground grid; the turret shot needs controlled minions shot and timed; the level-three
        threshold needs one Practice Tool lane logged minion by minion. Until then they say NOT FOUND,
        because a plausible number printed as a fact is worse than a gap.
      </p>
    </section>
  );
}
