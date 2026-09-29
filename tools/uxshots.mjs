/**
 * The front-door harness: every screen a player can open, photographed and
 * counted, so a claim like "the drills come first" is a number rather than an
 * opinion.
 *
 *   node tools/uxshots.mjs <out-dir> [--ref <git-ref>] [--seconds 3]
 *
 * It builds a throwaway copy of the client (optionally at an older commit —
 * that is how the "before" column is made) with a short PLAY minute so a
 * results screen arrives in seconds, serves it, and walks Chromium through
 * PLAY and every section on it, a results screen, STUDY and PROGRESS, at
 * 1360×900 and 390×844, for a new profile and a returning one.
 *
 * For every screen it records:
 *
 *  - **words above the first playable card** — every word of visible text in
 *    the screen (the top bar excluded, it is the same everywhere) that sits
 *    above the top edge of the first thing a click starts a run from;
 *  - **whether that card is above the fold**, and where it starts;
 *  - **controls** — buttons, links, fields and tabs, in the first viewport and
 *    on the whole screen;
 *  - **clicks from load to a running drill**, measured by actually doing it:
 *    boot, then the fewest clicks that put a run on screen.
 *
 * Nothing it builds is committed; the scratch copy lives beside the output.
 * The arena backdrop is switched off through the profile (`lowFx`), because
 * under software WebGL it costs seconds a frame and draws nothing counted here.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.APEX_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'uxshots');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ref = opt('ref', '');
const playSeconds = Number(opt('seconds', '3'));
const scratch = resolve(opt('scratch', join(outDir, '.build')));
const exe = process.env.APEX_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const VIEWPORTS = [
  { id: 'desktop', width: 1360, height: 900 },
  { id: 'phone', width: 390, height: 844 },
];

mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------ the short build
const build = () => {
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
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

// ---------------------------------------------------------------- profiles
const DAY = 86_400_000;
const NEW_PROFILE = { version: 1, onboarded: true, settings: { lowFx: true, muted: true } };

/**
 * Somebody who has been here before: a fortnight of runs across the drills and
 * two champions, three stars and one playlist. Written the way the client
 * writes it, and read back through the same `loadProfile` as anything else.
 */
const returningProfile = () => {
  const now = Date.now();
  const history = [];
  const run = (drill, daysAgo, score, performance) =>
    history.push({
      drill,
      t: now - daysAgo * DAY,
      score,
      performance,
      difficulty: 0.4,
      overall: 1180,
      key: performance,
      keyId: 'score',
      axes: {},
    });
  [
    [9, 610, 0.52],
    [6, 655, 0.55],
    [4, 700, 0.6],
    [2, 690, 0.59],
    [1, 760, 0.64],
  ].forEach(([d, s, p]) => run('apmPulse', d, s, p));
  [
    [12, 900, 0.5],
    [11, 980, 0.54],
    [10, 1040, 0.58],
  ].forEach(([d, s, p]) => run('vayneTumble', d, s, p));
  [
    [3, 420, 0.4],
    [1, 480, 0.45],
  ].forEach(([d, s, p]) => run('tfGold', d, s, p));
  history.sort((a, b) => a.t - b.t);
  return {
    ...NEW_PROFILE,
    name: 'RETURNING',
    createdAt: now - 20 * DAY,
    placed: true,
    placementRuns: 3,
    ratings: { movement: 1210, aim: 1150, kiting: 1100 },
    samples: { movement: 6, aim: 5, kiting: 3 },
    overall: 1180,
    peakOverall: 1190,
    bests: {
      apmPulse: { score: 760, metrics: {}, at: now - DAY },
      vayneTumble: { score: 1040, metrics: {}, at: now - 10 * DAY },
      tfGold: { score: 480, metrics: {}, at: now - DAY },
    },
    history,
    totalRuns: history.length,
    totalSeconds: history.length * 60,
    stars: ['apmPulse', 'vayneTumble', 'tfGold'],
    playlists: [{ id: 'pl-proof', name: 'MORNING', items: ['apmPulse', 'vayneTumble', 'tfGold'] }],
  };
};

// ------------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Anything a click starts a run from, across every version of PLAY this has measured. */
const PLAYABLE = '[data-playable], .pr-startable, .pr-lab-mode';

/** Through the title card and into the client. */
const enter = async (page) => {
  await page.waitForSelector('.boot', { timeout: 60_000 }).catch(() => {});
  await sleep(500);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.topbar', { timeout: 90_000 });
  // The screens fade up; count them once they have landed.
  await sleep(900);
};

const open = async (browser, url, viewport, profile) => {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await ctx.addInitScript((raw) => {
    // Only the first load of this context is seeded: a reload keeps whatever
    // the client itself wrote since.
    if (!sessionStorage.getItem('apex.proof.seeded')) {
      localStorage.setItem('apex.profile.v1', raw);
      sessionStorage.setItem('apex.proof.seeded', '1');
    }
  }, JSON.stringify(profile));
  const page = await ctx.newPage();
  await page.goto(url);
  await enter(page);
  return { ctx, page };
};

/** The numbers, read off the screen as it stands. */
const measure = (page) =>
  page.evaluate((PLAYABLE) => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const topbar = document.querySelector('.topbar');
    const inTopbar = (el) => !!topbar && topbar.contains(el);
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.02;
    };
    const scope = document.querySelector('.results') ?? document.querySelector('.shell') ?? document.body;
    // The first playable thing that is on screen now — after a scroll, a card
    // above the viewport does not count as "in view".
    const card = [...scope.querySelectorAll(PLAYABLE)].find(
      (el) => visible(el) && !inTopbar(el) && el.getBoundingClientRect().bottom > 0,
    );
    // The same question asked of the section cards alone, leaving PLAY NEXT
    // out: the honest comparison with a screen that had no front door.
    const sectionCard = [...scope.querySelectorAll('.pr-panel ' + PLAYABLE.split(', ').join(', .pr-panel '))].find(
      (el) => visible(el) && el.getBoundingClientRect().bottom > 0,
    );
    const sectionTop = sectionCard ? sectionCard.getBoundingClientRect().top : Infinity;
    const cardTop = card ? card.getBoundingClientRect().top : Infinity;
    const cardName = card
      ? (card.querySelector('.pr-name, .pr-lab-name, .pr-hero-name, h2, b')?.textContent ?? '').trim().slice(0, 40)
      : null;

    let above = 0;
    let aboveSection = 0;
    let firstView = 0;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || inTopbar(el) || !visible(el)) continue;
      if (el.closest('script, style, [aria-hidden="true"]')) continue;
      const words = (n.textContent ?? '').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
      if (!words.length) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.bottom > 0 && r.bottom <= cardTop + 1) above += words.length;
      if (r.bottom > 0 && r.bottom <= sectionTop + 1) aboveSection += words.length;
      if (r.top < vh && r.bottom > 0) firstView += words.length;
    }
    const controls = [...scope.querySelectorAll('button, a[href], input, select, textarea, [role="tab"], [role="button"]')].filter(
      (el) => visible(el) && !inTopbar(el),
    );
    const small = controls.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < vh && (r.height < 44 || r.width < 44);
    }).length;
    const scroller = document.scrollingElement;
    return {
      wordsAboveFirstCard: card ? above : null,
      wordsInFirstView: firstView,
      firstCard: cardName,
      firstCardTop: card ? Math.round(cardTop) : null,
      cardAboveFold: card ? cardTop < vh - 80 : false,
      wordsAboveFirstSectionCard: sectionCard ? aboveSection : null,
      firstSectionCardTop: sectionCard ? Math.round(sectionTop) : null,
      sectionCardAboveFold: sectionCard ? sectionTop < vh - 80 : false,
      justPlayedInView: (() => {
        const j = document.querySelector('.just-played');
        if (!j) return null;
        const r = j.getBoundingClientRect();
        return r.top < vh && r.bottom > 0;
      })(),
      controlsInFirstView: controls.filter((el) => el.getBoundingClientRect().top < vh).length,
      controlsTotal: controls.length,
      smallTargetsInFirstView: small,
      horizontalScroll: scroller ? scroller.scrollWidth > vw + 1 : false,
    };
  }, PLAYABLE);

/**
 * The fewest clicks from a freshly loaded PLAY to a live run, found by doing
 * it: click the first playable thing in the first viewport.
 */
const clicksToRun = async (page) => {
  const vh = page.viewportSize().height;
  const firstVisible = async () => {
    const handles = await page.$$(PLAYABLE);
    for (const h of handles) {
      const b = await h.boundingBox();
      if (b && b.y >= 0 && b.y < vh - 80) return { h, b };
    }
    return null;
  };
  let clicks = 0;
  const hit = await firstVisible();
  if (!hit) return { clicks: null, note: 'no playable card reachable without scrolling' };
  // Click the card body, clear of its own buttons.
  await page.mouse.click(hit.b.x + hit.b.width * 0.5, hit.b.y + Math.min(40, hit.b.height * 0.25));
  clicks++;
  const ok = await page.waitForSelector('.game-host', { timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  return { clicks: ok ? clicks : null, note: ok ? '' : 'the click did not start a run' };
};

/** Enter on a freshly loaded PLAY: does a key alone start the next drill? */
const keyToRun = async (page) => {
  await page.keyboard.press('Enter');
  return page.waitForSelector('.game-host', { timeout: 8_000 }).then(
    () => true,
    () => false,
  );
};

/** Put a run on screen from PLAY and play it to its results. */
const toResults = async (page) => {
  const card = await page.$(PLAYABLE);
  if (!card) return false;
  const b = await card.boundingBox();
  await page.mouse.click(b.x + b.width * 0.5, b.y + Math.min(40, b.height * 0.25));
  await page.waitForFunction(() => window.__apex?.session, null, { timeout: 30_000 });
  // Step the simulation to its buzzer headlessly: the run is the same run,
  // it simply does not wait for software WebGL to draw every frame of it.
  for (let i = 0; i < 400; i++) {
    const done = await page.evaluate(() => {
      const s = window.__apex?.session;
      if (!s) return true;
      for (let k = 0; k < 2400 && s.phase !== 'ended'; k++) s.step(1 / 240);
      return s.phase === 'ended';
    });
    if (done) break;
  }
  await page.waitForSelector('.results', { timeout: 60_000 });
  await sleep(2200);
  return true;
};

const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.jpg`), type: 'jpeg', quality: 72 });

// -------------------------------------------------------------------- walk
const main = async () => {
  const dist = build();
  const { server, url } = await serve(dist);
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const out = { ref: ref || 'working tree', at: new Date().toISOString(), screens: {} };
  const record = (key, data) => {
    out.screens[key] = data;
    console.log(`  ${key}: ${JSON.stringify(data)}`);
  };

  for (const vp of VIEWPORTS) {
    for (const [who, profile] of [
      ['new', NEW_PROFILE],
      ['returning', returningProfile()],
    ]) {
      const tag = `${vp.id}-${who}`;
      // PLAY, exactly as it opens.
      {
        const { ctx, page } = await open(browser, url, vp, profile);
        await shot(page, `${tag}-play`);
        record(`${tag} · PLAY (as it opens)`, await measure(page));
        await ctx.close();
      }
      // One click (or more) to a live run.
      {
        const { ctx, page } = await open(browser, url, vp, profile);
        const r = await clicksToRun(page);
        record(`${tag} · clicks to a running drill`, r);
        await ctx.close();
      }
      {
        const { ctx, page } = await open(browser, url, vp, profile);
        record(`${tag} · Enter starts a drill`, { enter: await keyToRun(page) });
        await ctx.close();
      }
      // PLAY with YOURS unfolded from the shelf.
      {
        const { ctx, page } = await open(browser, url, vp, profile);
        await page.click('.pr-chip-more');
        await sleep(700);
        await shot(page, `${tag}-play-yours`);
        record(`${tag} · PLAY › YOURS`, await measure(page));
        await ctx.close();
      }
      // PRACTICE and PROGRESS from the bar; STUDY from its corner chip.
      for (const [tab, sel] of [
        ['PRACTICE', null],
        ['PROGRESS', null],
        ['STUDY', '.study-chip'],
      ]) {
        const { ctx, page } = await open(browser, url, vp, profile);
        if (sel) await page.click(sel);
        else await page.locator('.nav button', { hasText: tab }).click();
        await sleep(900);
        await shot(page, `${tag}-${tab.toLowerCase()}`);
        record(`${tag} · ${tab}`, await measure(page));
        await ctx.close();
      }
      // A results screen, and where leaving it lands.
      {
        const { ctx, page } = await open(browser, url, vp, profile);
        if (await toResults(page)) {
          await shot(page, `${tag}-results`);
          const m = await measure(page);
          const primary = await page.$eval('.res-actions .btn.primary', (b) => b.textContent?.trim() ?? '').catch(() => null);
          record(`${tag} · RESULTS`, { ...m, primary });
          await page.keyboard.press('Escape');
          await sleep(1200);
          await shot(page, `${tag}-after-results`);
          record(`${tag} · PLAY after leaving results`, await measure(page));
        }
        await ctx.close();
      }
    }
  }

  writeFileSync(join(outDir, 'numbers.json'), JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
  rmSync(scratch, { recursive: true, force: true });
  console.log(`\nwrote ${join(outDir, 'numbers.json')}`);
};

await main();
