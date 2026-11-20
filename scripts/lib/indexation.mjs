import path from 'node:path';
import { readJson, writeJson, fetchText } from './util.mjs';
import { parseSitemap } from './sitemaps.mjs';
import { getAccessToken } from './gsc.mjs';

const ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

/** Toutes les URL du sitemap du site (index de sitemaps compris). */
async function siteUrls(domain) {
  const queue = [`https://${domain}/sitemap-index.xml`, `https://${domain}/sitemap.xml`];
  const seen = new Set();
  const urls = new Set();
  while (queue.length && seen.size < 20) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    try {
      const r = await fetchText(u, { retries: 1 });
      if (!r.ok) continue;
      const p = parseSitemap(r.text);
      if (p.type === 'index') queue.push(...p.sitemaps);
      else if (p.type === 'urlset') p.urls.forEach((x) => urls.add(x.loc));
    } catch {
      /* sitemap suivant */
    }
  }
  return [...urls];
}

async function inspect(token, siteUrl, url) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: url, siteUrl, languageCode: 'fr-FR' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
  const r = json.inspectionResult?.indexStatusResult || {};
  return {
    verdict: r.verdict || null, // PASS = indexée, NEUTRAL = exclue, FAIL = erreur
    etat: r.coverageState || null, // libellé Google, en français grâce à languageCode
    indexation: r.indexingState || null,
    robots: r.robotsTxtState || null,
    recup: r.pageFetchState || null,
    dernierCrawl: r.lastCrawlTime ? r.lastCrawlTime.slice(0, 10) : null,
    canoniqueGoogle: r.googleCanonical || null,
    canoniqueDeclaree: r.userCanonical || null,
  };
}

/**
 * Inspecte chaque URL du sitemap (quota Google : 2 000 par jour et par propriété).
 * data/gsc/indexation.json : { date, pages: { url: {...} }, changements: [[jour, url, avant, après]] }
 */
export async function collectIndexation({ settings, dataDir, env, today, log }) {
  const token = await getAccessToken({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
  });
  const property = env.GSC_PROPERTY || settings.gscProperty;
  const urls = await siteUrls(settings.siteDomain);
  if (!urls.length) throw new Error(`sitemap de ${settings.siteDomain} introuvable`);
  log(`Indexation : ${urls.length} pages à inspecter`);

  const file = path.join(dataDir, 'gsc', 'indexation.json');
  const store = readJson(file, { pages: {}, changements: [] });
  // On garde les résultats précédents des pages encore au sitemap ; les pages
  // jamais vérifiées ou vérifiées il y a le plus longtemps passent en premier.
  const pages = Object.fromEntries(urls.filter((u) => store.pages[u]).map((u) => [u, store.pages[u]]));
  const file_attente = [...urls].sort((a, b) => (pages[a]?.verifie || '').localeCompare(pages[b]?.verifie || ''));
  const BUDGET_MS = 5 * 60 * 1000; // 5 minutes par nuit au plus : le reste passe la nuit suivante
  const debut = Date.now();
  let erreurs = 0;
  let reussites = 0;
  const travail = async () => {
    while (file_attente.length && Date.now() - debut < BUDGET_MS) {
      const url = file_attente.shift();
      const avant = pages[url]?.verdict;
      try {
        pages[url] = { ...(await inspect(token, property, url)), verifie: today };
        reussites++;
      } catch (e) {
        erreurs++;
        if (pages[url]) pages[url] = { ...pages[url], erreur: e.message };
        if (erreurs >= 5 && reussites === 0) throw new Error(`inspection impossible : ${e.message}`);
      }
      const apres = pages[url]?.verdict;
      if (avant && apres && avant !== apres) store.changements.push([today, url, avant, apres]);
    }
  };
  await Promise.all([travail(), travail(), travail()]);
  store.date = today;
  store.pages = pages;
  store.changements = store.changements.slice(-200);
  writeJson(file, store);
  const indexees = Object.values(pages).filter((p) => p.verdict === 'PASS').length;
  return { pages: urls.length, verifiees: reussites, restantes: file_attente.length, indexees, nonIndexees: Object.keys(pages).length - indexees, erreurs };
}
