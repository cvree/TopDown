import type { DrillId } from '../../drills/catalog';
import type { Profile } from '../../progression/profile';
import { STALE_DAYS, daysSince, freshBest, recentScores } from '../playNext';
import { Trend } from './Trend';

/**
 * A CARD'S RECORD, IN ONE ROW.
 *
 * What PROGRESS knows about one drill, printed on the drill: the number to
 * beat, the last five runs as a line, a NEW BEST when the latest run was one —
 * and, where the card asks for it, how long it has been since you last played
 * it. Most of the time this row is why a player never needs to open PROGRESS
 * to know whether they are getting better at a drill.
 */
export function CardRecord({
  profile,
  id,
  best,
  stale = false,
}: {
  profile: Profile;
  id: DrillId;
  /** The record, already in this card's own words: "best 1,040", "best 72%". */
  best?: string | null;
  /** Say so when this drill has gone quiet. Favourites ask for it. */
  stale?: boolean;
}) {
  const fresh = freshBest(profile, id);
  const days = stale ? daysSince(profile, id) : null;
  const quiet = days !== null && days >= STALE_DAYS;
  const scores = recentScores(profile, id);
  if (!best && !fresh && !quiet && scores.length < 2) return null;
  return (
    <div className="pr-rec mono">
      {best && <span className="pr-rec-best">{best}</span>}
      {fresh && <span className="pr-newbest">NEW BEST</span>}
      <Trend scores={scores} />
      {scores.length >= 2 && <Delta scores={scores} />}
      {quiet && (
        <span className="pr-stale" title={`You last played this ${days} days ago`}>
          not played in {days} days
        </span>
      )}
    </div>
  );
}

/**
 * The trend as a number: the newest of the last few runs against the oldest.
 * The line says which way; this says how far.
 */
function Delta({ scores }: { scores: number[] }) {
  const d = Math.round(scores[scores.length - 1] - scores[0]);
  const n = scores.length;
  if (d === 0) return <span className="pr-delta flat">level over {n} runs</span>;
  return (
    <span className={`pr-delta ${d > 0 ? 'up' : 'down'}`} title={`Your latest run against the one ${n - 1} runs before it`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString()} over {n} runs
    </span>
  );
}
