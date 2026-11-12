import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, getDoc, authByUid, listDocs } from './store.ts';
import { readZipEntries, readEntryData, createZipWriter, ZipError } from './zip.ts';

// مساحة ملفات حقيقية لكل مستخدم أو لكل سيرفر: data/users_data/<hash>/

export class WsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MB = 1024 * 1024;
export const limits = {
  quota: (Number(process.env.USER_QUOTA_MB) || 500) * MB,
  maxUpload: (Number(process.env.MAX_UPLOAD_MB) || 100) * MB,
  maxEdit: 2 * MB,
  maxPreview: 1 * MB,
  trashDays: Number(process.env.TRASH_DAYS) || 30,
};

export const INTERNAL = '.far3on';
const USERS_ROOT = path.join(DATA_DIR, 'users_data');

export function userDir(uid: string): string {
  return path.join(USERS_ROOT, crypto.createHash('sha256').update(uid).digest('hex').slice(0, 24));
}

export const serverWorkspaceKey = (uid: string, serverId: string) => `${uid}::server::${serverId}`;

const workspaceMigrationLocks = new Map<string, Promise<void>>();

export async function initializeServerWorkspace(uid: string, serverId: string, copyLegacy = false): Promise<void> {
  const key = serverWorkspaceKey(uid, serverId);
  const target = userDir(key);
  const readyMarker = path.join(target, INTERNAL, 'workspace-ready');
  if (fs.existsSync(readyMarker)) return;
  const pending = workspaceMigrationLocks.get(key);
  if (pending) return pending;
  const task = (async () => {
    await fsp.mkdir(target, { recursive: true });
    if (copyLegacy) {
    const legacy = userDir(uid);
    let entries: fs.Dirent[] = [];
    try { entries = await fsp.readdir(legacy, { withFileTypes: true }); } catch {}
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.toLowerCase() === INTERNAL.toLowerCase()) continue;
      const from = path.join(legacy, entry.name);
      const to = path.join(target, entry.name);
      try { await fsp.cp(from, to, { recursive: true, force: false, errorOnExist: false }); }
      catch (e: any) { if (e.code !== 'EEXIST') throw e; }
    }
      // Preserve installed Python packages and recoverable deleted files,
      // but do not clone process flags or live logs between servers.
      for (const name of ['site-packages', 'trash']) {
        const from = path.join(legacy, INTERNAL, name);
        const to = path.join(target, INTERNAL, name);
        if (!fs.existsSync(from)) continue;
        try { await fsp.cp(from, to, { recursive: true, force: false, errorOnExist: false }); }
        catch (e: any) { if (e.code !== 'EEXIST') throw e; }
      }
    }
    await fsp.mkdir(path.dirname(readyMarker), { recursive: true });
    await fsp.writeFile(readyMarker, JSON.stringify({ uid, serverId, initializedAt: Date.now() }), { flag: 'w' });
  })();
  workspaceMigrationLocks.set(key, task);
  try { await task; } finally { workspaceMigrationLocks.delete(key); }
}

/** ترحيل الملفات الحالية مرة واحدة لكل سيرفر موجود قبل تفعيل العزل. */
export async function prepareServerWorkspaces(): Promise<void> {
  for (const [serverId, server] of listDocs('servers')) {
    if (typeof server.ownerId !== 'string') continue;
    await initializeServerWorkspace(server.ownerId, serverId, true);
  }
}

export const internalDir = (uid: string, ...parts: string[]) => path.join(userDir(uid), INTERNAL, ...parts);

// ---------------- التحقق من الأسماء والمسارات ----------------

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function checkName(name: string) {
  if (!name || name.length > 150) throw new WsError(400, 'Invalid name');
  if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) throw new WsError(400, 'The name contains characters that are not allowed');
  if (name === '.' || name === '..') throw new WsError(400, 'Invalid name');
  if (/[. ]$/.test(name)) throw new WsError(400, 'The name cannot end with a dot or a space');
  if (RESERVED.test(name)) throw new WsError(400, 'This name is reserved by the system');
  if (name.toLowerCase().startsWith(INTERNAL)) throw new WsError(403, 'This name is reserved');
}

export function segments(p: unknown): string[] {
  if (p === undefined || p === null || p === '') return [];
  if (typeof p !== 'string' || p.length > 1000 || p.includes('\0')) throw new WsError(400, 'Invalid path');
  const segs = p.split('/').filter(s => s !== '');
  if (segs.length > 30) throw new WsError(400, 'The path is too deep');
  segs.forEach(checkName);
  return segs;
}

export const joinRel = (segs: string[]) => segs.join('/');

async function ensureRoot(uid: string): Promise<string> {
  const root = userDir(uid);
  await fsp.mkdir(root, { recursive: true });
  return root;
}

/** يحوّل مسارًا نسبيًا إلى مسار حقيقي مع منع الروابط الرمزية والخروج من مجلد المستخدم */
async function resolve(uid: string, segs: string[]): Promise<string> {
  const root = await ensureRoot(uid);
  let cur = root;
  let checking = true;
  for (const s of segs) {
    cur = path.join(cur, s);
    if (!checking) continue;
    try {
      const st = await fsp.lstat(cur);
      if (st.isSymbolicLink()) throw new WsError(403, 'Symbolic links are not allowed');
    } catch (e: any) {
      if (e instanceof WsError) throw e;
      if (e.code === 'ENOENT') checking = false;
      else throw e;
    }
  }
  if (cur !== root && !cur.startsWith(root + path.sep)) throw new WsError(400, 'Invalid path');
  return cur;
}

async function statOrNull(full: string) {
  try { return await fsp.lstat(full); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}

// ---------------- أنواع الملفات ----------------

const TEXT_EXT = new Set([
  'py', 'pyw', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'txt', 'md', 'html', 'htm', 'css', 'php', 'sh', 'bat', 'cmd',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'log', 'csv', 'tsv', 'sql', 'xml', 'c', 'h', 'cpp', 'hpp', 'java', 'go',
  'rs', 'rb', 'lua', 'pl', 'r', 'kt', 'swift', 'gitignore', 'dockerfile', 'lock',
]);
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
};
export const RUNNABLE: Record<string, 'python' | 'node' | 'php'> = { py: 'python', pyw: 'python', js: 'node', mjs: 'node', php: 'php' };

export const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : (name.startsWith('.') ? name.slice(1).toLowerCase() : '');
};
export const imageMime = (name: string) => IMAGE_MIME[extOf(name)];

const looksBinary = (buf: Buffer) => buf.subarray(0, 8000).includes(0);

// ---------------- الكتابة الآمنة ----------------

async function atomicWrite(uid: string, full: string, data: Buffer | string) {
  const tmpDir = internalDir(uid, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  await fsp.writeFile(tmp, data);
  try {
    await fsp.rename(tmp, full);
  } catch (e: any) {
    // بعض الأنظمة (ويندوز) ترفض الاستبدال إذا كان الملف مفتوحًا، فنكتب مباشرة
    if (e.code === 'EXDEV' || e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') {
      await fsp.writeFile(full, data);
      await fsp.rm(tmp, { force: true });
    } else {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
  }
  invalidateUsage(uid);
}

// ---------------- المساحة ----------------

const usageCache = new Map<string, { at: number; bytes: number }>();
export const invalidateUsage = (uid: string) => { usageCache.delete(uid); };

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) { try { total += (await fsp.lstat(full)).size; } catch {} }
    }
  }
  return total;
}

export async function usage(uid: string): Promise<number> {
  const c = usageCache.get(uid);
  if (c && Date.now() - c.at < 20000) return c.bytes;
  const bytes = await dirSize(userDir(uid));
  usageCache.set(uid, { at: Date.now(), bytes });
  return bytes;
}

export const quotaFor = (uid: string): number => {
  const ownerUid = uid.split('::server::', 1)[0];
  return getDoc('users', ownerUid)?.role === 'admin' ? 0 : limits.quota;
};

async function ensureQuota(uid: string, extra: number) {
  const q = quotaFor(uid);
  if (q > 0 && (await usage(uid)) + extra > q) {
    throw new WsError(413, `Not enough storage space (limit ${Math.round(q / MB)} MB). Delete some files or empty the trash.`);
  }
}

// ---------------- القراءة ----------------

export interface Entry { name: string; type: 'dir' | 'file'; size: number; mtime: number }

export async function list(uid: string, p: unknown): Promise<Entry[]> {
  const segs = segments(p);
  const full = await resolve(uid, segs);
  const st = await statOrNull(full);
  if (!st) { if (!segs.length) return []; throw new WsError(404, 'Folder not found'); }
  if (!st.isDirectory()) throw new WsError(400, 'This is not a folder');
  const out: Entry[] = [];
  for (const e of await fsp.readdir(full, { withFileTypes: true })) {
    if (!segs.length && e.name.toLowerCase().startsWith(INTERNAL)) continue;
    if (e.isSymbolicLink()) continue;
    try {
      const s = await fsp.lstat(path.join(full, e.name));
      out.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', size: e.isDirectory() ? 0 : s.size, mtime: s.mtimeMs });
    } catch {}
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1));
  return out;
}

export interface FileInfo {
  name: string; path: string; size: number; mtime: number; ext: string;
  kind: 'text' | 'image' | 'binary' | 'large';
  content?: string; runnable: boolean; language?: string; isZip: boolean;
}

export async function readFile(uid: string, p: unknown): Promise<FileInfo> {
  const segs = segments(p);
  if (!segs.length) throw new WsError(400, 'Invalid path');
  const full = await resolve(uid, segs);
  const st = await statOrNull(full);
  if (!st) throw new WsError(404, 'File not found');
  if (!st.isFile()) throw new WsError(400, 'This is not a file');
  const name = segs[segs.length - 1];
  const ext = extOf(name);
  const info: FileInfo = {
    name, path: joinRel(segs), size: st.size, mtime: st.mtimeMs, ext, kind: 'binary',
    runnable: ext in RUNNABLE, language: RUNNABLE[ext], isZip: ext === 'zip',
  };
  if (imageMime(name)) { info.kind = 'image'; return info; }
  if (st.size > limits.maxPreview) { info.kind = TEXT_EXT.has(ext) ? 'large' : 'binary'; return info; }
  const buf = await fsp.readFile(full);
  if (looksBinary(buf)) return info;
  info.kind = 'text';
  info.content = buf.toString('utf8');
  return info;
}

export async function rawFile(uid: string, p: unknown) {
  const segs = segments(p);
  if (!segs.length) throw new WsError(400, 'Invalid path');
  const full = await resolve(uid, segs);
  const st = await statOrNull(full);
  if (!st || !st.isFile()) throw new WsError(404, 'File not found');
  return { full, size: st.size, name: segs[segs.length - 1] };
}

// ---------------- الكتابة والإنشاء ----------------

async function parentMustBeDir(uid: string, segs: string[]) {
  const parent = await resolve(uid, segs.slice(0, -1));
  const st = await statOrNull(parent);
  if (!st && segs.length > 1) throw new WsError(404, 'The parent folder does not exist');
  if (st && !st.isDirectory()) throw new WsError(400, 'The parent is not a folder');
  await fsp.mkdir(parent, { recursive: true });
}

export async function writeText(uid: string, p: unknown, content: unknown) {
  if (typeof content !== 'string') throw new WsError(400, 'Invalid content');
  const segs = segments(p);
  if (!segs.length) throw new WsError(400, 'Invalid path');
  const bytes = Buffer.byteLength(content);
  if (bytes > limits.maxEdit) throw new WsError(413, `The file is too large to save from the editor (limit ${limits.maxEdit / MB} MB)`);
  const full = await resolve(uid, segs);
  const st = await statOrNull(full);
  if (!st) throw new WsError(404, 'File not found');
  if (!st.isFile()) throw new WsError(400, 'This is not a file');
  await ensureQuota(uid, Math.max(0, bytes - st.size));
  await atomicWrite(uid, full, content);
}

export async function createFile(uid: string, p: unknown, content = '') {
  const segs = segments(p);
  if (!segs.length) throw new WsError(400, 'Invalid path');
  const full = await resolve(uid, segs);
  if (await statOrNull(full)) throw new WsError(409, 'A file or folder with this name already exists');
  await parentMustBeDir(uid, segs);
  await ensureQuota(uid, Buffer.byteLength(content));
  await atomicWrite(uid, full, content);
}

export async function makeDir(uid: string, p: unknown) {
  const segs = segments(p);
  if (!segs.length) throw new WsError(400, 'Invalid path');
  const full = await resolve(uid, segs);
  if (await statOrNull(full)) throw new WsError(409, 'A file or folder with this name already exists');
  await parentMustBeDir(uid, segs);
  await fsp.mkdir(full);
}

export async function rename(uid: string, from: unknown, to: unknown) {
  const a = segments(from);
  const b = segments(to);
  if (!a.length || !b.length) throw new WsError(400, 'Invalid path');
  if (joinRel(b).startsWith(joinRel(a) + '/')) throw new WsError(400, 'You cannot move a folder into itself');
  const fa = await resolve(uid, a);
  const fb = await resolve(uid, b);
  if (!(await statOrNull(fa))) throw new WsError(404, 'Not found');
  if (await statOrNull(fb)) throw new WsError(409, 'A file or folder with this name already exists');
  await parentMustBeDir(uid, b);
  await fsp.rename(fa, fb);
}

export async function upload(uid: string, dir: unknown, name: unknown, data: Buffer, overwrite: boolean) {
  if (typeof name !== 'string') throw new WsError(400, 'Invalid name');
  checkName(name);
  if (data.length > limits.maxUpload) throw new WsError(413, `The file is larger than the upload limit (${limits.maxUpload / MB} MB)`);
  const segs = [...segments(dir), name];
  const full = await resolve(uid, segs);
  const st = await statOrNull(full);
  if (st && !st.isFile()) throw new WsError(409, 'A folder with this name already exists');
  if (st && !overwrite) throw new WsError(409, 'exists');
  await parentMustBeDir(uid, segs);
  await ensureQuota(uid, data.length - (st?.size || 0));
  if (st) await moveToTrash(uid, segs); // لا نفقد النسخة القديمة أبدًا
  await atomicWrite(uid, full, data);
  return { path: joinRel(segs), size: data.length };
}

// ---------------- فك الضغط ----------------

export interface ExtractResult { files: number; dirs: number; skipped: Array<{ name: string; reason: string }> }

export async function extractZip(uid: string, destDir: unknown, zip: Buffer, overwrite: boolean): Promise<ExtractResult> {
  const destSegs = segments(destDir);
  const dest = await resolve(uid, destSegs);
  await fsp.mkdir(dest, { recursive: true });

  let entries;
  try { entries = readZipEntries(zip); } catch (e: any) { throw new WsError(400, e.message); }

  const total = entries.filter(e => !e.isDir).reduce((n, e) => n + e.size, 0);
  if (total > Math.max(limits.maxUpload * 4, 400 * MB)) throw new WsError(413, 'The extracted size is too large');
  await ensureQuota(uid, total);

  const res: ExtractResult = { files: 0, dirs: 0, skipped: [] };
  const skip = (name: string, reason: string) => { if (res.skipped.length < 50) res.skipped.push({ name, reason }); };

  for (const e of entries) {
    const clean = e.name.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(s => s !== '' && s !== '.');
    if (!clean.length) continue;
    if (clean[0] === '__MACOSX' || clean[clean.length - 1] === '.DS_Store') continue;
    if (clean.includes('..')) { skip(e.name, 'unsafe path'); continue; }
    if (e.isSymlink) { skip(e.name, 'symbolic link'); continue; }
    try { clean.forEach(checkName); } catch (err: any) { skip(e.name, err.message); continue; }

    const target = path.join(dest, ...clean);
    if (!target.startsWith(dest + path.sep)) { skip(e.name, 'unsafe path'); continue; }

    try {
      // تأكد أن أي مجلد موجود بالمسار ليس رابطًا رمزيًا
      await resolve(uid, [...destSegs, ...clean]);
      if (e.isDir) {
        await fsp.mkdir(target, { recursive: true });
        res.dirs++;
        continue;
      }
      const existing = await statOrNull(target);
      if (existing && !existing.isFile()) { skip(e.name, 'a folder with this name exists'); continue; }
      if (existing && !overwrite) { skip(e.name, 'already exists'); continue; }
      const data = readEntryData(zip, e);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      if (existing) await moveToTrash(uid, [...destSegs, ...clean]);
      await atomicWrite(uid, target, data);
      res.files++;
    } catch (err: any) {
      if (err instanceof WsError && err.status >= 500) throw err;
      skip(e.name, err instanceof ZipError || err instanceof WsError ? err.message : 'could not be written');
    }
  }
  invalidateUsage(uid);
  return res;
}

// ---------------- سلة المحذوفات ----------------

export interface TrashItem { id: string; name: string; originalPath: string; deletedAt: number; isDir: boolean; size: number }

const TRASH_ID = /^\d{10,}-[a-f0-9]{6}$/;

async function movePath(from: string, to: string) {
  try {
    await fsp.rename(from, to);
  } catch (e: any) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(from, to, { recursive: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

export async function moveToTrash(uid: string, segs: string[]) {
  if (!segs.length) throw new WsError(400, 'Invalid path');
  const full = await resolve(uid, segs);
  const st = await statOrNull(full);
  if (!st) throw new WsError(404, 'Not found');
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = internalDir(uid, 'trash', id);
  await fsp.mkdir(dir, { recursive: true });
  const size = st.isDirectory() ? await dirSize(full) : st.size;
  await movePath(full, path.join(dir, 'item'));
  const meta: TrashItem = { id, name: segs[segs.length - 1], originalPath: joinRel(segs), deletedAt: Date.now(), isDir: st.isDirectory(), size };
  await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta));
  invalidateUsage(uid);
}

export async function listTrash(uid: string): Promise<TrashItem[]> {
  const base = internalDir(uid, 'trash');
  let ids: string[] = [];
  try { ids = await fsp.readdir(base); } catch { return []; }
  const out: TrashItem[] = [];
  for (const id of ids) {
    if (!TRASH_ID.test(id)) continue;
    try { out.push(JSON.parse(await fsp.readFile(path.join(base, id, 'meta.json'), 'utf8'))); } catch {}
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

export async function restoreTrash(uid: string, id: unknown): Promise<string> {
  if (typeof id !== 'string' || !TRASH_ID.test(id)) throw new WsError(400, 'Invalid item');
  const dir = internalDir(uid, 'trash', id);
  let meta: TrashItem;
  try { meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8')); } catch { throw new WsError(404, 'Item not found'); }
  let segs = segments(meta.originalPath);
  let full = await resolve(uid, segs);
  if (await statOrNull(full)) {
    const last = segs[segs.length - 1];
    const dot = last.lastIndexOf('.');
    const restored = dot > 0 ? `${last.slice(0, dot)} (restored)${last.slice(dot)}` : `${last} (restored)`;
    segs = [...segs.slice(0, -1), restored];
    full = await resolve(uid, segs);
  }
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await movePath(path.join(dir, 'item'), full);
  await fsp.rm(dir, { recursive: true, force: true });
  invalidateUsage(uid);
  return joinRel(segs);
}

export async function purgeTrash(uid: string, id?: unknown) {
  const base = internalDir(uid, 'trash');
  if (id === undefined) {
    await fsp.rm(base, { recursive: true, force: true });
  } else {
    if (typeof id !== 'string' || !TRASH_ID.test(id)) throw new WsError(400, 'Invalid item');
    await fsp.rm(path.join(base, id), { recursive: true, force: true });
  }
  invalidateUsage(uid);
}

export async function purgeOldTrash() {
  const cutoff = Date.now() - limits.trashDays * 24 * 3600 * 1000;
  const keys = new Set<string>(authByUid.keys());
  for (const [serverId, server] of listDocs('servers')) {
    if (typeof server.ownerId === 'string') keys.add(serverWorkspaceKey(server.ownerId, serverId));
  }
  for (const uid of keys) {
    try {
      for (const item of await listTrash(uid)) if (item.deletedAt < cutoff) await purgeTrash(uid, item.id);
    } catch {}
  }
}

// ---------------- النسخ الاحتياطي ----------------

export async function writeBackup(uid: string, write: (b: Buffer) => void | Promise<void>) {
  const root = await ensureRoot(uid);
  const zip = createZipWriter(write);
  const stack: Array<{ dir: string; rel: string }> = [{ dir: root, rel: '' }];
  while (stack.length) {
    const { dir, rel } = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    if (!entries.length && rel) await zip.addDir(rel, new Date());
    for (const e of entries) {
      if (!rel && e.name.toLowerCase().startsWith(INTERNAL)) continue;
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push({ dir: full, rel: r });
      else if (e.isFile()) {
        try {
          const st = await fsp.stat(full);
          await zip.addFile(r, await fsp.readFile(full), st.mtime);
        } catch {}
      }
    }
  }
  await zip.finish();
}

export const userDirExists = (uid: string) => fs.existsSync(userDir(uid));
