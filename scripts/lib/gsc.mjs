import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, isoDay, addDays, dayRange } from './util.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const ROW_LIMIT = 25000;

export async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === 'invalid_grant') {
      throw new Error(
        "Jeton Google expiré ou révoqué. Relance « npm run auth » sur ton ordinateur et remplace le secret GOOGLE_REFRESH_TOKEN dans GitHub. " +
          "Si ça se reproduit chaque semaine, ton application OAuth est restée en mode « Test » : passe-la « En production » (voir le README)."
      );
    }
    throw new Error(`Connexion Google refusée (${res.status}) : ${json.error_description || json.error || 'erreur inconnue'}`);
  }
  return json.access_token;
}

export async function listSites(token) {
  const res = await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`Search Console : ${json.error?.message || res.status}`);
  return (json.siteEntry || []).map((s) => ({ url: s.siteUrl, permission: s.permissionLevel }));
}

/** Interroge searchAnalytics.query en paginant jusqu'à la dernière ligne. */
export async function querySA(token, property, body) {
  const url = `${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const rows = [];
  for (let startRow = 0; ; startRow += ROW_LIMIT) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'web', rowLimit: ROW_LIMIT, startRow, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.error?.message || `HTTP ${res.status}`;
      if (res.status === 403) {
        const sites = await listSites(token).catch(() => []);
        const list = sites.length ? sites.map((s) => s.url).join(', ') : 'aucune';
        throw new Error(`Accès refusé à la propriété « ${property} ». Propriétés accessibles avec ce compte : ${list}. Corrige gscProperty dans config/settings.json.`);
      }
      throw new Error(`Search Console : ${msg}`);
    }
    const batch = json.rows || [];
    rows.push(...batch);
    if (batch.length < ROW_LIMIT) break;
  }
  return rows;
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Met à jour des fichiers mensuels { "AAAA-MM-JJ": [[clé, clics, impressions, position], …] }.
 * Chaque jour de la fenêtre est remplacé en entier (ou supprimé s'il n'a plus de données).
 */
function upsertMonthly(dir, days, rowsByDay) {
  const byMonth = new Map();
  for (const day of days) {
    const m = day.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(day);
  }
  for (const [month, monthDays] of byMonth) {
    const file = path.join(dir, `${month}.json`);
    const data = readJson(file, {});
    for (const day of monthDays) {
      const rows = rowsByDay.get(day);
      if (rows?.length) data[day] = rows.sort((a, b) => b[2] - a[2]);
      else delete data[day];
    }
    const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
    writeJson(file, sorted);
  }
}

function groupByDay(rows) {
  const map = new Map();
  for (const r of rows) {
    const [day, key] = r.keys;
    if (!map.has(day)) map.set(day, []);
    map.get(day).push([key, r.clicks, r.impressions, r1(r.position)]);
  }
  return map;
}

export async function collectGsc({ settings, dataDir, env, log }) {
  const token = await getAccessToken({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
  });
  const property = env.GSC_PROPERTY || settings.gscProperty;
  const gscDir = path.join(dataDir, 'gsc');
  const totalsFile = path.join(gscDir, 'totals.json');
  const totals = readJson(totalsFile, []);
  const firstRun = totals.length === 0;

  // Les données de la Search Console ont 2 à 3 jours de retard :
  // on recharge les 10 derniers jours à chaque passage pour récupérer les valeurs définitives.
  const end = isoDay(-1);
  const recent = addDays(end, -9);
  const histStart = firstRun ? addDays(end, -(settings.historyDays || 480) + 1) : recent;
  const queryStart = firstRun ? addDays(end, -(settings.queryHistoryDays || 90) + 1) : recent;
  log(`Search Console « ${property} » : ${firstRun ? 'premier chargement de l’historique' : 'mise à jour des 10 derniers jours'}`);

  // 1. Totaux du site par jour (inclut les requêtes anonymisées, contrairement au détail par requête)
  const totalRows = await querySA(token, property, { startDate: histStart, endDate: end, dimensions: ['date'] });
  const totalsMap = new Map(totals.map((t) => [t[0], t]));
  for (const d of dayRange(histStart, end)) totalsMap.delete(d);
  for (const r of totalRows) totalsMap.set(r.keys[0], [r.keys[0], r.clicks, r.impressions, r1(r.position)]);
  const newTotals = [...totalsMap.values()].sort((a, b) => a[0].localeCompare(b[0]));
  writeJson(totalsFile, newTotals);

  // 2. Pages par jour
  const pageRows = await querySA(token, property, { startDate: histStart, endDate: end, dimensions: ['date', 'page'] });
  upsertMonthly(path.join(gscDir, 'pages'), dayRange(histStart, end), groupByDay(pageRows));

  // 3. Requêtes par jour
  const queryRows = await querySA(token, property, { startDate: queryStart, endDate: end, dimensions: ['date', 'query'] });
  upsertMonthly(path.join(gscDir, 'queries'), dayRange(queryStart, end), groupByDay(queryRows));

  // 4. Couples requête × page sur 28 jours (cannibalisation, pages en concurrence)
  const qpStart = addDays(end, -27);
  const qpRows = await querySA(token, property, { startDate: qpStart, endDate: end, dimensions: ['query', 'page'] });
  writeJson(path.join(gscDir, 'query-page-28d.json'), {
    start: qpStart,
    end,
    rows: qpRows.map((r) => [r.keys[0], r.keys[1], r.clicks, r.impressions, r1(r.position)]),
  });

  // Ménage : on garde 13 mois de détail par requête
  const qDir = path.join(gscDir, 'queries');
  const oldest = addDays(end, -400).slice(0, 7);
  for (const f of fs.existsSync(qDir) ? fs.readdirSync(qDir) : []) {
    if (f.endsWith('.json') && f.slice(0, 7) < oldest) fs.unlinkSync(path.join(qDir, f));
  }

  return {
    property,
    lastDate: newTotals.at(-1)?.[0] || null,
    days: newTotals.length,
    pageRows: pageRows.length,
    queryRows: queryRows.length,
  };
}
