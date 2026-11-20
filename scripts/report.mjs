#!/usr/bin/env node
/**
 * Résumé texte des données (utilisé par Claude pour les analyses dans le chat).
 * Réutilise exactement les calculs du tableau de bord (src/lib/data.ts).
 * Usage : node scripts/report.mjs            → résumé complet en Markdown
 *         node scripts/report.mjs --json     → mêmes données en JSON
 */
import { ROOT } from './lib/util.mjs';
process.chdir(ROOT);
const d = await import('../src/lib/data.ts');

const f1 = (n) => (n == null ? '–' : n.toFixed(1).replace('.', ','));
const pc = (n) => (n == null ? '–' : (n * 100).toFixed(1).replace('.', ',') + ' %');
const dl = (n) => (n == null ? '' : Math.abs(n) < 0.5 ? '=' : n > 0 ? `▲${f1(n)}` : `▼${f1(-n)}`);
const ev = (cur, prev) => (cur == null || !prev ? '' : `${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / prev) * 100)} %`);
const kw = (s) => ({ requete: s.keyword, pos7: s.pos7, evol7: s.delta7, pos28: s.pos28, evol28: s.delta28, clics28: s.clicks28, impr28: s.impressions28, ctr28: s.ctr28 });

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    meta: d.meta, dernierJour: d.lastDay, kpis: d.kpis, concentration: { part: d.concentration.topShare, page: d.concentration.top?.key },
    pages28: d.pages28.slice(0, 20),
    suivis: d.trackedGroups.map((g) => ({ groupe: g.name, mots: g.rows.map(kw) })),
    requetes: d.topQueries.map(kw), mouvements: { hausse: d.movers.up.map(kw), baisse: d.movers.down.map(kw) },
    idees: { page2: d.ideas.page2.map((s) => ({ ...kw(s), page: s.page })), ctrFaible: d.ideas.lowCtr.map((s) => ({ ...kw(s), repere: s.expected, page: s.page })), cannibalisation: d.ideas.cannibal },
    suggest: d.suggest, concurrents: d.competitors,
  }, null, 1));
  process.exit(0);
}

const out = [];
const p = (s = '') => out.push(s);
p(`# Rapport SEO espritaloe.fr`);
p(`Collecte : ${d.meta.lastRun ?? 'jamais'} · Search Console jusqu'au ${d.lastDay ?? '–'}`);
const errs = Object.entries(d.meta.steps).filter(([, s]) => s.status !== 'ok');
if (errs.length) { p('\n## ⚠️ Étapes en échec ou ignorées'); for (const [n, s] of errs) p(`- ${n} (${s.status}) : ${s.message}`); }

if (d.kpis) {
  const { cur, prev } = d.kpis;
  p('\n## 28 jours vs 28 jours précédents');
  p(`- Clics ${cur.clicks} (${ev(cur.clicks, prev.clicks)}) · Impressions ${cur.impressions} (${ev(cur.impressions, prev.impressions)}) · CTR ${pc(cur.ctr)} · Position ${f1(cur.position)} (avant ${f1(prev.position)})`);
  p(`- Première page : ${pc(d.concentration.topShare)} des clics (${d.concentration.top ? d.shortUrl(d.concentration.top.key) : '–'})`);
  p('\n## Pages (28 j)');
  for (const x of d.pages28.slice(0, 10)) p(`- ${d.shortUrl(x.key)} : ${x.clicks} clics, ${x.impressions} impr., pos. ${f1(x.position)}`);
  p('\n## Mouvements 7 j');
  for (const s of d.movers.up) p(`- ▲ ${s.keyword} : ${f1(s.pos7)} (${dl(s.delta7)})`);
  for (const s of d.movers.down) p(`- ▼ ${s.keyword} : ${f1(s.pos7)} (${dl(s.delta7)})`);
}

p('\n## Mots-clés suivis (pos. 7 j, évol., pos. 28 j, clics, impr. 28 j)');
for (const g of d.trackedGroups) {
  p(`### ${g.name}`);
  for (const s of g.rows) p(`- ${s.keyword} : ${s.impressions28 ? `${f1(s.pos7)} ${dl(s.delta7)} | ${f1(s.pos28)} | ${s.clicks28} clics | ${s.impressions28} impr.` : 'pas visible'}`);
}

p('\n## Idées');
p(`### Page 2 (${d.ideas.page2.length})`);
for (const s of d.ideas.page2.slice(0, 15)) p(`- ${s.keyword} : pos. ${f1(s.pos28)}, ${s.impressions28} impr. → ${s.page ? d.shortUrl(s.page) : '–'}`);
p(`### CTR faible (${d.ideas.lowCtr.length})`);
for (const s of d.ideas.lowCtr.slice(0, 10)) p(`- ${s.keyword} : pos. ${f1(s.pos28)}, CTR ${pc(s.ctr28)} (repère ${pc(s.expected)}) → ${s.page ? d.shortUrl(s.page) : '–'}${s.page && d.isFrozen(s.page) ? ' [GELÉE]' : ''}`);
p(`### Cannibalisation (${d.ideas.cannibal.length})`);
for (const c of d.ideas.cannibal.slice(0, 10)) p(`- ${c.query} : ${c.pages.map((x) => `${d.shortUrl(x.page)} (pos. ${f1(x.position)}, ${x.impressions} impr.)`).join(' / ')}`);
p(`### Google Suggest (relevé ${d.suggest.date ?? '–'}) : ${d.suggest.fresh.length} nouvelles, ${d.suggest.gaps.length} non couvertes`);
if (d.suggest.fresh.length) p(`Nouvelles : ${d.suggest.fresh.map((s) => s.text).join(' · ')}`);
p(`Non couvertes (extrait) : ${d.suggest.gaps.slice(0, 40).map((s) => s.text).join(' · ')}`);

p(`\n## Indexation Google (contrôle du ${d.indexation.date ?? '–'}) : ${d.indexation.indexees}/${d.indexation.total} indexées`);
for (const x of d.indexation.nonIndexees) p(`- NON INDEXÉE ${d.shortUrl(x.url)} : ${x.etat ?? x.verdict} (dernier crawl ${x.dernierCrawl ?? '–'})`);
for (const x of d.indexation.canoniques) p(`- CANONIQUE ${d.shortUrl(x.url)} → Google retient ${x.canoniqueGoogle}`);
for (const [j, u, a, b] of d.indexation.changements.slice(0, 10)) p(`- changement ${j} ${d.shortUrl(u)} : ${a} → ${b}`);

p('\n## Concurrents');
for (const c of d.competitors) {
  if (!c.ok) { p(`- ${c.label} : ${c.error}`); continue; }
  p(`- ${c.label} : ${c.total} pages, ${c.newPages.length} nouvelles / ${c.updated.length} mises à jour / ${c.removed} retirées sur 30 j (vérifié le ${c.lastCheck})${c.stale ? ` ⚠️ ${c.stale}` : ''}`);
  for (const x of c.newPages.slice(0, 10)) p(`  - ${x.first} ${x.title ?? ''} ${x.url}`);
}
console.log(out.join('\n'));
