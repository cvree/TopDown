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

// A whole document, not a fragment. A page with no doctype is served in
// quirks mode, which is a different box model and a different set of CSS
// defaults from the one every stylesheet in this project was written against
// — so the one build whose entire job is to be hostable anywhere was the one
// build that could be laid out differently from the others.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#010a13" />
<title>APEX Mechanics</title>
<meta name="description" content="A precision mechanics trainer for MOBA players: movement, kiting, spacing, dodging and combat drills with a ranked mechanical skill system." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fontLink}
<style>
html, body { height: 100%; margin: 0; background: #05070c; }
${cssText}
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
${jsText}
</script>
</body>
</html>
`;

writeFileSync(process.argv[2] ?? 'dist/apex-single.html', page);
console.log(`wrote ${(page.length / 1024).toFixed(0)}KB`);
