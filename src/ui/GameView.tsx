import { useCallback, useEffect, useRef, useState } from 'react';
import { audio } from '../engine/audio';
import { DEFAULT_BINDINGS, InputSystem, type AbilitySlot, type Bindings } from '../engine/input';
import { GameLoop } from '../engine/loop';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import { Renderer } from '../engine/renderer';
import { Session, type HudSnapshot } from '../engine/session';
import { arenaFor, createDrill } from '../drills';
import { DRILLS, type DrillId } from '../drills/catalog';
import type { RunResult } from '../progression/profile';
import type { AppSettings } from '../progression/profile';
import './gameview.css';

interface Props {
  drill: DrillId;
  difficulty: number;
  seed: number;
  settings: AppSettings;
  /** Label shown above the drill name, e.g. "CALIBRATION 2 / 5". */
  context?: string;
  onComplete: (result: RunResult, bounds: { w: number; h: number }) => void;
  onExit: () => void;
  onRetry: () => void;
}

const bindingsFrom = (settings: AppSettings): Bindings => {
  const out = { ...DEFAULT_BINDINGS };
  for (const [k, v] of Object.entries(settings.bindings ?? {})) {
    if (k in out) (out as Record<string, unknown>)[k] = v;
  }
  return out;
};

export function GameView({ drill, difficulty, seed, settings, context, onComplete, onExit, onRetry }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'countdown' | 'running' | 'paused' | 'ended'>('countdown');
  const doneRef = useRef(false);
  const meta = DRILLS[drill];

  // Everything below lives outside React on purpose: the simulation must not
  // be driven by, or wait on, a render pass.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    doneRef.current = false;

    const bounds = arenaFor(drill);
    const renderer = new Renderer(canvas);
    const input = new InputSystem({
      bindings: bindingsFrom(settings),
      quickCast: settings.quickCast,
      activeSlots: new Set<AbilitySlot>(meta.abilities),
    });
    const session = new Session(
      { duration: meta.duration, arena: bounds, seed, difficulty, abilities: meta.abilities },
      input,
      renderer,
    );
    const drillInstance = createDrill(drill, session);
    session.attachDrill(drillInstance);
    session.onResetRequest = () => {
      if (session.phase === 'ended') return;
      session.abort();
    };

    // An opt-in handle for automated testing and for players who want to
    // inspect a run. Off unless ?debug is present, so it never ships as a
    // stray global.
    const debug = typeof location !== 'undefined' && location.search.includes('debug');
    if (debug) {
      (window as unknown as { __apex?: unknown }).__apex = { session, drill: drillInstance, renderer, input, bounds };
    }

    input.attach(canvas);
    renderer.resize(bounds.w, bounds.h);
    audio.unlock();
    audio.stopAmbience();

    const ro = new ResizeObserver(() => renderer.resize(bounds.w, bounds.h));
    ro.observe(host);

    // --- HUD elements, written to directly each frame -------------------
    const hud = hudRef.current!;
    const q = <T extends Element>(sel: string) => hud.querySelector(sel) as T;
    const elTime = q<HTMLDivElement>('[data-time]');
    const elScore = q<HTMLDivElement>('[data-score]');
    const elChain = q<HTMLDivElement>('[data-chain]');
    const elChainN = q<HTMLDivElement>('[data-chain-n]');
    const elHp = q<HTMLDivElement>('[data-hp]');
    const elHpWrap = q<HTMLDivElement>('[data-hp-wrap]');
    const elFps = q<HTMLDivElement>('[data-fps]');
    const elBanner = q<HTMLDivElement>('[data-banner]');
    const elCount = q<HTMLDivElement>('[data-count]');
    const fieldEls = Array.from(hud.querySelectorAll('[data-field]')) as HTMLDivElement[];

    let lastHudWrite = 0;
    let lastPhase: string = session.phase;

    const writeHud = (snap: HudSnapshot, now: number) => {
      if (now - lastHudWrite < 45) return;
      lastHudWrite = now;
      const t = snap.timeLeft;
      elTime.textContent =
        meta.duration > 0
          ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
          : `${t.toFixed(1)}`;
      if (meta.duration > 0 && t < 5.5) elTime.classList.add('urgent');
      else elTime.classList.remove('urgent');

      elScore.textContent = snap.score.toLocaleString();
      const hpPct = Math.max(0, (snap.hp / Math.max(1, snap.maxHp)) * 100);
      elHp.style.width = `${hpPct}%`;
      elHp.style.background = hpPct < 30 ? PALETTE.danger : hpPct < 60 ? PALETTE.warn : PALETTE.good;
      elHpWrap.style.opacity = snap.maxHp > 1 ? '1' : '0';

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

      elFps.textContent = `${Math.round(snap.fps)}`;
      elBanner.textContent = snap.banner ?? '';
      elBanner.style.opacity = snap.banner ? '1' : '0';
      elCount.textContent = snap.phase === 'countdown' ? (snap.countdown > 0 ? `${snap.countdown}` : 'GO') : '';
      elCount.style.opacity = snap.phase === 'countdown' ? '1' : '0';
    };

    const loop = new GameLoop(
      (dt) => {
        session.cursorWorld = renderer.screenToWorld(input.cursor.x, input.cursor.y);
        session.step(dt);
      },
      (alpha, dtWall) => {
        renderer.render(session.world, session.fx, alpha, dtWall, {
          cursor: input.cursor,
          showRange: settings.showRange,
          hoverTargetId: session.hoverTargetId,
          pathTrail: session.pathTrail,
          chain: session.chain,
          dimmed: session.phase === 'paused' ? 0.55 : session.dimmed,
          hitFeedback: session.hitFeedback,
          lowFx: settings.lowFx,
          overlay: (ctx, scale, t) => drillInstance.drawOverlay(ctx, scale, t),
        });

        const now = performance.now();
        writeHud(session.hud(loop.stats.fps), now);

        if (session.phase !== lastPhase) {
          lastPhase = session.phase;
          setPhase(session.phase);
        }

        if (session.phase === 'ended' && !doneRef.current) {
          doneRef.current = true;
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
          window.setTimeout(() => onComplete(result, bounds), session.endReason === 'abort' ? 0 : 620);
        }
      },
    );
    loop.start();

    return () => {
      loop.stop();
      ro.disconnect();
      input.detach();
      session.fx.clear();
      if (debug) delete (window as unknown as { __apex?: unknown }).__apex;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, difficulty, seed]);

  const resume = useCallback(() => {
    // The session owns pause state; a synthetic Escape is the cleanest bridge.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  }, []);

  return (
    <div className="game-host" ref={hostRef}>
      <canvas ref={canvasRef} className="game-canvas" tabIndex={0} />

      <div className="hud" ref={hudRef}>
        <div className="hud-top">
          <div className="hud-drill">
            {context && <div className="hud-context">{context}</div>}
            <div className="hud-name display">{meta.name}</div>
            <div className="hud-tag">{meta.tagline}</div>
          </div>

          <div className="hud-center">
            <div className="hud-time num" data-time>
              0:00
            </div>
            <div className="hud-score-wrap">
              <span className="eyebrow">SCORE</span>
              <span className="hud-score num" data-score>
                0
              </span>
            </div>
          </div>

          <div className="hud-right">
            <div className="hud-diff">
              <span className="eyebrow">DIFFICULTY</span>
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
        </div>

        <div className="hud-banner" data-banner />
        <div className="hud-count display" data-count />

        <div className="hud-bottom">
          <div className="hud-fields">
            {[0, 1, 2].map((i) => (
              <div className="hud-field" data-field key={i}>
                <div className="hud-field-label" data-fl />
                <div className="hud-field-value tone-neutral" data-fv />
                <div className="hud-field-bar" data-fb>
                  <span />
                </div>
              </div>
            ))}
          </div>

          <div className="hud-center-bottom">
            <div className="hud-chain" data-chain>
              <span className="hud-chain-x">×</span>
              <span className="hud-chain-n num" data-chain-n>
                2
              </span>
              <span className="hud-chain-label">CLEAN CHAIN</span>
            </div>
            <div className="hud-hp" data-hp-wrap>
              <span data-hp />
            </div>
          </div>

          <div className="hud-keys">
            <div>
              <span className="kbd">RMB</span> move / attack
            </div>
            <div>
              <span className="kbd">A</span>
              <span className="kbd">LMB</span> attack-move
            </div>
            {meta.abilities.length > 0 && (
              <div>
                {meta.abilities.map((a) => (
                  <span className="kbd" key={a}>
                    {a.toUpperCase()}
                  </span>
                ))}{' '}
                abilities
              </div>
            )}
            <div>
              <span className="kbd">ESC</span> pause · <span className="kbd">`</span> reset
            </div>
          </div>
        </div>
      </div>

      {phase === 'paused' && (
        <div className="pause-overlay fade-in">
          <div className="pause-card scale-in">
            <div className="eyebrow">PAUSED</div>
            <h2 className="display">{meta.name}</h2>
            <p className="dim" style={{ maxWidth: 380, margin: '0 0 22px' }}>
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
