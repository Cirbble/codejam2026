import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHOTO_DIR } from './store.js';

/** 240 px wide JPEG thumbnails next to the photos: p/<id>_w240.jpg. Made on save, or lazily for older cards. */
export const THUMB_W = 240;
export const thumbPath = (id: string) => join(PHOTO_DIR, `${id}_w${THUMB_W}.jpg`);

let sharpMod: any | null | undefined;
async function sharp(): Promise<any | null> {
  if (sharpMod === undefined) {
    try {
      sharpMod = (await import('sharp')).default;
    } catch (e) {
      console.warn('[thumbs] sharp unavailable, serving full photos:', (e as Error).message);
      sharpMod = null;
    }
  }
  return sharpMod;
}

const inflight = new Map<string, Promise<Buffer | null>>();

/** The thumbnail for a card, generating it if needed. null when it can't be made (caller serves the full photo). */
export function thumbnail(id: string): Promise<Buffer | null> {
  const out = thumbPath(id);
  if (existsSync(out)) {
    try {
      return Promise.resolve(readFileSync(out));
    } catch {}
  }
  let p = inflight.get(id);
  if (!p) {
    p = (async () => {
      const full = join(PHOTO_DIR, `${id}.jpg`);
      const s = await sharp();
      if (!s || !existsSync(full)) return null;
      try {
        const buf: Buffer = await s(readFileSync(full)).rotate().resize({ width: THUMB_W, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
        const tmp = `${out}.${process.pid}.tmp`;
        writeFileSync(tmp, buf);
        renameSync(tmp, out);
        return buf;
      } catch (e) {
        console.warn('[thumbs] failed for', id, (e as Error).message);
        return null;
      }
    })().finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}
