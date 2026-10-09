import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
// Origin validation is compiled into the server manifest. Read only this public
// setting from the repository environment when building without --env-file.
const environmentFile = fileURLToPath(new URL('../../.env', import.meta.url));
const publicUrl = process.env.PUBLIC_URL || (existsSync(environmentFile) ? parse(readFileSync(environmentFile)).PUBLIC_URL : undefined);
const publicOrigin = publicUrl ? new URL(publicUrl) : null;
const allowedOrigins = ['http://localhost:4321', 'http://127.0.0.1:4321', 'https://pos.cashlessthailand.com', 'https://pay.cashlessthailand.com', ...(publicOrigin ? [publicOrigin.origin] : [])];
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: { port: 4321 },
  security: { checkOrigin: true, allowedDomains: [...new Set(allowedOrigins)].map(origin => { const url = new URL(origin); return { protocol: url.protocol.slice(0, -1), hostname: url.hostname, port: url.port }; }) },
  vite: { server: {
    fs: { strict: true, allow: ['src', 'node_modules', '../../node_modules'].map(path => fileURLToPath(new URL(path, import.meta.url))) },
    proxy: { '/api': { target: 'http://127.0.0.1:3001', ws: true } },
  } },
});
