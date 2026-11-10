import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from './store.ts';
import * as ws from './workspace.ts';

export type ShareRecord = {
  token: string;
  uid: string;
  path: string;
  createdAt: number;
  expiresAt: number;
  downloads: number;
  revokedAt?: number;
};

const FILE = path.join(DATA_DIR, 'share-links.json');
let records: ShareRecord[] | null = null;
let queue: Promise<void> = Promise.resolve();

async function load(): Promise<ShareRecord[]> {
  if (records) return records;
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, 'utf8'));
    records = Array.isArray(parsed) ? parsed.filter((x: any) => x && typeof x.token === 'string' && typeof x.uid === 'string') : [];
  } catch (e: any) {
    if (e.code !== 'ENOENT') console.error('[share-links] Could not read link store:', e);
    records = [];
  }
  return records;
}

async function save() {
  const data = JSON.stringify(await load(), null, 2);
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${FILE}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  await fs.writeFile(temp, data, { mode: 0o600 });
  await fs.rename(temp, FILE);
}

function serializedSave() {
  queue = queue.then(save, save);
  return queue;
}

export async function createShare(uid: string, filePath: unknown, expiresInHours: unknown) {
  const file = await ws.rawFile(uid, filePath);
  const hours = typeof expiresInHours === 'number' && Number.isFinite(expiresInHours) ? Math.floor(expiresInHours) : 168;
  if (hours < 1 || hours > 720) throw new ws.WsError(400, 'مدة الرابط يجب أن تكون بين ساعة و30 يوماً');
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const item: ShareRecord = {
    token, uid, path: String(filePath), createdAt: now,
    expiresAt: now + hours * 60 * 60 * 1000, downloads: 0,
  };
  (await load()).push(item);
  await serializedSave();
  return { token, url: `/s/${token}`, name: file.name, size: file.size, expiresAt: item.expiresAt };
}

export async function listShares(uid: string) {
  return (await load()).filter(x => x.uid === uid).map(({ token, path: filePath, createdAt, expiresAt, downloads, revokedAt }) => ({
    token, path: filePath, url: `/s/${token}`, createdAt, expiresAt, downloads,
    status: revokedAt ? 'revoked' : expiresAt <= Date.now() ? 'expired' : 'active',
  })).sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeShare(uid: string, token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw new ws.WsError(400, 'رابط غير صالح');
  const item = (await load()).find(x => x.token === token && x.uid === uid);
  if (!item) throw new ws.WsError(404, 'الرابط غير موجود');
  item.revokedAt = Date.now();
  await serializedSave();
}

export async function resolveShare(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new ws.WsError(404, 'الرابط غير موجود');
  const item = (await load()).find(x => x.token === token);
  if (!item || item.revokedAt || item.expiresAt <= Date.now()) throw new ws.WsError(404, 'الرابط غير متاح أو انتهت صلاحيته');
  const file = await ws.rawFile(item.uid, item.path);
  item.downloads++;
  await serializedSave();
  return { ...file, token };
}
