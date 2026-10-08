/**
 * The picture half of the tutorials: every frame of every episode, through
 * Chromium, into ffmpeg.
 *
 *   node tools/tutorials/render.mjs <build-dir> [--fps 30] [--only ep1-arcanopulse]
 *
 * Reads <build-dir>/narration.json (written by tts.py) so each beat lasts as
 * long as its line does, draws the episode frame by frame in player.html, and
 * writes <build-dir>/<episode>/video.mp4 (silent) and timeline.json — the
 * beat starts and every sound cue the pictures asked for, which mix.py turns
 * into the soundtrack. Needs Playwright (`npm i -g playwright`) and ffmpeg.
 */
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  try {
    return require('playwright');
  } catch {
    return require(join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
};
const { chromium } = loadPlaywright();

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = resolve(args.find((a) => !a.startsWith('--')) ?? 'tutorial-build');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fps = Number(opt('fps', '30'));
const only = (opt('only', '') ?? '').split(',').filter(Boolean);
const exe = process.env.APEX_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const script = JSON.parse(readFileSync(join(here, 'episodes.json'), 'utf8'));
const narration = JSON.parse(readFileSync(join(out, 'narration.json'), 'utf8'));

const browser = await chromium.launch({ executablePath: exe, args: ['--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(join(here, 'player.html')).href);

for (const ep of script.episodes) {
  if (only.length && !only.includes(ep.id)) continue;
  const dir = join(out, ep.id);
  mkdirSync(dir, { recursive: true });
  const total = await page.evaluate(([e, l, c]) => window.XS.load(e, l, c), [ep, narration[ep.id], script.cast]);
  const frames = Math.ceil(total * fps);
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    join(dir, 'video.mp4'),
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const started = Date.now();
  const BATCH = 12;
  for (let i = 0; i < frames; i += BATCH) {
    const urls = await page.evaluate(
      ([from, n, f]) => {
        const out = [];
        const cv = document.getElementById('c');
        for (let k = from; k < from + n; k++) {
          window.XS.frame(k / f, true, (k - 1) / f);
          out.push(cv.toDataURL('image/jpeg', 0.93));
        }
        return out;
      },
      [i, Math.min(BATCH, frames - i), fps],
    );
    for (const u of urls) {
      const ok = ff.stdin.write(Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'));
      if (!ok) await new Promise((r) => ff.stdin.once('drain', r));
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  const cues = await page.evaluate(() => window.XS.takeCues());
  // Where each line starts, as the page laid them out: the mixer puts the
  // voice there.
  const starts = await page.evaluate(() => window.XS.starts());
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify({ duration: total, fps, starts, cues }, null, 2));
  console.log(`${ep.id}: ${frames} frames, ${total.toFixed(1)}s, ${cues.length} cues, ${((Date.now() - started) / 1000).toFixed(0)}s to draw`);
}

await browser.close();
