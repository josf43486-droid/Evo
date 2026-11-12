import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { authByUid, getDoc, listDocs, onShutdown, isShuttingDown } from './store.ts';
import { WsError, segments, joinRel, userDir, internalDir, RUNNABLE, extOf } from './workspace.ts';

// تشغيل سكربتات المستخدمين (Python / Node / PHP) كعمليات مُدارة مع سجلات دائمة

const IS_WIN = process.platform === 'win32';
const LOG_MAX = 2 * 1024 * 1024;

export type Status = 'starting' | 'installing' | 'running' | 'restarting' | 'stopped' | 'crashed';

interface Proc {
  uid: string;
  rel: string;
  full: string;
  kind: 'script' | 'pip';
  child: ChildProcess | null;
  status: Status;
  startedAt: number | null;
  exitCode: number | null;
  restarts: number;
  quickCrashes: number;
  keepAlive: boolean;
  stopRequested: boolean;
  timer: NodeJS.Timeout | null;
  logPath: string;
  logSize: number;
  logFd: number | null;
}

const procs = new Map<string, Proc>();
const keyOf = (uid: string, rel: string) => `${uid}|${rel}`;
const ownerOf = (uid: string) => uid.split('::server::', 1)[0];
const ACTIVE: Status[] = ['starting', 'installing', 'running', 'restarting'];
const isActive = (p: Proc) => ACTIVE.includes(p.status);

export const limitsRun = {
  perUser: process.env.MAX_RUNNING_PER_USER !== undefined ? Number(process.env.MAX_RUNNING_PER_USER) : 3,
  total: Number(process.env.MAX_RUNNING_TOTAL) || 60,
};

// ---------------- المفسّرات ----------------

interface Interp { cmd: string; args: string[]; label: string }
let pythonCache: Interp | null = null;
let pythonCheckedAt = 0;

export function findPython(): Interp | null {
  if (pythonCache) return pythonCache;
  if (Date.now() - pythonCheckedAt < 30000) return null;
  pythonCheckedAt = Date.now();
  const candidates: Array<[string, string[]]> = IS_WIN
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    try {
      const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version.split()[0])'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      const out = (r.stdout || '').trim();
      if (r.status === 0 && /^\d+\.\d+/.test(out)) {
        pythonCache = { cmd, args: pre, label: out };
        return pythonCache;
      }
    } catch {}
  }
  return null;
}

function interpreterFor(lang: 'python' | 'node' | 'php'): Interp | null {
  if (lang === 'python') return findPython();
  if (lang === 'node') return { cmd: process.execPath, args: [], label: process.version };
  return { cmd: 'php', args: [], label: 'php' };
}

// ---------------- البيئة ----------------

const ENV_ALLOW = new Set([
  'path', 'systemroot', 'windir', 'temp', 'tmp', 'tmpdir', 'home', 'userprofile', 'lang', 'lc_all', 'comspec', 'pathext',
  'appdata', 'localappdata', 'programdata', 'programfiles', 'programfiles(x86)', 'number_of_processors',
  'processor_architecture', 'ssl_cert_file', 'tz', 'username', 'computername',
]);

function buildEnv(uid: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (ENV_ALLOW.has(k.toLowerCase())) env[k] = v;
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  env.PYTHONPATH = internalDir(uid, 'site-packages');
  return env;
}

// ---------------- السجلات ----------------

const logPathFor = (uid: string, rel: string) =>
  path.join(internalDir(uid, 'logs'), crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16) + '.log');

function openLog(p: Proc) {
  fs.mkdirSync(path.dirname(p.logPath), { recursive: true });
  try { p.logSize = fs.statSync(p.logPath).size; } catch { p.logSize = 0; }
  p.logFd = fs.openSync(p.logPath, 'a');
}

function logWrite(p: Proc, text: string) {
  try {
    if (p.logFd === null) openLog(p);
    if (p.logSize > LOG_MAX) {
      fs.closeSync(p.logFd!);
      try { fs.renameSync(p.logPath, p.logPath + '.old'); } catch {}
      p.logFd = fs.openSync(p.logPath, 'a');
      p.logSize = 0;
    }
    const buf = Buffer.from(text, 'utf8');
    fs.writeSync(p.logFd!, buf);
    p.logSize += buf.length;
  } catch {}
}

const panel = (p: Proc, msg: string) => logWrite(p, `[panel] ${msg}\n`);

function trimIncompleteUtf8(buf: Buffer): Buffer {
  for (let back = 1; back <= 3 && back <= buf.length; back++) {
    const b = buf[buf.length - back];
    if ((b & 0xc0) === 0x80) continue;
    if (b >= 0xc0) {
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      return back < need ? buf.subarray(0, buf.length - back) : buf;
    }
    return buf;
  }
  return buf;
}

export function readLog(uid: string, relIn: unknown, from: number): { text: string; offset: number; size: number; reset: boolean } {
  const rel = joinRel(segments(relIn));
  const file = logPathFor(uid, rel);
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return { text: '', offset: 0, size: 0, reset: from > 0 }; }
  let start = from;
  let reset = false;
  if (!Number.isFinite(from) || from < 0) start = Math.max(0, size - 60000);
  else if (from > size) { start = 0; reset = true; }
  const len = Math.min(size - start, 200000);
  if (len <= 0) return { text: '', offset: start, size, reset };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    const chunk = trimIncompleteUtf8(buf.subarray(0, n));
    return { text: chunk.toString('utf8'), offset: start + chunk.length, size, reset };
  } finally {
    fs.closeSync(fd);
  }
}

export function clearLog(uid: string, relIn: unknown) {
  const rel = joinRel(segments(relIn));
  const p = procs.get(keyOf(uid, rel));
  try { fs.truncateSync(logPathFor(uid, rel), 0); } catch {}
  if (p) p.logSize = 0;
}

// ---------------- الإعدادات الدائمة ----------------

interface Flags { keepAlive: boolean; running: boolean }
const flagsFile = (uid: string) => internalDir(uid, 'processes.json');

function readFlags(uid: string): Record<string, Flags> {
  try { return JSON.parse(fs.readFileSync(flagsFile(uid), 'utf8')); } catch { return {}; }
}

function setFlag(uid: string, rel: string, patch: Partial<Flags>) {
  if (isShuttingDown()) return;
  try {
    const all = readFlags(uid);
    all[rel] = { keepAlive: true, running: false, ...all[rel], ...patch };
    const file = flagsFile(uid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(all));
    fs.renameSync(file + '.tmp', file);
  } catch {}
}

function dropFlag(uid: string, rel: string) {
  try {
    const all = readFlags(uid);
    if (!(rel in all)) return;
    delete all[rel];
    fs.writeFileSync(flagsFile(uid), JSON.stringify(all));
  } catch {}
}

// ---------------- إنهاء العمليات ----------------

function killTree(child: ChildProcess, force = false) {
  const pid = child.pid;
  if (!pid) return;
  if (IS_WIN) {
    try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); } catch {}
    return;
  }
  const sig = force ? 'SIGKILL' : 'SIGTERM';
  try { process.kill(-pid, sig); } catch { try { child.kill(sig); } catch {} }
  if (!force) {
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
      }
    }, 4000).unref();
  }
}

// ---------------- التشغيل ----------------

function newProc(uid: string, rel: string, kind: 'script' | 'pip', keepAlive: boolean): Proc {
  const full = path.join(userDir(uid), ...rel.split('/'));
  return {
    uid, rel, full, kind, child: null, status: 'starting', startedAt: null, exitCode: null, restarts: 0, quickCrashes: 0,
    keepAlive, stopRequested: false, timer: null, logPath: logPathFor(uid, rel), logSize: 0, logFd: null,
  };
}

function findRequirements(p: Proc): string | null {
  const here = path.join(path.dirname(p.full), 'requirements.txt');
  if (fs.existsSync(here)) return here;
  const root = path.join(userDir(p.uid), 'requirements.txt');
  return fs.existsSync(root) ? root : null;
}

function runPip(p: Proc, py: Interp, reqFile: string): Promise<number> {
  return new Promise(resolve => {
    const site = internalDir(p.uid, 'site-packages');
    fs.mkdirSync(site, { recursive: true });
    const child = spawn(py.cmd, [...py.args, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade', '--target', site, '-r', reqFile], {
      cwd: path.dirname(reqFile), env: buildEnv(p.uid), stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true,
    });
    p.child = child;
    child.stdout!.setEncoding('utf8').on('data', d => logWrite(p, d));
    child.stderr!.setEncoding('utf8').on('data', d => logWrite(p, d));
    child.on('error', e => { panel(p, `pip could not start: ${e.message}`); resolve(-1); });
    child.on('close', code => { p.child = null; resolve(code ?? -1); });
  });
}

const reqStateFile = (uid: string) => internalDir(uid, 'requirements-state.json');
const reqHash = (file: string) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

function needsInstall(uid: string, reqFile: string): boolean {
  try {
    if (!fs.existsSync(internalDir(uid, 'site-packages'))) return true;
    const st = JSON.parse(fs.readFileSync(reqStateFile(uid), 'utf8'));
    return st[reqFile] !== reqHash(reqFile);
  } catch { return true; }
}

function markInstalled(uid: string, reqFile: string) {
  let st: Record<string, string> = {};
  try { st = JSON.parse(fs.readFileSync(reqStateFile(uid), 'utf8')); } catch {}
  st[reqFile] = reqHash(reqFile);
  try { fs.mkdirSync(path.dirname(reqStateFile(uid)), { recursive: true }); fs.writeFileSync(reqStateFile(uid), JSON.stringify(st)); } catch {}
}

function finish(p: Proc, status: Status) {
  p.child = null;
  p.status = status;
}

async function launch(p: Proc) {
  p.stopRequested = false;
  p.exitCode = null;
  p.status = 'starting';
  const lang = RUNNABLE[extOf(p.rel)];

  // ---- مجموعة المكتبات ----
  if (p.kind === 'pip') {
    const py = findPython();
    if (!py) { panel(p, 'Python was not found on this machine. Install Python 3 and restart the panel.'); finish(p, 'crashed'); return; }
    p.status = 'installing';
    panel(p, `Installing packages from ${p.rel} ...`);
    const code = await runPip(p, py, p.full);
    if (p.stopRequested) { panel(p, 'Installation stopped.'); finish(p, 'stopped'); return; }
    if (code === 0) { markInstalled(p.uid, p.full); panel(p, 'Packages installed successfully.'); finish(p, 'stopped'); }
    else { panel(p, `Installation failed (exit code ${code}).`); p.exitCode = code; finish(p, 'crashed'); }
    return;
  }

  const interp = interpreterFor(lang);
  if (!interp) {
    panel(p, 'Python was not found on this machine. Install Python 3 (and tick "Add to PATH"), then restart the panel.');
    finish(p, 'crashed');
    setFlag(p.uid, p.rel, { running: false });
    return;
  }

  if (lang === 'python') {
    const req = findRequirements(p);
    if (req && needsInstall(p.uid, req)) {
      p.status = 'installing';
      panel(p, 'Installing requirements (first run or requirements changed)...');
      const code = await runPip(p, interp, req);
      if (p.stopRequested) { panel(p, 'Stopped.'); finish(p, 'stopped'); setFlag(p.uid, p.rel, { running: false }); return; }
      if (code === 0) { markInstalled(p.uid, req); panel(p, 'Requirements installed.'); }
      else panel(p, `Requirements installation failed (exit code ${code}). Starting the script anyway.`);
    }
  }

  if (p.stopRequested) { finish(p, 'stopped'); return; }
  if (!fs.existsSync(p.full)) { panel(p, 'The script file no longer exists.'); finish(p, 'crashed'); setFlag(p.uid, p.rel, { running: false }); return; }

  const args = [...interp.args, ...(lang === 'python' ? ['-u'] : []), path.basename(p.full)];
  let child: ChildProcess;
  try {
    child = spawn(interp.cmd, args, {
      cwd: path.dirname(p.full), env: buildEnv(p.uid), stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true,
    });
  } catch (e: any) {
    panel(p, `Failed to start: ${e.message}`);
    finish(p, 'crashed');
    return;
  }
  p.child = child;
  p.status = 'running';
  p.startedAt = Date.now();
  panel(p, `Started ${p.rel} (PID ${child.pid})`);

  child.stdout!.setEncoding('utf8').on('data', d => logWrite(p, d));
  child.stderr!.setEncoding('utf8').on('data', d => logWrite(p, d));

  let errored = false;
  child.on('error', (e: any) => {
    errored = true;
    panel(p, e.code === 'ENOENT' ? `"${interp.cmd}" is not installed on this machine.` : `Failed to start: ${e.message}`);
    finish(p, 'crashed');
    setFlag(p.uid, p.rel, { running: false });
  });

  child.on('close', (code, signal) => {
    if (errored) return;
    const ranMs = Date.now() - (p.startedAt || Date.now());
    p.child = null;
    p.exitCode = code;
    panel(p, `Process exited (${code !== null ? `code ${code}` : `signal ${signal}`}) after ${Math.round(ranMs / 1000)}s`);
    if (isShuttingDown()) { p.status = 'stopped'; return; }
    if (p.stopRequested || code === 0) {
      p.status = 'stopped';
      setFlag(p.uid, p.rel, { running: false });
      return;
    }
    p.status = 'crashed';
    if (!p.keepAlive) { setFlag(p.uid, p.rel, { running: false }); return; }
    p.quickCrashes = ranMs > 60000 ? 0 : p.quickCrashes + 1;
    if (p.quickCrashes > 8) {
      panel(p, 'The script keeps crashing right after it starts. Auto-restart has been turned off.');
      setFlag(p.uid, p.rel, { running: false });
      return;
    }
    const delay = Math.min(30000, 1000 * 2 ** Math.min(p.quickCrashes, 5));
    panel(p, `Restarting in ${Math.round(delay / 1000)}s ...`);
    p.status = 'restarting';
    p.timer = setTimeout(() => { p.timer = null; p.restarts++; launch(p); }, delay);
  });
}

// ---------------- الواجهة العامة ----------------

function validateRunnable(uid: string, relIn: unknown): { rel: string; lang: 'python' | 'node' | 'php' } {
  const segs = segments(relIn);
  if (!segs.length) throw new WsError(400, 'Invalid path');
  const rel = joinRel(segs);
  const lang = RUNNABLE[extOf(rel)];
  if (!lang) throw new WsError(400, 'Only .py, .js and .php files can be run');
  const full = path.join(userDir(uid), ...segs);
  let st: fs.Stats;
  try { st = fs.lstatSync(full); } catch { throw new WsError(404, 'File not found'); }
  if (!st.isFile()) throw new WsError(400, 'This is not a file');
  return { rel, lang };
}

function countActive(uid: string) {
  let n = 0;
  for (const p of procs.values()) if (ownerOf(p.uid) === ownerOf(uid) && p.kind === 'script' && isActive(p)) n++;
  return n;
}

export function startScript(uid: string, relIn: unknown, opts: { keepAlive?: boolean } = {}) {
  const { rel } = validateRunnable(uid, relIn);
  const key = keyOf(uid, rel);
  const existing = procs.get(key);
  if (existing && isActive(existing)) throw new WsError(409, 'This script is already running');

  const isAdmin = getDoc('users', uid)?.role === 'admin';
  if (!isAdmin && limitsRun.perUser > 0 && countActive(uid) >= limitsRun.perUser) {
    throw new WsError(429, `You can run up to ${limitsRun.perUser} scripts at the same time. Stop one first.`);
  }
  let total = 0;
  for (const p of procs.values()) if (isActive(p)) total++;
  if (total >= limitsRun.total) throw new WsError(503, 'The server is busy right now. Try again in a moment.');

  const saved = readFlags(uid)[rel];
  const keepAlive = opts.keepAlive ?? saved?.keepAlive ?? true;
  const p = newProc(uid, rel, 'script', keepAlive);
  if (existing) {
    p.restarts = existing.restarts;
    if (existing.logFd !== null) { try { fs.closeSync(existing.logFd); } catch {} }
  }
  procs.set(key, p);
  setFlag(uid, rel, { running: true, keepAlive });
  panel(p, '----------------------------------------');
  launch(p).catch(e => { panel(p, `Unexpected error: ${e?.message || e}`); finish(p, 'crashed'); });
  return info(p);
}

export function installRequirements(uid: string, relIn: unknown) {
  const segs = segments(relIn);
  const rel = joinRel(segs);
  if (!/\.txt$/i.test(rel)) throw new WsError(400, 'Choose a requirements .txt file');
  const full = path.join(userDir(uid), ...segs);
  if (!fs.existsSync(full)) throw new WsError(404, 'File not found');
  const key = keyOf(uid, rel);
  const existing = procs.get(key);
  if (existing && isActive(existing)) throw new WsError(409, 'Already installing');
  const p = newProc(uid, rel, 'pip', false);
  procs.set(key, p);
  launch(p).catch(e => { panel(p, `Unexpected error: ${e?.message || e}`); finish(p, 'crashed'); });
  return info(p);
}

export function stopScript(uid: string, relIn: unknown) {
  const rel = joinRel(segments(relIn));
  const p = procs.get(keyOf(uid, rel));
  if (!p) { setFlag(uid, rel, { running: false }); return; }
  p.stopRequested = true;
  if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  setFlag(uid, rel, { running: false });
  if (p.child) killTree(p.child);
  else if (p.status === 'restarting' || p.status === 'crashed') { p.status = 'stopped'; panel(p, 'Stopped.'); }
}

export async function restartScript(uid: string, relIn: unknown) {
  const rel = joinRel(segments(relIn));
  stopScript(uid, rel);
  const p = procs.get(keyOf(uid, rel));
  for (let i = 0; i < 60 && p && isActive(p); i++) await new Promise(r => setTimeout(r, 100));
  return startScript(uid, rel);
}

export function setKeepAlive(uid: string, relIn: unknown, value: boolean) {
  const rel = joinRel(segments(relIn));
  const p = procs.get(keyOf(uid, rel));
  if (p) p.keepAlive = value;
  setFlag(uid, rel, { keepAlive: value });
}

/** إيقاف كل ما يتبع مسارًا (عند حذف ملف أو مجلد) */
export function stopPrefix(uid: string, segs: string[]) {
  const rel = joinRel(segs);
  for (const p of procs.values()) {
    if (p.uid === uid && (p.rel === rel || p.rel.startsWith(rel + '/'))) {
      stopScript(uid, p.rel);
      dropFlag(uid, p.rel);
    }
  }
}

// ---------------- المعلومات ----------------

export interface ProcInfo {
  path: string; status: Status; pid: number | null; startedAt: number | null; uptime: number;
  restarts: number; keepAlive: boolean; exitCode: number | null; memoryKb: number | null; kind: 'script' | 'pip';
}

function rssKb(pid: number | undefined): number | null {
  if (!pid || process.platform !== 'linux') return null;
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

function info(p: Proc): ProcInfo {
  return {
    path: p.rel, status: p.status, pid: p.child?.pid ?? null, startedAt: p.startedAt,
    uptime: p.status === 'running' && p.startedAt ? Date.now() - p.startedAt : 0,
    restarts: p.restarts, keepAlive: p.keepAlive, exitCode: p.exitCode, memoryKb: rssKb(p.child?.pid), kind: p.kind,
  };
}

export function listProcesses(uid: string): ProcInfo[] {
  const out = new Map<string, ProcInfo>();
  for (const [rel, f] of Object.entries(readFlags(uid))) {
    if (!fs.existsSync(path.join(userDir(uid), ...rel.split('/')))) { dropFlag(uid, rel); continue; }
    out.set(rel, {
      path: rel, status: 'stopped', pid: null, startedAt: null, uptime: 0, restarts: 0,
      keepAlive: f.keepAlive, exitCode: null, memoryKb: null, kind: 'script',
    });
  }
  for (const [key, p] of procs) {
    if (p.uid !== uid) continue;
    if (!isActive(p) && (p.kind === 'pip' || !fs.existsSync(p.full))) {
      if (!fs.existsSync(p.full)) procs.delete(key);
      continue;
    }
    out.set(p.rel, info(p));
  }
  const order: Record<string, number> = { running: 0, installing: 1, starting: 1, restarting: 2, crashed: 3, stopped: 4 };
  return [...out.values()].sort((a, b) => order[a.status] - order[b.status] || a.path.localeCompare(b.path));
}

export function stopAll(uid: string) {
  const rels = new Set<string>(Object.keys(readFlags(uid)));
  for (const p of procs.values()) if (p.uid === uid) rels.add(p.rel);
  for (const rel of rels) {
    stopScript(uid, rel);
    dropFlag(uid, rel);
  }
}

export function activeCount(uid: string) { return countActive(uid); }

export function listAllActive() {
  const out: Array<ProcInfo & { uid: string; username: string }> = [];
  for (const p of procs.values()) {
    if (!isActive(p)) continue;
    out.push({ ...info(p), uid: p.uid, username: (authByUid.get(ownerOf(p.uid))?.email || '').split('@')[0] });
  }
  return out;
}

// ---------------- الإقلاع والإغلاق ----------------

export function restoreOnBoot() {
  let delay = 0;
  const scopes = new Set<string>(authByUid.keys());
  for (const [serverId, server] of listDocs('servers')) {
    if (typeof server.ownerId === 'string') scopes.add(`${server.ownerId}::server::${serverId}`);
  }
  for (const scope of scopes) {
    const prof = getDoc('users', ownerOf(scope));
    if (prof?.isBanned) continue;
    for (const [rel, f] of Object.entries(readFlags(scope))) {
      if (!f.running || !f.keepAlive) continue;
      setTimeout(() => {
        try { startScript(scope, rel, { keepAlive: true }); console.log(`[runner] restored ${rel}`); }
        catch (e: any) { console.log(`[runner] could not restore ${rel}: ${e.message}`); }
      }, (delay += 700)).unref();
    }
  }
}

onShutdown(async () => {
  const children: ChildProcess[] = [];
  for (const p of procs.values()) {
    p.stopRequested = true;
    if (p.timer) clearTimeout(p.timer);
    if (p.child) { children.push(p.child); killTree(p.child); }
  }
  if (children.length && !IS_WIN) {
    await new Promise(r => setTimeout(r, 1500));
    for (const c of children) if (c.exitCode === null && c.signalCode === null) killTree(c, true);
  }
});

process.on('exit', () => {
  for (const p of procs.values()) if (p.child && p.child.exitCode === null) {
    try { IS_WIN ? p.child.kill() : process.kill(-p.child.pid!, 'SIGKILL'); } catch {}
  }
});
