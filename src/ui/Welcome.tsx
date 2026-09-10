import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { resolveBindings, shortCodeLabel } from '../engine/input';
import { APM_LEVELS } from '../progression/apm';
import { Crest } from './components/Crest';
import './welcome.css';

/**
 * THE FIRST FIVE MINUTES.
 *
 * Everything in this client used to be explained in the client's own words —
 * benches, rungs, rosters, floors, chains — and every one of those words is a
 * word you can only learn by already knowing it. Somebody opening this for the
 * first time does not need the vocabulary. They need four answers:
 *
 *   what is this, how do I move, how hard should it be, and what do I press
 *   first.
 *
 * So this is the first thing anybody ever sees, it asks exactly those four
 * things, and the third one it answers *for* them by measuring their hands
 * for twenty seconds rather than asking them to guess a difficulty. The test
 * is not decoration — the number it produces is the level every drill in the
 * client will open on afterwards.
 *
 * It can be replayed at any time from the "?" in the top bar, and skipped at
 * any point with a single button. Nothing it collects is unrecoverable: every
 * answer is a setting, and every setting lives in SETUP.
 */

export interface WelcomeResult {
  name: string;
  scheme: 'click' | 'wasd';
  /** The level the ladder should open on, 1..10. */
  level: number;
  /** Median reaction, ms. Zero if the test was skipped. */
  reaction: number;
  accuracy: number;
  /** Whether they took the test or skipped straight past it. */
  measured: boolean;
}

interface Props {
  /** The name to start the field on. */
  name: string;
  scheme: 'click' | 'wasd';
  /** True when replayed from the top bar rather than shown on a first run. */
  replay?: boolean;
  onDone: (r: WelcomeResult) => void;
  /** Close without changing anything. */
  onSkip: () => void;
}

type StepId = 'hail' | 'name' | 'tour' | 'scheme' | 'played' | 'brief' | 'test' | 'verdict';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'hail', label: 'HELLO' },
  { id: 'name', label: 'YOU' },
  { id: 'tour', label: 'THE PLACE' },
  { id: 'scheme', label: 'MOVING' },
  { id: 'played', label: 'EXPERIENCE' },
  { id: 'brief', label: 'THE TEST' },
  { id: 'test', label: 'HANDS' },
  { id: 'verdict', label: 'YOUR LEVEL' },
];

/** How much League is behind these hands. Only ever nudges the result. */
const PLAYED = [
  { id: 'never', label: 'NEVER PLAYED IT', note: "I'm here for the reflexes, not the game.", bias: -1 },
  { id: 'some', label: 'A LITTLE', note: 'I know what a minion is.', bias: 0 },
  { id: 'lots', label: 'A LOT', note: 'Hundreds of games. Unranked or low ranked.', bias: 1 },
  { id: 'ranked', label: 'I CLIMB', note: 'I play ranked and I care about the number.', bias: 2 },
] as const;

type PlayedId = (typeof PLAYED)[number]['id'];

/** How many lights the test asks for. Twenty seconds, near enough. */
const ROUNDS = 12;

interface Shot {
  ms: number;
  hit: boolean;
}

// ===========================================================================

export function Welcome({ name: name0, scheme: scheme0, replay, onDone, onSkip }: Props) {
  const [step, setStep] = useState<StepId>('hail');
  const [name, setName] = useState(name0 === 'PLAYER' ? '' : name0);
  const [scheme, setScheme] = useState<'click' | 'wasd'>(scheme0);
  const [played, setPlayed] = useState<PlayedId>('some');
  const [shots, setShots] = useState<Shot[]>([]);
  const [measured, setMeasured] = useState(false);

  const i = STEPS.findIndex((s) => s.id === step);
  const go = useCallback((id: StepId) => {
    audio.play('uiTab');
    setStep(id);
  }, []);
  const next = useCallback(() => {
    const n = STEPS[Math.min(STEPS.length - 1, STEPS.findIndex((s) => s.id === step) + 1)];
    go(n.id);
  }, [step, go]);
  const back = useCallback(() => {
    const n = STEPS[Math.max(0, STEPS.findIndex((s) => s.id === step) - 1)];
    go(n.id);
  }, [step, go]);

  // The four ability keys as this player will actually meet them. Under the
  // keyboard scheme they are not Q W E R, and a walkthrough that taught the
  // wrong four letters would be worse than no walkthrough.
  const keys = useMemo(() => {
    const b = resolveBindings(scheme, undefined);
    return (['q', 'w', 'e', 'r'] as const).map((slot) => ({
      slot,
      code: b[slot].primary,
      label: shortCodeLabel(b[slot].primary),
    }));
  }, [scheme]);

  const verdict = useMemo(() => readHands(shots, PLAYED.find((p) => p.id === played)!.bias), [shots, played]);

  const finish = useCallback(() => {
    audio.play('uiClick');
    onDone({
      name: name.trim() || 'PLAYER',
      scheme,
      level: verdict.level,
      reaction: verdict.reaction,
      accuracy: verdict.accuracy,
      measured,
    });
  }, [name, scheme, verdict, measured, onDone]);

  // Enter is "yes, next" on every step that is only reading. The test owns its
  // own keys, and the verdict's Enter is the one that starts the client.
  useEffect(() => {
    if (step === 'test') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      e.preventDefault();
      if (step === 'verdict') finish();
      else next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, next, finish]);

  return (
    <div className="wc" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="wc-glow" aria-hidden />
      <div className="wc-frame">
        <i className="brk tl" />
        <i className="brk tr" />
        <i className="brk bl" />
        <i className="brk br" />

        {/* ---------------------------------------------------- progress rail */}
        <div className="wc-rail" aria-hidden>
          {STEPS.map((s, n) => (
            <span key={s.id} className={`wc-pip${n < i ? ' done' : ''}${n === i ? ' on' : ''}`}>
              <b />
              <i>{s.label}</i>
            </span>
          ))}
        </div>

        <div key={step} className="wc-stage fade-up">
          {step === 'hail' && <Hail replay={replay} />}
          {step === 'name' && <NameStep name={name} onName={setName} />}
          {step === 'tour' && <Tour />}
          {step === 'scheme' && <SchemeStep scheme={scheme} onPick={setScheme} />}
          {step === 'played' && <PlayedStep played={played} onPick={setPlayed} />}
          {step === 'brief' && <Brief keys={keys} rounds={ROUNDS} />}
          {step === 'test' && (
            <HandTest
              keys={keys}
              rounds={ROUNDS}
              onDone={(s) => {
                setShots(s);
                setMeasured(true);
                setStep('verdict');
              }}
            />
          )}
          {step === 'verdict' && <Verdict v={verdict} name={name.trim() || 'PLAYER'} measured={measured} />}
        </div>

        {/* -------------------------------------------------------- the foot */}
        <div className="wc-foot">
          <button className="wc-quiet" onClick={onSkip}>
            {replay ? 'CLOSE' : 'SKIP ALL THIS'}
          </button>
          <div className="wc-foot-right">
            {i > 0 && step !== 'test' && (
              <button className="btn ghost sm" onClick={back}>
                BACK
              </button>
            )}
            {step === 'test' && (
              <button
                className="btn ghost sm"
                onClick={() => {
                  setMeasured(false);
                  setShots([]);
                  go('verdict');
                }}
              >
                SKIP THE TEST
              </button>
            )}
            {step !== 'test' && step !== 'verdict' && (
              <button className="btn primary" onMouseEnter={() => audio.play('uiHover')} onClick={next}>
                {step === 'brief' ? "I'M READY" : 'CONTINUE'}
                <em className="wc-enter mono">ENTER</em>
              </button>
            )}
            {step === 'verdict' && (
              <button className="btn primary" onMouseEnter={() => audio.play('uiHover')} onClick={finish}>
                LET'S GO
                <em className="wc-enter mono">ENTER</em>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// THE STEPS
// ===========================================================================

function Hail({ replay }: { replay?: boolean }) {
  return (
    <div className="wc-hail">
      <div className="wc-crest">
        <Crest size={104} spin />
      </div>
      <div className="eyebrow">{replay ? 'the tour, again' : 'first time here'}</div>
      <h1 className="display wc-h1">
        WELCOME TO <span className="foil">APEX</span>
      </h1>
      <p className="wc-lead">
        This is a gym for the hands you play League with. You press keys, it counts the ones you
        got right, and it tells you whether you are getting faster.
      </p>
      <p className="wc-lead">
        Three questions, one short test, and then you are playing. It takes about a minute.
      </p>
    </div>
  );
}

function NameStep({ name, onName }: { name: string; onName: (s: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="wc-step">
      <div className="eyebrow">question one</div>
      <h1 className="display wc-h1">WHAT DO WE CALL YOU?</h1>
      <p className="wc-lead">Goes on your scores. Nothing leaves this browser.</p>
      <input
        ref={ref}
        className="wc-input"
        value={name}
        maxLength={18}
        placeholder="PLAYER"
        aria-label="Your name"
        onChange={(e) => onName(e.target.value)}
      />
      <p className="wc-note">You can change it later on the PROGRESS screen.</p>
    </div>
  );
}

function Tour() {
  const cards = [
    {
      c: '#ffd166',
      k: 'PLAY',
      t: 'A real lane',
      b: 'Farm minions against somebody who is trying to stop you. This is the game itself.',
    },
    {
      c: '#7ceaff',
      k: 'TRAIN',
      t: 'Short drills',
      b: 'One minute each. A target lights up, you press the right key. That is the whole idea.',
    },
    {
      c: '#c58bff',
      k: 'PROGRESS',
      t: 'The numbers',
      b: 'Every run is saved. Come back tomorrow and see whether the line went up.',
    },
  ];
  return (
    <div className="wc-step">
      <div className="eyebrow">what is in here</div>
      <h1 className="display wc-h1">THREE PLACES, THAT IS ALL</h1>
      <p className="wc-lead">They are the three words in the top bar. Nothing else is hiding.</p>
      <div className="wc-cards">
        {cards.map((c) => (
          <div className="wc-card" key={c.k} style={{ ['--c' as string]: c.c }}>
            <b className="display">{c.k}</b>
            <i>{c.t}</i>
            <p>{c.b}</p>
          </div>
        ))}
      </div>
      <p className="wc-note">
        Start anywhere. If you have no idea, start with TRAIN — it is one minute and it explains
        itself as you go.
      </p>
    </div>
  );
}

function SchemeStep({
  scheme,
  onPick,
}: {
  scheme: 'click' | 'wasd';
  onPick: (s: 'click' | 'wasd') => void;
}) {
  const opts = [
    {
      id: 'click' as const,
      label: 'WITH THE MOUSE',
      sub: 'right-click where you want to go',
      body: 'Exactly how League works. Pick this if you play League and want the practice to carry over.',
    },
    {
      id: 'wasd' as const,
      label: 'WITH W A S D',
      sub: 'the keys, like most other games',
      body: 'Pick this if League is not really the point and you just want your hands to get quicker.',
    },
  ];
  return (
    <div className="wc-step">
      <div className="eyebrow">question two</div>
      <h1 className="display wc-h1">HOW DO YOU WANT TO MOVE?</h1>
      <p className="wc-lead">Either is fine, and you can switch whenever you like.</p>
      <div className="wc-picks">
        {opts.map((o) => (
          <button
            key={o.id}
            className={`wc-pick${scheme === o.id ? ' on' : ''}`}
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiClick');
              onPick(o.id);
            }}
          >
            <b className="display">{o.label}</b>
            <i>{o.sub}</i>
            <p>{o.body}</p>
          </button>
        ))}
      </div>
      <p className="wc-note">SETUP, top right, has this and every key on it.</p>
    </div>
  );
}

function PlayedStep({ played, onPick }: { played: PlayedId; onPick: (p: PlayedId) => void }) {
  return (
    <div className="wc-step">
      <div className="eyebrow">question three</div>
      <h1 className="display wc-h1">HOW MUCH LEAGUE HAVE YOU PLAYED?</h1>
      <p className="wc-lead">
        Only used to pick your starting difficulty. There is no wrong answer and nothing is locked
        either way.
      </p>
      <div className="wc-list">
        {PLAYED.map((p) => (
          <button
            key={p.id}
            className={`wc-row${played === p.id ? ' on' : ''}`}
            onMouseEnter={() => audio.play('uiHover')}
            onClick={() => {
              audio.play('uiClick');
              onPick(p.id);
            }}
          >
            <span className="wc-row-dot" aria-hidden />
            <b>{p.label}</b>
            <i>{p.note}</i>
          </button>
        ))}
      </div>
    </div>
  );
}

function Brief({ keys, rounds }: { keys: { label: string }[]; rounds: number }) {
  return (
    <div className="wc-step">
      <div className="eyebrow">the last bit</div>
      <h1 className="display wc-h1">NOW LET'S SEE YOUR HANDS</h1>
      <p className="wc-lead">
        {rounds} lights, about twenty seconds. A square appears somewhere with a letter on it —
        press that letter. That is the test, and it is also most of what you will be doing here.
      </p>
      <div className="wc-keys">
        {keys.map((k) => (
          <span className="wc-key" key={k.label}>
            {k.label}
          </span>
        ))}
      </div>
      <p className="wc-note">
        Rest your fingers on those four now. Go as fast as you can and do not worry about
        mistakes — we are looking for your natural speed, not a perfect score.
      </p>
    </div>
  );
}

// ===========================================================================
// THE TEST
// ===========================================================================

interface Prompt {
  n: number;
  key: { slot: string; code: string; label: string };
  x: number;
  y: number;
  at: number;
}

function HandTest({
  keys,
  rounds,
  onDone,
}: {
  keys: { slot: string; code: string; label: string }[];
  rounds: number;
  onDone: (s: Shot[]) => void;
}) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [count, setCount] = useState(0);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const [countdown, setCountdown] = useState(3);
  const shots = useRef<Shot[]>([]);
  const timer = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  // Three, two, one — so the first light is never the one that catches you
  // still reading the sentence above it.
  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => {
      audio.play('uiTab');
      setCountdown((c) => c - 1);
    }, 700);
    return () => window.clearTimeout(t);
  }, [countdown]);

  const raise = useCallback(() => {
    if (!live.current) return;
    const key = keys[Math.floor(Math.random() * keys.length)];
    setPrompt({
      n: shots.current.length,
      key,
      // Kept off the very edges so the pad never lands under the frame.
      x: 12 + Math.random() * 76,
      y: 16 + Math.random() * 68,
      at: performance.now(),
    });
  }, [keys]);

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(raise, 420 + Math.random() * 900);
  }, [raise]);

  useEffect(() => {
    if (countdown > 0) return;
    schedule();
    return () => window.clearTimeout(timer.current);
  }, [countdown, schedule]);

  // The answer. A wrong key is recorded and moves on — the point is to find a
  // natural rate, and a test that made you repeat your mistakes would measure
  // patience instead.
  useEffect(() => {
    if (countdown > 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!prompt) return;
      if (!keys.some((k) => k.code === e.code)) return;
      e.preventDefault();
      const hit = e.code === prompt.key.code;
      const ms = performance.now() - prompt.at;
      shots.current = [...shots.current, { ms, hit }];
      audio.play(hit ? 'uiClick' : 'uiBack');
      setFlash(hit ? 'hit' : 'miss');
      window.setTimeout(() => setFlash(null), 180);
      setPrompt(null);
      setCount(shots.current.length);
      if (shots.current.length >= rounds) {
        window.setTimeout(() => live.current && onDone(shots.current), 420);
        return;
      }
      schedule();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, keys, rounds, schedule, onDone, countdown]);

  const done = shots.current.filter((s) => s.hit).length;

  return (
    <div className="wc-test">
      <div className="wc-test-head">
        <span className="eyebrow">press the letter you see</span>
        <span className="mono wc-test-count">
          {count} / {rounds}
        </span>
      </div>
      <div className={`wc-field${flash ? ` ${flash}` : ''}`}>
        <i className="brk tl" />
        <i className="brk tr" />
        <i className="brk bl" />
        <i className="brk br" />
        {countdown > 0 ? (
          <div className="wc-count display">{countdown}</div>
        ) : prompt ? (
          <button
            key={prompt.n}
            className="wc-pad display"
            style={{ left: `${prompt.x}%`, top: `${prompt.y}%` }}
            tabIndex={-1}
          >
            {prompt.key.label}
          </button>
        ) : (
          <div className="wc-wait mono">…</div>
        )}
        <div className="wc-scan" aria-hidden />
      </div>
      <div className="wc-test-foot mono">
        {done} clean · fingers on {keys.map((k) => k.label).join(' ')}
      </div>
    </div>
  );
}

// ===========================================================================
// THE VERDICT
// ===========================================================================

interface Reading {
  level: number;
  reaction: number;
  accuracy: number;
  title: string;
  line: string;
}

/**
 * Twelve lights, turned into one number.
 *
 * The median rather than the mean, because one sneeze should not decide where
 * somebody starts, and accuracy only ever pulls the answer *down* — a fast
 * hand that presses the wrong key is not ready for a faster floor.
 */
function readHands(shots: Shot[], bias: number): Reading {
  const hits = shots.filter((s) => s.hit);
  const accuracy = shots.length ? hits.length / shots.length : 0;
  if (hits.length < 4) {
    // Skipped, or barely attempted. Fall back to what they told us, gently.
    const level = clamp(3 + bias, 1, 6);
    return {
      level,
      reaction: 0,
      accuracy,
      title: 'LEVEL ' + level,
      line: 'We went with what you told us. Nudge it up or down on any drill card whenever you like.',
    };
  }
  const sorted = [...hits].map((s) => s.ms).sort((a, b) => a - b);
  const reaction = Math.round(sorted[Math.floor(sorted.length / 2)]);

  // 620ms and slower is level one; 240ms and faster is level eight. Linear in
  // between, because every level in this client is one even step of the same
  // dial and the mapping onto it should be too.
  const raw = 1 + ((620 - reaction) / (620 - 240)) * 7;
  const penalty = accuracy >= 0.92 ? 0 : accuracy >= 0.8 ? 1 : 2;
  const level = clamp(Math.round(raw + bias * 0.5 - penalty), 1, 8);

  const title =
    reaction <= 260
      ? 'FAST'
      : reaction <= 330
        ? 'QUICK'
        : reaction <= 420
          ? 'STEADY'
          : reaction <= 520
            ? 'UNHURRIED'
            : 'TAKING YOUR TIME';

  const line =
    penalty > 0
      ? 'Quick hands, a few wrong keys. We started you a touch lower so accuracy comes first — it always does.'
      : reaction <= 300
        ? 'That is genuinely fast. You should find the first few levels easy, so climb early.'
        : reaction <= 430
          ? 'A normal, healthy set of hands. This is the level most people start on.'
          : 'A gentle start, on purpose. Speed is the easiest thing here to improve.';

  return { level, reaction, accuracy, title, line };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function Verdict({ v, name, measured }: { v: Reading; name: string; measured: boolean }) {
  return (
    <div className="wc-step wc-verdict">
      <div className="eyebrow">{measured ? 'twelve lights, one number' : 'no test taken'}</div>
      <h1 className="display wc-h1">
        {name}, YOU START AT <span className="foil">LEVEL {v.level}</span>
      </h1>

      <div className="wc-scores">
        <div className="stat lg">
          <span className="stat-k">Reaction</span>
          <span className="stat-v">{measured && v.reaction ? `${v.reaction}ms` : '—'}</span>
          <span className="stat-s">{measured && v.reaction ? v.title : 'skipped'}</span>
        </div>
        <div className="stat lg">
          <span className="stat-k">Right key</span>
          <span className="stat-v">{measured ? `${Math.round(v.accuracy * 100)}%` : '—'}</span>
          <span className="stat-s">of the lights you answered</span>
        </div>
        <div className="stat lg">
          <span className="stat-k">Starting level</span>
          <span className="stat-v">
            {v.level}
            <em className="wc-of">/ {APM_LEVELS}</em>
          </span>
          <span className="stat-s">every drill opens here</span>
        </div>
      </div>

      <div className="wc-ladder" aria-hidden>
        {Array.from({ length: APM_LEVELS }, (_, n) => n + 1).map((n) => (
          <span key={n} className={`wc-rung${n <= v.level ? ' on' : ''}${n === v.level ? ' here' : ''}`}>
            <b>{n}</b>
          </span>
        ))}
      </div>

      <p className="wc-lead">{v.line}</p>
      <p className="wc-note">
        Nothing is locked. Every level of every drill is playable right now — this is only where
        the arrows start. Too easy, press ▶. Too hard, press ◀.
      </p>
    </div>
  );
}
