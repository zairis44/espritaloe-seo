/**
 * Middleware Vercel (Routing Middleware) : protège tout le tableau de bord par mot de passe.
 * Le mot de passe se règle dans Vercel → Settings → Environment Variables → DASHBOARD_PASSWORD.
 * Identifiant : n'importe lequel (ex. « rafael »). Utilise un mot de passe sans accents.
 */
import { next } from '@vercel/functions';

export const config = { matcher: '/:path*' };

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default function middleware(request) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return new Response('Tableau de bord verrouillé : la variable DASHBOARD_PASSWORD n’est pas définie dans Vercel.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const [scheme, encoded] = (request.headers.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    try {
      const decoded = atob(encoded);
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(password, expected)) return next({ headers: { 'x-robots-tag': 'noindex, nofollow' } });
    } catch {
      /* en-tête mal formé : on redemande */
    }
  }
  return new Response('Accès réservé.', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="SEO Esprit Aloe", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' },
  });
}
