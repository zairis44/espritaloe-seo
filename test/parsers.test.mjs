import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSitemap, extractTitle, decodeXml } from '../scripts/lib/sitemaps.mjs';
import { parseSuggest } from '../scripts/lib/suggest.mjs';
import { norm, dayRange, addDays } from '../scripts/lib/util.mjs';

test('sitemap index (Yoast / Wix)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://ex.fr/post-sitemap.xml</loc><lastmod>2026-11-07T10:00:00+00:00</lastmod></sitemap>
  <sitemap>
    <loc><![CDATA[https://ex.fr/page-sitemap.xml]]></loc>
  </sitemap>
</sitemapindex>`;
  assert.deepEqual(parseSitemap(xml), { type: 'index', sitemaps: ['https://ex.fr/post-sitemap.xml', 'https://ex.fr/page-sitemap.xml'] });
});

test('urlset avec préfixes, entités et lastmod complet', () => {
  const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url><loc>https://ex.fr/post/c9-avis?a=1&amp;b=2</loc><lastmod>2026-11-05T08:12:00Z</lastmod>
<image:image><image:loc>https://ex.fr/i.jpg</image:loc></image:image></url>
<url><loc> https://ex.fr/sans-date </loc></url>
</urlset>`;
  assert.deepEqual(parseSitemap(xml), {
    type: 'urlset',
    urls: [
      { loc: 'https://ex.fr/post/c9-avis?a=1&b=2', lastmod: '2026-11-05' },
      { loc: 'https://ex.fr/sans-date', lastmod: null },
    ],
  });
});

test('format inconnu', () => {
  assert.equal(parseSitemap('<html><body>404</body></html>').type, 'unknown');
});

test('titre de page', () => {
  assert.equal(extractTitle('<head><title>\n C9 Forever : avis &amp; prix \n</title></head>'), 'C9 Forever : avis & prix');
  assert.equal(extractTitle('<h1 class="x">Avis <span>C9</span></h1>'), 'Avis C9');
  assert.equal(decodeXml('&#233;t&#xE9;'), 'été');
});

test('Google Suggest', () => {
  assert.deepEqual(parseSuggest('["aloe vera",["aloe vera bienfaits","aloe vera cheveux"]]'), ['aloe vera bienfaits', 'aloe vera cheveux']);
  assert.deepEqual(parseSuggest('["x",[]]'), []);
});

test('normalisation des requêtes', () => {
  assert.equal(norm('  Déodorant  FOREVER   Aloe '), 'deodorant forever aloe');
  assert.equal(norm("c9 forever avis négatif"), norm('C9 Forever Avis Negatif'));
  assert.equal(norm("l'aloe vera"), 'l aloe vera');
});

test('dates', () => {
  assert.deepEqual(dayRange('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});
