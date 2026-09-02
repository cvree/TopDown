import type { World } from '../../engine/world';

/**
 * The minimap. Small, always-on, and the only place in the interface that
 * shows the whole arena at once — which matters now that the main camera is a
 * perspective view that can be zoomed in past the arena bounds.
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private size = 168;

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

  draw(world: World, coverage: { w: number; h: number }, camera: { x: number; y: number }, accent: string): void {
    const g = this.ctx;
    const S = this.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);

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

    // Hazards read as danger before units do.
    for (const hz of world.hazards) {
      g.fillStyle = hz.warn > 0 ? 'rgba(255,95,126,0.28)' : 'rgba(255,138,92,0.45)';
      g.beginPath();
      g.arc(px(hz.pos.x), py(hz.pos.y), Math.max(2, hz.radius * scale), 0, Math.PI * 2);
      g.fill();
    }

    for (const a of world.actors) {
      if (!a.alive) continue;
      const isPlayer = a.id === world.playerId;
      const r = isPlayer ? 4.2 : a.isMinion ? 2 : 3.4;
      g.beginPath();
      g.arc(px(a.pos.x), py(a.pos.y), r, 0, Math.PI * 2);
      g.fillStyle = isPlayer ? accent : a.isMinion ? '#b8664e' : '#ff5a52';
      g.fill();
      if (isPlayer) {
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 1.2;
        g.stroke();
      }
    }

    // Camera viewport rectangle, exactly as League draws it.
    const vw = coverage.w * scale;
    const vh = coverage.h * scale;
    g.strokeStyle = 'rgba(235,225,200,0.55)';
    g.lineWidth = 1;
    g.strokeRect(px(camera.x) - vw / 2, py(camera.y) - vh / 2, vw, vh);
  }
}
