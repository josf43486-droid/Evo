import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type Doc = Record<string, any>;

export interface AuthRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  salt: string;
  hash: string;
  createdAt: number;
}

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// collectionPath ("servers" أو "servers/ID/files") -> (docId -> بيانات)
const collections = new Map<string, Map<string, Doc>>();
export const authByEmail = new Map<string, AuthRecord>();
export const authByUid = new Map<string, AuthRecord>();

export const genId = () => crypto.randomBytes(10).toString('base64url');

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    for (const [cp, docs] of Object.entries<Record<string, Doc>>(raw.collections || {})) {
      collections.set(cp, new Map(Object.entries(docs)));
    }
    for (const rec of Object.values<AuthRecord>(raw.auth || {})) {
      authByEmail.set(rec.email, rec);
      authByUid.set(rec.uid, rec);
    }
  } catch (e) {
    const backup = path.join(DATA_DIR, `db.corrupt-${Date.now()}.json`);
    fs.renameSync(DB_FILE, backup);
    console.error(`[store] ملف البيانات تالف، تم نقله إلى ${backup} والبدء من جديد.`);
  }
}

function snapshot() {
  const cols: Record<string, Record<string, Doc>> = {};
  for (const [cp, docs] of collections) {
    if (docs.size) cols[cp] = Object.fromEntries(docs);
  }
  const auth: Record<string, AuthRecord> = {};
  for (const rec of authByUid.values()) auth[rec.uid] = rec;
  return JSON.stringify({ collections: cols, auth });
}

function flushSync() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, snapshot(), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

let timer: NodeJS.Timeout | null = null;
let dirty = false;

export function markDirty() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try { flushSync(); } catch (e) { console.error('[store] فشل حفظ البيانات:', e); }
  }, 300);
}

function flushNow() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (dirty) {
    dirty = false;
    try { flushSync(); } catch (e) { console.error('[store] فشل حفظ البيانات:', e); }
  }
}

// ---------- الإغلاق الآمن ----------

const shutdownHooks: Array<() => void | Promise<void>> = [];
export const onShutdown = (fn: () => void | Promise<void>) => { shutdownHooks.push(fn); };
let shuttingDown = false;
export const isShuttingDown = () => shuttingDown;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const fn of shutdownHooks) {
    try { await fn(); } catch (e) { console.error('[shutdown]', e); }
  }
  flushNow();
  process.exit(0);
}

process.on('exit', flushNow);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  try { process.on(sig, shutdown); } catch {}
}

load();

// ---------- عمليات المستندات ----------

export const getDoc = (cp: string, id: string): Doc | undefined => collections.get(cp)?.get(id);

export function putDoc(cp: string, id: string, data: Doc) {
  let col = collections.get(cp);
  if (!col) { col = new Map(); collections.set(cp, col); }
  col.set(id, data);
  markDirty();
}

export function removeDoc(cp: string, id: string) {
  collections.get(cp)?.delete(id);
  // حذف كل المجموعات الفرعية التابعة للمستند
  const prefix = `${cp}/${id}/`;
  for (const key of [...collections.keys()]) {
    if (key.startsWith(prefix)) collections.delete(key);
  }
  markDirty();
}

export function listDocs(cp: string): Array<[string, Doc]> {
  const col = collections.get(cp);
  return col ? [...col.entries()] : [];
}

export function saveAuth(rec: AuthRecord) {
  authByEmail.set(rec.email, rec);
  authByUid.set(rec.uid, rec);
  markDirty();
}
