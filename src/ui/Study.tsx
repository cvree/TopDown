import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { audio } from '../engine/audio';
import { Rng, newSeed } from '../engine/rng';
import {
  CLASSES,
  DATA_VERSION,
  ROSTER,
  SPELL_KEYS,
  champ,
  cooldownFit,
  ladder,
  rangeFit,
  secs,
  spellOf,
  units,
  type Champion,
} from '../study/roster';
import {
  TOPICS,
  allFacts,
  isRight,
  nextQuestion,
  questionFor,
  type Focus,
  type PlaceQuestion,
  type Question,
  type Topic,
} from '../study/questions';
import {
  answer,
  champTally,
  dueFacts,
  loadStudy,
  saveStudy,
  scopePool,
  tally,
  type Scope,
  type StudyMode,
  type StudyStore,
} from '../progression/study';
import { Why } from './components/Why';
import { Ticker } from './components/Ticker';
import './practice.css';
import './lab.css';
import './study.css';

/**
 * STUDY — the part of League nobody teaches.
 *
 * Everything else in the client trains hands. This trains the other half of
 * a lane: knowing that the hook you just watched miss is down for nineteen
 * seconds, that the mage across from you out-ranges you by four hundred units,
 * that the bruiser's passive is why trading into him at full health loses.
 * League never prints any of it where you can see it mid-game, so it has to
 * be known before the game starts.
 *
 * Three ways to play, the same three the rest of the client uses:
 *
 *  - **PLAY** — one minute of questions. The clock only runs while a question
 *    is open, so reading the answer costs nothing: the answer is the lesson.
 *  - **SURVIVE** — no clock. Three wrong and it is over.
 *  - **REVIEW** — only what is due: facts you missed, and facts you knew
 *    whose wait has run out. Spaced, so the ones you know stop coming back.
 *
 * And a reference: every champion, every number the quiz asks about, and
 * Riot's tips for playing against them — so a question you got wrong can be
 * looked up rather than guessed at again.
 */

const PLAY_MS = 60_000;
const STRIKES = 3;
const REVIEW_MAX = 25;
/** In PLAY and SURVIVE, how often a due fact is asked instead of a new one. */
const REVIEW_SHARE = 0.35;
/** A fact is not asked again within this many questions. */
const RECENT = 12;

const MODES: { id: StudyMode; label: string; brief: string }[] = [
  { id: 'play', label: 'PLAY', brief: 'One minute of questions. The clock stops while you read the answer.' },
  { id: 'survive', label: 'SURVIVE', brief: `No clock. ${STRIKES} wrong and it is over.` },
  { id: 'review', label: 'REVIEW', brief: 'Only what is due — what you missed, and what you have not seen in a while.' },
];

const TOPIC_COLOUR: Record<Topic, string> = {
  passives: '#c8aa6e',
  abilities: '#0ac8b9',
  cooldowns: '#7ceaff',
  ranges: '#f0c247',
  matchups: '#e84057',
};

// =========================================================================
// The screen
// =========================================================================

interface Session {
  mode: StudyMode;
  /** Set when a session drills one champion from the reference. */
  only?: string;
  rng: Rng;
  pool: Champion[];
  topics: Topic[];
  q: Question | null;
  /** The answer given: an option's index, or a placement's distance in units. */
  picked: number | null;
  asked: number;
  right: number;
  strikes: number;
  streak: number;
  bestStreak: number;
  recent: string[];
  queue: string[];
  missed: Question[];
  over: boolean;
  /** PLAY only: question time left. */
  left: number;
  newBest?: boolean;
}

export function Study() {
  const [store, setStore] = useState<StudyStore>(loadStudy);
  const storeRef = useRef(store);
  storeRef.current = store;
  const [tab, setTab] = useState<'quiz' | 'champions'>('quiz');
  const [session, setSession] = useState<Session | null>(null);
  const [lookup, setLookup] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => saveStudy(store), 200);
    return () => window.clearTimeout(t);
  }, [store]);

  const pool = useMemo(() => scopePool(store), [store.scope, store.mine]);
  const facts = useMemo(() => allFacts().length, []);
  const counts = tally(store);
  const due = useMemo(() => dueFacts(store, Date.now(), pool), [store, pool]);

  // The session lives in a ref as well as in state: answering writes the
  // store, plays a sound and moves the clock, and none of that belongs inside
  // a state updater, which React is free to run twice.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const commit = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const start = useCallback((mode: StudyMode, only?: string) => {
    audio.unlock();
    audio.play('uiClick');
    const s = storeRef.current;
    const sPool = only ? ROSTER.filter((c) => c.id === only) : scopePool(s);
    const queue = mode === 'review' ? dueFacts(s, Date.now(), sPool).slice(0, REVIEW_MAX) : [];
    const next: Session = {
      mode, only, rng: new Rng(newSeed()), pool: sPool, topics: s.topics, q: null, picked: null,
      asked: 0, right: 0, strikes: 0, streak: 0, bestStreak: 0, recent: [], queue, missed: [], over: false, left: PLAY_MS,
    };
    next.q = draw(next, s);
    if (!next.q) next.over = true;
    commit(next);
  }, [commit]);

  /** The session, over: the record written, the result said. */
  const finish = useCallback((s: Session) => {
    if (s.over) return;
    const st = storeRef.current;
    let newBest = false;
    if (!s.only && s.asked > 0) {
      const best = { ...st.best };
      if (s.mode === 'play' && s.right > best.play) (best.play = s.right), (newBest = true);
      if (s.mode === 'survive' && s.right > best.survive) (best.survive = s.right), (newBest = true);
      setStore((x) => ({
        ...x,
        best,
        runs: [...x.runs, { mode: s.mode, right: s.right, asked: s.asked, at: Date.now() }].slice(-40),
      }));
    }
    audio.play(newBest ? 'personalBest' : 'resultsReveal');
    commit({ ...s, over: true, q: null, newBest });
  }, [commit]);

  // ------------------------------------------------------------- answering

  const choose = useCallback((pick: number) => {
    const s = sessionRef.current;
    if (!s || !s.q || s.picked !== null || s.over) return;
    const right = isRight(s.q, pick);
    audio.play(right ? 'perfect' : 'fail', right ? 0.6 : 1);
    const fact = s.q.fact;
    const now = Date.now();
    setStore((st) => ({ ...st, cards: { ...st.cards, [fact]: answer(st.cards[fact], right, now) } }));
    const streak = right ? s.streak + 1 : 0;
    commit({
      ...s,
      picked: pick,
      asked: s.asked + 1,
      right: s.right + (right ? 1 : 0),
      strikes: s.strikes + (right ? 0 : 1),
      streak,
      bestStreak: Math.max(s.bestStreak, streak),
      missed: right ? s.missed : [...s.missed, s.q],
    });
  }, [commit]);

  const advance = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.over || s.picked === null) return;
    audio.play('uiTab');
    if ((s.mode === 'survive' && s.strikes >= STRIKES) || (s.mode === 'play' && s.left <= 0)) return finish(s);
    const next: Session = { ...s, picked: null, queue: [...s.queue], recent: [...s.recent, s.q!.fact].slice(-RECENT) };
    next.q = draw(next, storeRef.current);
    if (next.q) commit(next);
    else finish(next);
  }, [commit, finish]);

  const quit = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    audio.play('uiBack');
    if (s.asked === 0 || s.over) commit(null);
    else finish(s);
  }, [commit, finish]);

  // ------------------------------------------------------------- the clock
  //
  // PLAY's minute is question time: it runs while a question is open and
  // stands still while its answer is on screen. Time running out with a
  // question open ends the session without scoring that question — it was
  // never answered, so it is not a miss.
  const ticking = session?.mode === 'play' && !session.over && session.q !== null && session.picked === null;
  useEffect(() => {
    if (!ticking) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const s = sessionRef.current;
      if (!s || s.over || s.picked !== null) return;
      // Ten times a second is plenty for a clock you read in whole seconds.
      if (now - last >= 100) {
        const left = s.left - (now - last);
        last = now;
        if (left <= 0) return finish({ ...s, left: 0 });
        commit({ ...s, left });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ticking, commit, finish]);

  // ------------------------------------------------------------- keys
  //
  // Number keys answer, Enter and Space move on, Escape leaves. Listened to on
  // the capture phase so Escape here ends the quiz rather than opening setup.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (session.over) commit(null);
        else quit();
        return;
      }
      if (session.over) {
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyR') {
          e.preventDefault();
          start(session.mode, session.only);
        }
        return;
      }
      if (session.picked !== null && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        advance();
        return;
      }
      const n = /^(Digit|Numpad)([1-4])$/.exec(e.code);
      if (n && session.picked === null && session.q?.format === 'choice') {
        const i = Number(n[2]) - 1;
        if (i < session.q.options.length) {
          e.preventDefault();
          choose(i);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [session, advance, choose, quit, start, commit]);

  // ------------------------------------------------------------- render

  if (session) {
    return (
      <div className="scroll">
        <div className="wrap practice study fade-up">
          {session.over ? (
            <SessionResults
              s={session}
              best={session.mode === 'play' ? store.best.play : session.mode === 'survive' ? store.best.survive : null}
              onAgain={() => start(session.mode, session.only)}
              onBack={() => {
                audio.play('uiBack');
                commit(null);
              }}
              onLookup={(id) => {
                commit(null);
                setTab('champions');
                setLookup(id);
              }}
            />
          ) : (
            <QuizRun s={session} onChoose={choose} onNext={advance} onQuit={quit} />
          )}
        </div>
      </div>
    );
  }

  const set = (patch: Partial<StudyStore>) => setStore((s) => ({ ...s, ...patch }));

  return (
    <div className="scroll">
      <div className="wrap practice study fade-up">
        <header className="pr-head one-line">
          <h1 className="display pr-h1">STUDY</h1>
          <div className="eyebrow">Learn · every champion in League</div>
          <div className="lab-tally mono st-tally">
            <span>
              <b>{ROSTER.length}</b> CHAMPIONS
            </span>
            <span>
              <b>
                <Ticker value={counts.known} />
              </b>
              /{facts} FACTS KNOWN
            </span>
            <span className={due.length ? 'st-due' : ''}>
              <b>{due.length}</b> DUE
            </span>
          </div>
          <Why label="What is here">
            <p className="dim pr-lead">
              Every champion’s passive, what each of their abilities does, how long each one is down for,
              how far each one reaches, and Riot’s own tips for playing against them — asked until you know
              them. A fact you miss comes back a few questions later; a fact you know waits a day, then
              three, then a week, then longer, so the ones you know stop costing you time.
            </p>
            <p className="dim pr-lead">
              The numbers are Riot’s: Data Dragon {DATA_VERSION}, rank one unless it says otherwise. Data
              Dragon writes some figures as placeholders — 25000 for “global” and for “cast on yourself”
              alike, 0 for a passive sitting in an ability slot, one number for a champion with two forms —
              and the quiz never asks about those. Where a champion’s ability is listed as a range but is
              really the size of an area around them, the figure is still Riot’s.
            </p>
          </Why>
        </header>

        <div className="pr-seg st-tabs" role="tablist" aria-label="Study">
          {(
            [
              ['quiz', 'QUIZ', 'be asked'],
              ['champions', 'CHAMPIONS', 'look it up'],
            ] as const
          ).map(([id, label, sub]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`pr-seg-btn${tab === id ? ' on' : ''}`}
              style={{ ['--c' as string]: '#c8aa6e' }}
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                if (tab === id) return;
                audio.play('uiTab');
                setTab(id);
              }}
            >
              <b className="display">{label}</b>
              <i>{sub}</i>
            </button>
          ))}
        </div>

        {tab === 'quiz' ? (
          <QuizMenu store={store} pool={pool} due={due.length} onSet={set} onStart={start} />
        ) : (
          <Reference
            store={store}
            open={lookup}
            onOpen={setLookup}
            onDrill={(id) => start('play', id)}
          />
        )}
      </div>
    </div>
  );
}

/** The next question for a session, or null when there is nothing left to ask. */
function draw(s: Session, store: StudyStore): Question | null {
  const g = { rng: s.rng, pool: s.pool };
  if (s.mode === 'review') {
    while (s.queue.length) {
      const q = questionFor(g, s.queue.shift()!, s.topics);
      if (q) return q;
    }
    return null;
  }
  const recent = new Set(s.recent);
  if (s.rng.chance(REVIEW_SHARE)) {
    const due = dueFacts(store, Date.now(), s.pool).filter((f) => !recent.has(f));
    if (due.length) {
      // Most overdue first, but not always the same one.
      const q = questionFor(g, due[s.rng.int(0, Math.min(due.length, 4))], s.topics);
      if (q) return q;
    }
  }
  return nextQuestion(g, s.topics, recent);
}

// =========================================================================
// The menu
// =========================================================================

function QuizMenu({
  store,
  pool,
  due,
  onSet,
  onStart,
}: {
  store: StudyStore;
  pool: Champion[];
  due: number;
  onSet: (patch: Partial<StudyStore>) => void;
  onStart: (mode: StudyMode) => void;
}) {
  const canPlay = pool.length > 0 && store.topics.length > 0;
  const toggleTopic = (t: Topic) => {
    const on = store.topics.includes(t);
    // Never none: a quiz about nothing is a button that does nothing.
    if (on && store.topics.length === 1) return;
    audio.play('uiTab');
    onSet({ topics: on ? store.topics.filter((x) => x !== t) : TOPICS.map((x) => x.id).filter((x) => x === t || store.topics.includes(x)) });
  };

  return (
    <div className="st-menu fade-up">
      <div className="st-modes">
        {MODES.map((m) => {
          const best = m.id === 'play' ? store.best.play : m.id === 'survive' ? store.best.survive : null;
          const off = !canPlay || (m.id === 'review' && due === 0);
          return (
            <button
              key={m.id}
              type="button"
              className={`st-mode${off ? ' off' : ''}`}
              disabled={off}
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => onStart(m.id)}
            >
              <b className="display">{m.label}</b>
              <span className="st-mode-brief">{m.brief}</span>
              <span className="st-mode-foot mono">
                {m.id === 'review'
                  ? due > 0
                    ? `${Math.min(due, REVIEW_MAX)} DUE NOW`
                    : 'NOTHING DUE — COME BACK LATER'
                  : best
                    ? `BEST ${best}`
                    : 'NO RECORD YET'}
              </span>
            </button>
          );
        })}
      </div>

      <GroupHead label="ASK ABOUT" note="at least one — a missed fact only comes back in a topic that is on" />
      <div className="st-chips">
        {TOPICS.map((t) => {
          const on = store.topics.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={`st-chip${on ? ' on' : ''}`}
              style={{ ['--c' as string]: TOPIC_COLOUR[t.id] }}
              aria-pressed={on}
              onClick={() => toggleTopic(t.id)}
            >
              <b className="mono">{t.label}</b>
              <i>{t.note}</i>
            </button>
          );
        })}
      </div>

      <GroupHead label="ABOUT WHO" note={`${pool.length} champion${pool.length === 1 ? '' : 's'} · wrong answers still come from everyone`} />
      <div className="st-scope">
        {(['all', ...CLASSES, 'mine'] as Scope[]).map((sc) => (
          <button
            key={sc}
            type="button"
            className={`st-scope-btn mono${store.scope === sc ? ' on' : ''}`}
            onClick={() => {
              audio.play('uiTab');
              onSet({ scope: sc });
            }}
          >
            {sc === 'all' ? 'EVERYONE' : sc === 'mine' ? `MY LIST · ${store.mine.length}` : sc.toUpperCase()}
          </button>
        ))}
      </div>
      {store.scope === 'mine' && <PoolPicker mine={store.mine} onChange={(mine) => onSet({ mine })} />}
    </div>
  );
}

function GroupHead({ label, note }: { label: string; note: string }) {
  return (
    <div className="pr-group-head st-group-head">
      <b className="display">{label}</b>
      <span className="pr-group-rule" aria-hidden />
      <i>{note}</i>
    </div>
  );
}

/** Your own list: the champions you play against, or the ones you keep losing to. */
function PoolPicker({ mine, onChange }: { mine: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ROSTER.filter((c) => !mine.includes(c.id) && c.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, mine]);
  return (
    <div className="st-picker">
      <input
        className="st-search"
        placeholder="Add a champion…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) {
            onChange([...mine, hits[0].id]);
            setQ('');
          }
        }}
      />
      {hits.length > 0 && (
        <div className="st-hits">
          {hits.map((c) => (
            <button
              key={c.id}
              type="button"
              className="st-hit"
              onClick={() => {
                audio.play('uiClick');
                onChange([...mine, c.id]);
                setQ('');
              }}
            >
              + {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="st-mine">
        {mine.length === 0 && <i className="dim">Nobody yet. Search above — the champions you face most are the ones worth knowing first.</i>}
        {mine.map((id) => (
          <button
            key={id}
            type="button"
            className="st-mine-chip"
            title="Remove"
            onClick={() => {
              audio.play('uiBack');
              onChange(mine.filter((x) => x !== id));
            }}
          >
            {champ(id)?.name ?? id} <span aria-hidden>×</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// =========================================================================
// A question
// =========================================================================

function QuizRun({
  s,
  onChoose,
  onNext,
  onQuit,
}: {
  s: Session;
  onChoose: (pick: number) => void;
  onNext: () => void;
  onQuit: () => void;
}) {
  const q = s.q!;
  const done = s.picked !== null;
  const right = done && isRight(q, s.picked!);
  const last = s.mode === 'survive' ? done && s.strikes >= STRIKES : s.mode === 'play' ? done && s.left <= 0 : false;
  const topic = TOPICS.find((t) => t.id === q.topic)!;
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Focus, and scroll to, the way on: on a phone the reveal lands below the fold.
    if (done) nextRef.current?.focus();
  }, [done]);

  return (
    <div className="st-run">
      <div className="st-bar mono">
        <span className="st-bar-mode">{s.only ? `${champ(s.only)?.name.toUpperCase()} · DRILL` : MODES.find((m) => m.id === s.mode)!.label}</span>
        {s.mode === 'play' && (
          <span className={`st-clock${s.left < 10_000 ? ' low' : ''}`}>
            <i style={{ width: `${(s.left / PLAY_MS) * 100}%` }} />
            <b>{Math.ceil(s.left / 1000)}s</b>
          </span>
        )}
        {s.mode === 'survive' && (
          <span className="st-strikes" aria-label={`${s.strikes} of ${STRIKES} wrong`}>
            {Array.from({ length: STRIKES }, (_, i) => (
              <i key={i} className={i < s.strikes ? 'on' : ''} />
            ))}
          </span>
        )}
        {s.mode === 'review' && <span>{s.queue.length + (done ? 0 : 1)} LEFT</span>}
        <span className="st-bar-score">
          <b>{s.right}</b> RIGHT{s.streak >= 3 ? ` · ${s.streak} IN A ROW` : ''}
        </span>
        <button type="button" className="btn ghost sm" onClick={onQuit}>
          END · ESC
        </button>
      </div>

      <div key={`${s.asked}-${q.fact}`} className="st-card fade-up" style={{ ['--c' as string]: TOPIC_COLOUR[q.topic] }}>
        <div className="eyebrow st-topic">{topic.label}</div>
        <h2 className="st-prompt">{q.prompt}</h2>
        {q.stem && <blockquote className="st-stem">{q.stem}</blockquote>}

        {q.format === 'choice' ? (
          <div className={`st-options${q.options.length === 2 ? ' two' : ''}`}>
            {q.options.map((o, i) => {
              const state = !done ? '' : i === q.answer ? ' right' : i === s.picked ? ' wrong' : ' dim';
              return (
                <button
                  key={i}
                  type="button"
                  className={`st-option${state}`}
                  disabled={done}
                  onMouseEnter={() => !done && audio.play('uiHover')}
                  onClick={() => onChoose(i)}
                >
                  <span className="st-key mono">{i + 1}</span>
                  <span className="st-option-text">
                    <b>{o.label}</b>
                    {o.sub && <i>{o.sub}</i>}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <RangeField q={q} picked={s.picked} onPick={onChoose} />
        )}

        {done && (
          <div className={`st-reveal fade-up ${right ? 'right' : 'wrong'}`}>
            <div className="st-verdict display">
              {right ? 'RIGHT' : 'NOT QUITE'}
              {q.format === 'place' && (
                <span className="mono st-off">
                  {' '}
                  · you put it at {Math.round(s.picked!)} — {Math.round(Math.abs(s.picked! - q.range))} units{' '}
                  {s.picked! > q.range ? 'long' : 'short'}
                </span>
              )}
            </div>
            <p className="st-line">{q.reveal.line}</p>
            <div className="st-reveal-cards">
              <ChampFacts id={q.reveal.champ} focus={q.reveal.focus} tip={q.reveal.tip} />
              {q.reveal.vs && <ChampFacts id={q.reveal.vs.champ} focus={q.reveal.vs.focus} />}
            </div>
            <button ref={nextRef} type="button" className="btn primary st-next" onClick={onNext}>
              {last ? 'RESULTS' : 'NEXT'} <span className="mono">⏎</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The floor, from above: the champion, a distance you already know by eye,
 * and the question of where the ability stops.
 *
 * The number is hidden while you aim — it would turn a question about how far
 * something looks into one about arithmetic — and printed once you have put
 * the mark down, next to the truth.
 */
function RangeField({ q, picked, onPick }: { q: PlaceQuestion; picked: number | null; onPick: (units: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 720, h: 300 });
  // The floor is always 1800 units wide at this scale, whatever the answer —
  // a floor that fitted itself to the answer would be the answer.
  const SPAN = 1800;
  const PAD = 48;
  const scale = (size.w - PAD * 2) / SPAN;
  const origin = { x: PAD, y: size.h / 2 };

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(280, Math.min(el.clientWidth, 900));
      setSize({ w, h: Math.round(Math.max(220, Math.min(320, w * 0.42))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);

    // Ground.
    const bg = g.createLinearGradient(0, 0, size.w, 0);
    bg.addColorStop(0, '#0b1a1c');
    bg.addColorStop(1, '#060d15');
    g.fillStyle = bg;
    g.fillRect(0, 0, size.w, size.h);
    g.strokeStyle = 'rgba(120, 90, 40, 0.12)';
    g.lineWidth = 1;
    for (let x = 0; x < size.w; x += 24) {
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, size.h);
      g.stroke();
    }
    for (let y = 0; y < size.h; y += 24) {
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(size.w, y + 0.5);
      g.stroke();
    }

    const ring = (r: number, colour: string, dash: number[], width = 2) => {
      g.save();
      g.setLineDash(dash);
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.beginPath();
      g.arc(origin.x, origin.y, r * scale, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    };
    const label = (r: number, text: string, colour: string, dy: number) => {
      g.font = '600 11px "JetBrains Mono", monospace';
      g.fillStyle = colour;
      g.textAlign = 'center';
      g.fillText(text, origin.x + r * scale, origin.y + dy);
    };

    // The yardstick.
    ring(q.ref, 'rgba(10, 200, 185, 0.7)', [6, 6], 1.5);
    label(q.ref, q.refLabel.toUpperCase(), 'rgba(56, 224, 208, 0.9)', -size.h / 2 + 18);

    // The aim line.
    g.strokeStyle = 'rgba(200, 170, 110, 0.25)';
    g.setLineDash([2, 6]);
    g.beginPath();
    g.moveTo(origin.x, origin.y);
    g.lineTo(size.w, origin.y);
    g.stroke();
    g.setLineDash([]);

    if (picked === null && hover !== null) ring(hover, 'rgba(240, 230, 210, 0.75)', [], 2);
    if (picked !== null) {
      const ok = Math.abs(picked - q.range) <= q.tolerance;
      // The band that counts as right, then the truth, then you.
      g.fillStyle = 'rgba(79, 212, 124, 0.12)';
      g.beginPath();
      g.arc(origin.x, origin.y, (q.range + q.tolerance) * scale, 0, Math.PI * 2);
      g.arc(origin.x, origin.y, Math.max(0, q.range - q.tolerance) * scale, 0, Math.PI * 2, true);
      g.fill();
      ring(q.range, '#4fd47c', [], 2.5);
      label(q.range, `${q.range}`, '#4fd47c', size.h / 2 - 12);
      ring(picked, ok ? 'rgba(240, 230, 210, 0.8)' : '#e84057', [4, 4], 2);
      label(picked, `YOU ${Math.round(picked)}`, ok ? '#f0e6d2' : '#e84057', size.h / 2 - 28);
    }

    // The champion.
    g.fillStyle = '#c8aa6e';
    g.strokeStyle = '#f0e6d2';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(origin.x, origin.y, 9, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const who = champ(q.champ);
    g.font = '700 11px "Chakra Petch", sans-serif';
    g.fillStyle = '#f0e6d2';
    g.textAlign = 'left';
    g.fillText(`${who?.name ?? ''} ${q.key}`.toUpperCase(), origin.x - 6, origin.y + 26);
  }, [q, picked, hover, size, scale, origin.x, origin.y]);

  const toUnits = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * size.w;
    const y = ((e.clientY - r.top) / r.height) * size.h;
    return Math.hypot(x - origin.x, y - origin.y) / scale;
  };

  return (
    <div className="st-field">
      <canvas
        ref={ref}
        style={{ width: size.w, height: size.h }}
        className={picked === null ? 'aiming' : ''}
        onPointerMove={(e) => picked === null && setHover(toUnits(e))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          if (picked !== null) return;
          onPick(Math.round(toUnits(e)));
        }}
      />
      {picked === null && <p className="dim st-field-hint">Click where it stops. The dashed ring is a distance you already know.</p>}
    </div>
  );
}

// =========================================================================
// Results
// =========================================================================

function SessionResults({
  s,
  best,
  onAgain,
  onBack,
  onLookup,
}: {
  s: Session;
  best: number | null;
  onAgain: () => void;
  onBack: () => void;
  onLookup: (id: string) => void;
}) {
  const acc = s.asked ? Math.round((s.right / s.asked) * 100) : 0;
  const headline =
    s.mode === 'review' && s.asked === 0
      ? 'Nothing to review.'
      : s.asked === 0
        ? 'No questions answered.'
        : s.mode === 'play'
          ? `${s.right} right in a minute.`
          : s.mode === 'survive'
            ? `${s.right} right before the third miss.`
            : `${s.right} of ${s.asked} remembered.`;

  return (
    <div className="st-results fade-up">
      <div className="eyebrow">{s.only ? `${champ(s.only)?.name} · drill` : MODES.find((m) => m.id === s.mode)!.label}</div>
      <div className="st-score display">
        <Ticker value={s.right} />
      </div>
      <p className="st-headline">{headline}</p>
      <div className="lab-tally mono st-tally">
        <span>
          <b>{s.asked}</b> ASKED
        </span>
        <span>
          <b>{acc}%</b> RIGHT
        </span>
        <span>
          <b>{s.bestStreak}</b> BEST STREAK
        </span>
        {best !== null && !s.only && (
          <span className={s.newBest ? 'st-due' : ''}>
            <b>{best}</b> {s.newBest ? 'NEW BEST' : 'BEST'}
          </span>
        )}
      </div>

      {s.missed.length > 0 && (
        <>
          <GroupHead label="TO KNOW NEXT TIME" note="each of these comes back in your next few questions, and in REVIEW" />
          <ul className="st-missed">
            {s.missed.map((q, i) => (
              <li key={i}>
                <button type="button" className="st-missed-row" onClick={() => onLookup(q.reveal.champ)}>
                  <b>{champ(q.reveal.champ)?.name}</b>
                  <span>{q.reveal.line}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="st-results-buttons">
        <button type="button" className="btn primary lg" onClick={onAgain}>
          AGAIN <span className="mono">⏎</span>
        </button>
        <button type="button" className="btn ghost" onClick={onBack}>
          BACK · ESC
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// The reference
// =========================================================================

function Reference({
  store,
  open,
  onOpen,
  onDrill,
}: {
  store: StudyStore;
  open: string | null;
  onOpen: (id: string | null) => void;
  onDrill: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? ROSTER.filter((c) => c.name.toLowerCase().includes(s) || c.title.toLowerCase().includes(s)) : ROSTER;
  }, [q]);
  const c = open ? champ(open) : undefined;

  if (c) {
    const t = champTally(store, c.id);
    return (
      <div className="st-ref fade-up">
        <div className="st-ref-top">
          <button type="button" className="btn ghost sm" onClick={() => onOpen(null)}>
            ← ALL CHAMPIONS
          </button>
          <button type="button" className="btn primary sm" onClick={() => onDrill(c.id)}>
            DRILL {c.name.toUpperCase()} · 1 MIN
          </button>
        </div>
        <ChampFacts id={c.id} full />
        <p className="dim mono st-ref-tally">
          {t.seen ? `${t.known} of ${t.seen} facts asked so far known${t.missed ? ` · ${t.missed} to review` : ''}` : 'Not asked about yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="st-ref fade-up">
      <input
        className="st-search"
        placeholder={`Search ${ROSTER.length} champions…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) onOpen(list[0].id);
        }}
      />
      <div className="st-grid">
        {list.map((x) => {
          const t = champTally(store, x.id);
          return (
            <button
              key={x.id}
              type="button"
              className="st-cell"
              onMouseEnter={() => audio.play('uiHover')}
              onClick={() => {
                audio.play('uiClick');
                onOpen(x.id);
              }}
            >
              <b>{x.name}</b>
              <i>{x.tags.join(' · ')}</i>
              {t.seen > 0 && (
                <span className="st-cell-bar" aria-label={`${t.known} of ${t.seen} known`}>
                  <span style={{ width: `${(t.known / t.seen) * 100}%` }} />
                </span>
              )}
            </button>
          );
        })}
        {list.length === 0 && <p className="dim">Nobody by that name.</p>}
      </div>
    </div>
  );
}

/**
 * One champion's card: the passive, the four abilities with the figures the
 * quiz asks about, and Riot's tips for playing against them. In a reveal only
 * the row the question was about is open; in the reference, all of it.
 */
function ChampFacts({ id, focus, tip, full }: { id: string; focus?: Focus; tip?: number; full?: boolean }) {
  const c = champ(id);
  if (!c) return null;
  const show = (f: Focus) => full || focus === f;
  return (
    <div className={`st-champ${full ? ' full' : ''}`}>
      <div className="st-champ-head">
        <b className="display">{c.name}</b>
        <i>{c.title}</i>
        <span className="mono st-champ-meta">
          {c.tags.join(' · ')} · <span className={focus === 'AR' ? 'hot' : ''}>ATTACK RANGE {c.ar}</span> · MOVE {c.ms}
        </span>
      </div>
      {show('P') && (
        <div className={`st-row${focus === 'P' ? ' hot' : ''}`}>
          <span className="st-slot mono">P</span>
          <div>
            <b>{c.passive.name}</b>
            <p>{c.passive.text}</p>
          </div>
        </div>
      )}
      {SPELL_KEYS.map((k) => {
        if (!show(k)) return null;
        const s = spellOf(c, k);
        return (
          <div key={k} className={`st-row${focus === k ? ' hot' : ''}`}>
            <span className="st-slot mono">{k}</span>
            <div>
              <b>{s.name}</b>
              <p>{s.text}</p>
              <span className="st-figs mono">
                <span title="Cooldown by rank">CD {cooldownFit(c, s) ? ladder(s.cd, secs) : '—'}</span>
                <span title="Range at rank one, as Data Dragon lists it">RANGE {rangeFit(c, s) ? units(s.range[0]) : '—'}</span>
              </span>
            </div>
          </div>
        );
      })}
      {(full || focus === 'TIP') && c.enemy.length > 0 && (
        <div className="st-tips">
          <span className="eyebrow">Playing against {c.name}</span>
          <ul>
            {c.enemy.map((t, i) => (
              <li key={i} className={focus === 'TIP' && tip === i ? 'hot' : ''}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
