import type { FxSystem } from '../engine/fx';
import type { Billboard, DrillPaint, PlateMark } from '../engine/paint';
import type { Actor } from '../engine/types';
import type { World } from '../engine/world';
import type { RiftCamera } from './camera';

/**
 * The world-anchored 2D layer: health bars, nameplates, combat text and the
 * drills' own prompts, drawn on a canvas over the 3D view.
 *
 * These are deliberately *not* 3D. A health bar has to be pixel-crisp and the
 * same size whether the unit is near or far — that is what makes it scannable
 * — and a bar that foreshortens with the ground plane is unreadable. So the
 * scene projects, and this draws.
 */

export interface OverlayOpts {
  /** Actor id under the cursor. */
  hoverId: number | null;
  playerId: number;
  /** Height of a champion in world units, so bars sit above the head. */
  headHeight: (a: Actor) => number;
  paint: DrillPaint;
  showNames: boolean;
}

const ALLY = '#3ddc84';
const ENEMY = '#e8483c';
const ALLY_MINION = '#2fbf78';
const ENEMY_MINION = '#c9463c';

/** Tone colours for a health bar the drill has marked up. */
const PLATE_TONE: Record<NonNullable<PlateMark['tone']>, string> = {
  ready: '#7dffb0',
  soon: '#ffd166',
  losing: '#ff6a5c',
};

export class OverlayHud {
  private ctx: CanvasRenderingContext2D;
  private plates = new Map<number, PlateMark>();
  private dpr = 1;
  private w = 0;
  private h = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D overlay unavailable');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = cssW;
    this.h = cssH;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(world: World, fx: FxSystem, cam: RiftCamera, opts: OverlayOpts): void {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    // Health-bar annotations are keyed by actor, so resolve them once rather
    // than scanning the list per unit.
    this.plates.clear();
    for (const pl of opts.paint.plates) this.plates.set(pl.actorId, pl);

    for (const a of world.actors) {
      if (!a.alive) continue;
      this.drawNameplate(g, a, cam, opts);
    }

    for (const b of opts.paint.billboards) this.drawBillboard(g, b, cam);

    // Combat text last: it is punctuation and must never be occluded.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of fx.texts) {
      const p = cam.worldToScreen(t.x, t.y, 72);
      if (!p.visible) continue;
      const life = Math.max(0, t.life / t.max);
      const pop = life > 0.82 ? 1 + (life - 0.82) * 2.6 : 1;
      const alpha = life > 0.6 ? 1 : life / 0.6;
      const y = p.y - t.rise * 1.5;
      g.globalAlpha = alpha;
      g.font = `${t.weight} ${Math.round(t.size * pop)}px "Chakra Petch", "Inter", system-ui, sans-serif`;
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(3,6,12,0.8)';
      g.strokeText(t.text, p.x, y);
      g.fillStyle = t.color;
      g.fillText(t.text, p.x, y);
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------- nameplates

  private drawNameplate(g: CanvasRenderingContext2D, a: Actor, cam: RiftCamera, opts: OverlayOpts): void {
    // A turret is scenery you cannot kill in this trainer, so it carries no
    // bar: a permanently full one would only compete for the eye with the
    // bars that actually matter.
    if (a.unitKind === 'turret') return;
    const isPlayer = a.id === opts.playerId;
    const minion = !!a.isMinion;
    const ally = a.team === 'player';
    const plate = this.plates.get(a.id);
    const p = cam.worldToScreen(a.pos.x, a.pos.y, opts.headHeight(a));
    if (!p.visible) return;

    // Only a bar the drill has something to say about grows. Twelve minions
    // in a clump is already a wall of bars, and widening all of them buys
    // clutter; widening the two that matter buys attention.
    const marked = !!plate?.tone;
    const w = minion ? (marked ? 58 : 46) : isPlayer ? 128 : 108;
    const h = minion ? (marked ? 8 : 6) : 9;
    const x = Math.round(p.x - w / 2);
    const y = Math.round(p.y - (minion ? 12 : 20));
    const pct = Math.max(0, Math.min(1, a.hp / Math.max(1, a.maxHp)));

    // Frame.
    g.fillStyle = 'rgba(4,7,13,0.82)';
    g.strokeStyle = 'rgba(0,0,0,0.9)';
    g.lineWidth = 1;
    g.beginPath();
    g.rect(x - 1.5, y - 1.5, w + 3, h + 3);
    g.fill();
    g.stroke();

    // Fill. Team decides the colour, exactly as it does in League: anything
    // green is on your side and anything red is not, minion or champion.
    const col = minion ? (ally ? ALLY_MINION : ENEMY_MINION) : ally ? ALLY : ENEMY;
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, lighten(col, 0.32));
    grad.addColorStop(0.55, col);
    grad.addColorStop(1, darken(col, 0.3));
    g.fillStyle = grad;
    g.fillRect(x, y, Math.max(0, w * pct), h);

    // Damage-taken ghost: the slice you just lost, lit for a moment.
    if (a.hitFlash > 0.02) {
      g.fillStyle = `rgba(255,255,255,${Math.min(0.55, a.hitFlash * 0.55)})`;
      g.fillRect(x, y, Math.max(0, w * pct), h);
    }

    if (plate) this.drawPlateMark(g, plate, x, y, w, h, pct);

    // Tick marks, one per 200 max HP, exactly the read League gives you.
    const per = minion ? 0 : 200;
    if (per > 0 && a.maxHp > per) {
      g.strokeStyle = 'rgba(6,10,16,0.75)';
      g.lineWidth = 1;
      g.beginPath();
      for (let v = per; v < a.maxHp; v += per) {
        const tx = Math.round(x + (v / a.maxHp) * w) + 0.5;
        g.moveTo(tx, y);
        g.lineTo(tx, y + h);
      }
      g.stroke();
    }

    // Highlight under the cursor.
    if (opts.hoverId === a.id) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.5;
      g.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    }

    if (!minion && opts.showNames && a.label) {
      g.font = '600 10px "Inter", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(3,6,12,0.85)';
      g.strokeText(a.label, p.x, y - 5);
      g.fillStyle = ally ? '#cfe9ff' : '#ffb8b0';
      g.fillText(a.label, p.x, y - 5);
    }

    // Crowd control reads on the plate, because that is where your eye is.
    if (a.rootedFor > 0 || a.slowFor > 0) {
      const label = a.rootedFor > 0 ? 'ROOTED' : 'SLOWED';
      g.font = '700 9px "Inter", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillStyle = a.rootedFor > 0 ? '#ffd166' : '#8fc7ff';
      g.fillText(label, p.x, y + h + 3);
    }
  }

  /**
   * The last-hitter's read, drawn onto the bar itself.
   *
   * Two things are painted. The hatched slice at the leading edge is damage
   * that has already left somebody's hands — missiles in the air and windups
   * past the point of recall — so the health you are looking at is visibly not
   * the health that will be there in half a second. The bright tick is where
   * your own attack would leave the bar: once the fill crosses it, the minion
   * is yours. Nothing here tells you when to click; it tells you what you are
   * looking at, which is the part that transfers.
   */
  private drawPlateMark(
    g: CanvasRenderingContext2D,
    plate: PlateMark,
    x: number,
    y: number,
    w: number,
    h: number,
    pct: number,
  ): void {
    // Damage in flight is drawn as a pale wash over the end of the bar with a
    // hard bright edge where the health will stop. A darker or hatched slice
    // was the first thing tried and it is unreadable at six pixels high: the
    // texture never resolves and the whole thing just looks like a bar with a
    // black end. A wash plus one crisp line survives being glanced at.
    const incoming = Math.max(0, Math.min(pct, plate.incoming ?? 0));
    if (incoming > 0.004) {
      const from = Math.round(x + (pct - incoming) * w);
      const to = Math.round(x + pct * w);
      g.fillStyle = 'rgba(255,255,255,0.42)';
      g.fillRect(from, y, to - from, h);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.fillRect(from, y, 1.5, h);
    }

    const th = plate.threshold ?? 0;
    if (th > 0.001 && th < 1) {
      const tx = Math.round(x + th * w) + 0.5;
      g.strokeStyle = 'rgba(6,10,16,0.9)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(tx, y - 2);
      g.lineTo(tx, y + h + 2);
      g.stroke();
      g.strokeStyle = plate.tone ? PLATE_TONE[plate.tone] : 'rgba(255,255,255,0.9)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(tx, y - 2);
      g.lineTo(tx, y + h + 2);
      g.stroke();
    }

    if (plate.tone) {
      g.strokeStyle = PLATE_TONE[plate.tone];
      g.lineWidth = 1.5;
      g.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    }

    if (plate.note) {
      g.font = '700 9px "Chakra Petch", "Inter", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(3,6,12,0.85)';
      g.strokeText(plate.note, x + w / 2, y + h + 4);
      g.fillStyle = plate.tone ? PLATE_TONE[plate.tone] : '#dff6ff';
      g.fillText(plate.note, x + w / 2, y + h + 4);
    }
  }

  // -------------------------------------------------------------- billboards

  private drawBillboard(g: CanvasRenderingContext2D, b: Billboard, cam: RiftCamera): void {
    switch (b.kind) {
      case 'keys': {
        const p = cam.worldToScreen(b.x, b.y, 150);
        if (!p.visible) return;
        const boxW = 46;
        const gap = 9;
        const total = b.seq.length * boxW + (b.seq.length - 1) * gap;
        const x0 = p.x - total / 2;
        const y = p.y - 62;

        for (let i = 0; i < b.seq.length; i++) {
          const bx = x0 + i * (boxW + gap);
          const done = i < b.index;
          const active = i === b.index;
          roundRect(g, bx, y, boxW, 44, 7);
          g.fillStyle = done ? 'rgba(61,220,132,0.22)' : active ? 'rgba(88,224,255,0.2)' : 'rgba(8,12,20,0.78)';
          g.fill();
          g.lineWidth = active ? 2.5 : 1.4;
          g.strokeStyle = done ? 'rgba(61,220,132,0.9)' : active ? '#58e0ff' : 'rgba(140,160,185,0.55)';
          g.stroke();

          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.font = '700 20px "Chakra Petch", "Inter", sans-serif';
          g.fillStyle = done ? '#8ff0bb' : active ? '#eafcff' : '#93a6bd';
          g.fillText(b.seq[i].toUpperCase(), bx + boxW / 2, y + 17);
          g.font = '600 9px "Inter", sans-serif';
          g.fillStyle = 'rgba(190,208,228,0.75)';
          g.fillText(b.labels[i] ?? '', bx + boxW / 2, y + 34);
        }

        g.fillStyle = 'rgba(120,140,165,0.35)';
        g.fillRect(x0, y - 9, total, 4);
        g.fillStyle = b.progress < 0.3 ? '#ff5f7e' : '#58e0ff';
        g.fillRect(x0, y - 9, total * Math.max(0, b.progress), 4);
        return;
      }
      case 'label': {
        const p = cam.worldToScreen(b.x, b.y, 90);
        if (!p.visible) return;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `700 ${b.size ?? 14}px "JetBrains Mono", ui-monospace, monospace`;
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(3,6,12,0.8)';
        g.strokeText(b.text, p.x, p.y);
        g.fillStyle = b.color;
        g.fillText(b.text, p.x, p.y);
        if (b.sub) {
          g.font = '600 10px "Inter", sans-serif';
          g.strokeText(b.sub, p.x, p.y + 15);
          g.fillStyle = 'rgba(200,215,235,0.8)';
          g.fillText(b.sub, p.x, p.y + 15);
        }
        return;
      }
      case 'timerBar': {
        const p = cam.worldToScreen(b.x, b.y, b.lift ?? 130);
        if (!p.visible) return;
        const w = b.width ?? 64;
        const x = p.x - w / 2;
        const y = p.y - 34;
        g.fillStyle = 'rgba(6,10,16,0.7)';
        g.fillRect(x - 1, y - 1, w + 2, 7);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x, y, w, 5);
        g.fillStyle = b.color;
        g.fillRect(x, y, w * Math.max(0, Math.min(1, b.progress)), 5);
        return;
      }
      case 'caret': {
        const p = cam.worldToScreen(b.x, b.y, b.lift ?? 150);
        if (!p.visible) return;
        const bob = Math.sin(performance.now() / 180) * 3;
        g.beginPath();
        g.moveTo(p.x, p.y - 8 + bob);
        g.lineTo(p.x - 9, p.y - 22 + bob);
        g.lineTo(p.x + 9, p.y - 22 + bob);
        g.closePath();
        g.fillStyle = b.color;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = 'rgba(4,8,14,0.75)';
        g.stroke();
        return;
      }
    }
  }
}

const roundRect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
};

const channel = (hex: string, i: number): number => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return parseInt(full.slice(i * 2, i * 2 + 2), 16);
};

const lighten = (hex: string, k: number): string =>
  `rgb(${Math.round(channel(hex, 0) + (255 - channel(hex, 0)) * k)},${Math.round(
    channel(hex, 1) + (255 - channel(hex, 1)) * k,
  )},${Math.round(channel(hex, 2) + (255 - channel(hex, 2)) * k)})`;

const darken = (hex: string, k: number): string =>
  `rgb(${Math.round(channel(hex, 0) * (1 - k))},${Math.round(channel(hex, 1) * (1 - k))},${Math.round(channel(hex, 2) * (1 - k))})`;
