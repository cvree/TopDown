import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ChampionRig } from '../../gfx/champions';
import { heroFor, type HeroId } from '../../engine/heroes';

/**
 * One champion, turning on a plinth.
 *
 * Picking a body out of a list of names is a form; watching it stand there and
 * swing is a choice. So the roster gets the real rig — the same class that
 * draws the champion you are about to play, running the same windup and
 * backswing poses — rather than an illustration of it.
 *
 * It is deliberately not a `RiftScene`: the arena builds terrain, a sky and a
 * post chain, and none of that belongs behind a portrait. This is one light
 * rig, one figure, a soft floor and nothing else, which is cheap enough to
 * mount and dispose every time the selection changes.
 */

const HEIGHT = 170;

export function HeroPortrait({
  hero,
  /** Falls back to the flat sigil when the player has asked for fewer effects. */
  enabled = true,
  className,
}: {
  hero: HeroId;
  enabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !enabled) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      // No WebGL. The static mark underneath is already doing this job.
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Lower than the arena's: a portrait is lit from close in, and the rig's
    // emissive accent plate blows out to white at gameplay exposure.
    renderer.toneMappingExposure = 1.02;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();

    // The same two-lights-and-a-hemisphere the arena uses, so the champion is
    // lit here the way it will be lit in a drill.
    const key = new THREE.DirectionalLight(0xffd6a0, 3.2);
    key.position.set(-140, 240, 180);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 20;
    key.shadow.camera.far = 700;
    key.shadow.camera.left = -160;
    key.shadow.camera.right = 160;
    key.shadow.camera.top = 220;
    key.shadow.camera.bottom = -40;
    key.shadow.bias = -0.0016;
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x7fb4ff, 1.5);
    fill.position.set(220, 120, -200);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight(0x8fb6e8, 0x2a2418, 1.05));

    const def = heroFor(hero);
    // A rim light in the champion's own colour. It is what makes seven bodies
    // in the same armour read as seven different champions in a grid.
    const rim = new THREE.PointLight(new THREE.Color(def.accent), 60000, 1100, 2);
    rim.position.set(150, 190, -260);
    scene.add(rim);

    const rig = new ChampionRig({
      height: HEIGHT,
      radius: HEIGHT / 5.4,
      ...def.look,
      ringColor: '#5fe0ff',
    });
    rig.setPosition(0, 0);
    scene.add(rig.group);

    const camera = new THREE.PerspectiveCamera(30, 1, 10, 1400);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let acc = 0;
    // 30fps is plenty for a figure turning slowly, and leaves the machine to
    // the arena rendering behind the menu.
    const FRAME = 1 / 30;

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

      // A slow quarter-turn back and forth rather than a full spin: a
      // turntable shows you a model, an arc shows you a silhouette.
      const yaw = Math.sin(t * 0.42) * 0.62;
      camera.position.set(Math.sin(yaw) * 360, HEIGHT * 0.72, Math.cos(yaw) * 360);
      camera.lookAt(0, HEIGHT * 0.5, 0);

      // Idle, wind up, release, idle — the loop the whole trainer is about,
      // played at half speed so the two phases are separable by eye.
      const cyc = t % 5;
      rig.update(step, {
        speed: 0,
        // The rig faces +z at `facing = π/2` (see the note in units.ts), and
        // the camera is orbiting by `yaw` — so this keeps the champion turned
        // to whoever is looking at it, all the way through the arc.
        facing: Math.PI / 2 - yaw,
        phase: cyc < 0.7 ? 'windup' : cyc < 1.5 ? 'backswing' : 'idle',
        phaseT: cyc < 0.7 ? cyc / 0.7 : cyc < 1.5 ? (cyc - 0.7) / 0.8 : 0,
        time: t,
        hitFlash: 0,
        death: 0,
        cast: 0,
        hp01: 1,
        hovered: false,
        rooted: false,
      });

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      rig.dispose();
      scene.clear();
      renderer.dispose();
    };
  }, [hero, enabled]);

  if (!enabled) return null;
  return <canvas ref={ref} className={className} aria-hidden />;
}
