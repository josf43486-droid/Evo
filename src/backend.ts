// طبقة البيانات والمصادقة: تتكلم مع الخادم المحلي عبر /api
// أسماء الدوال مطابقة للنمط المستخدم في الصفحات (doc, getDoc, onSnapshot ...)

const TOKEN_KEY = 'far3on_token';
const POLL_MS = 2500;

// ---------------- الطلبات ----------------

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
const setToken = (t: string | null) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
};

/** ترويسة التوثيق لطلبات الخادم المباشرة (تشغيل/إيقاف/سجلات) */
export const authHeaders = (): Record<string, string> => {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function request(path: string, body?: any, method = 'POST') {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('unavailable', 'تعذر الاتصال بالخادم');
  }
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && getToken() && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
    // الجلسة لم تعد صالحة
    setToken(null);
    auth.currentUser = null;
    notifyAuth();
  }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(e?.code || `http-${res.status}`, e?.message || 'حدث خطأ');
  }
  return data;
}

// ---------------- الوقت ----------------

export class Timestamp {
  private ms: number;
  constructor(ms: number) { this.ms = ms; }
  toDate() { return new Date(this.ms); }
  toMillis() { return this.ms; }
  get seconds() { return Math.floor(this.ms / 1000); }
  get nanoseconds() { return (this.ms % 1000) * 1e6; }
  static now() { return new Timestamp(Date.now()); }
  static fromDate(d: Date) { return new Timestamp(d.getTime()); }
  static fromMillis(ms: number) { return new Timestamp(ms); }
}

export const serverTimestamp = () => ({ __sv: 'ts' });

function encode(v: any): any {
  if (v instanceof Date) return { __ts: v.getTime() };
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = encode(x);
    return out;
  }
  return v;
}

function decode(v: any): any {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (typeof v.__ts === 'number' && Object.keys(v).length === 1) return new Timestamp(v.__ts);
    const out: any = {};
    for (const [k, x] of Object.entries(v)) out[k] = decode(x);
    return out;
  }
  return v;
}

// ---------------- المراجع ----------------

export const db = { kind: 'db' } as const;

export interface DocumentReference { type: 'document'; path: string; id: string }
export interface CollectionReference { type: 'collection'; path: string; id: string }
type Constraint =
  | { kind: 'where'; field: string; op: string; value: any }
  | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { kind: 'limit'; n: number };
export interface Query { type: 'query'; path: string; constraints: Constraint[] }

type Target = DocumentReference | CollectionReference | Query;

export const doc = (_db: unknown, ...segments: string[]): DocumentReference => {
  const path = segments.join('/');
  return { type: 'document', path, id: segments[segments.length - 1] };
};
export const collection = (_db: unknown, ...segments: string[]): CollectionReference => ({
  type: 'collection', path: segments.join('/'), id: segments[segments.length - 1],
});
export const where = (field: string, op: string, value: any): Constraint => ({ kind: 'where', field, op, value: encode(value) });
export const orderBy = (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ kind: 'orderBy', field, dir });
export const limit = (n: number): Constraint => ({ kind: 'limit', n });
export const query = (ref: CollectionReference | Query, ...constraints: Constraint[]): Query => ({
  type: 'query', path: ref.path, constraints: [...(ref.type === 'query' ? ref.constraints : []), ...constraints],
});

// ---------------- اللقطات ----------------

export interface DocumentSnapshot {
  id: string;
  ref: DocumentReference;
  exists: () => boolean;
  data: () => any;
}
export interface QuerySnapshot {
  docs: DocumentSnapshot[];
  empty: boolean;
  size: number;
  forEach: (cb: (d: DocumentSnapshot) => void) => void;
}

const makeDocSnap = (parentPath: string, id: string, raw: any | undefined): DocumentSnapshot => {
  const data = raw === undefined ? undefined : decode(raw);
  return {
    id,
    ref: { type: 'document', path: `${parentPath}/${id}`, id },
    exists: () => data !== undefined,
    data: () => data,
  };
};

const makeQuerySnap = (path: string, rows: Array<{ id: string; data: any }>): QuerySnapshot => {
  const docs = rows.map(r => makeDocSnap(path, r.id, r.data));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: cb => docs.forEach(cb) };
};

// ---------------- القراءة والكتابة ----------------

const listeners = new Set<() => void>();
const emitChange = () => listeners.forEach(fn => fn());

const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');

async function fetchDoc(ref: DocumentReference) {
  const r = await request('/api/db/get', { path: ref.path });
  return r.exists ? r.data : undefined;
}

async function fetchList(target: CollectionReference | Query) {
  const constraints = target.type === 'query' ? target.constraints : [];
  const r = await request('/api/db/list', {
    path: target.path,
    where: constraints.filter(c => c.kind === 'where').map((c: any) => ({ field: c.field, op: c.op, value: c.value })),
    orderBy: constraints.filter(c => c.kind === 'orderBy').map((c: any) => ({ field: c.field, dir: c.dir })),
    limit: (constraints.find(c => c.kind === 'limit') as any)?.n,
  });
  return r.docs as Array<{ id: string; data: any }>;
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  return makeDocSnap(parentOf(ref.path), ref.id, await fetchDoc(ref));
}

export async function getDocs(target: CollectionReference | Query): Promise<QuerySnapshot> {
  return makeQuerySnap(target.path, await fetchList(target));
}

export async function setDoc(ref: DocumentReference, data: any, options?: { merge?: boolean }) {
  await request('/api/db/set', { path: ref.path, data: encode(data), merge: !!options?.merge });
  emitChange();
}

export async function updateDoc(ref: DocumentReference, data: any) {
  await request('/api/db/update', { path: ref.path, data: encode(data) });
  emitChange();
}

export async function deleteDoc(ref: DocumentReference) {
  await request('/api/db/delete', { path: ref.path });
  emitChange();
}

export async function addDoc(col: CollectionReference, data: any): Promise<DocumentReference> {
  const r = await request('/api/db/add', { path: col.path, data: encode(data) });
  emitChange();
  return { type: 'document', path: `${col.path}/${r.id}`, id: r.id };
}

/** متابعة التغييرات: استعلام دوري خفيف + تحديث فوري بعد أي كتابة من هذا المتصفح */
export function onSnapshot(
  target: Target,
  next: (snap: any) => void,
  onError?: (err: ApiError) => void,
): () => void {
  let stopped = false;
  let busy = false;
  let last: string | null = null;

  const run = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      if (target.type === 'document') {
        const raw = await fetchDoc(target);
        const sig = JSON.stringify(raw ?? null);
        if (sig !== last) { last = sig; next(makeDocSnap(parentOf(target.path), target.id, raw)); }
      } else {
        const rows = await fetchList(target);
        const sig = JSON.stringify(rows);
        if (sig !== last) { last = sig; next(makeQuerySnap(target.path, rows)); }
      }
    } catch (e: any) {
      // انقطاع شبكة مؤقت: نعيد المحاولة بصمت. الأخطاء الأخرى نبلغ عنها مرة واحدة
      if (!stopped && e?.code !== 'unavailable' && e?.code !== 'auth/unauthenticated') {
        onError?.(e);
        stopped = true;
        clearInterval(timer);
        listeners.delete(refresh);
      }
    } finally {
      busy = false;
    }
  };

  const refresh = () => { if (!document.hidden) run(); };
  const timer = setInterval(refresh, POLL_MS);
  listeners.add(refresh);
  document.addEventListener('visibilitychange', refresh);
  run();

  return () => {
    stopped = true;
    clearInterval(timer);
    listeners.delete(refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}

// ---------------- المصادقة ----------------

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
}

export const auth: { currentUser: AuthUser | null } = { currentUser: null };

const authListeners = new Set<(u: AuthUser | null) => void>();
const notifyAuth = () => authListeners.forEach(fn => fn(auth.currentUser));

const ready: Promise<void> = (async () => {
  if (!getToken()) return;
  try {
    const r = await request('/api/auth/me', undefined, 'GET');
    auth.currentUser = r.user;
  } catch (e: any) {
    // نحذف الجلسة فقط إذا رفضها الخادم، وليس عند انقطاع الشبكة
    if (e?.code !== 'unavailable') setToken(null);
  }
})();

export function onAuthStateChanged(_auth: unknown, cb: (u: AuthUser | null) => void): () => void {
  authListeners.add(cb);
  ready.then(() => { if (authListeners.has(cb)) cb(auth.currentUser); });
  return () => { authListeners.delete(cb); };
}

async function authRequest(route: 'login' | 'register', email: string, password: string, displayName?: string) {
  const r = await request(`/api/auth/${route}`, { email, password, displayName });
  setToken(r.token);
  auth.currentUser = r.user;
  notifyAuth();
  return { user: r.user as AuthUser };
}

export const signInWithEmailAndPassword = (_a: unknown, email: string, password: string) =>
  authRequest('login', email, password);

export const createUserWithEmailAndPassword = (_a: unknown, email: string, password: string, displayName?: string) =>
  authRequest('register', email, password, displayName);

export async function updateProfile(_user: AuthUser, patch: { displayName?: string | null; photoURL?: string | null }) {
  const r = await request('/api/auth/profile', patch);
  auth.currentUser = r.user;
}

export async function signOut(_a?: unknown) {
  setToken(null);
  auth.currentUser = null;
  notifyAuth();
}
