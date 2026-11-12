import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { notifyOwner, notifyTelegramUser } from './notifications.ts';
import {
  DATA_DIR, type Doc, type AuthRecord, authByEmail, authByUid, saveAuth,
  getDoc, putDoc, removeDoc, listDocs, genId,
} from './store.ts';
import { initializeServerWorkspace } from './workspace.ts';

export interface ApiRequest {
  method: string;
  path: string;
  body: any;
  authorization?: string;
  ip?: string;
}
export interface ApiResponse { status: number; body: any }

const ok = (body: any = {}): ApiResponse => ({ status: 200, body });
const fail = (status: number, code: string, message: string): ApiResponse => ({ status, body: { error: { code, message } } });

// ---------- مفتاح توقيع الجلسات ----------

function loadSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'secret.key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();
// لا نترك المفتاح في بيئة العملية حتى لا ترثه البرامج التي يشغّلها المستخدمون
delete process.env.SESSION_SECRET;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signToken(uid: string): string {
  const payload = Buffer.from(JSON.stringify({ u: uid, e: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof u !== 'string' || typeof e !== 'number' || e < Date.now()) return null;
    return authByUid.has(u) ? u : null;
  } catch {
    return null;
  }
}

export function uidFromHeader(header?: string): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7));
}

// ---------- كلمات المرور ----------

const scrypt = (pw: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));

async function checkPassword(rec: AuthRecord | undefined, password: string): Promise<boolean> {
  // نفس الزمن تقريباً سواء وُجد الحساب أم لا
  const salt = rec?.salt || 'x'.repeat(32);
  const key = await scrypt(password, salt);
  if (!rec) return false;
  const stored = Buffer.from(rec.hash, 'hex');
  return stored.length === key.length && crypto.timingSafeEqual(stored, key);
}

// ---------- تحديد المحاولات ----------

const attempts = new Map<string, { count: number; reset: number }>();
function hit(key: string, max: number, windowMs: number, consume = true): boolean {
  const now = Date.now();
  let a = attempts.get(key);
  if (!a || a.reset < now) { a = { count: 0, reset: now + windowMs }; attempts.set(key, a); }
  if (a.count >= max) return false;
  if (consume) a.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
}, 10 * 60 * 1000).unref();

// ---------- أدوات ----------

const EMAIL_RE = /^[a-z0-9._-]{3,32}@[a-z0-9.-]+\.[a-z]{2,}$/;
const SEG_RE = /^[A-Za-z0-9_-]{1,128}$/;

const publicUser = (r: AuthRecord) => ({ uid: r.uid, email: r.email, displayName: r.displayName, photoURL: r.photoURL });

function defaultBalance(): number {
  const v = getDoc('config', 'global')?.defaultBalance;
  return typeof v === 'number' && v >= 0 ? v : 0;
}

function resolveSentinels(v: any): any {
  if (Array.isArray(v)) return v.map(resolveSentinels);
  if (v && typeof v === 'object') {
    if (v.__sv === 'ts') return { __ts: Date.now() };
    const out: Doc = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = resolveSentinels(x);
    return out;
  }
  return v;
}

const isPlainObject = (v: any) => v && typeof v === 'object' && !Array.isArray(v) && !('__ts' in v);

function deepMerge(base: Doc, patch: Doc): Doc {
  const out: Doc = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

// ---------- الصلاحيات ----------

interface Ctx { uid: string | null; isAdmin: boolean; banned: boolean }

function ctxFor(uid: string | null): Ctx {
  if (!uid) return { uid: null, isAdmin: false, banned: false };
  const u = getDoc('users', uid);
  return { uid, isAdmin: u?.role === 'admin', banned: !!u?.isBanned };
}

const SUBS = ['files', 'databases', 'backups'];

function splitPath(p: unknown): string[] | null {
  if (typeof p !== 'string') return null;
  const segs = p.split('/');
  return segs.length && segs.every(s => SEG_RE.test(s)) ? segs : null;
}

const ownsServer = (ctx: Ctx, serverId: string) => {
  if (!ctx.uid) return false;
  if (ctx.isAdmin) return true;
  return getDoc('servers', serverId)?.ownerId === ctx.uid;
};

/** هل يمكن قراءة هذا المستند؟ segs = مسار المستند كاملاً */
function canRead(segs: string[], doc: Doc | undefined, ctx: Ctx): boolean {
  const [root] = segs;
  if (root === 'config') return segs.length === 2 && segs[1] === 'global' ? true : ctx.isAdmin;
  if (!ctx.uid) return false;
  if (ctx.banned && !(root === 'users' && segs[1] === ctx.uid)) return false;
  if (ctx.isAdmin) return true;
  if (root === 'users') return segs.length === 2 && segs[1] === ctx.uid;
  if (root === 'servers') {
    if (segs.length === 2) return doc?.ownerId === ctx.uid;
    if (segs.length === 4 && SUBS.includes(segs[2])) return ownsServer(ctx, segs[1]);
    return false;
  }
  if (root === 'rechargeRequests' || root === 'activities') return segs.length === 2 && doc?.uid === ctx.uid;
  return false;
}

type WriteResult = { ok: true; data: Doc } | { ok: false; msg: string };
const deny = (msg = 'غير مسموح'): WriteResult => ({ ok: false, msg });

const LANGS = ['python', 'javascript', 'php'];
const STATUSES = ['running', 'stopped', 'starting', 'error', 'suspended'];
const PLANS = ['free', 'premium', 'unlimited'];
const validPlan = (value: unknown) => typeof value === 'string' && (PLANS.includes(value) || /^[a-z0-9_-]{2,40}$/i.test(value));

function validateServer(d: Doc, ctx: Ctx): string | null {
  if (typeof d.ownerId !== 'string') return 'ownerId مطلوب';
  if (typeof d.name !== 'string' || !d.name.length || d.name.length > 50) return 'اسم السيرفر غير صالح';
  if (!LANGS.includes(d.language)) return 'اللغة غير مدعومة';
  if (!STATUSES.includes(d.status)) return 'الحالة غير صالحة';
  if (!validPlan(d.plan)) return 'الخطة غير صالحة';
  return null;
}

/** يفحص الكتابة ويرجع المستند النهائي الذي سيُحفظ */
function checkWrite(op: 'set' | 'update' | 'delete', segs: string[], old: Doc | undefined, incoming: Doc, merge: boolean, ctx: Ctx): WriteResult {
  if (!ctx.uid) return deny('يجب تسجيل الدخول');
  if (ctx.banned && !ctx.isAdmin) return deny('الحساب محظور');
  const [root] = segs;
  const base = op === 'delete' ? {} : (op === 'update' || merge) && old ? deepMerge(old, incoming) : { ...incoming };

  if (op === 'update' && !old) return deny('المستند غير موجود');

  if (root === 'config') return ctx.isAdmin ? { ok: true, data: base } : deny();

  if (root === 'users' && segs.length === 2) {
    const id = segs[1];
    if (op === 'delete') return ctx.isAdmin ? { ok: true, data: base } : deny();
    if (!ctx.isAdmin && id !== ctx.uid) return deny();
    if (base.uid !== undefined && base.uid !== id) return deny('uid غير صحيح');
    if (typeof base.email === 'string' && !EMAIL_RE.test(base.email)) return deny('بريد غير صالح');
    if (base.plan !== undefined && !validPlan(base.plan)) return deny('الخطة غير صالحة');
    if (base.serverCount !== undefined && !(typeof base.serverCount === 'number' && base.serverCount >= 0)) return deny('serverCount غير صالح');
    if (!ctx.isAdmin) {
      if (!old) {
        base.role = 'user'; base.plan = 'free'; base.balance = defaultBalance(); delete base.isBanned;
      } else {
        // حقول محمية: لا يغيرها المستخدم لنفسه، والرصيد يمكن أن ينقص فقط
        base.role = old.role ?? 'user';
        base.plan = old.plan ?? 'free';
        if (old.isBanned === undefined) delete base.isBanned; else base.isBanned = old.isBanned;
        const ob = typeof old.balance === 'number' ? old.balance : 0;
        base.balance = typeof base.balance === 'number' ? Math.min(base.balance, ob) : ob;
      }
    }
    return { ok: true, data: base };
  }

  if (root === 'servers' && segs.length === 2) {
    if (op === 'delete') return old && (ctx.isAdmin || old.ownerId === ctx.uid) ? { ok: true, data: base } : deny();
    if (op === 'set' && !old) {
      if (base.ownerId !== ctx.uid) return deny('ownerId غير صحيح');
      if (!ctx.isAdmin) {
        const profile = getDoc('users', ctx.uid) || {};
        const sub = profile.subscription;
        const subExpiryRaw = sub?.expiresAt?.__ts ?? sub?.expiresAt;
        const subExpiry = subExpiryRaw ? new Date(subExpiryRaw).getTime() : 0;
        const activeSub = !!sub && sub.status === 'active' && subExpiry > Date.now();
        const freeLimit = Number(getDoc('config', 'global')?.maxFreeServers || 1);
        const serverLimit = activeSub ? Number(sub.serverLimit || 1) : freeLimit;
        const ownedCount = listDocs('servers').filter(([, server]) => server.ownerId === ctx.uid).length;
        if (ownedCount >= serverLimit) return deny(`وصلت للحد الأقصى المسموح به في اشتراكك (${serverLimit} خادم)`);
        if (base.plan === 'premium' && !activeSub && !PLANS.includes(String(profile.plan || 'free'))) return deny('الخطة الحالية لا تسمح بإنشاء هذا الخادم');
        if (activeSub) {
          base.plan = 'premium';
          base.expiresAt = sub.expiresAt;
          base.ramLimitMb = Number(sub.ramMb || 512);
          base.cpuLimitCores = Number(sub.cpuCores || 0.5);
          base.storageLimitGb = Number(sub.storageGb || 1);
          base.projectLimit = Number(sub.projectLimit || 1);
        }
      }
    } else {
      if (!old || !(ctx.isAdmin || old.ownerId === ctx.uid)) return deny();
      if (base.ownerId !== old.ownerId) return deny('لا يمكن تغيير المالك');
    }
    const err = validateServer(base, ctx);
    return err ? deny(err) : { ok: true, data: base };
  }

  if (root === 'servers' && segs.length === 4 && SUBS.includes(segs[2])) {
    if (!ownsServer(ctx, segs[1]) || !getDoc('servers', segs[1])) return deny();
    if (op === 'delete') return { ok: true, data: base };
    if (segs[2] === 'files') {
      const d = base;
      if (typeof d.serverId !== 'string' || typeof d.name !== 'string' || !d.name.length || d.name.length > 100
        || typeof d.content !== 'string' || d.content.length >= 1048576 || typeof d.path !== 'string') return deny('بيانات الملف غير صالحة');
    }
    return { ok: true, data: base };
  }

  if (root === 'rechargeRequests' && segs.length === 2) {
    if (ctx.isAdmin) return { ok: true, data: base };
    if (op !== 'set' || old || base.uid !== ctx.uid) return deny();
    if (typeof base.amount !== 'number' || !Number.isFinite(base.amount) || base.amount <= 0 || base.amount > 10000000) return deny('المبلغ غير صالح');
    if (typeof base.telegram !== 'string' || base.telegram.replace(/^@/, '').trim().length < 3 || base.telegram.length > 40) return deny('يوزر تيليجرام غير صالح');
    if (typeof base.screenshotDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(base.screenshotDataUrl) || base.screenshotDataUrl.length > 3 * 1024 * 1024) return deny('إثبات التحويل غير صالح أو حجمه كبير');
    const config = getDoc('config', 'global') || {};
    const method = Array.isArray(config.paymentMethods) ? config.paymentMethods.find((m: any) => m.id === base.methodId && m.enabled) : null;
    if (!method) return deny('وسيلة الدفع غير متاحة');
    base.methodName = String(method.name || '').slice(0, 80);
    base.methodAccount = String(method.account || '').slice(0, 160);
    base.methodNetwork = String(method.network || '').slice(0, 40);
    base.currency = String(base.currency || 'EGP').slice(0, 8);
    if (base.planId) {
      const plan = Array.isArray(config.plans) ? config.plans.find((p: any) => p.id === base.planId && p.enabled) : null;
      if (!plan) return deny('الخطة غير متاحة');
      if (Number(plan.price) !== base.amount || String(plan.currency) !== base.currency) return deny('قيمة الخطة تغيرت، حدّث الصفحة وأعد الطلب');
      base.planName = String(plan.name || '').slice(0, 80);
      base.planSnapshot = plan;
    } else {
      base.planId = '';
      base.planName = '';
      base.planSnapshot = null;
    }
    base.status = 'pending';
    base.createdAt = { __ts: Date.now() };
    return { ok: true, data: base };
  }

  if (root === 'activities' && segs.length === 2) {
    if (ctx.isAdmin) return { ok: true, data: base };
    if (op === 'set' && !old && (base.uid === undefined || base.uid === ctx.uid)) return { ok: true, data: base };
    return deny();
  }

  return deny();
}

// ---------- الاستعلامات ----------

const norm = (v: any) => (v && typeof v === 'object' && '__ts' in v ? v.__ts : v);

function cmp(a: any, b: any): number {
  a = norm(a); b = norm(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

function matches(doc: Doc, w: { field: string; op: string; value: any }): boolean {
  const has = Object.prototype.hasOwnProperty.call(doc, w.field);
  const v = norm(doc[w.field]);
  const t = norm(w.value);
  if (!has) return false;
  switch (w.op) {
    case '==': return v === t;
    case '!=': return v !== t;
    case '<': return v < t;
    case '<=': return v <= t;
    case '>': return v > t;
    case '>=': return v >= t;
    case 'in': return Array.isArray(t) && t.includes(v);
    case 'not-in': return Array.isArray(t) && !t.includes(v);
    case 'array-contains': return Array.isArray(doc[w.field]) && doc[w.field].includes(t);
    default: return false;
  }
}

// ---------- المسارات ----------

export async function handleApi(req: ApiRequest): Promise<ApiResponse> {
  const route = req.path.replace(/\/+$/, '');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (req.method !== 'POST' && !(req.method === 'GET' && route === '/api/auth/me')) {
    return fail(405, 'method-not-allowed', 'الطريقة غير مسموحة');
  }

  try {
    // ----- المصادقة -----
    if (route === '/api/auth/register') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const displayName = String(body.displayName || email.split('@')[0]).trim().slice(0, 50);
      if (!EMAIL_RE.test(email)) return fail(400, 'auth/invalid-email', 'اسم المستخدم غير صالح');
      if (password.length < 6 || password.length > 128) return fail(400, 'auth/weak-password', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      if (!hit(`reg|${req.ip}`, 10, 60 * 60 * 1000)) return fail(429, 'auth/too-many-requests', 'محاولات كثيرة، حاول لاحقاً');
      if (authByEmail.has(email)) return fail(409, 'auth/email-already-in-use', 'اسم المستخدم مستخدم');

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt)).toString('hex');
      if (authByEmail.has(email)) return fail(409, 'auth/email-already-in-use', 'اسم المستخدم مستخدم');

      const rec: AuthRecord = { uid: genId(), email, displayName, photoURL: '', salt, hash, createdAt: Date.now() };
      saveAuth(rec);
      putDoc('users', rec.uid, {
        uid: rec.uid, email, displayName, photoURL: '',
        plan: 'free',
        serverCount: 0,
        balance: defaultBalance(),
        role: 'user',
        createdAt: { __ts: Date.now() },
      });
      return ok({ token: signToken(rec.uid), user: publicUser(rec) });
    }

    if (route === '/api/auth/login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const key = `login|${req.ip}|${email}`;
      if (!hit(key, 8, 10 * 60 * 1000, false)) return fail(429, 'auth/too-many-requests', 'محاولات كثيرة، حاول لاحقاً');
      const rec = authByEmail.get(email);
      if (!(await checkPassword(rec, password)) || !rec) {
        hit(key, 8, 10 * 60 * 1000);
        return fail(401, 'auth/invalid-credential', 'اسم المستخدم أو كلمة المرور غير صحيحة');
      }
      attempts.delete(key);
      return ok({ token: signToken(rec.uid), user: publicUser(rec) });
    }

    if (route === '/api/auth/me') {
      const uid = uidFromHeader(req.authorization);
      const rec = uid ? authByUid.get(uid) : undefined;
      return rec ? ok({ user: publicUser(rec) }) : fail(401, 'auth/unauthenticated', 'انتهت الجلسة');
    }

    if (route === '/api/auth/profile') {
      const uid = uidFromHeader(req.authorization);
      const rec = uid ? authByUid.get(uid) : undefined;
      if (!rec) return fail(401, 'auth/unauthenticated', 'انتهت الجلسة');
      if (typeof body.displayName === 'string' && body.displayName.trim()) rec.displayName = body.displayName.trim().slice(0, 50);
      if (typeof body.photoURL === 'string') rec.photoURL = body.photoURL.slice(0, 500);
      saveAuth(rec);
      const prof = getDoc('users', rec.uid);
      if (prof) putDoc('users', rec.uid, { ...prof, displayName: rec.displayName });
      return ok({ user: publicUser(rec) });
    }

    // ----- قاعدة البيانات -----
    if (route.startsWith('/api/db/')) {
      const ctx = ctxFor(uidFromHeader(req.authorization));
      const op = route.slice('/api/db/'.length);

      if (op === 'list') {
        const csegs = splitPath(body.path);
        if (!csegs || csegs.length % 2 === 0) return fail(400, 'invalid-argument', 'مسار غير صالح');
        const cp = csegs.join('/');
        // المجموعات الفرعية: التحقق من المالك مرة واحدة
        if (csegs.length === 3 && !canRead([...csegs, 'x'], undefined, ctx)) return fail(403, 'permission-denied', 'غير مسموح');
        if (csegs.length > 3) return fail(400, 'invalid-argument', 'مسار غير صالح');

        let rows = listDocs(cp).filter(([id, d]) => canRead([...csegs, id], d, ctx));
        const wheres: any[] = Array.isArray(body.where) ? body.where : [];
        rows = rows.filter(([, d]) => wheres.every(w => matches(d, w)));
        const orders: any[] = Array.isArray(body.orderBy) ? body.orderBy : [];
        if (orders.length) {
          rows = rows.filter(([, d]) => orders.every(o => Object.prototype.hasOwnProperty.call(d, o.field)));
          rows.sort(([, a], [, b]) => {
            for (const o of orders) {
              const c = cmp(a[o.field], b[o.field]);
              if (c) return o.dir === 'desc' ? -c : c;
            }
            return 0;
          });
        } else {
          rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        }
        if (typeof body.limit === 'number' && body.limit > 0) rows = rows.slice(0, body.limit);
        return ok({ docs: rows.map(([id, data]) => {
          if (cp === 'rechargeRequests' && ctx.isAdmin) { const { screenshotDataUrl, ...summary } = data; return { id, data: summary }; }
          return { id, data };
        }) });
      }

      const segs = splitPath(body.path);
      if (!segs || segs.length % 2 !== (op === 'add' ? 1 : 0) || segs.length > 4) return fail(400, 'invalid-argument', 'مسار غير صالح');

      if (op === 'get') {
        const cp = segs.slice(0, -1).join('/');
        const id = segs[segs.length - 1];
        const d = getDoc(cp, id);
        if (!canRead(segs, d, ctx)) return d ? fail(403, 'permission-denied', 'غير مسموح') : ok({ exists: false });
        return ok(d ? { exists: true, id, data: d } : { exists: false });
      }

      const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? resolveSentinels(body.data) : {};

      if (op === 'add') {
        const id = genId();
        const full = [...segs, id];
        const r = checkWrite('set', full, undefined, data, false, ctx);
        if (!r.ok) return fail(403, 'permission-denied', r.msg);
        putDoc(segs.join('/'), id, r.data);
        if (segs.join('/') === 'servers' && typeof r.data.ownerId === 'string') void initializeServerWorkspace(r.data.ownerId, id, false);
        if (segs.join('/') === 'rechargeRequests') {
          const d = r.data;
          void notifyOwner(`EVO | طلب دفع جديد\nالمستخدم: ${String(d.email || d.uid || 'غير معروف')}\nالمبلغ: ${Number(d.amount || 0)} ${String(d.currency || '')}\nالوسيلة: ${String(d.methodName || 'غير محددة')}\nالخطة: ${String(d.planName || 'شحن رصيد')}\nافتح لوحة المالك لمراجعة الإثبات.`);
        }
        return ok({ id });
      }

      const cp = segs.slice(0, -1).join('/');
      const id = segs[segs.length - 1];
      const old = getDoc(cp, id);

      if (op === 'set' || op === 'update') {
        if (cp === 'rechargeRequests' && ctx.isAdmin && old && old.status !== 'pending' && data.status && data.status !== old.status) {
          return fail(409, 'payment/already-reviewed', 'تمت مراجعة طلب الدفع بالفعل');
        }
        const r = checkWrite(op, segs, old, data, op === 'set' && body.merge === true, ctx);
        if (!r.ok) return fail(403, 'permission-denied', r.msg);
        putDoc(cp, id, r.data);
        if (cp === 'servers' && !old && typeof r.data.ownerId === 'string') void initializeServerWorkspace(r.data.ownerId, id, false);
        if (cp === 'rechargeRequests' && old?.status === 'pending' && (r.data.status === 'approved' || r.data.status === 'rejected')) {
          const approved = r.data.status === 'approved';
          void notifyTelegramUser(r.data.telegram, approved
            ? `EVO: تمت الموافقة على طلب الدفع الخاص بك${r.data.planName ? ` وتفعيل خطة ${r.data.planName}` : ' وإضافة الرصيد'}.`
            : `EVO: تم رفض طلب الدفع. راجع لوحة حسابك أو تواصل مع الدعم لمعرفة التفاصيل.`);
          void notifyOwner(`EVO | تحديث طلب دفع\nالحالة: ${approved ? 'مقبول' : 'مرفوض'}\nالمستخدم: ${String(r.data.email || r.data.uid || '')}`);
        }
        return ok({ id });
      }

      if (op === 'delete') {
        const r = checkWrite('delete', segs, old, {}, false, ctx);
        if (!r.ok) return fail(403, 'permission-denied', r.msg);
        removeDoc(cp, id);
        return ok();
      }
    }

    return fail(404, 'not-found', 'المسار غير موجود');
  } catch (e: any) {
    console.error('[api] خطأ:', e);
    void notifyOwner(`EVO | خطأ API\nالمسار: ${route}\nالنوع: ${String(e?.name || 'Error')}\nالرسالة: ${String(e?.message || e).slice(0, 700)}`);
    return fail(500, 'internal', 'خطأ داخلي في الخادم');
  }
}

// ---------- صلاحية تشغيل/إيقاف السيرفرات (تُستخدم في server.ts) ----------

export function authorizeServer(authorization: string | undefined, serverId: string): { ok: true; uid: string } | { ok: false; status: number; message: string } {
  const uid = uidFromHeader(authorization);
  if (!uid) return { ok: false, status: 401, message: 'يجب تسجيل الدخول' };
  const ctx = ctxFor(uid);
  if (ctx.banned && !ctx.isAdmin) return { ok: false, status: 403, message: 'الحساب محظور' };
  if (!SEG_RE.test(serverId) || !getDoc('servers', serverId)) return { ok: false, status: 404, message: 'السيرفر غير موجود' };
  if (!ownsServer(ctx, serverId)) return { ok: false, status: 403, message: 'غير مسموح' };
  return { ok: true, uid };
}

/** المستخدم الحالي من ترويسة التوثيق (يرفض المحظورين) */
export function userFromHeader(authorization: string | undefined): { uid: string; username: string; isAdmin: boolean } | null {
  const uid = uidFromHeader(authorization);
  if (!uid) return null;
  const ctx = ctxFor(uid);
  if (ctx.banned && !ctx.isAdmin) return null;
  const rec = authByUid.get(uid);
  if (!rec) return null;
  return { uid, username: rec.email.split('@')[0], isAdmin: ctx.isAdmin };
}
