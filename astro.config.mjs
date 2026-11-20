import { defineConfig } from 'astro/config';

// Site 100 % statique : les données sont lues au moment du build.
// La protection par mot de passe est assurée par middleware.js (Vercel).
export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'always' },
});
