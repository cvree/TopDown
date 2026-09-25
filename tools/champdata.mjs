/**
 * Rebuild the roster STUDY quizzes on, from Riot's Data Dragon.
 *
 *   node tools/champdata.mjs                       fetch the latest championFull.json
 *   node tools/champdata.mjs path/to/championFull.json
 *   node tools/champdata.mjs https://…/championFull.json
 *
 * Data Dragon's champion file is five megabytes of lore, skins, sprite sheets
 * and recommended builds. The quiz needs a sliver of it — names, the passive,
 * each ability's summary, cooldowns and ranges, the attack range, and Riot's
 * own "playing against" tips — so this keeps that sliver and nothing else, as
 * plain text, and writes it next to the code that reads it.
 *
 * Nothing is edited by hand on the way through. Where Data Dragon's figures
 * are placeholders (a range of 25000 for "global", 0 for "no cooldown"), they
 * are kept as Riot printed them; the quiz decides what it is willing to ask.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/study/champions.json', import.meta.url));
const KEYS = ['Q', 'W', 'E', 'R'];

const load = async (src) => {
  if (src && !/^https?:/.test(src)) return JSON.parse(readFileSync(src, 'utf8'));
  let url = src;
  if (!url) {
    const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    url = `https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/championFull.json`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

/** Data Dragon text is tooltip markup. The quiz wants sentences. */
const clean = (s) =>
  String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const round = (n) => Math.round(Number(n) * 100) / 100;

const src = await load(process.argv[2]);
const champions = Object.values(src.data)
  .map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    tags: c.tags,
    ar: c.stats.attackrange,
    ms: c.stats.movespeed,
    passive: { name: clean(c.passive.name), text: clean(c.passive.description) },
    spells: c.spells.map((s, i) => ({
      key: KEYS[i],
      name: clean(s.name),
      text: clean(s.description),
      cd: s.cooldown.map(round),
      range: s.range.map(round),
    })),
    enemy: (c.enemytips ?? []).map(clean).filter(Boolean),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(OUT, JSON.stringify({ version: src.version, champions }) + '\n');
console.log(`${champions.length} champions from Data Dragon ${src.version} → ${OUT}`);
