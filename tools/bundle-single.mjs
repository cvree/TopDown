/**
 * Inlines the Vite build into one self-contained HTML page.
 * Used to publish the trainer as a single hostable artifact.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assets = readdirSync(join(dist, 'assets'));
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
const head = readFileSync('index.html', 'utf8');

const fontLink = head.match(/<link href="https:\/\/fonts\.googleapis[^>]+>/)?.[0] ?? '';
const cssText = readFileSync(join(dist, 'assets', css), 'utf8');
const jsText = readFileSync(join(dist, 'assets', js), 'utf8');

const page = `<title>APEX Mechanics</title>
<meta name="description" content="A precision mechanics trainer for MOBA players: movement, kiting, spacing, dodging and combat drills with a ranked mechanical skill system." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fontLink}
<style>
html, body { height: 100%; margin: 0; background: #05070c; }
${cssText}
</style>
<div id="root"></div>
<script type="module">
${jsText}
</script>
`;

writeFileSync(process.argv[2] ?? 'dist/apex-single.html', page);
console.log(`wrote ${(page.length / 1024).toFixed(0)}KB`);
