# SEO Esprit Aloé : tableau de bord privé

Ton outil SEO maison pour **espritaloe.fr**. Il a trois parties :

- **Positions** : tes vraies positions Google, issues de la Search Console. Tu suis tes mots-clés et vois ce qui monte et ce qui descend.
- **Concurrents** : les nouvelles pages et les mises à jour de aloe-vera-pour-tous, aloeveragel, aloeveraforever et ghaloe, relevées dans leurs sitemaps.
- **Idées** : tes requêtes en page 2, les titres à retravailler, les pages qui se font concurrence et les recherches Google où tu n'apparais pas encore.

Chaque nuit, GitHub Actions collecte les données et les enregistre dans `data/`. Vercel reconstruit alors le tableau de bord, qui reste protégé par un mot de passe. Tout est gratuit.

```
GitHub Actions (chaque nuit) ──► data/*.json ──► Vercel rebuild ──► tableau de bord (mot de passe)
   ├─ Search Console API (lecture seule)
   ├─ sitemaps des 4 concurrents
   └─ Google Suggest (une fois par semaine)
```

Ce repo est **séparé** du site `mon-aloe-site` : il ne touche ni au site public ni à son SEO.

---

## Installation sans terminal (environ 30 minutes, une seule fois)

Tout se fait dans le navigateur. Claude pousse le code et s'occupe ensuite des analyses et des mises à jour depuis le chat.

### 1. Créer le repo GitHub vide (privé)

Sur github.com : **New repository** → nom `espritaloe-seo` → **Private** → **sans** README ni .gitignore → **Create repository**.
Préviens ensuite Claude dans le chat : il y envoie tout le code.

### 2. Créer l'accès Google (lecture seule)

1. Va sur https://console.cloud.google.com et crée un projet nommé `espritaloe-seo`.
2. Dans **API et services → Bibliothèque**, cherche **Google Search Console API**, puis clique sur **Activer**.
3. Ouvre **Google Auth Platform** (ou **Écran de consentement OAuth**) :
   - Type d'utilisateur : **Externe**. Nom : `SEO Esprit Aloé`. E-mail : le tien.
   - Dans **Audience**, clique sur **Publier l'application** pour la passer **En production**.
     ⚠️ C'est indispensable. En mode « Test », Google coupe l'accès au bout de 7 jours. Tu n'as pas besoin de faire valider l'application.
4. Dans **Clients** (ou **Identifiants → Créer des identifiants → ID client OAuth**) :
   - Type d'application : **Application Web**. Nom : `collecte`.
   - **URI de redirection autorisés** : `https://developers.google.com/oauthplayground`
   - Clique sur **Créer** et garde l'**ID client** et le **Code secret** sous la main.

### 3. Récupérer le jeton avec l'OAuth Playground

1. Ouvre https://developers.google.com/oauthplayground
2. Clique sur la roue dentée ⚙️ en haut à droite, coche **Use your own OAuth credentials**, puis colle l'ID client et le code secret.
3. À gauche, dans le champ **Input your own scopes**, colle `https://www.googleapis.com/auth/webmasters.readonly` puis clique sur **Authorize APIs**.
4. Connecte-toi avec le compte de la Search Console. Google affiche « Google n'a pas validé cette application » : clique sur **Paramètres avancés**, puis **Accéder à SEO Esprit Aloé**, et autorise.
5. À l'étape 2, clique sur **Exchange authorization code for tokens** et copie le **Refresh token** (il commence par `1//`).

### 4. Ajouter les secrets dans GitHub

Dans le repo `espritaloe-seo`, va dans **Settings → Secrets and variables → Actions → New repository secret** et crée ces trois secrets :

| Nom | Valeur |
|---|---|
| `GOOGLE_CLIENT_ID` | l'ID client (étape 2) |
| `GOOGLE_CLIENT_SECRET` | le code secret (étape 2) |
| `GOOGLE_REFRESH_TOKEN` | le refresh token (étape 3) |

### 5. Déployer sur Vercel

1. Sur Vercel : **Add New → Project**, puis importe `espritaloe-seo`. Vercel détecte Astro tout seul.
2. Ouvre **Environment Variables** et ajoute `DASHBOARD_PASSWORD` avec un mot de passe **sans accents**.
3. Clique sur **Deploy**. L'identifiant peut être n'importe quoi ; le mot de passe est celui de `DASHBOARD_PASSWORD`. Ajoute la page à l'écran d'accueil de ton téléphone.

### 6. Première collecte

Dans GitHub, va dans **Actions → Collecte SEO → Run workflow**, ou demande-le simplement à Claude. Ensuite, la collecte tourne toute seule chaque nuit.
La propriété Search Console réglée par défaut est `sc-domain:espritaloe.fr`. Si ce n'est pas la bonne, la collecte affiche la liste exacte de tes propriétés et Claude corrige le réglage.

## Piloter depuis le chat avec Claude

Plus besoin de commandes. Demande simplement :
- « Fais-moi le point SEO de la semaine » : Claude lit les données du repo et les croise au besoin avec Semrush ou Ubersuggest.
- « Suis aussi le mot-clé X » ou « ajoute tel concurrent » : Claude modifie la configuration et pousse. Le tableau de bord se met à jour en 1 à 2 minutes.
- « Relance une collecte » : Claude modifie `.github/collect-now`, ce qui déclenche la collecte tout de suite.
- « Écris l'article pour la requête en page 2 X » : Claude passe ensuite au repo du site.

Le mode d'emploi détaillé pour Claude est dans le document de projet `claude/outil-seo-mode-emploi.md`.

## Au quotidien

- **Suivre un mot-clé** : ajoute-le dans `config/keywords.json`, puis commite et pousse. Il apparaît avec son historique sur 90 jours.
- **Changer de concurrents** : modifie la liste `competitors` dans `config/settings.json`.
- **Pages gelées** (fenêtre de mesure en cours) : ajoute leur chemin dans `"frozenPages"`, par exemple `"/blog/forever-living-avis-produits-france/"`. Elles portent alors un badge « gelée » dans les idées.
- **Graines Google Suggest** : modifie `suggest.seeds` dans `config/settings.json`.
- **En cas d'erreur** : GitHub t'envoie un e-mail, et un bandeau rouge en haut du tableau de bord donne la cause.
  - « Jeton Google expiré » : relance `npm run auth` et remplace le secret `GOOGLE_REFRESH_TOKEN`.
  - Si ça arrive chaque semaine, l'application est restée en mode Test (voir l'étape 2.3).

## Bon à savoir

- **La Search Console a 2 à 3 jours de retard.** Le tableau de bord s'arrête donc au dernier jour complet. Chaque nuit, la collecte recharge aussi les 10 derniers jours pour récupérer les valeurs définitives.
- **Les positions sont des moyennes** (tous pays, tous appareils), pondérées par les impressions. Un mot-clé « pas visible » n'a eu aucune impression sur 28 jours.
- **Pour les concurrents, on ne voit que ce qu'ils déclarent dans leurs sitemaps** : pages ajoutées, retirées et dates de modification. Le premier relevé sert de référence ; les « nouvelles pages » apparaissent à partir du lendemain. On ne voit pas encore leurs positions : ce sera l'étape DataForSEO.
- **Google Suggest** passe par l'adresse publique d'autocomplétion de Google, interrogée une fois par semaine avec des pauses entre les requêtes. Cette adresse n'est pas officiellement documentée : si Google la change, cette partie s'arrêtera sans bloquer le reste.

## Plus tard : positions des concurrents (DataForSEO)

Il faudra :
1. Ouvrir un compte DataForSEO (dépôt minimum de 50 $, à environ 1 $ par mois pour 50 mots-clés suivis chaque jour).
2. Ajouter deux secrets, `DATAFORSEO_LOGIN` et `DATAFORSEO_PASSWORD`.
3. Ajouter un module `scripts/lib/serp.mjs`, sur le même modèle que les autres, et une colonne par concurrent dans la page Positions.

## Structure

```
config/            → réglages (propriété GSC, concurrents, graines, mots-clés suivis)
scripts/collect.mjs → collecte (Node pur, sans dépendance)
scripts/auth.mjs    → connexion Google en ligne de commande (facultatif)
scripts/report.mjs  → résumé texte pour les analyses dans le chat
scripts/lib/        → Search Console, sitemaps, Google Suggest
data/               → données collectées (écrites par GitHub Actions)
src/                → tableau de bord Astro (4 pages, presque sans JavaScript)
middleware.js       → mot de passe (Vercel)
test/               → tests des analyseurs : npm test
```

## Annexe : même chose en ligne de commande (facultatif)

```bash
npm install
npm run demo                                   # aperçu avec des données fictives
npm run auth -- ~/Downloads/client_secret.json # client « Application de bureau » : jeton + liste des propriétés
npm run collect                                # collecte locale (lit .env.local)
npm run dev                                    # http://localhost:4321
node scripts/report.mjs                        # résumé texte des données
```
