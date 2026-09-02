import { useEffect, useRef } from 'react';
import { ChampionRig } from '../../gfx/champions';
import { RiftScene } from '../../gfx/scene';

/**
 * The menus sit in front of the arena itself, rendered live.
 *
 * A still image or a particle field behind a menu is the tell of a product
 * that has a game bolted to it. Showing the real arena — the same terrain,
 * lighting and champions you are about to play in, on a slow cinematic
 * orbit — is what makes the front end and the game feel like one thing.
 *
 * It runs at a capped frame rate on medium quality, pauses when the tab is
 * hidden, and is skipped entirely when the player has asked for low effects.
 */

const BOUNDS = { w: 1500, h: 900 };

const FIGURES = [
  { x: 620, y: 500, primary: '#4e9ee0', secondary: '#e2c77a', accent: '#9ff2ff', skin: '#e6c2a0', weapon: 'sword', headgear: 'helm', cape: true, build: 'medium', radius: 30, ring: '#5fe0ff' },
  { x: 940, y: 430, primary: '#c25a34', secondary: '#43201a', accent: '#ff9257', skin: '#b98763', weapon: 'greatsword', headgear: 'horns', cape: false, build: 'heavy', radius: 34, ring: '#ff4d42' },
  { x: 830, y: 660, primary: '#46a37e', secondary: '#1d4436', accent: '#6dffb4', skin: '#c9a583', weapon: 'bow', headgear: 'hood', cape: true, build: 'lean', radius: 30, ring: '#ff4d42' },
] as const;

export function ArenaBackdrop({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !enabled) return;

    let scene: RiftScene;
    try {
      scene = new RiftScene(canvas, BOUNDS, '#c8aa6e', 3);
    } catch {
      // No WebGL: the menus still work, they just get a flat background.
      return;
    }
    // A backdrop must never cost the front end its responsiveness: no shadow
    // map, no post chain, three-quarter resolution, and a hard frame cap.
    scene.renderScale = 0.72;
    scene.setQuality('low');

    const rigs = FIGURES.map((f) => {
      const rig = new ChampionRig({
        height: f.radius * 5.4,
        radius: f.radius,
        build: f.build,
        primary: f.primary,
        secondary: f.secondary,
        accent: f.accent,
        skin: f.skin,
        weapon: f.weapon,
        headgear: f.headgear,
        cape: f.cape,
        ringColor: f.ring,
      });
      rig.setPosition(f.x, f.y);
      scene.world.add(rig.group);
      return rig;
    });

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      scene.resize(Math.max(1, r.width), Math.max(1, r.height));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const cam = scene.rig.camera;
    // A lower, slower camera than gameplay: from here you can see the terraces,
    // the braziers and the sky, which is the whole point of a hero shot.
    cam.fov = 40;
    cam.updateProjectionMatrix();

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let acc = 0;
    const FRAME = 1 / 24;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      acc += dt;
      if (acc < FRAME) return;
      const step = acc;
      acc = 0;
      t += step;

      const cx = BOUNDS.w / 2;
      const cz = BOUNDS.h / 2;
      const a = t * 0.038;
      const radius = 1480 + Math.sin(t * 0.11) * 120;
      // High enough to see the terraces and the horizon, low enough that the
      // champions still have a silhouette against the sky.
      cam.position.set(cx + Math.sin(a) * radius, 940 + Math.sin(t * 0.07) * 70, cz + Math.cos(a) * radius);
      cam.lookAt(cx, 90, cz);
      cam.updateMatrixWorld();

      rigs.forEach((rig, i) => {
        const cyc = (t * 0.55 + i * 1.9) % 6;
        rig.update(step, {
          speed: 0,
          facing: Math.atan2(cz - FIGURES[i].y, cx - FIGURES[i].x) + Math.sin(t * 0.3 + i) * 0.35,
          phase: cyc < 0.5 ? 'windup' : cyc < 1.0 ? 'backswing' : 'idle',
          phaseT: cyc < 0.5 ? cyc / 0.5 : cyc < 1.0 ? (cyc - 0.5) / 0.5 : 0,
          time: t + i * 3,
          hitFlash: 0,
          death: 0,
          cast: 0,
          hp01: 1,
          hovered: false,
          rooted: false,
        });
      });

      scene.render(step, { hurt: 0, flash: 0, flashColor: '#ffffff', energy: 0, dim: 0 });
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const rig of rigs) rig.dispose();
      scene.dispose();
    };
  }, [enabled]);

  if (!enabled) return <div className="atmos atmos-static" aria-hidden />;
  return (
    <div className="atmos" aria-hidden>
      <canvas ref={ref} />
    </div>
  );
}
