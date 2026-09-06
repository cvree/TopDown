import { FOG_MINIMAP } from '../../gfx/fogofwar';
import type { MapBoard } from '../../engine/mapboard';
import type { World } from '../../engine/world';

/**
 * The minimap. Small, always-on, and the only place in the interface that
 * shows the whole arena at once — which matters now that the main camera is a
 * perspective view that can be zoomed in past the arena bounds.
 *
 * With fog of war on it stops being a convenience and becomes the instrument
 * the mode is about. It shows terrain always, because the shape of the map is
 * something you are supposed to know; it shows the fog exactly as the arena
 * does; and it shows bodies only where you have vision, so "where is the other
 * one" is a question you answer by moving the camera and looking rather than
 * by reading a dot that was never earned.
 *
 * The one thing it adds that League does not is the fading ring at a position
 * you have just lost: an enemy that walks into the dark could be anywhere
 * inside a circle that grows at its own move speed, and drawing that circle is
 * the fastest way to teach a player what losing vision actually costs.
 */

/** How long a lost enemy is remembered, in seconds. */
const MEMORY = 4;
/** How fast the uncertainty ring grows, in world units per second. */
const DRIFT = 340;

interface Ghost {
  x: number;
  y: number;
  /** World time the body was last visible. */
  t: number;
  minion: boolean;
}

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private size = 168;
  private ghosts = new Map<number, Ghost>();
  /** Offscreen buffer the fog grid is painted into, one pixel per cell. */
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogCtx: CanvasRenderingContext2D | null = null;
  private fogImage: ImageData | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap canvas unavailable');
    this.ctx = ctx;
  }

  resize(size: number): void {
    this.size = size;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(size * this.dpr);
    this.canvas.height = Math.round(size * this.dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
  }

  draw(
    world: World,
    coverage: { w: number; h: number },
    camera: { x: number; y: number },
    accent: string,
    board: MapBoard | null = null,
  ): void {
    const g = this.ctx;
    const S = this.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    if (board) {
      this.drawBoard(board, accent);
      return;
    }

    const { w, h } = world.bounds;
    // The arena is letterboxed inside the square so proportions stay honest.
    const scale = Math.min((S - 16) / w, (S - 16) / h);
    const ox = (S - w * scale) / 2;
    const oy = (S - h * scale) / 2;
    const px = (x: number) => ox + x * scale;
    const py = (y: number) => oy + y * scale;

    g.fillStyle = 'rgba(16,28,46,0.9)';
    g.fillRect(ox, oy, w * scale, h * scale);
    g.strokeStyle = 'rgba(200,170,110,0.75)';
    g.lineWidth = 1;
    g.strokeRect(ox + 0.5, oy + 0.5, w * scale - 1, h * scale - 1);

    g.strokeStyle = 'rgba(160,190,225,0.16)';
    for (let i = 1; i < 3; i++) {
      g.beginPath();
      g.moveTo(px((w / 3) * i), oy);
      g.lineTo(px((w / 3) * i), oy + h * scale);
      g.moveTo(ox, py((h / 3) * i));
      g.lineTo(ox + w * scale, py((h / 3) * i));
      g.stroke();
    }

    // Terrain, always. Which side of a wall you are on is the whole of a
    // condemn and half of an escape, and a map that hides its own geometry
    // teaches you to play by the arena you can see on screen.
    g.fillStyle = 'rgba(126,140,158,0.6)';
    for (const wall of world.walls) {
      g.fillRect(px(wall.x - wall.w / 2), py(wall.y - wall.h / 2), wall.w * scale, wall.h * scale);
    }
    for (const b of world.brush) {
      g.fillStyle = 'rgba(58,124,72,0.55)';
      g.fillRect(px(b.x - b.w / 2), py(b.y - b.h / 2), b.w * scale, b.h * scale);
    }

    // Hazards read as danger before units do — but only the ones you can see.
    for (const hz of world.hazards) {
      if (hz.team !== 'player' && !world.canSeePoint('player', hz.pos)) continue;
      g.fillStyle = hz.warn > 0 ? 'rgba(255,95,126,0.28)' : 'rgba(255,138,92,0.45)';
      g.beginPath();
      g.arc(px(hz.pos.x), py(hz.pos.y), Math.max(2, hz.radius * scale), 0, Math.PI * 2);
      g.fill();
    }

    this.drawFog(world, ox, oy, w * scale, h * scale);

    // Wards, over the fog rather than under it — the whole point of one is
    // that it is a piece of the map you own, and a pip the fog could dim would
    // be answering "is it still alight" with "look harder". The circle is what
    // it holds; the pip fades as it burns down, which is the only place on the
    // interface where "you are about to go blind there" is visible at a glance.
    for (const ward of world.wards) {
      if (ward.team !== 'player') continue;
      const left = Math.max(0, Math.min(1, ward.life / Math.max(0.001, ward.maxLife)));
      g.strokeStyle = `rgba(124,232,164,${0.1 + 0.18 * left})`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(px(ward.pos.x), py(ward.pos.y), ward.radius * scale, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = `rgba(124,232,164,${0.4 + 0.5 * left})`;
      g.beginPath();
      g.arc(px(ward.pos.x), py(ward.pos.y), 2.6, 0, Math.PI * 2);
      g.fill();
    }

    // Where the camera is pointing, drawn under the units: an enemy blip has
    // to win against the frame it sits in.
    const vw = coverage.w * scale;
    const vh = coverage.h * scale;
    g.strokeStyle = 'rgba(235,225,200,0.55)';
    g.lineWidth = 1;
    g.strokeRect(px(camera.x) - vw / 2, py(camera.y) - vh / 2, vw, vh);

    const now = world.time;
    for (const a of world.actors) {
      if (!a.alive || a.hidden) continue;
      const isPlayer = a.id === world.playerId;
      const visible = world.visible(a);
      if (!visible) continue;
      if (a.team === 'enemy') {
        this.ghosts.set(a.id, { x: a.pos.x, y: a.pos.y, t: now, minion: !!a.isMinion });
      }
      const ally = a.team === 'player';
      const turret = a.unitKind === 'turret';
      const r = isPlayer ? 4.2 : turret ? 4 : a.isMinion ? 2 : 3.4;
      g.beginPath();
      if (turret) {
        // Structures are squares. On a map this small, shape carries further
        // than colour, and a turret is not a unit you can chase or run from.
        const s = r * 1.6;
        g.rect(px(a.pos.x) - s / 2, py(a.pos.y) - s / 2, s, s);
      } else {
        g.arc(px(a.pos.x), py(a.pos.y), r, 0, Math.PI * 2);
      }
      g.fillStyle = isPlayer ? accent : ally ? (a.isMinion ? '#4d9a72' : '#5fe0ff') : a.isMinion ? '#b8664e' : '#ff5a52';
      g.fill();
      if (isPlayer) {
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 1.2;
        g.stroke();
      } else if (!a.isMinion && a.team === 'enemy') {
        // An enemy you can see but are not looking at. The ring is the nudge
        // to move the camera, and it is the only thing on this map that ever
        // asks for attention.
        const offScreen =
          Math.abs(a.pos.x - camera.x) > coverage.w / 2 || Math.abs(a.pos.y - camera.y) > coverage.h / 2;
        if (offScreen) {
          const pulse = 0.5 + 0.5 * Math.sin(now * 6);
          g.strokeStyle = `rgba(255,90,82,${0.35 + pulse * 0.5})`;
          g.lineWidth = 1.4;
          g.beginPath();
          g.arc(px(a.pos.x), py(a.pos.y), r + 2.5 + pulse * 2.5, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }

    this.drawGhosts(world, g, px, py, scale, now);
  }


  /**
   * The lab's board, drawn in the minimap's place.
   *
   * Two lanes, your blip in one of them, and a bad orb falling down one of
   * them. Everything about how it is drawn is in service of being readable
   * out of the corner of an eye that is busy elsewhere: the threatened lane is
   * washed in colour rather than outlined, the orb grows as it falls so the
   * urgency is a size and not a position you have to measure, the blip is the
   * brightest thing on the panel, and the lane keys are printed under it in
   * the player's own bindings so the answer never has to be remembered.
   */
  private drawBoard(board: MapBoard, accent: string): void {
    const g = this.ctx;
    const S = this.size;
    const pad = 7;
    const x0 = pad;
    const y0 = pad;
    const w = S - pad * 2;
    const h = S - pad * 2;
    const lanes = Math.max(1, board.lanes.length);
    const laneW = w / lanes;
    // The strip along the bottom that the blip stands on and the keys sit in.
    const floorH = 34;
    const fall = h - floorH;

    g.fillStyle = 'rgba(10,16,28,0.94)';
    g.fillRect(x0, y0, w, h);

    board.lanes.forEach((lane, i) => {
      const lx = x0 + i * laneW;
      if (lane.threatened) {
        const grad = g.createLinearGradient(0, y0, 0, y0 + fall);
        grad.addColorStop(0, 'rgba(255,90,82,0.03)');
        grad.addColorStop(1, 'rgba(255,90,82,0.22)');
        g.fillStyle = grad;
        g.fillRect(lx, y0, laneW, fall);
      }
      if (i > 0) {
        g.strokeStyle = 'rgba(160,190,225,0.18)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(lx + 0.5, y0);
        g.lineTo(lx + 0.5, y0 + h);
        g.stroke();
      }
    });

    // The floor: where the orb lands and where you are standing when it does.
    g.fillStyle = 'rgba(150,180,215,0.09)';
    g.fillRect(x0, y0 + fall, w, floorH);
    g.strokeStyle = 'rgba(200,170,110,0.5)';
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);

    for (const orb of board.orbs) {
      const ox = x0 + orb.x * w;
      const oy = y0 + orb.y * fall;
      const r = orb.r * laneW;
      const glow = g.createRadialGradient(ox, oy, 0, ox, oy, r * 2.1);
      glow.addColorStop(0, 'rgba(255,95,110,0.5)');
      glow.addColorStop(1, 'rgba(255,95,110,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(ox, oy, r * 2.1, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = orb.committed ? '#ff5f6e' : '#ff9f5c';
      g.beginPath();
      g.arc(ox, oy, r, 0, Math.PI * 2);
      g.fill();
      // Where it is going to land. A falling circle with no shadow under it is
      // a puzzle; with one it is a countdown you can read without arithmetic.
      const sx = x0 + (orb.lane + 0.5) * laneW;
      g.fillStyle = `rgba(255,95,110,${0.15 + orb.y * 0.45})`;
      g.beginPath();
      g.ellipse(sx, y0 + fall + 5, r * (0.7 + orb.y * 0.5), 3, 0, 0, Math.PI * 2);
      g.fill();
    }

    // The blip.
    const bx = x0 + (board.player + 0.5) * laneW;
    const by = y0 + fall + 15;
    g.fillStyle = board.hurt > 0.02 ? '#ff5f6e' : accent;
    g.beginPath();
    g.arc(bx, by, 5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(255,255,255,${0.6 + board.clean * 0.4})`;
    g.lineWidth = 1.3;
    g.stroke();
    if (board.clean > 0.02) {
      g.strokeStyle = `rgba(124,232,164,${board.clean * 0.8})`;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(bx, by, 5 + (1 - board.clean) * 9, 0, Math.PI * 2);
      g.stroke();
    }

    // The keys, one under each lane, in the player's own bindings.
    g.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    board.lanes.forEach((lane, i) => {
      const cx = x0 + (i + 0.5) * laneW;
      const here = Math.abs(board.player - i) < 0.5;
      g.fillStyle = here ? 'rgba(235,240,250,0.95)' : 'rgba(150,175,205,0.55)';
      g.fillText(lane.key, cx, y0 + h - 7);
    });

    // The caption, top-left, and the streak opposite it.
    g.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'left';
    g.fillStyle = board.note === 'MOVE' ? '#ff8a8a' : 'rgba(150,175,205,0.7)';
    g.fillText(board.note, x0 + 5, y0 + 8);
    if (board.streak > 1) {
      g.textAlign = 'right';
      g.fillStyle = board.color;
      g.fillText(`${board.streak}`, x0 + w - 5, y0 + 8);
    }
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';

    if (board.hurt > 0.02) {
      g.fillStyle = `rgba(255,80,90,${board.hurt * 0.34})`;
      g.fillRect(x0, y0, w, h);
    }
  }

  /**
   * The fog, at grid resolution and then scaled up.
   *
   * One pixel per vision cell painted into a tiny offscreen canvas and drawn
   * across the map with smoothing on: a thousand `fillRect`s per frame is the
   * obvious way to do this and it is also the one that shows up in a profile.
   */
  private drawFog(world: World, ox: number, oy: number, w: number, h: number): void {
    const field = world.vision;
    if (!field) return;
    if (!this.fogCanvas || this.fogCanvas.width !== field.cols || this.fogCanvas.height !== field.rows) {
      const c = document.createElement('canvas');
      c.width = field.cols;
      c.height = field.rows;
      this.fogCanvas = c;
      this.fogCtx = c.getContext('2d');
      this.fogImage = this.fogCtx?.createImageData(field.cols, field.rows) ?? null;
    }
    const ctx = this.fogCtx;
    const img = this.fogImage;
    if (!ctx || !img) return;
    const data = img.data;
    for (let i = 0; i < field.light.length; i++) {
      const dark = 1 - Math.min(1, field.light[i]);
      const j = i * 4;
      data[j] = FOG_MINIMAP.r;
      data[j + 1] = FOG_MINIMAP.g;
      data[j + 2] = FOG_MINIMAP.b;
      data[j + 3] = dark * 255 * FOG_MINIMAP.alpha;
    }
    ctx.putImageData(img, 0, 0);
    const g = this.ctx;
    g.save();
    // The grid's cells are centred on world multiples of the cell size, so the
    // texture overhangs the map by half a cell on every side.
    const half = 0.5 / field.cols;
    const halfY = 0.5 / field.rows;
    g.beginPath();
    g.rect(ox, oy, w, h);
    g.clip();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.fogCanvas as HTMLCanvasElement, ox - half * w, oy - halfY * h, w * (1 + half * 2), h * (1 + halfY * 2));
    g.restore();
  }

  /** The fading ring at every position you have lost since it went dark. */
  private drawGhosts(
    world: World,
    g: CanvasRenderingContext2D,
    px: (x: number) => number,
    py: (y: number) => number,
    scale: number,
    now: number,
  ): void {
    for (const [id, ghost] of this.ghosts) {
      const actor = world.byId(id);
      const age = now - ghost.t;
      if (!actor || !actor.alive || age > MEMORY || world.visible(actor)) {
        if (!actor || !actor.alive || age > MEMORY) this.ghosts.delete(id);
        continue;
      }
      if (ghost.minion) continue;
      const fade = 1 - age / MEMORY;
      // The circle it could be anywhere inside by now. Watching it swallow the
      // wall you are standing behind is the entire lesson.
      const radius = Math.max(3, (age * DRIFT + 40) * scale);
      g.strokeStyle = `rgba(255,120,110,${0.32 * fade})`;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.arc(px(ghost.x), py(ghost.y), radius, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = `rgba(255,120,110,${0.5 * fade})`;
      g.beginPath();
      g.arc(px(ghost.x), py(ghost.y), 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
}
