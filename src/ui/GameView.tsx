import { Fragment, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { audio } from '../engine/audio';
import {
  InputSystem,
  codeLabel,
  defaultsFor,
  type AbilitySlot,
  type Bindings,
  type MovementScheme,
} from '../engine/input';
import { GameLoop } from '../engine/loop';
import { derive } from '../engine/metrics';
import { clearPaint, newPaint } from '../engine/paint';
import { ABILITY_BAR, Session, type HudSnapshot } from '../engine/session';
import { RiftRenderer } from '../gfx/RiftRenderer';
import { arenaFor, createDrill } from '../drills';
import { DRILLS, type DrillId } from '../drills/catalog';
import type { AppSettings, RunResult } from '../progression/profile';
import { Minimap } from './hud/Minimap';
import './gameview.css';

interface Props {
  drill: DrillId;
  difficulty: number;
  seed: number;
  settings: AppSettings;
  /** Label shown above the drill name, e.g. "CALIBRATION 2 / 5". */
  context?: string;
  /**
   * Multiplies the drill's own length. Only the APM section uses it, for a
   * double-length endurance run; an open-ended drill is unaffected.
   */
  durationScale?: number;
  onComplete: (result: RunResult, bounds: { w: number; h: number }) => void;
  onExit: () => void;
  onRetry: () => void;
}

/**
 * A sigil per slot.
 *
 * League's ability icons are art, and art is the one thing this trainer does
 * not generate. What it can do is give each slot a shape that is distinct at
 * 20 pixels — which is the only property of an ability icon that matters in a
 * fight — and match it to the sound that slot makes: Q is a dart, W is a
 * shield arc, E is a dash, R is a burst.
 */
const SLOT_GLYPH: Record<string, ReactElement> = {
  q: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 20 L20 4 M20 4 L20 11 M20 4 L13 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  w: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3 L20 7 V12 C20 17 16 20 12 21.5 C8 20 4 17 4 12 V7 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
  e: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3 12 H15 M10 7 L15 12 L10 17 M18 6 V18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  r: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 L14.4 9.2 L21.5 12 L14.4 14.8 L12 22 L9.6 14.8 L2.5 12 L9.6 9.2 Z" fill="currentColor" />
    </svg>
  ),
  d: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 5.5 V12 L16 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  f: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M13 2 L5 13 H11 L10 22 L19 10 H13 Z" fill="currentColor" />
    </svg>
  ),
};

const schemeOf = (settings: AppSettings): MovementScheme => settings.movementScheme ?? 'click';

const bindingsFrom = (settings: AppSettings): Bindings => {
  const scheme = schemeOf(settings);
  const out = { ...defaultsFor(scheme) };
  const overrides = scheme === 'wasd' ? settings.wasdBindings : settings.bindings;
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (k in out) (out as Record<string, unknown>)[k] = v;
  }
  return out;
};

/** The hint row, which is different in the two schemes and short in both. */
const HINTS: Record<MovementScheme, { key: string; label: string }[]> = {
  click: [
    { key: 'RMB', label: 'move · attack' },
    { key: 'A', label: 'attack-move' },
    { key: 'S', label: 'stop' },
    { key: 'SPACE', label: 'centre camera' },
    { key: 'Y', label: 'camera lock' },
    { key: 'WHEEL', label: 'zoom' },
    { key: 'ESC', label: 'pause' },
  ],
  wasd: [
    { key: 'WASD', label: 'move' },
    { key: 'LMB', label: 'attack' },
    { key: 'Q E R F', label: 'abilities' },
    { key: 'RELEASE', label: 'to shoot' },
    { key: 'SPACE', label: 'centre camera' },
    { key: 'WHEEL', label: 'zoom' },
    { key: 'ESC', label: 'pause' },
  ],
};



/** What is actually printed on the ability key, which the scheme decides. */
const abilityKeyLabel = (settings: AppSettings, slot: AbilitySlot): string => {
  const b = bindingsFrom(settings)[slot];
  return codeLabel(b.primary).toUpperCase();
};

export function GameView({
  drill,
  difficulty,
  seed,
  settings,
  context,
  durationScale = 1,
  onComplete,
  onExit,
  onRetry,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'countdown' | 'running' | 'paused' | 'ended'>('countdown');
  const [gpuLost, setGpuLost] = useState(false);
  const doneRef = useRef(false);
  const meta = DRILLS[drill];
  // A drill with no clock stays without one: doubling zero is still open-ended.
  const duration = meta.duration > 0 ? Math.round(meta.duration * durationScale) : meta.duration;

  // Everything below lives outside React on purpose: the simulation must not
  // be driven by, or wait on, a render pass.
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const host = hostRef.current;
    const minimapCanvas = minimapRef.current;
    if (!canvas || !host || !overlay || !minimapCanvas) return;
    doneRef.current = false;

    const bounds = arenaFor(drill);
    const renderer = new RiftRenderer(canvas, overlay, bounds, meta.accent, seed % 997);
    renderer.setQuality(settings.lowFx ? 'low' : 'high');
    if (meta.zoom !== undefined) renderer.setZoom(meta.zoom);
    const minimap = new Minimap(minimapCanvas);
    minimap.resize(158);

    const scheme = schemeOf(settings);
    const input = new InputSystem({
      bindings: bindingsFrom(settings),
      quickCast: settings.quickCast,
      activeSlots: new Set<AbilitySlot>(meta.abilities),
      scheme,
    });
    const session = new Session(
      { duration, arena: bounds, seed, difficulty, abilities: meta.abilities, scheme },
      input,
      renderer,
    );
    const drillInstance = createDrill(drill, session);
    session.attachDrill(drillInstance);
    session.onResetRequest = () => {
      if (session.phase === 'ended') return;
      session.abort();
    };

    const paint = newPaint();

    // An opt-in handle for automated testing and for players who want to
    // inspect a run. Off unless ?debug is present, so it never ships as a
    // stray global.
    const debug = typeof location !== 'undefined' && location.search.includes('debug');
    if (debug) {
      (window as unknown as { __apex?: unknown }).__apex = { session, drill: drillInstance, renderer, input, bounds };
    }

    input.attach(canvas);
    renderer.resize();
    audio.unlock();
    audio.stopAmbience();
    audio.startArenaBed();

    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(host);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      renderer.zoomBy(Math.sign(e.deltaY) * 0.09);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Last line of defence for a run in progress. Opera's back gesture is a
    // right-drag — the same input used to move — so a misfire used to unload
    // the page mid-drill with no way back. The in-app history guard catches
    // almost all of those; this catches the rest.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (doneRef.current || session.phase === 'ended') return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // --- HUD elements, written to directly each frame -------------------
    const hud = hudRef.current!;
    const q = <T extends Element>(sel: string) => hud.querySelector(sel) as T;
    const elTime = q<HTMLDivElement>('[data-time]');
    const elScore = q<HTMLDivElement>('[data-score]');
    const elChain = q<HTMLDivElement>('[data-chain]');
    const elChainN = q<HTMLDivElement>('[data-chain-n]');
    const elHp = q<HTMLDivElement>('[data-hp]');
    const elHpText = q<HTMLDivElement>('[data-hp-text]');
    const elCycle = q<HTMLDivElement>('[data-cycle]');
    const elCycleFill = q<HTMLDivElement>('[data-cycle-fill]');
    const elCycleLabel = q<HTMLDivElement>('[data-cycle-label]');
    const elFps = q<HTMLDivElement>('[data-fps]');
    const elCam = q<HTMLDivElement>('[data-cam]');
    const elBanner = q<HTMLDivElement>('[data-banner]');
    const elCount = q<HTMLDivElement>('[data-count]');
    const fieldEls = Array.from(hud.querySelectorAll('[data-field]')) as HTMLDivElement[];
    const abilityEls = Array.from(hud.querySelectorAll('[data-ability]')) as HTMLDivElement[];

    const abilityCd: number[] = [];
    let lastCount = '';
    let lastHudWrite = 0;
    let lastPhase: string = session.phase;
    let endedAt = 0;
    let slowFrames = 0;
    let quality: 'high' | 'medium' | 'low' = settings.lowFx ? 'low' : 'high';

    const writeHud = (snap: HudSnapshot, now: number) => {
      if (now - lastHudWrite < 42) return;
      lastHudWrite = now;
      const t = snap.timeLeft;
      elTime.textContent =
        duration > 0
          ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
          : `${t.toFixed(1)}`;
      elTime.classList.toggle('urgent', duration > 0 && t < 5.5);

      elScore.textContent = snap.score.toLocaleString();

      const hpPct = Math.max(0, (snap.hp / Math.max(1, snap.maxHp)) * 100);
      elHp.style.width = `${hpPct}%`;
      elHp.classList.toggle('low', hpPct < 30);
      elHpText.textContent = snap.maxHp > 1 ? `${Math.round(snap.hp)} / ${Math.round(snap.maxHp)}` : '—';

      // The attack-cycle bar. This is the drill's whole thesis made visible:
      // amber means committed, green means the backswing is yours to cancel.
      const phaseName = snap.attackPhase;
      elCycle.dataset.state = phaseName;
      if (phaseName === 'windup') {
        elCycleFill.style.width = `${snap.attackPhaseT * 100}%`;
        elCycleLabel.textContent = 'WINDUP · COMMITTED';
      } else if (phaseName === 'backswing') {
        elCycleFill.style.width = `${(1 - snap.attackPhaseT) * 100}%`;
        elCycleLabel.textContent = 'BACKSWING · FREE TO MOVE';
      } else {
        elCycleFill.style.width = `${snap.attackCd * 100}%`;
        elCycleLabel.textContent = snap.attackCd > 0.02 ? 'WINDING DOWN' : 'READY';
      }

      if (snap.chain >= 2) {
        elChain.classList.add('on');
        elChainN.textContent = `${snap.chain}`;
        elChain.style.setProperty('--intensity', String(Math.min(1, snap.chain / 10)));
      } else {
        elChain.classList.remove('on');
      }

      for (let i = 0; i < fieldEls.length; i++) {
        const f = snap.fields[i];
        const el = fieldEls[i];
        if (!f) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = '';
        const l = el.querySelector('[data-fl]') as HTMLElement;
        const v = el.querySelector('[data-fv]') as HTMLElement;
        const b = el.querySelector('[data-fb]') as HTMLElement;
        if (l.textContent !== f.label) l.textContent = f.label;
        if (v.textContent !== f.value) v.textContent = f.value;
        v.className = `hud-field-value tone-${f.tone ?? 'neutral'}`;
        if (f.bar === undefined) {
          b.style.display = 'none';
        } else {
          b.style.display = '';
          (b.firstElementChild as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, f.bar)) * 100)}%`;
        }
      }

      for (let i = 0; i < abilityEls.length; i++) {
        const a = snap.abilities[i];
        const el = abilityEls[i];
        if (!a) continue;
        el.classList.toggle('locked', a.locked);
        el.classList.toggle('highlight', a.highlight);
        // The radial sweep, exactly as a MOBA draws it: a dark wedge that
        // unwinds anticlockwise, so how much is left is a shape rather than
        // a number you have to read mid-fight.
        el.style.setProperty('--cd', String(a.cd));
        el.classList.toggle('cooling', a.cd > 0.015);
        const prev = abilityCd[i] ?? 0;
        if (prev > 0.04 && a.cd <= 0.015 && !a.locked) {
          // Retrigger the ready flash by taking the class off and forcing a
          // reflow — otherwise a second cooldown in the same element never
          // restarts the animation.
          el.classList.remove('ready');
          void el.offsetWidth;
          el.classList.add('ready');
        }
        abilityCd[i] = a.cd;
        const name = el.querySelector('[data-ab-name]') as HTMLElement;
        if (name.textContent !== a.name) name.textContent = a.name;
      }

      elFps.textContent = `${Math.round(snap.fps)}`;
      elCam.classList.toggle('unlocked', !renderer.cameraLocked);
      elBanner.textContent = snap.banner ?? '';
      elBanner.style.opacity = snap.banner ? '1' : '0';
      const countText = snap.phase === 'countdown' ? (snap.countdown > 0 ? `${snap.countdown}` : 'GO') : '';
      if (countText !== lastCount) {
        lastCount = countText;
        elCount.textContent = countText;
        elCount.classList.toggle('go', countText === 'GO');
        // Restart the strike animation on every tick rather than letting the
        // number swap silently inside a still element.
        elCount.classList.remove('tick');
        void elCount.offsetWidth;
        if (countText) elCount.classList.add('tick');
      }
      elCount.style.opacity = snap.phase === 'countdown' ? '1' : '0';
    };

    const loop = new GameLoop(
      (dt) => {
        session.cursorWorld = renderer.screenToWorld(input.cursor.x, input.cursor.y);
        session.step(dt);
      },
      (alpha, dtWall) => {
        clearPaint(paint);
        drillInstance.paint(paint, session.world.time);

        renderer.render(session.world, session.fx, alpha, dtWall, {
          cursor: input.cursor,
          showRange: settings.showRange,
          hoverTargetId: session.hoverTargetId,
          pathTrail: session.pathTrail,
          chain: session.chain,
          dimmed: session.phase === 'paused' ? 0.55 : session.dimmed,
          hitFeedback: session.hitFeedback,
          lowFx: settings.lowFx,
          paint,
          idle: session.phase === 'countdown',
        });

        const now = performance.now();
        writeHud(session.hud(loop.stats.fps), now);
        minimap.draw(session.world, renderer.scene.rig.coverage, renderer.scene.rig.focus, meta.accent);

        // Quality falls back on its own rather than asking the player to find
        // a setting. Scores must never depend on the machine.
        if (!settings.lowFx) {
          if (loop.stats.fps < 42) slowFrames++;
          else slowFrames = Math.max(0, slowFrames - 2);
          if (slowFrames > 120 && quality === 'high') {
            quality = 'medium';
            renderer.setQuality('medium');
            slowFrames = 0;
          } else if (slowFrames > 180 && quality === 'medium') {
            quality = 'low';
            renderer.setQuality('low');
            slowFrames = 0;
          }
        }

        if (session.phase !== lastPhase) {
          lastPhase = session.phase;
          setPhase(session.phase);
        }

        // Once the run is over the results panel owns the screen. Letting the
        // arena keep rendering behind it costs a full frame budget for a view
        // nobody is looking at — and on a slow machine it starves the reveal.
        if (doneRef.current && endedAt && now - endedAt > 1000) {
          loop.stop();
          return;
        }

        if (session.phase === 'ended' && !doneRef.current) {
          doneRef.current = true;
          endedAt = now;
          const out = drillInstance.outcome();
          const m = session.metrics.m;
          const result: RunResult = {
            drill,
            seed,
            difficulty: out.effectiveDifficulty ?? difficulty,
            score: Math.round(out.score),
            performance: out.performance,
            axisPerformance: out.axisPerformance,
            metrics: m,
            derived: derive(m, session.world.player?.maxHp ?? 720),
            keyMetrics: out.keyMetrics,
            endReason: session.endReason,
            helped: out.helped,
            hurt: out.hurt,
            advice: out.advice,
          };
          // Let the death/victory effects land before the results take over.
          window.setTimeout(() => onComplete(result, bounds), session.endReason === 'abort' ? 0 : 700);
        }
      },
    );
    loop.start();

    // Browsers can take the GPU back — Opera GX's RAM and CPU limiters make it
    // markedly more likely than elsewhere. Unhandled, that is a black canvas
    // and a run that quietly stops meaning anything. Freeze it, say so, and
    // let the player restart on their own terms.
    const onContextLost = (e: Event) => {
      // Without preventDefault the context can never come back at all.
      e.preventDefault();
      loop.stop();
      if (session.phase === 'running') session.phase = 'paused';
      setGpuLost(true);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      loop.stop();
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('beforeunload', onBeforeUnload);
      input.detach();
      session.fx.clear();
      audio.stopArenaBed();
      renderer.dispose();
      if (debug) delete (window as unknown as { __apex?: unknown }).__apex;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, difficulty, seed, duration]);

  const resume = useCallback(() => {
    // The session owns pause state; a synthetic Escape is the cleanest bridge.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  }, []);

  return (
    <div className="game-host" ref={hostRef}>
      <canvas ref={canvasRef} className="game-canvas" tabIndex={0} />
      <canvas ref={overlayRef} className="game-overlay" />

      <div className="hud" ref={hudRef}>
        <div className="hud-objective panel-rift">
          {context && <div className="hud-context">{context}</div>}
          <div className="hud-name">{meta.name}</div>
          <div className="hud-tag">{meta.tagline}</div>
          <div className="hud-brief">{meta.brief}</div>
        </div>

        <div className="hud-clock">
          <div className="hud-time num" data-time>
            0:00
          </div>
          <div className="hud-score-row">
            <span className="hud-score-label">SCORE</span>
            <span className="hud-score num" data-score>
              0
            </span>
          </div>
        </div>

        <div className="hud-right">
          <div className="hud-diff">
            <span className="hud-diff-label">DIFFICULTY</span>
            <div className="diff-bars">
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} className={i < Math.round(difficulty * 10) ? 'on' : ''} />
              ))}
            </div>
          </div>
          <div className="hud-fps">
            <span data-fps>60</span> FPS
          </div>
        </div>

        <div className="hud-banner" data-banner />
        <div className="hud-count" data-count />

        <div className="hud-chain" data-chain>
          <span className="hud-chain-n num" data-chain-n>
            2
          </span>
          <span className="hud-chain-label">CLEAN CHAIN</span>
        </div>

        <div className="hud-stats">
          {[0, 1, 2, 3].map((i) => (
            <div className="hud-field" data-field key={i}>
              <div className="hud-field-label" data-fl />
              <div className="hud-field-value tone-neutral" data-fv />
              <div className="hud-field-bar" data-fb>
                <span />
              </div>
            </div>
          ))}
        </div>

        <div className="champ-frame">
          <div className="cf-portrait" style={{ ['--c' as string]: meta.accent }}>
            <svg viewBox="0 0 48 48" aria-hidden>
              <path d="M24 5 L41 38 H7 Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
              <path d="M24 17 L32 33 H16 Z" fill="currentColor" />
            </svg>
            <span className="cf-level">{Math.max(1, Math.round(difficulty * 17) + 1)}</span>
          </div>

          <div className="cf-body">
            <div className="cf-hp">
              <span data-hp />
              <em data-hp-text>—</em>
            </div>

            {/* The attack-cycle bar. Not a League element — League has no
                reason to show you this — but it is the one thing the whole
                trainer is about, so it sits where League puts your resource
                bar: directly under your health, under your hands. */}
            <div className="cf-cycle" data-cycle data-state="idle">
              <span className="cf-cycle-fill" data-cycle-fill />
              <em className="cf-cycle-label" data-cycle-label>
                READY
              </em>
            </div>
          </div>

          <div className="cf-abilities">
            {ABILITY_BAR.map((s, i) => (
              <Fragment key={s}>
                {i === 4 && <div className="ab-sep" />}
                <div className={`ability${i >= 4 ? ' summoner' : ''}`} data-ability style={{ ['--cd' as string]: 0 }}>
                  <span className="ab-face">
                    <span className="ab-glyph">{SLOT_GLYPH[s]}</span>
                    <span className="ab-sweep" />
                    <span className="ab-shine" />
                  </span>
                  <span className="ab-key">{abilityKeyLabel(settings, s)}</span>
                  <span className="ab-name" data-ab-name />
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        {/* Controls, shown once and then gone. A cheat sheet that never
            leaves is a cheat sheet you stop reading and start seeing. */}
        <div className="hud-hints">
          {HINTS[schemeOf(settings)].map((h) => (
            <span key={h.key}>
              <b className="kbd">{h.key}</b> {h.label}
            </span>
          ))}
        </div>

        {/* Which camera mode you are in, sat above the minimap where League
            puts its own lock. A sibling rather than a child: the minimap is
            clipped to a cut corner, and a clip-path clips its children too. */}
        <div className="hud-cam" data-cam>
          <svg viewBox="0 0 16 16" aria-hidden>
            <rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path className="shackle" d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <span>CAM</span>
        </div>

        <div className="hud-minimap">
          <canvas ref={minimapRef} />
        </div>
      </div>

      {gpuLost && (
        <div className="pause-overlay fade-in">
          <div className="pause-card scale-in">
            <div className="eyebrow">GRAPHICS CONTEXT LOST</div>
            <h2>{meta.name}</h2>
            <p className="dim" style={{ maxWidth: 430, margin: '0 0 22px' }}>
              The browser reclaimed the GPU, so this run has been stopped rather than scored on a
              frozen arena. If it keeps happening, turn off your browser’s RAM and CPU limiters
              (Opera GX: <b>GX Control</b>) or switch on <b>Reduced effects</b> in settings.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={onRetry}>
                Restart drill
              </button>
              <button className="btn ghost" onClick={onExit}>
                Exit drill
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'paused' && !gpuLost && (
        <div className="pause-overlay fade-in">
          <div className="pause-card scale-in">
            <div className="eyebrow">PAUSED</div>
            <h2>{meta.name}</h2>
            <p className="dim" style={{ maxWidth: 400, margin: '0 0 22px' }}>
              {meta.brief}
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={resume}>
                Resume
              </button>
              <button className="btn" onClick={onRetry}>
                Restart
              </button>
              <button className="btn ghost" onClick={onExit}>
                Exit drill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
