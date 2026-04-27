import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://fanfiction.fyi',
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
      persist: true,
    },
  }),
  integrations: [
    preact({
      compat: true,
    }),
  ],
  vite: {
    ssr: {
      noExternal: ['@material/web'],
    },
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
  },
});