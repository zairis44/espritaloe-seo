/**
 * Lecture des données collectées et calcul des indicateurs.
 * Tout se fait au moment du build : le tableau de bord publié est 100 % statique.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
export const DATA_DIR = path.resolve(ROOT, process.env.SEO_DATA_DIR || 'data');

// ---------- utilitaires ----------
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
export function addDays(day: string, n: number) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dayRange(start: string, end: string) {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
export function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- configuration ----------
export interface Settings {
  gscProperty: string;
  siteDomain: string;
  competitors: { domain: string; label?: string }[];
  frozenPages?: string[];
  suggest?: { seeds?: string[] };
}
export const settings = readJson<Settings>(path.join(ROOT, 'config', 'settings.json'), {} as Settings);
export const keywordGroups = readJson<{ groups: { name: string; keywords: string[] }[] }>(
  path.join(ROOT, 'config', 'keywords.json'),
  { groups: [] }
).groups;

export const meta = readJson<{ lastRun?: string; steps: Record<string, { status: string; at: string; message?: string; lastOk?: string }> }>(
  path.join(DATA_DIR, 'meta.json'),
  { steps: {} }
);

/** Chemin relatif d'une URL du site (pour l'affichage). */
export function shortUrl(url: string) {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname + u.search) || '/';
    // Une variante d'hôte (ex. www.) est signalée pour ne pas confondre deux lignes « / »
    return settings.siteDomain && u.hostname !== settings.siteDomain && u.hostname.endsWith(settings.siteDomain) ? `${u.hostname}${path}` : path;
  } catch {
    return url;
  }
}
export function isFrozen(url: string) {
  const p = shortUrl(url);
  return (settings.frozenPages || []).some((f) => p === f || p === f.replace(/\/?$/, '/'));
}

// ---------- Search Console ----------
type Row = [string, number, number, number]; // clé, clics, impressions, position
type Daily = Map<string, Row[]>;

const totalsRaw = readJson<[string, number, number, number][]>(path.join(DATA_DIR, 'gsc', 'totals.json'), []);
export const hasGsc = totalsRaw.length > 0;
export const lastDay = totalsRaw.at(-1)?.[0] ?? null;

function loadMonthly(kind: 'queries' | 'pages'): Daily {
  const dir = path.join(DATA_DIR, 'gsc', kind);
  const map: Daily = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const data = readJson<Record<string, Row[]>>(path.join(dir, f), {});
    for (const [day, rows] of Object.entries(data)) map.set(day, rows);
  }
  return map;
}
const queriesDaily = loadMonthly('queries');
const pagesDaily = loadMonthly('pages');

export interface Agg {
  key: string;
  clicks: number;
  impressions: number;
  position: number | null; // moyenne pondérée par les impressions
  ctr: number | null;
}

function aggregate(daily: Daily, start: string, end: string, filter?: (k: string) => boolean): Map<string, Agg> {
  const acc = new Map<string, { c: number; i: number; p: number }>();
  for (const day of dayRange(start, end)) {
    for (const [k, c, i, p] of daily.get(day) || []) {
      if (filter && !filter(k)) continue;
      const a = acc.get(k) || { c: 0, i: 0, p: 0 };
      a.c += c;
      a.i += i;
      a.p += p * i;
      acc.set(k, a);
    }
  }
  const out = new Map<string, Agg>();
  for (const [k, a] of acc) out.set(k, { key: k, clicks: a.c, impressions: a.i, position: a.i ? a.p / a.i : null, ctr: a.i ? a.c / a.i : null });
  return out;
}

/** Fenêtres de comparaison, alignées sur le dernier jour disponible. */
export const win = lastDay
  ? {
      end: lastDay,
      d7: addDays(lastDay, -6),
      p7start: addDays(lastDay, -13),
      p7end: addDays(lastDay, -7),
      d28: addDays(lastDay, -27),
      p28start: addDays(lastDay, -55),
      p28end: addDays(lastDay, -28),
      d90: addDays(lastDay, -89),
    }
  : null;

// --- totaux du site ---
function sumTotals(start: string, end: string) {
  let c = 0, i = 0, p = 0;
  for (const [d, cl, im, pos] of totalsRaw) {
    if (d < start || d > end) continue;
    c += cl;
    i += im;
    p += pos * im;
  }
  return { clicks: c, impressions: i, ctr: i ? c / i : null, position: i ? p / i : null };
}
export const kpis = win
  ? { cur: sumTotals(win.d28, win.end), prev: sumTotals(win.p28start, win.p28end) }
  : null;

export const totalsSeries = win
  ? (() => {
      const byDay = new Map(totalsRaw.map((t) => [t[0], t]));
      return dayRange(win.d90, win.end).map((d) => ({ day: d, clicks: byDay.get(d)?.[1] ?? 0, impressions: byDay.get(d)?.[2] ?? 0 }));
    })()
  : [];

/** Clics par semaine sur tout l'historique (pour la tendance longue). */
export const weeklyClicks = (() => {
  const out: { week: string; clicks: number }[] = [];
  if (!lastDay) return out;
  for (let end = lastDay; ; end = addDays(end, -7)) {
    const start = addDays(end, -6);
    if (start < totalsRaw[0][0]) break;
    out.unshift({ week: start, clicks: sumTotals(start, end).clicks });
  }
  return out;
})();

// --- pages ---
export const pages28 = win ? [...aggregate(pagesDaily, win.d28, win.end).values()].sort((a, b) => b.clicks - a.clicks) : [];
export const concentration = (() => {
  const total = pages28.reduce((s, p) => s + p.clicks, 0);
  return { total, topShare: total ? pages28[0].clicks / total : 0, top: pages28[0] ?? null };
})();

// --- requêtes ---
const q28 = win ? aggregate(queriesDaily, win.d28, win.end) : new Map<string, Agg>();
const q7 = win ? aggregate(queriesDaily, win.d7, win.end) : new Map<string, Agg>();
const qPrev7 = win ? aggregate(queriesDaily, win.p7start, win.p7end) : new Map<string, Agg>();
const qPrev28 = win ? aggregate(queriesDaily, win.p28start, win.p28end) : new Map<string, Agg>();
const q90 = win ? aggregate(queriesDaily, win.d90, win.end) : new Map<string, Agg>();

/** Requêtes Search Console indexées par forme normalisée (variantes d'accents/majuscules regroupées). */
const byNorm = new Map<string, string[]>();
for (const k of q90.keys()) {
  const n = norm(k);
  if (!byNorm.has(n)) byNorm.set(n, []);
  byNorm.get(n)!.push(k);
}

function mergeAgg(map: Map<string, Agg>, keys: string[]): Agg | null {
  let c = 0, i = 0, p = 0;
  for (const k of keys) {
    const a = map.get(k);
    if (!a) continue;
    c += a.clicks;
    i += a.impressions;
    p += (a.position ?? 0) * a.impressions;
  }
  return i ? { key: keys[0], clicks: c, impressions: i, position: p / i, ctr: c / i } : null;
}

function positionSeries(keys: string[]) {
  if (!win) return [];
  const set = new Set(keys);
  return dayRange(win.d90, win.end).map((d) => {
    let i = 0, p = 0;
    for (const [k, , im, pos] of queriesDaily.get(d) || []) if (set.has(k)) { i += im; p += pos * im; }
    return i ? p / i : null;
  });
}

export interface KeywordStat {
  keyword: string;
  pos7: number | null;
  delta7: number | null; // positif = gain de places
  pos28: number | null;
  delta28: number | null;
  clicks28: number;
  impressions28: number;
  ctr28: number | null;
  series: (number | null)[];
}

function statFor(label: string, keys: string[]): KeywordStat {
  const a7 = mergeAgg(q7, keys), p7 = mergeAgg(qPrev7, keys), a28 = mergeAgg(q28, keys), p28 = mergeAgg(qPrev28, keys);
  return {
    keyword: label,
    pos7: a7?.position ?? null,
    delta7: a7?.position != null && p7?.position != null ? p7.position - a7.position : null,
    pos28: a28?.position ?? null,
    delta28: a28?.position != null && p28?.position != null ? p28.position - a28.position : null,
    clicks28: a28?.clicks ?? 0,
    impressions28: a28?.impressions ?? 0,
    ctr28: a28?.ctr ?? null,
    series: positionSeries(keys),
  };
}

export const trackedGroups = keywordGroups.map((g) => ({
  name: g.name,
  rows: g.keywords.map((kw) => statFor(kw, byNorm.get(norm(kw)) || [])),
}));

export const topQueries = [...byNorm.entries()]
  .map(([, keys]) => statFor(keys[0], keys))
  .filter((s) => s.impressions28 > 0)
  .sort((a, b) => b.impressions28 - a.impressions28)
  .slice(0, 150);

/** Plus fortes variations de position sur 7 jours (requêtes avec un minimum de visibilité). */
export const movers = (() => {
  const list = topQueries.filter((s) => s.delta7 != null && s.impressions28 >= 20 && s.pos7 != null && s.pos7 <= 50);
  return {
    up: [...list].sort((a, b) => b.delta7! - a.delta7!).filter((s) => s.delta7! >= 1).slice(0, 6),
    down: [...list].sort((a, b) => a.delta7! - b.delta7!).filter((s) => s.delta7! <= -1).slice(0, 6),
  };
})();

// ---------- idées ----------
/** Repères de taux de clic par position (ordre de grandeur, varie selon la SERP). */
const CTR_REF = [0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
export function expectedCtr(pos: number) {
  return CTR_REF[Math.min(10, Math.max(1, Math.round(pos)))];
}

const qp = readJson<{ start?: string; end?: string; rows: [string, string, number, number, number][] }>(
  path.join(DATA_DIR, 'gsc', 'query-page-28d.json'),
  { rows: [] }
);
/** Meilleure page par requête (sur 28 jours). */
const bestPage = new Map<string, string>();
{
  const best = new Map<string, number>();
  for (const [q, p, , i] of qp.rows) if (i > (best.get(q) ?? -1)) { best.set(q, i); bestPage.set(q, p); }
}

export const ideas = {
  page2: topQueries
    .filter((s) => s.pos28 != null && s.pos28 > 10.5 && s.pos28 <= 20.5 && s.impressions28 >= 10)
    .sort((a, b) => b.impressions28 - a.impressions28)
    .slice(0, 40)
    .map((s) => ({ ...s, page: bestPage.get(s.keyword) ?? null })),

  lowCtr: topQueries
    .filter((s) => s.pos28 != null && s.pos28 <= 10.5 && s.impressions28 >= 50 && (s.ctr28 ?? 0) < expectedCtr(s.pos28) * 0.5)
    .sort((a, b) => b.impressions28 - a.impressions28)
    .slice(0, 30)
    .map((s) => ({ ...s, expected: expectedCtr(s.pos28!), page: bestPage.get(s.keyword) ?? null })),

  cannibal: (() => {
    const by = new Map<string, { page: string; clicks: number; impressions: number; position: number }[]>();
    for (const [q, p, c, i, pos] of qp.rows) {
      if (!by.has(q)) by.set(q, []);
      by.get(q)!.push({ page: p, clicks: c, impressions: i, position: pos });
    }
    const out: { query: string; impressions: number; pages: { page: string; clicks: number; impressions: number; position: number }[] }[] = [];
    for (const [q, list] of by) {
      const total = list.reduce((s, x) => s + x.impressions, 0);
      const significant = list.filter((x) => x.impressions / total >= 0.15 && x.impressions >= 5);
      if (total >= 20 && significant.length >= 2) out.push({ query: q, impressions: total, pages: significant.sort((a, b) => b.impressions - a.impressions) });
    }
    return out.sort((a, b) => b.impressions - a.impressions).slice(0, 20);
  })(),
};

// ---------- Google Suggest ----------
const suggestLatest = readJson<{ date?: string; items: Record<string, string[]> }>(path.join(DATA_DIR, 'suggest', 'latest.json'), { items: {} });
const suggestSeen = readJson<Record<string, string>>(path.join(DATA_DIR, 'suggest', 'seen.json'), {});
export const suggest = (() => {
  const known = new Set(byNorm.keys());
  const newSince = suggestLatest.date ? addDays(suggestLatest.date, -14) : '';
  const items = Object.entries(suggestLatest.items).map(([s, seeds]) => {
    const n = norm(s);
    const first = suggestSeen[n] || '';
    return {
      text: s,
      seeds,
      covered: known.has(n), // tu as déjà eu des impressions sur cette requête exacte
      isNew: !!first && !first.endsWith('*') && first >= newSince,
      words: s.split(/\s+/).length,
    };
  });
  return {
    date: suggestLatest.date ?? null,
    total: items.length,
    fresh: items.filter((x) => x.isNew).sort((a, b) => a.text.localeCompare(b.text, 'fr')),
    gaps: items.filter((x) => !x.covered && x.words >= 3).sort((a, b) => b.words - a.words || a.text.localeCompare(b.text, 'fr')),
  };
})();

// ---------- concurrents ----------
interface CompStore {
  domain: string;
  label: string;
  baselineDate: string;
  lastCheck: string;
  errors?: string[];
  history: [string, number, number, number][];
  urls: Record<string, { f: string; m: string | null; b?: 1; t?: string; g?: string }>;
}
export const competitors = (settings.competitors || []).map((c) => {
  const s = readJson<CompStore | null>(path.join(DATA_DIR, 'competitors', `${c.domain}.json`), null);
  const step = meta.steps[`competitor:${c.domain}`];
  if (!s) return { domain: c.domain, label: c.label || c.domain, ok: false as const, pending: !step, error: step?.message ?? 'pas encore collecté (première collecte cette nuit)' };
  const ref = s.lastCheck;
  const since30 = addDays(ref, -30);
  const entries = Object.entries(s.urls);
  const live = entries.filter(([, u]) => !u.g);
  const newPages = entries
    .filter(([, u]) => !u.b && u.f >= since30)
    .map(([url, u]) => ({ url, first: u.f, title: u.t ?? null, gone: u.g ?? null }))
    .sort((a, b) => b.first.localeCompare(a.first));
  const updated = live
    .filter(([, u]) => u.m && u.m >= since30 && u.m <= ref)
    .map(([url, u]) => ({ url, lastmod: u.m!, title: u.t ?? null }))
    .sort((a, b) => b.lastmod.localeCompare(a.lastmod));
  // Activité par semaine sur 12 semaines, d'après la date de dernière modification déclarée dans le sitemap
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const end = addDays(ref, -7 * (11 - i));
    const start = addDays(end, -6);
    return { start, count: live.filter(([, u]) => u.m && u.m >= start && u.m <= end).length };
  });
  const removed = entries.filter(([, u]) => u.g && u.g >= since30).length;
  return {
    domain: c.domain,
    label: c.label || s.label || c.domain,
    ok: true as const,
    stale: step?.status === 'error' ? step.message : null,
    lastCheck: s.lastCheck,
    baselineDate: s.baselineDate,
    total: live.length,
    newPages,
    new7: newPages.filter((p) => p.first >= addDays(ref, -7)).length,
    updated,
    weeks,
    removed,
  };
});
