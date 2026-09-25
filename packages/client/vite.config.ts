import { defineConfig } from 'vite';

/**
 * GitHub Pages project sites are served from /<repo>/, so the build needs a matching `base`
 * or every asset 404s. Deriving it from GITHUB_REPOSITORY (set by Actions) means nothing is
 * hardcoded; locally the variable is unset, so dev and preview stay at the root.
 */
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  base: repository ? `/${repository}/` : '/',
  build: {
    target: 'es2022',
  },
  server: {
    port: 5173,
  },
});
