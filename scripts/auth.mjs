#!/usr/bin/env node
/**
 * À lancer UNE fois sur ton ordinateur : npm run auth -- chemin/vers/client_secret.json
 * Ouvre la page de connexion Google, récupère un jeton de rafraîchissement en lecture seule
 * sur la Search Console, affiche tes propriétés et écrit .env.local (jamais envoyé sur GitHub).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT } from './lib/util.mjs';
import { listSites } from './lib/gsc.mjs';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function loadClient() {
  const file = process.argv[2];
  if (file) {
    const json = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const c = json.installed || json.web;
    if (!c) throw new Error('Ce fichier ne ressemble pas à un identifiant OAuth « Application de bureau ».');
    return { clientId: c.client_id, clientSecret: c.client_secret };
  }
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
  }
  throw new Error('Usage : npm run auth -- chemin/vers/client_secret.json');
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* l'URL est affichée de toute façon */
  }
}

const { clientId, clientSecret } = loadClient();
const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const server = http.createServer();
server.listen(0, '127.0.0.1', () => {
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
  console.log('\nOuvre cette adresse si le navigateur ne s’ouvre pas tout seul :\n\n' + authUrl + '\n');
  openBrowser(authUrl);

  server.on('request', async (req, res) => {
    const url = new URL(req.url, redirectUri);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
      res.writeHead(404).end();
      return;
    }
    const finish = (msg, code = 0) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<p style="font:16px system-ui;padding:2rem">${msg}</p>`);
      server.close();
      setTimeout(() => process.exit(code), 100);
    };
    try {
      if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
      if (url.searchParams.get('state') !== state) throw new Error('Réponse inattendue (state différent)');
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: url.searchParams.get('code'),
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok || !tokens.refresh_token) throw new Error(tokens.error_description || tokens.error || 'pas de refresh_token reçu');

      const sites = await listSites(tokens.access_token);
      console.log('Tes propriétés Search Console :');
      for (const s of sites) console.log(`  • ${s.url}  (${s.permission})`);
      console.log('\n→ Recopie la bonne dans config/settings.json, champ "gscProperty".\n');

      fs.writeFileSync(
        path.join(ROOT, '.env.local'),
        `GOOGLE_CLIENT_ID=${clientId}\nGOOGLE_CLIENT_SECRET=${clientSecret}\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`
      );
      console.log('Les 3 valeurs à coller dans GitHub (Settings → Secrets and variables → Actions) :\n');
      console.log(`GOOGLE_CLIENT_ID      = ${clientId}`);
      console.log(`GOOGLE_CLIENT_SECRET  = ${clientSecret}`);
      console.log(`GOOGLE_REFRESH_TOKEN  = ${tokens.refresh_token}\n`);
      console.log('Elles sont aussi enregistrées dans .env.local pour lancer « npm run collect » sur ta machine.');
      finish('C’est bon ✅ Tu peux fermer cet onglet et revenir au terminal.');
    } catch (e) {
      console.error('Échec : ' + e.message);
      finish('Échec : ' + e.message, 1);
    }
  });
});
