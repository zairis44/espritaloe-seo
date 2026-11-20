import path from 'node:path';
import { fetchText, readJson, writeJson, sleep, daysBetween, norm } from './util.mjs';

const ENDPOINT = 'https://suggestqueries.google.com/complete/search';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

export function parseSuggest(text) {
  const json = JSON.parse(text);
  return Array.isArray(json?.[1]) ? json[1].filter((s) => typeof s === 'string') : [];
}

async function suggestFor(q) {
  const url = `${ENDPOINT}?client=firefox&hl=fr&gl=fr&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`;
  const r = await fetchText(url, { retries: 1 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseSuggest(r.text);
}

export function isDue(dataDir, everyDays, today) {
  const latest = readJson(path.join(dataDir, 'suggest', 'latest.json'), null);
  return !latest?.date || daysBetween(latest.date, today) >= everyDays;
}

/**
 * Interroge l'autocomplétion Google pour chaque graine (+ lettres et questions).
 * latest.json : { date, items: { suggestion: [graines] } } ; seen.json : { suggestion normalisée: première date vue }
 */
export async function collectSuggest({ settings, dataDir, today, log }) {
  const cfg = settings.suggest || {};
  const queries = [];
  for (const seed of cfg.seeds || []) {
    queries.push([seed, seed]);
    if (cfg.expandAlphabet) for (const l of LETTERS) queries.push([seed, `${seed} ${l}`]);
    for (const p of cfg.questionPrefixes || []) queries.push([seed, `${p} ${seed}`]);
  }
  log(`Google Suggest : ${queries.length} requêtes`);

  const items = {};
  let failures = 0;
  for (const [seed, q] of queries) {
    try {
      for (const s of await suggestFor(q)) {
        const key = s.trim().toLowerCase();
        items[key] ??= [];
        if (!items[key].includes(seed)) items[key].push(seed);
      }
    } catch {
      failures++;
      if (failures > 20) throw new Error('Google Suggest ne répond plus (trop d’erreurs consécutives)');
    }
    await sleep(350);
  }
  if (!Object.keys(items).length) throw new Error('Google Suggest : aucune suggestion récupérée');

  const seenFile = path.join(dataDir, 'suggest', 'seen.json');
  const seen = readJson(seenFile, {});
  const firstRun = Object.keys(seen).length === 0;
  let fresh = 0;
  for (const s of Object.keys(items)) {
    const k = norm(s);
    if (!seen[k]) {
      seen[k] = firstRun ? `${today}*` : today; // l'astérisque marque le relevé initial
      if (!firstRun) fresh++;
    }
  }
  writeJson(seenFile, seen);
  writeJson(path.join(dataDir, 'suggest', 'latest.json'), { date: today, items });
  return { suggestions: Object.keys(items).length, new: fresh, failures };
}
