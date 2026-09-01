import { useEffect, useRef } from 'react';

/**
 * The menu backdrop: a slow drift of instrument motes and scan lines. It is
 * deliberately almost invisible — its job is to stop the dark from feeling
 * dead, not to compete with the content.
 */
export function Atmos({ intensity = 1 }: { intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: true });
    if (!ctx) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const motes = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.2 + Math.random() * 0.8,
      s: 0.4 + Math.random() * 1.5,
      vx: (Math.random() - 0.5) * 0.012,
      vy: -0.006 - Math.random() * 0.014,
    }));

    const resize = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      cv.width = Math.max(1, w * dpr);
      cv.height = Math.max(1, h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      for (const m of motes) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.y < -0.05) {
          m.y = 1.05;
          m.x = Math.random();
        }
        if (m.x < -0.05) m.x = 1.05;
        if (m.x > 1.05) m.x = -0.05;
        const a = 0.05 + m.z * 0.16 * intensity;
        ctx.fillStyle = `rgba(140,214,255,${a})`;
        ctx.beginPath();
        ctx.arc(m.x * w, m.y * h, m.s * m.z * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // A single slow horizontal sweep, like a readout refreshing.
      const t = (now / 9000) % 1;
      const y = t * h;
      const g = ctx.createLinearGradient(0, y - 90, 0, y + 90);
      g.addColorStop(0, 'rgba(88,224,255,0)');
      g.addColorStop(0.5, `rgba(88,224,255,${0.022 * intensity})`);
      g.addColorStop(1, 'rgba(88,224,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 90, w, 180);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [intensity]);

  return <canvas ref={ref} className="atmos" />;
}
