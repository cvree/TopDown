/**
 * The proof harness: six moments of the client, recorded as video.
 *
 *   node tools/record.mjs <out-dir> [--ref <git-ref>] [--seconds 6] [--only lane,results]
 *
 * It builds a throwaway copy of the client with a short PLAY minute (so a
 * results screen arrives in seconds rather than a minute of software WebGL),
 * serves it, and drives Chromium through: the boot into WARM UP, a mode card
 * opening, the countdown, a lane minute, the results screen and a rank-up.
 * Then it measures frame times on the lane, with nothing recording.
 *
 * The short build lives in the scratch directory and is never committed —
 * the only thing it changes is `PLAY_SECONDS`. Needs Playwright on the
 * machine (`npm i -g playwright`); it uses the Chromium already installed.
 */
import { execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  try {
    return require('playwright');
  } catch {
    return require(join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
};
const { chromium } = loadPlaywright();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'recordings');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const playSeconds = Number(opt('seconds', '6'));
/** Record a commit rather than the working tree — how the "before" clips are made. */
const ref = opt('ref', '');
const only = opt('only', '')?.split(',').filter(Boolean) ?? [];
const scratch = resolve(opt('scratch', join(outDir, '.build')));
const exe = process.env.APEX_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const W = 1280;
const H = 720;

mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------ the short build
const buildShort = () => {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const files = ['src', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'package.json'];
  if (ref) execSync(`git archive ${ref} ${files.join(' ')} | tar -x -C ${JSON.stringify(scratch)}`, { cwd: root });
  else for (const f of files) cpSync(join(root, f), join(scratch, f), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'));
  const modes = join(scratch, 'src/drills/modes.ts');
  writeFileSync(modes, readFileSync(modes, 'utf8').replace(/PLAY_SECONDS = \d+/, `PLAY_SECONDS = ${playSeconds}`));
  execSync('npx vite build --logLevel error', { cwd: scratch, stdio: 'inherit' });
  return join(scratch, 'dist');
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const serve = (dir) =>
  new Promise((ok) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const file = join(dir, path === '/' ? 'index.html' : path);
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}/?debug` }));
  });

// ------------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const launch = () =>
  chromium.launch({
    executablePath: exe,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });

/** Through the title card: wait for the arena, press a key, wait for the client. */
const enter = async (page) => {
  await page.waitForSelector('.boot', { timeout: 60_000 }).catch(() => {});
  await sleep(600);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.topbar', { timeout: 90_000 });
  await sleep(400);
};

/** A profile that has been through the walkthrough, so the client opens on WARM UP. */
const seedProfile = async (browser, url) => {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(url);
  await enter(page);
  const skip = page.locator('.wc-quiet').first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await sleep(800);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
};

const clip = async (browser, state, name, fn) => {
  if (only.length && !only.some((o) => name.includes(o))) return;
  const dir = join(outDir, `.raw-${name}`);
  rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    storageState: state,
    recordVideo: { dir, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await fn(page);
  } catch (e) {
    console.log(`  ! ${name}: ${e.message.split('\n')[0]}`);
  }
  await ctx.close();
  const vid = readdirSync(dir).find((f) => f.endsWith('.webm'));
  if (vid) renameSync(join(dir, vid), join(outDir, `${name}.webm`));
  rmSync(dir, { recursive: true, force: true });
  console.log(`  ✓ ${name}.webm  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
};

const openPractice = async (page) => {
  await page.locator('.nav button', { hasText: 'PLAY' }).click();
  await sleep(700);
};

/** Click the first mode card on the PRACTICE tab of the champion screen. */
const openModeCard = async (page) => {
  await openPractice(page);
  await page.locator('#pr-tab-practice').click();
  await sleep(900);
  const card = page.locator('.pr-startable').first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + 60, { steps: 12 });
    await sleep(700);
    await page.mouse.click(box.x + box.width * 0.3, box.y + 60);
  }
};

const startLane = async (page) => {
  await openPractice(page);
  await page.locator('#pr-tab-lane').click();
  await sleep(700);
  const card = page.locator('.pr-lane').first();
  const box = await card.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + 80);
};

/** Wait for the countdown to finish and the run to be live. */
const waitRunning = (page) =>
  page.waitForFunction(() => window.__apex?.session?.phase === 'running', null, { timeout: 60_000 });

/** Advance the simulation headlessly to `seconds` of run time. Recording only. */
const fastForward = async (page, seconds) => {
  for (;;) {
    const at = await page.evaluate((target) => {
      const s = window.__apex?.session;
      if (!s) return target;
      for (let i = 0; i < 1200 && s.elapsed < target && s.phase === 'running'; i++) s.step(1 / 240);
      return s.elapsed;
    }, seconds);
    if (at >= seconds - 0.01) return;
  }
};

/**
 * A tiny farmer: last-hit whatever is low enough, otherwise hold ground just
 * behind the wave. Clicks the real canvas, like a player — it exists to make
 * the lane produce the banners and numbers a real lane produces.
 */
const farm = async (page, ms, boost = 0) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Software WebGL runs the arena at a fraction of real time; `boost` tops
    // the simulation up between clicks so a minute of video is a minute of lane.
    if (boost > 0) {
      await page.evaluate((b) => {
        const s = window.__apex?.session;
        for (let i = 0; s && i < b * 240 && s.phase === 'running'; i++) s.step(1 / 240);
      }, boost);
    }
    const aim = await page.evaluate(() => {
      const a = window.__apex;
      if (!a?.session?.world?.player) return null;
      const w = a.session.world;
      const p = w.player;
      const foes = w.actors.filter((x) => x.alive && x.team === 'enemy' && x.unitKind);
      const low = foes
        .filter((x) => x.hp <= p.attack.damage * 1.15 && Math.hypot(x.pos.x - p.pos.x, x.pos.y - p.pos.y) < p.attack.range + 260)
        .sort((x, y) => x.hp - y.hp)[0];
      const allies = w.actors.filter((x) => x.alive && x.team === 'player' && x.unitKind);
      const anchor = low?.pos ??
        (allies.length
          ? { x: allies.reduce((s, x) => s + x.pos.x, 0) / allies.length - 60, y: allies.reduce((s, x) => s + x.pos.y, 0) / allies.length + 60 }
          : p.pos);
      const sc = a.renderer.worldToScreen(anchor);
      return { x: sc.x, y: sc.y, hit: !!low };
    });
    if (aim && aim.x > 10 && aim.y > 10 && aim.x < W - 10 && aim.y < H - 10) {
      await page.mouse.move(aim.x, aim.y);
      await page.mouse.click(aim.x, aim.y, { button: 'right' });
    }
    await sleep(aim?.hit ? 180 : 420);
  }
};

const frameTimes = async (page, ms) =>
  page.evaluate(
    (dur) =>
      new Promise((ok) => {
        const d = [];
        let last = performance.now();
        const end = last + dur;
        const tick = (t) => {
          d.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else {
            d.sort((a, b) => a - b);
            const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
            ok({ frames: d.length, median: q(0.5), p95: q(0.95), max: d[d.length - 1] });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

// ----------------------------------------------------------------------- run
const dist = buildShort();
const { server, url } = await serve(dist);
const browser = await launch();
console.log(`recording into ${outDir} (PLAY = ${playSeconds}s)`);
const state = await seedProfile(browser, url);

await clip(browser, state, '1-boot-warmup', async (page) => {
  await page.goto(url);
  await enter(page);
  await sleep(3500);
});

await clip(browser, state, '2-card-open', async (page) => {
  await page.goto(url);
  await enter(page);
  await openModeCard(page);
  await sleep(2500);
});

await clip(browser, state, '3-countdown', async (page) => {
  await page.goto(url);
  await enter(page);
  await openModeCard(page);
  await waitRunning(page);
  await sleep(2200);
});

await clip(browser, state, '4-lane-minute', async (page) => {
  await page.goto(url);
  await enter(page);
  await startLane(page);
  await waitRunning(page);
  await fastForward(page, 52);
  await farm(page, 60_000, 0.3);
});

/** Play the opened mode to its buzzer, the last second and a half of it live. */
const toResults = async (page) => {
  await waitRunning(page);
  await fastForward(page, playSeconds - 1.5);
  await page.waitForSelector('.results', { timeout: 240_000 });
};

await clip(browser, state, '5-results', async (page) => {
  await page.goto(url);
  await enter(page);
  await openModeCard(page);
  await toResults(page);
  await sleep(7000);
});

await clip(browser, state, '6-rank-up', async (page) => {
  await page.goto(url);
  await enter(page);
  await openModeCard(page);
  await toResults(page);
  await sleep(2500);
  await page.evaluate(() => window.__apexShow?.rankUp(1180, 1260));
  await sleep(4500);
});

if (!only.length || only.includes('frames')) {
  // Frame times on the heaviest screen — the lane, mid-wave — with no video
  // running, so the recorder is not what is being measured.
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, storageState: state });
  const page = await ctx.newPage();
  await page.goto(url);
  await enter(page);
  await startLane(page);
  await waitRunning(page);
  await fastForward(page, 58);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const farming = farm(page, 9000);
  await sleep(1500);
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const m0 = await metric();
  const ft = await frameTimes(page, 6000);
  const m1 = await metric();
  await farming;
  // Main-thread cost per frame, split the way DevTools splits it. Software
  // WebGL makes the whole frame slow here; these are the parts the client's
  // own code and styles are responsible for.
  const per = (k) => ((m1[k] - m0[k]) * 1000) / Math.max(1, ft.frames);
  ft.scriptMs = per('ScriptDuration');
  ft.styleMs = per('RecalcStyleDuration');
  ft.layoutMs = per('LayoutDuration');
  const counts = await page.evaluate(() => window.__apex?.session?.shown ?? null);
  await ctx.close();

  // And the results reveal: the heaviest screen the client itself draws, with
  // the arena stopped behind it, so this is the interface being timed.
  const rctx = await browser.newContext({ viewport: { width: W, height: H }, storageState: state });
  const rpage = await rctx.newPage();
  await rpage.goto(url);
  await enter(rpage);
  await openModeCard(rpage);
  await waitRunning(rpage);
  await fastForward(rpage, playSeconds - 0.2);
  await rpage.waitForSelector('.results', { timeout: 240_000, state: 'attached' });
  const rcdp = await rctx.newCDPSession(rpage);
  await rcdp.send('Performance.enable');
  const rmetric = async () => Object.fromEntries((await rcdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  // Past the arena's last second, into the reveal itself.
  await sleep(1100);
  const r0 = await rmetric();
  const rt = await frameTimes(rpage, 2500);
  const r1 = await rmetric();
  const rper = (k) => ((r1[k] - r0[k]) * 1000) / Math.max(1, rt.frames);
  rt.scriptMs = rper('ScriptDuration');
  rt.styleMs = rper('RecalcStyleDuration');
  rt.layoutMs = rper('LayoutDuration');
  await rctx.close();
  console.log(
    `  frame time on the results reveal: median ${rt.median.toFixed(1)}ms  p95 ${rt.p95.toFixed(1)}ms  (${rt.frames} frames)` +
      `  · per frame: script ${rt.scriptMs.toFixed(2)}ms  style ${rt.styleMs.toFixed(2)}ms  layout ${rt.layoutMs.toFixed(2)}ms`,
  );
  const report = { frame: ft, results: rt, shownOnLane: counts, at: new Date().toISOString() };
  writeFileSync(join(outDir, 'frames.json'), JSON.stringify(report, null, 2));
  console.log(
    `  frame time on the lane: median ${ft.median.toFixed(1)}ms  p95 ${ft.p95.toFixed(1)}ms  (${ft.frames} frames)` +
      `  · per frame: script ${ft.scriptMs.toFixed(2)}ms  style ${ft.styleMs.toFixed(2)}ms  layout ${ft.layoutMs.toFixed(2)}ms`,
  );
}

await browser.close();
server.close();
rmSync(scratch, { recursive: true, force: true });
