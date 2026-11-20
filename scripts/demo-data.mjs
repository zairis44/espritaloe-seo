#!/usr/bin/env node
/**
 * Génère des données FICTIVES dans data-demo/ pour voir le tableau de bord avant d'avoir branché la Search Console.
 * Usage : npm run demo  (génère puis lance le serveur local)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, writeJson, isoDay, addDays, dayRange } from './lib/util.mjs';

const dir = path.join(ROOT, 'data-demo');
fs.rmSync(dir, { recursive: true, force: true });

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;

const end = isoDay(-2);
const days480 = dayRange(addDays(end, -479), end);
const days90 = dayRange(addDays(end, -89), end);
const SITE = 'https://espritaloe.fr';

const pages = [
  ['/blog/forever-living-avis-produits-france/', 0.55],
  ['/blog/c9-forever-avis/', 0.12],
  ['/produits/programme-c9/', 0.07],
  ['/devenir-distributeur/', 0.05],
  ['/distributeur-forever-suisse/', 0.05],
  ['/produits/aloe-vera-gel/', 0.04],
  ['/blog/forever-living-franchise-ou-vente-directe/', 0.04],
  ['/produits/aloe-gelly/', 0.03],
  ['/recettes-c9/', 0.03],
  ['/', 0.02],
];

// [requête, position de départ, position d'arrivée, impressions/jour]
const queries = [
  ['forever living avis', 9, 6.2, 40], ['avis produits forever', 7, 5.1, 18], ['forever living danger', 12, 7.4, 25],
  ['produits forever fiables', 15, 9.8, 8], ['aloe vera forever avis', 8, 7.6, 22], ['c9 forever avis', 14, 11.2, 30],
  ['programme c9 forever', 18, 13.5, 20], ['c9 forever prix', 22, 16.4, 12], ['c9 forever avis négatif', 30, 24, 4],
  ['devenir distributeur forever', 21, 17.8, 14], ['distributeur forever living', 19, 15.2, 10], ['forever living franchise', 24, 18.9, 9],
  ['forever living pyramidal', 13, 12.1, 11], ['distributeur forever suisse', 11, 8.7, 6], ['aloe vera gel forever', 35, 28, 15],
  ['boisson aloe vera', 48, 41, 9], ['aloe gelly forever', 16, 12.3, 7], ['shampoing aloe vera forever', 27, 19, 5],
  ['forever living arnaque', 10, 8.9, 12], ['avis forever living', 8.5, 6.8, 16], ['forever aloe vera danger', 14, 10.4, 9],
  ['c9 forever perte de poids', 17, 14, 13], ['forever c9 avis', 13, 12.5, 10], ['recette c9 forever', 9, 4.2, 8],
  ['forever living produits avis', 6, 4.4, 20], ['forever living suisse', 12, 9.1, 5], ['aloe vera à boire danger', 26, 19, 7],
  ['f15 forever avis', 23, 18, 6], ['forever living belgique', 15, 13, 4], ['est ce que forever est fiable', 9, 5.5, 6],
];

// Totaux : croissance progressive
const totals = days480.map((d, i) => {
  const growth = Math.min(1, Math.max(0.03, (i - 300) / 180));
  const impr = Math.round(Math.max(0, 600 * growth * (1 + 0.15 * gauss())));
  const clicks = Math.round(impr * (0.035 + 0.01 * gauss()));
  return [d, Math.max(0, clicks), impr, Math.round((14 - 4 * growth + gauss()) * 10) / 10];
});
writeJson(path.join(dir, 'gsc', 'totals.json'), totals);

function monthly(kind, days, rowsFor) {
  const byMonth = {};
  for (const d of days) {
    const m = d.slice(0, 7);
    byMonth[m] ??= {};
    byMonth[m][d] = rowsFor(d);
  }
  for (const [m, data] of Object.entries(byMonth)) writeJson(path.join(dir, 'gsc', kind, `${m}.json`), data);
}

const totalsMap = new Map(totals.map((t) => [t[0], t]));
monthly('pages', days480, (d) => {
  const [, c, i] = totalsMap.get(d);
  return pages
    .map(([p, share]) => [SITE + p, Math.round(c * share * (1 + 0.2 * gauss())), Math.round(i * share * (1 + 0.2 * gauss())), Math.round((8 + 10 * rnd()) * 10) / 10])
    .filter((r) => r[2] > 0);
});

monthly('queries', days90, (d) => {
  const t = days90.indexOf(d) / 89;
  return queries
    .map(([q, p0, p1, ipd]) => {
      let p = Math.max(1, p0 + (p1 - p0) * t + gauss() * 1.2);
      if (t > 0.93 && q === 'forever living danger') p -= 3; // un saut récent, pour l'exemple
      if (t > 0.93 && q === 'forever living franchise') p += 4;
      if (rnd() < 0.12) return null; // jours sans impression
      const impr = Math.max(1, Math.round(ipd * (0.4 + t) * (1 + 0.3 * gauss())));
      const ctr = p < 3 ? 0.15 : p < 6 ? 0.05 : p < 11 ? 0.015 : 0.002;
      return [q, Math.round(impr * ctr * (1 + gauss())), impr, Math.round(p * 10) / 10];
    })
    .filter(Boolean)
    .map((r) => [r[0], Math.max(0, r[1]), r[2], r[3]]);
});

writeJson(path.join(dir, 'gsc', 'query-page-28d.json'), {
  start: addDays(end, -27),
  end,
  rows: [
    ...queries.map(([q, , p1, ipd]) => [q, SITE + pages[Math.floor(rnd() * 4)][0], Math.round(ipd * 0.5), ipd * 28, p1]),
    ['c9 forever avis', SITE + '/produits/programme-c9/', 4, 210, 14.2],
    ['forever living franchise', SITE + '/devenir-distributeur/', 2, 120, 19.1],
  ],
});

// Concurrents : relevé initial il y a 40 jours, puis de nouvelles pages
const today = isoDay(0);
const baseline = addDays(today, -40);
const comp = (domain, label, base, fresh) => {
  const urls = {};
  for (let i = 0; i < base; i++) urls[`https://${domain}/page-${i}`] = { f: baseline, m: addDays(today, -Math.floor(rnd() * 400)) };
  fresh.forEach(([slug, title, ago]) => (urls[`https://${domain}/${slug}`] = { f: addDays(today, -ago), m: addDays(today, -ago), t: title }));
  writeJson(path.join(dir, 'competitors', `${domain}.json`), {
    domain, label, baselineDate: baseline, lastCheck: today, sitemaps: [], errors: [],
    history: [[today, base + fresh.length, 0, 0]], urls,
  });
};
comp('www.aloe-vera-pour-tous.com', 'aloe-vera-pour-tous', 340, [
  ['post/est-ce-que-les-produits-forever-sont-fiables', 'Est-ce que les produits Forever sont fiables ?', 2],
  ['post/c9-forever-avis-negatif', 'C9 Forever : avis négatifs, ce qu’il faut savoir', 4],
  ['post/aloe-vera-cheveux-poreux', 'Aloe vera et cheveux poreux : mode d’emploi', 9],
  ['post/forever-aloe-vera-gel-ou-naturaloe', 'Forever Aloe Vera Gel ou Naturaloe ?', 15],
]);
comp('aloeveragel.fr', 'aloeveragel', 210, [['distributeur-forever-living/bretagne/rennes/', 'Distributeur Forever Rennes', 6]]);
comp('www.aloeveraforever.fr', 'aloeveraforever', 120, []);
comp('www.ghaloe.com', 'ghaloe', 96, []);

// Google Suggest
const sugg = [
  'aloe vera bienfaits cheveux', 'aloe vera à boire danger', 'aloe vera à boire bienfaits', 'c9 forever avis négatif',
  'c9 forever combien de kilos', 'c9 forever menu jour 3', 'c9 forever effets secondaires', 'forever living avis',
  'comment boire aloe vera forever', 'pourquoi aloe vera fait maigrir', 'quel aloe vera à boire choisir',
  'est-ce que forever living est une arnaque', 'aloe gelly brûlure', 'aloe gelly coup de soleil', 'gel aloe vera visage nuit',
  'distributeur forever salaire', 'f15 forever débutant 1 avis', 'forever living franchise prix',
];
const items = Object.fromEntries(sugg.map((s) => [s, [s.split(' ').slice(0, 2).join(' ')]]));
writeJson(path.join(dir, 'suggest', 'latest.json'), { date: addDays(today, -3), items });
writeJson(path.join(dir, 'suggest', 'seen.json'), Object.fromEntries(sugg.map((s, i) => [s.normalize('NFD').replace(/[̀-ͯ]/g, ''), i % 5 === 0 ? addDays(today, -3) : `${addDays(today, -40)}*`])));

writeJson(path.join(dir, 'meta.json'), {
  lastRun: new Date().toISOString(),
  steps: {
    gsc: { status: 'ok', at: new Date().toISOString() },
    'competitor:www.ghaloe.com': { status: 'error', at: new Date().toISOString(), message: 'exemple d’erreur : délai dépassé', lastOk: addDays(today, -1) },
  },
});
console.log('Données de démonstration écrites dans data-demo/');

const mode = process.argv[2]; // dev | build | rien
if (mode) {
  const child = spawn('npx', ['astro', mode], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, SEO_DATA_DIR: 'data-demo' } });
  child.on('exit', (code) => process.exit(code ?? 0));
}
