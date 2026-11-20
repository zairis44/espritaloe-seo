import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const UA = 'EspritAloeSEOBot/1.0 (+https://espritaloe.fr)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Fichier JSON illisible : ${file} (${e.message})`);
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data) + '\n');
}

/** Date UTC au format AAAA-MM-JJ, décalée de `offset` jours. */
export function isoDay(offset = 0, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

export function dayRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Minuscules, sans accents, espaces normalisés : sert à comparer des requêtes. */
export function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Charge .env.local (pour lancer la collecte sur ta machine). */
export function loadEnvLocal() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/**
 * Récupère une ressource texte. Décompresse les fichiers .gz,
 * respecte le charset annoncé, réessaie deux fois en cas d'erreur réseau.
 */
export async function fetchText(url, { timeout = 20000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: '*/*', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const body = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
      const ct = res.headers.get('content-type') || '';
      const charset = (ct.match(/charset=([^;]+)/i)?.[1] || 'utf-8').trim().toLowerCase();
      let text;
      try {
        text = new TextDecoder(charset).decode(body);
      } catch {
        text = new TextDecoder('utf-8').decode(body);
      }
      return { status: res.status, ok: res.ok, url: res.url, text };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error(`${url} : ${lastErr?.message || lastErr}`);
}
