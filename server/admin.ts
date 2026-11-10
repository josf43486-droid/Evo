import crypto from 'crypto';
import { authByEmail, authByUid, saveAuth, getDoc, putDoc, genId, type AuthRecord } from './store.ts';

// حساب الأدمن الوحيد في الموقع. لا يمكن لأي حساب آخر أن يصبح أدمن.
// يمكن تغيير البيانات من ملف .env (ADMIN_USERNAME / ADMIN_PASSWORD).
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!/^[a-z0-9._-]{3,32}$/.test(ADMIN_USERNAME)) throw new Error('EVO setup: set ADMIN_USERNAME (3-32 lowercase letters, numbers, dot, underscore or hyphen) in .env');
if (ADMIN_PASSWORD.length < 14 || ADMIN_PASSWORD.includes('CHANGE_THIS')) throw new Error('EVO setup: replace the example ADMIN_PASSWORD with a unique password of at least 14 characters in .env');
delete process.env.ADMIN_PASSWORD; // لا ترثه السكربتات التي يشغّلها المستخدمون
const EMAIL_DOMAIN = 'nexus.internal';

const scrypt = (pw: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? reject(e) : resolve(k))));

export const ADMIN_EMAIL = `${ADMIN_USERNAME}@${EMAIL_DOMAIN}`;

/** ينشئ حساب المالك أو يحدّث كلمة مروره، ويسحب صلاحية المالك من أي حساب آخر */
export async function ensureAdminAccount() {
  let rec = authByEmail.get(ADMIN_EMAIL);

  if (!rec) {
    const salt = crypto.randomBytes(16).toString('hex');
    rec = {
      uid: genId(), email: ADMIN_EMAIL, displayName: ADMIN_USERNAME, photoURL: '',
      salt, hash: (await scrypt(ADMIN_PASSWORD, salt)).toString('hex'), createdAt: Date.now(),
    } as AuthRecord;
    saveAuth(rec);
  } else {
    // كلمة المرور في الإعدادات هي المرجع دائماً
    const key = await scrypt(ADMIN_PASSWORD, rec.salt);
    const stored = Buffer.from(rec.hash, 'hex');
    if (stored.length !== key.length || !crypto.timingSafeEqual(stored, key)) {
      const salt = crypto.randomBytes(16).toString('hex');
      saveAuth({ ...rec, salt, hash: (await scrypt(ADMIN_PASSWORD, salt)).toString('hex') });
    }
  }

  const prof = getDoc('users', rec.uid);
  putDoc('users', rec.uid, {
    uid: rec.uid, email: ADMIN_EMAIL, displayName: rec.displayName, photoURL: '',
    serverCount: 0, balance: 0, createdAt: { __ts: Date.now() },
    ...prof,
    role: 'admin', plan: 'unlimited', isBanned: false,
  });

  // لا أدمن غيره
  for (const uid of authByUid.keys()) {
    if (uid === rec.uid) continue;
    const p = getDoc('users', uid);
    if (p?.role === 'admin') putDoc('users', uid, { ...p, role: 'user', plan: p.plan === 'unlimited' ? 'free' : p.plan });
  }
}
