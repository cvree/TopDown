import { audio } from '../../engine/audio';
import { HERO_LIST, heroFor, type HeroId } from '../../engine/heroes';
import { HeroPortrait } from './HeroPortrait';
import { HeroSigil } from './HeroSigil';

/**
 * The roster picker.
 *
 * One component, two homes: the first-run champion select and the Champion tab
 * in settings. They are the same decision made at different moments, so they
 * are emphatically not two different screens — a player who changes their mind
 * a week later should recognise the thing they are looking at.
 *
 * The list is on the left because that is where every list in this client
 * lives, and the champion stands on the right at full height, turning, with
 * the honest sentence about what the choice does and does not change printed
 * under it. Nobody should have to guess whether picking the heavy one makes
 * the drills harder.
 */
export function HeroRoster({
  value,
  onChange,
  /** The player has asked for fewer effects: the flat mark stands in. */
  lowFx = false,
}: {
  value: HeroId;
  onChange: (id: HeroId) => void;
  lowFx?: boolean;
}) {
  const def = heroFor(value);

  return (
    <div className="roster" style={{ ['--c' as string]: def.accent }}>
      <div className="roster-grid" role="radiogroup" aria-label="Champion">
        {HERO_LIST.map((h) => {
          const on = h.id === value;
          return (
            <button
              key={h.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`hcard${on ? ' on' : ''}`}
              style={{ ['--c' as string]: h.accent }}
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                if (on) return;
                audio.play('uiClick');
                onChange(h.id);
              }}
            >
              <span className="hcard-mark">
                <HeroSigil hero={h.id} size={30} />
              </span>
              <span className="hcard-text">
                <b>{h.name}</b>
                <i>{h.role}</i>
              </span>
              <span className="hcard-tick" aria-hidden />
            </button>
          );
        })}
      </div>

      <div className="roster-stage">
        <div className="rs-figure">
          {/* The flat mark sits behind the canvas rather than instead of it, so
              a machine that cannot start WebGL still shows a champion. */}
          <div className="rs-fallback">
            <HeroSigil hero={def.id} size={112} />
          </div>
          <HeroPortrait hero={def.id} enabled={!lowFx} className="rs-canvas" />
        </div>

        <div className="rs-text">
          <div className="eyebrow">{def.role}</div>
          <h2 className="display rs-name">{def.name}</h2>
          <div className="rs-title">{def.title}</div>
          <div className="ornament">
            <i />
          </div>
          <p className="rs-blurb">{def.blurb}</p>
          <div className="rs-sil">
            <span className="eyebrow">Silhouette</span>
            <b>{def.silhouette}</b>
          </div>
          <p className="rs-fine">
            Look only. Every champion here moves at the same speed, attacks on the same windup and takes
            the same damage — so a rating earned behind one is worth exactly a rating earned behind
            another.
            {def.championPath
              ? ' The Vayne path spawns this champion whatever you pick here; choosing her simply means every other drill rehearses the same outline.'
              : ' The Vayne path always spawns Vayne, whatever you pick here.'}
          </p>
        </div>
      </div>
    </div>
  );
}
