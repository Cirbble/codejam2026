import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(here, '..');

function readKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const candidates = [
    process.env.GEMINI_API_KEY_FILE,
    path.resolve(appRoot, '..', '..', '.secrets', 'GEMINI_API_KEY'),
  ].filter(Boolean);
  for (const f of candidates) {
    try { const k = fs.readFileSync(f, 'utf8').trim(); if (k) return k; } catch { /* none */ }
  }
  return '';
}

const dataDir = process.env.DATA_DIR || path.join(appRoot, 'data');

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'brim.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  // LLM results are cached by file hash. The committed cache lets a fresh deploy
  // rebuild the sample batch without any API calls.
  llmCacheDir: process.env.LLM_CACHE_DIR || path.join(appRoot, 'cache', 'llm'),
  datasetDir: process.env.DATASET_DIR || path.resolve(appRoot, '..', 'challenge', 'dataset', 'brim_ap_dataset'),
  geminiKey: readKey(),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  // Hard ceiling on LLM spend per process (USD, estimated from token counts).
  llmBudgetUsd: Number(process.env.LLM_BUDGET_USD || 1.5),
  sessionSecret: process.env.SESSION_SECRET || 'brim-demo-secret-change-me',
  // "Today" for the demo. Defaults to the real date; the dataset's as-of date is 2026-11-02.
  today: process.env.AS_OF_DATE || null,
  // Harborline's own GST number; it appears on every bill-to block and must never be read as the vendor's.
  buyerTaxIds: ['100000001RT0001'],
  buyerName: 'Harborline Logistics Inc.',
};

export function today() {
  return config.today || new Date().toISOString().slice(0, 10);
}
export function nowIso() {
  return new Date().toISOString().slice(0, 19);
}
