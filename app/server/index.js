import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config, appRoot } from './config.js';
import { authenticate } from './policy.js';
import { api } from './api.js';
import { get, getDb } from './db.js';
import { seedHistory } from './seed.js';
import { processInbox } from './services/ingest.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
  app.get('/healthz', (_req, res) => res.json({ ok: true, invoices: get('SELECT count(*) c FROM invoices').c }));
  app.use('/api', authenticate, api);
  const dist = path.join(appRoot, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}

export async function boot({ processIncoming = true } = {}) {
  getDb();
  const fresh = seedHistory();
  if (fresh && processIncoming) {
    const t = Date.now();
    const r = await processInbox({ actor: 'system' });
    console.log(`Seeded history and processed AP inbox in ${Date.now() - t} ms`, r.summary);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(appRoot, 'server', 'index.js')) {
  await boot();
  createApp().listen(config.port, () => console.log(`Brim AP listening on :${config.port}`));
}
