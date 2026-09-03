import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { DEFAULT_HERO, heroFor, type HeroId } from '../../engine/heroes';
import { ChampionRig, type RigSpec } from '../../gfx/champions';
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

/* Three champions, staged like a splash: the hero forward and centre, two
   more behind and apart so the group has depth rather than a line.

   The one in front is *your* champion, taken straight off the roster and
   swapped the moment you change it. A menu that shows a stock knight while you
   have been playing a hooded archer for a month is a menu about somebody
   else's game. The two behind are enemy archetypes, in enemy red. */
const FIGURES = [
  // `look: null` means "whoever the player is", filled in from the roster.
  { x: 760, y: 470, radius: 34, ring: '#5fe0ff', look: null },
  {
    x: 930,
    y: 340,
    radius: 36,
    ring: '#ff4d42',
    look: { build: 'heavy', primary: '#c25a34', secondary: '#43201a', accent: '#ff9257', skin: '#b98763', weapon: 'greatsword', headgear: 'horns', cape: false },
  },
  {
    x: 600,
    y: 330,
    radius: 32,
    ring: '#ff4d42',
    look: { build: 'lean', primary: '#46a37e', secondary: '#1d4436', accent: '#6dffb4', skin: '#c9a583', weapon: 'bow', headgear: 'hood', cape: true },
  },
] as const;

/** The rig spec for one staged figure; index 0 is whoever the player picked. */
const figureSpec = (i: number, hero: HeroId): RigSpec => {
  const f = FIGURES[i];
  const look = f.look ?? heroFor(hero).look;
  return { ...look, height: f.radius * 5.4, radius: f.radius, ringColor: f.ring };
};

export function ArenaBackdrop({
  enabled = true,
  hero = DEFAULT_HERO,
  onReady,
}: {
  enabled?: boolean;
  /** The champion standing front and centre. */
  hero?: HeroId;
  /** Fires once the arena has actually put a frame on screen. */
  onReady?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  // The live scene, so changing champion can swap one body rather than tear
  // down and regenerate the terrain, the shaders and the sky behind the menus.
  const liveRef = useRef<{ scene: RiftScene; rigs: ChampionRig[] } | null>(null);
  const heroRef = useRef(hero);
  heroRef.current = hero;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !enabled) {
      // No arena to wait for; whoever is gating on us should not hang.
      readyRef.current?.();
      return;
    }

    let scene: RiftScene;
    try {
      scene = new RiftScene(canvas, BOUNDS, '#c8aa6e', 3);
    } catch {
      // No WebGL: the menus still work, they just get a flat background.
      readyRef.current?.();
      return;
    }
    // A backdrop must never cost the front end its responsiveness — but it is
    // also the first thing anyone sees, so it keeps the post chain. Medium
    // quality buys bloom on the braziers and the grade pass's vignette and
    // grain, which is most of what separates "a render" from "a shot"; the
    // frame cap and the render scale pay for them.
    scene.renderScale = 0.8;
    scene.setQuality('medium');

    const rigs = FIGURES.map((f, i) => {
      const rig = new ChampionRig(figureSpec(i, heroRef.current));
      rig.setPosition(f.x, f.y);
      scene.world.add(rig.group);
      return rig;
    });
    liveRef.current = { scene, rigs };

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
    // A long lens from close in. A wide lens at distance is a map view; a
    // narrow one at eye level is a portrait, and the menu wants a portrait.
    cam.fov = 34;
    cam.updateProjectionMatrix();
    // Menus get a warmer, brighter print than gameplay — nothing here has to
    // stay legible under a health bar, so it can be lit for the look.
    scene.renderer.toneMappingExposure = 1.34;

    // The client's own parallax. The camera leans a few dozen units toward
    // the pointer, which is the cheapest way to make a still menu feel like
    // it is standing in a place rather than printed on one.
    const lean = { x: 0, y: 0, tx: 0, ty: 0 };
    const aim = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const onPointer = (e: PointerEvent) => {
      lean.tx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      lean.ty = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer);

    let raf = 0;
    let announced = false;
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
      const a = -0.5 + Math.sin(t * 0.021) * 0.42;
      // A slow dolly in and out under a shallow arc. A full orbit reads as a
      // turntable; an arc that never completes reads as a camera operator.
      const radius = 900 + Math.sin(t * 0.061) * 130;
      lean.x += (lean.tx - lean.x) * Math.min(1, step * 1.6);
      lean.y += (lean.ty - lean.y) * Math.min(1, step * 1.6);
      // High enough to see the terraces and the horizon, low enough that the
      // champions still have a silhouette against the sky.
      cam.position.set(
        cx + Math.sin(a) * radius + lean.x * 90,
        455 + Math.sin(t * 0.047) * 60 - lean.y * 50,
        cz + Math.cos(a) * radius,
      );
      // Aimed at chest height on the front champion rather than at the floor,
      // so the horizon sits high and the figures stand against the terraces.
      aim.set(cx + lean.x * 30, 165, cz - 90);
      // Then slid along the camera's own right vector, which parks the group
      // in the right third of the frame — the third the client leaves empty.
      // Doing it in camera space rather than world space keeps the framing
      // identical all the way through the arc.
      fwd.copy(aim).sub(cam.position).normalize();
      right.crossVectors(fwd, UP).normalize();
      aim.addScaledVector(right, -215);
      cam.lookAt(aim);
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

      if (!announced) {
        announced = true;
        readyRef.current?.();
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      ro.disconnect();
      liveRef.current = null;
      for (const rig of rigs) rig.dispose();
      scene.dispose();
    };
  }, [enabled]);

  // Champion changed: rebuild the one body it belongs to, in place.
  useEffect(() => {
    const live = liveRef.current;
    if (!live) return;
    const old = live.rigs[0];
    const rig = new ChampionRig(figureSpec(0, hero));
    rig.setPosition(FIGURES[0].x, FIGURES[0].y);
    live.scene.world.add(rig.group);
    live.rigs[0] = rig;
    old.dispose();
  }, [hero]);

  if (!enabled) return <div className="atmos atmos-static" aria-hidden />;
  return (
    <div className="atmos" aria-hidden>
      <canvas ref={ref} />
    </div>
  );
}
