import path from 'node:path';
import { fetchText, readJson, writeJson, sleep, addDays } from './util.mjs';

const MAX_SITEMAPS = 60;
const MAX_TITLES_PER_RUN = 25;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s) {
  return s
    .trim()
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i'));
  return m ? decodeXml(m[1]) : null;
}

/** Analyse un sitemap : renvoie { type: 'index', sitemaps } ou { type: 'urlset', urls }. */
export function parseSitemap(xml) {
  if (/<(?:\w+:)?sitemapindex[\s>]/i.test(xml)) {
    const sitemaps = [...xml.matchAll(/<(?:\w+:)?sitemap[\s>][\s\S]*?<\/(?:\w+:)?sitemap>/gi)]
      .map((m) => tag(m[0], 'loc'))
      .filter(Boolean);
    return { type: 'index', sitemaps };
  }
  if (/<(?:\w+:)?urlset[\s>]/i.test(xml)) {
    const urls = [...xml.matchAll(/<(?:\w+:)?url[\s>][\s\S]*?<\/(?:\w+:)?url>/gi)]
      .map((m) => ({ loc: tag(m[0], 'loc'), lastmod: (tag(m[0], 'lastmod') || '').slice(0, 10) || null }))
      .filter((u) => u.loc);
    return { type: 'urlset', urls };
  }
  return { type: 'unknown' };
}

export function extractTitle(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const clean = (s) => (s ? decodeXml(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : null);
  return clean(t) || clean(h1);
}

async function discover(domain, log) {
  const base = `https://${domain}`;
  const found = [];
  try {
    const robots = await fetchText(`${base}/robots.txt`, { retries: 1 });
    if (robots.ok) for (const m of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) found.push(m[1]);
  } catch (e) {
    log(`  robots.txt illisible : ${e.message}`);
  }
  if (found.length) return [...new Set(found)];
  for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    try {
      const r = await fetchText(base + p, { retries: 1 });
      if (r.ok && parseSitemap(r.text).type !== 'unknown') return [base + p];
    } catch {
      /* on essaie l'emplacement suivant */
    }
  }
  return [];
}

async function crawlSitemaps(roots, log) {
  const queue = roots.map((u) => ({ url: u, depth: 0 }));
  const seen = new Set();
  const urls = new Map();
  const errors = [];
  while (queue.length && seen.size < MAX_SITEMAPS) {
    const { url, depth } = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const r = await fetchText(url);
      if (!r.ok) {
        errors.push(`${url} → HTTP ${r.status}`);
        continue;
      }
      const parsed = parseSitemap(r.text);
      if (parsed.type === 'index' && depth < 3) {
        // Les sitemaps d'images ou de vidéos n'apportent rien ici
        for (const s of parsed.sitemaps) if (!/image|video/i.test(s)) queue.push({ url: s, depth: depth + 1 });
      } else if (parsed.type === 'urlset') {
        for (const u of parsed.urls) {
          const prev = urls.get(u.loc);
          if (!prev || (u.lastmod && (!prev.lastmod || u.lastmod > prev.lastmod))) urls.set(u.loc, u);
        }
      } else {
        errors.push(`${url} → format non reconnu`);
      }
    } catch (e) {
      errors.push(e.message);
    }
    await sleep(400);
  }
  if (errors.length) log(`  ${errors.length} sitemap(s) en erreur`);
  return { urls, sitemaps: [...seen], errors };
}

/**
 * Met à jour data/competitors/<domaine>.json.
 * Format : { domain, label, baselineDate, lastCheck, sitemaps, errors, history: [[jour, total, nouvelles, retirées]],
 *            urls: { url: { f: premier vu, m: lastmod, t?: titre, g?: disparue le } } }
 */
export async function collectCompetitor({ competitor, dataDir, today, log }) {
  const { domain, label } = competitor;
  const file = path.join(dataDir, 'competitors', `${domain}.json`);
  const store = readJson(file, { domain, label, baselineDate: null, urls: {}, history: [] });
  store.label = label || domain;

  const roots = await discover(domain, log);
  if (!roots.length) throw new Error(`${domain} : aucun sitemap trouvé`);
  const { urls, sitemaps, errors } = await crawlSitemaps(roots, log);
  if (!urls.size) throw new Error(`${domain} : sitemap vide ou illisible (${errors[0] || 'aucune URL'})`);

  const baseline = !store.baselineDate;
  if (baseline) store.baselineDate = today;
  const fresh = [];
  let removed = 0;

  for (const [loc, u] of urls) {
    const cur = store.urls[loc];
    if (!cur) {
      store.urls[loc] = { f: today, m: u.lastmod };
      if (!baseline) fresh.push(loc);
    } else {
      cur.m = u.lastmod || cur.m;
      if (cur.g) delete cur.g; // page revenue
    }
  }
  for (const [loc, cur] of Object.entries(store.urls)) {
    if (!urls.has(loc) && !cur.g) {
      cur.g = today;
      removed++;
    }
  }
  // Pages disparues depuis plus de 90 jours : on les oublie
  const forget = addDays(today, -90);
  for (const [loc, cur] of Object.entries(store.urls)) if (cur.g && cur.g < forget) delete store.urls[loc];

  // Titres des nouvelles pages (inspiration pour tes propres sujets)
  for (const loc of fresh.slice(0, MAX_TITLES_PER_RUN)) {
    try {
      const r = await fetchText(loc, { retries: 1 });
      if (r.ok) store.urls[loc].t = extractTitle(r.text) || undefined;
    } catch {
      /* titre facultatif */
    }
    await sleep(500);
  }

  store.lastCheck = today;
  store.sitemaps = sitemaps;
  store.errors = errors.slice(0, 10);
  store.history = (store.history || []).filter((h) => h[0] !== today);
  store.history.push([today, urls.size, fresh.length, removed]);
  store.history = store.history.slice(-400);
  writeJson(file, store);
  return { domain, total: urls.size, new: fresh.length, removed, baseline };
}
