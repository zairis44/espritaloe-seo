#!/usr/bin/env node
/**
 * Collecte nocturne : Search Console, sitemaps des concurrents, Google Suggest.
 * Lancée par GitHub Actions chaque nuit, ou à la main avec « npm run collect ».
 * Chaque étape est indépendante : si l'une échoue, les autres continuent.
 * Le code de sortie vaut 1 si au moins une étape a échoué (GitHub t'envoie alors un e-mail).
 */
import path from 'node:path';
import { ROOT, readJson, writeJson, isoDay, loadEnvLocal } from './lib/util.mjs';
import { collectGsc } from './lib/gsc.mjs';
import { collectCompetitor } from './lib/sitemaps.mjs';
import { collectSuggest, isDue } from './lib/suggest.mjs';

loadEnvLocal();
const dataDir = path.resolve(ROOT, process.env.SEO_DATA_DIR || 'data');
const settings = readJson(path.join(ROOT, 'config', 'settings.json'));
const today = isoDay(0);
const only = process.argv.slice(2); // ex. « npm run collect -- gsc »
const wants = (name) => only.length === 0 || only.includes(name);
const log = (...a) => console.log(...a);

const metaFile = path.join(dataDir, 'meta.json');
const meta = readJson(metaFile, { steps: {} });
meta.lastRun = new Date().toISOString();
let failed = false;

async function step(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    meta.steps[name] = { status: 'ok', at: meta.lastRun, result };
    log(`✔ ${name} (${Math.round((Date.now() - started) / 1000)} s)`, JSON.stringify(result));
  } catch (e) {
    failed = true;
    meta.steps[name] = { status: 'error', at: meta.lastRun, message: e.message, lastOk: meta.steps[name]?.status === 'ok' ? meta.steps[name].at : meta.steps[name]?.lastOk };
    console.error(`✖ ${name} : ${e.message}`);
  }
}

if (wants('gsc')) {
  const env = process.env;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    meta.steps.gsc = { status: 'skipped', at: meta.lastRun, message: 'Identifiants Google absents (secrets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN).' };
    log('… gsc ignoré : identifiants Google absents');
  } else {
    await step('gsc', () => collectGsc({ settings, dataDir, env, log }));
  }
}

if (wants('competitors')) {
  for (const competitor of settings.competitors || []) {
    log(`Concurrent : ${competitor.domain}`);
    await step(`competitor:${competitor.domain}`, () => collectCompetitor({ competitor, dataDir, today, log }));
  }
}

if (wants('suggest')) {
  const forced = only.includes('suggest');
  if (forced || isDue(dataDir, settings.suggest?.everyDays ?? 7, today)) {
    await step('suggest', () => collectSuggest({ settings, dataDir, today, log }));
  } else {
    log('… suggest : déjà fait cette semaine');
  }
}

writeJson(metaFile, meta);
process.exit(failed ? 1 : 0);
