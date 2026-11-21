// Shared test harness. No side effects on import: call start() from a test file.
// Every test file runs in its own process (node --test), so each gets a fresh temp DATA_DIR.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const server = (p) => new URL(`../server/${p}`, import.meta.url).href;

// Point the app at a throwaway data dir and make any uncached LLM call fail fast (budget 0),
// so tests never reach the real Gemini API. Must run before any server module is imported.
export function isolateEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brim-test-'));
  process.env.DATA_DIR = dir;
  delete process.env.DB_PATH;
  process.env.LLM_BUDGET_USD = '0';
  return dir;
}

export const load = (p) => import(server(p));

// Boot the app (seed + process the sample inbox) and listen on a random port.
export async function start({ processIncoming = true } = {}) {
  const dataDir = isolateEnv();
  const log = console.log;
  console.log = () => {};
  try {
    const { boot, createApp } = await load('index.js');
    await boot({ processIncoming });
    const srv = createApp().listen(0);
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}/api`;
    const tokens = new Map();

    async function login(userId) {
      if (tokens.has(userId)) return tokens.get(userId);
      const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: userId }) });
      if (r.status !== 200) throw new Error(`login ${userId} -> ${r.status}`);
      const { token } = await r.json();
      tokens.set(userId, token);
      return token;
    }

    // as('U004').get('/invoices') -> { status, body }
    function as(userId) {
      const call = async (method, p, body) => {
        const token = await login(userId);
        const r = await fetch(base + p, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await r.text();
        let json = null;
        try { json = JSON.parse(text); } catch { json = text; }
        return { status: r.status, body: json };
      };
      return {
        get: (p) => call('GET', p),
        post: (p, b = {}) => call('POST', p, b),
        patch: (p, b = {}) => call('PATCH', p, b),
        put: (p, b = {}) => call('PUT', p, b),
        del: (p) => call('DELETE', p),
      };
    }

    async function stop() {
      await new Promise((r) => srv.close(r));
      srv.closeAllConnections?.();
      const { closeDb } = await load('db.js');
      closeDb();
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows may hold the WAL briefly */ }
    }

    return { base, login, as, stop, dataDir };
  } finally {
    console.log = log;
  }
}

// Find a sample-batch invoice by its printed number.
export async function findNew(api, number) {
  const { body } = await api.get(`/invoices?source=new&q=${encodeURIComponent(number)}`);
  const hit = body.find((i) => i.vendor_invoice_number === number);
  if (!hit) throw new Error(`sample invoice #${number} not found`);
  return hit;
}
