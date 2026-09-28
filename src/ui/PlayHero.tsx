import { useRef, type ReactNode } from 'react';
import { audio } from '../engine/audio';
import { DRILLS, type DrillId } from '../drills/catalog';
import { isApmDrill, levelStars } from '../progression/apm';
import { LANE_TIERS } from '../progression/lane';
import type { AppSettings, Playlist, Profile } from '../progression/profile';
import { isEdited } from '../progression/tuning';
import { cardClickStarts } from './components/cardStart';
import { ModePreview } from './components/ModePreview';
import { Trend } from './components/Trend';
import { STALE_DAYS, daysSince, freshBest, recentScores, runsOf, type NextPick, type StartSpec } from './playNext';
import './playhero.css';

/**
 * THE FRONT DOOR.
 *
 * PLAY used to open on its own name in sixty-six-point type, a full-width
 * warm-up card, a five-tab rail and two explainers — and only then a card you
 * could start. Every piece of that is still in the client; none of it is the
 * first thing any more. The first thing is one drill, chosen for you, with the
 * one button that starts it:
 *
 *  - **The pick.** Whatever the coach would say next (see `pickNext`), with
 *    its clip, its name, the one line of why, and your record on it.
 *  - **PLAY NEXT.** The only gold button on the screen. Enter and Space press
 *    it from anywhere on PLAY that is not already a control.
 *  - **Yours.** Everything you have starred and every playlist you have built,
 *    one click each, beside it — each star played on the settings you gave it.
 */
export function PlayHero({
  profile,
  settings,
  pick,
  onStart,
  onPlayPlaylist,
  onPlayFavorite,
  onOpenFavorites,
}: {
  profile: Profile;
  settings: AppSettings;
  pick: NextPick;
  onStart: (spec: StartSpec) => void;
  onPlayPlaylist: (pl: Playlist) => void;
  /** A starred activity, on its own edited settings. */
  onPlayFavorite: (id: DrillId) => void;
  /** The full shelf — every starred card, and the playlist editor. */
  onOpenFavorites: () => void;
}) {
  const meta = DRILLS[pick.drill];
  const card = useRef<HTMLElement>(null);
  const start = () => {
    audio.play('uiClick');
    onStart(pick);
  };

  return (
    <div className="pr-front">
      {/* The screen's name, for anything that reads the page rather than
          looking at it. Sighted players already know which tab they are on. */}
      <h1 className="sr-only">PLAY</h1>
      <section
        ref={card}
        className="pr-hero pr-startable"
        data-playable
        style={{ ['--c' as string]: meta.accent }}
        onMouseEnter={() => audio.play('uiHover')}
        onClick={(e) => {
          if (cardClickStarts(e)) start();
        }}
      >
        <div className="pr-hero-media">
          <ModePreview id={pick.drill} accent={meta.accent} host={card} still={settings.lowFx} startLabel={meta.name} onStart={start} />
        </div>
        <div className="pr-hero-body">
          <div className="pr-hero-eyebrow">
            <b className="mono">PLAY NEXT</b>
            <span className="pr-hero-why" title={pick.why}>
              {pick.why}
            </span>
          </div>
          <div className="pr-hero-title">
            <h2 className="display pr-hero-name">{meta.name}</h2>
            <span className="pr-hero-tag">{meta.tagline}</span>
          </div>
          <RecordLine profile={profile} pick={pick} />
          <button type="button" className="pr-hero-go" onClick={start} aria-keyshortcuts="Enter Space">
            <span className="pr-hero-go-label">
              <span aria-hidden>▶</span> PLAY NEXT
            </span>
            <span className="kbd" aria-hidden>
              Enter
            </span>
          </button>
        </div>
      </section>

      <Shelf profile={profile} onPlayFavorite={onPlayFavorite} onPlayPlaylist={onPlayPlaylist} onOpenFavorites={onOpenFavorites} />
    </div>
  );
}

/** Your record on the pick: the number to beat, how it has been going, and where on its ladder it is. */
function RecordLine({ profile, pick }: { profile: Profile; pick: NextPick }) {
  const id = pick.drill;
  const scores = recentScores(profile, id);
  const runs = runsOf(profile, id);
  let best: string;
  let extra: ReactNode = null;
  if (isApmDrill(id)) {
    const level = pick.opts.level ?? 1;
    const lv = profile.apm.modes[id]?.levels?.[level - 1];
    const stars = lv ? levelStars(lv) : 0;
    best = lv && lv.best > 0 ? `best ${Math.round(lv.best * 100)}%` : 'not played at this level';
    extra = (
      <span className="pr-hero-level">
        LEVEL {level}{' '}
        <i className="pr-hero-stars" aria-label={`${stars} of 3 stars`}>
          {[1, 2, 3].map((n) => (
            <b key={n} className={n <= stars ? 'on' : ''}>
              ★
            </b>
          ))}
        </i>
      </span>
    );
  } else if (id === 'lanePhase') {
    const tier = LANE_TIERS[1];
    const rec = profile.lane?.tiers?.[tier.id];
    best = rec && rec.runs > 0 ? `best ${rec.bestCsPerMin.toFixed(1)} CS/min vs ${tier.label}` : `first lane vs ${tier.label}`;
  } else {
    const b = profile.bests[id];
    best = b ? `best ${b.score.toLocaleString()}` : 'no score yet';
  }
  return (
    <div className="pr-hero-record mono">
      {extra}
      <span>{best}</span>
      {freshBest(profile, id) && <span className="pr-newbest">NEW BEST</span>}
      <Trend scores={scores} />
      {runs > 0 && (
        <span className="pr-hero-runs">
          {runs} run{runs === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

/**
 * YOURS.
 *
 * The favourites shelf, folded into the front door: every star is one click
 * from a run, every playlist one click from its first item. A star that has
 * gone quiet says how long it has been; one you just beat says so.
 */
function Shelf({
  profile,
  onPlayFavorite,
  onPlayPlaylist,
  onOpenFavorites,
}: {
  profile: Profile;
  onPlayFavorite: (id: DrillId) => void;
  onPlayPlaylist: (pl: Playlist) => void;
  onOpenFavorites: () => void;
}) {
  const stars = profile.stars.filter((id) => DRILLS[id]);
  const lists = profile.playlists.filter((pl: Playlist) => pl.items.length > 0);
  return (
    <nav className="pr-shelf" aria-label="Your starred drills and playlists">
      {stars.map((id) => {
        const m = DRILLS[id];
        const days = daysSince(profile, id);
        const note = freshBest(profile, id)
          ? { text: 'NEW BEST', cls: 'best' }
          : isEdited(id, profile.tunings?.[id])
            ? { text: 'your settings', cls: '' }
          : days !== null && days >= STALE_DAYS
            ? { text: `${days} days ago`, cls: 'stale' }
            : days === null
              ? { text: 'never played', cls: 'stale' }
              : null;
        return (
          <button
            key={id}
            type="button"
            className="pr-chip"
            style={{ ['--c' as string]: m.accent }}
            title={`Play ${m.name}${days !== null ? ` — last played ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}` : ''}`}
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiClick');
              onPlayFavorite(id);
            }}
          >
            <span className="pr-chip-mark" aria-hidden>
              ★
            </span>
            <span className="pr-chip-text">
              <b>{m.name}</b>
              {note && <i className={note.cls}>{note.text}</i>}
            </span>
          </button>
        );
      })}
      {lists.map((pl) => (
        <button
          key={pl.id}
          type="button"
          className="pr-chip pr-chip-list"
          title={`Play ${pl.name}: ${pl.items.map((i) => DRILLS[i]?.name ?? i).join(' → ')}`}
          onMouseEnter={() => audio.play('uiHover')}
          onClick={() => {
            audio.play('uiClick');
            onPlayPlaylist(pl);
          }}
        >
          <span className="pr-chip-mark" aria-hidden>
            ▶
          </span>
          <span className="pr-chip-text">
            <b>{pl.name}</b>
            <i>
              playlist · {pl.items.length} drill{pl.items.length === 1 ? '' : 's'}
            </i>
          </span>
        </button>
      ))}
      <button
        type="button"
        className="pr-chip pr-chip-more"
        onMouseEnter={() => audio.play('uiHover')}
        onClick={() => {
          audio.play('uiTab');
          onOpenFavorites();
        }}
      >
        <span className="pr-chip-text">
          <b>{stars.length ? 'FAVORITES' : '☆ STAR A CARD'}</b>
          <i>{stars.length ? 'edit · playlists' : 'it lands here'}</i>
        </span>
      </button>
    </nav>
  );
}
