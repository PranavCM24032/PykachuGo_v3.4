import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function resolveSiteOrigin(): string {
  const raw =
    process.env.VITE_SITE_URL ||
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    process.env.URL ||
    process.env.CF_PAGES_URL ||
    process.env.APP_URL ||
    '';

  const cleaned = raw.trim().replace(/\/+$/, '');
  if (cleaned.startsWith('https://ais-dev-')) {
    return cleaned.replace('https://ais-dev-', 'https://ais-pre-');
  }
  return cleaned || 'https://pykachugov34.vercel.app';
}

function ogMetaOriginPlugin(): Plugin {
  return {
    name: 'og-meta-origin',
    transformIndexHtml(html) {
      return html.replace(/__SITE_URL__/g, resolveSiteOrigin());
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), ogMetaOriginPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
