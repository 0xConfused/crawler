// SPDX-License-Identifier: AGPL-3.0-or-later

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'dev-cors-proxy',
        configureServer(server) {
          server.middlewares.use('/api/proxy', async (req, res) => {
            const rawUrl = req.url || '';
            const queryIndex = rawUrl.indexOf('?');
            const search = queryIndex !== -1 ? rawUrl.slice(queryIndex) : rawUrl;
            const params = new URLSearchParams(search);
            const target = params.get('url');

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
            res.setHeader('Access-Control-Allow-Headers', '*');

            if (req.method === 'OPTIONS') {
              res.statusCode = 204;
              res.end();
              return;
            }

            if (!target) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing target url parameter' }));
              return;
            }

            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 12000);
              const upstream = await fetch(target, {
                signal: controller.signal,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
              });
              clearTimeout(timeout);

              res.statusCode = upstream.status;
              const ct = upstream.headers.get('content-type') || 'text/html';
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.setHeader('X-Proxied-Content-Type', ct);

              const buffer = await upstream.arrayBuffer();
              res.end(Buffer.from(buffer));
            } catch (err: any) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message || 'Upstream fetch failure' }));
            }
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: false,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});

