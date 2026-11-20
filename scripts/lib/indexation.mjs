import path from 'node:path';
import { readJson, writeJson, sleep, fetchText } from './util.mjs';
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
  const pages = {};
  let erreurs = 0;
  let reussites = 0;
  for (const url of urls) {
    try {
      pages[url] = await inspect(token, property, url);
      reussites++;
    } catch (e) {
      erreurs++;
      if (store.pages[url]) pages[url] = { ...store.pages[url], erreur: e.message };
      if (erreurs >= 5 && reussites === 0) throw new Error(`inspection impossible : ${e.message}`);
    }
    const avant = store.pages[url]?.verdict;
    const apres = pages[url]?.verdict;
    if (avant && apres && avant !== apres) store.changements.push([today, url, avant, apres]);
    await sleep(150);
  }
  store.date = today;
  store.pages = pages;
  store.changements = store.changements.slice(-200);
  writeJson(file, store);
  const indexees = Object.values(pages).filter((p) => p.verdict === 'PASS').length;
  return { pages: urls.length, indexees, nonIndexees: urls.length - indexees, erreurs };
}
