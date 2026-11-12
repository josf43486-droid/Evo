import fs from 'fs';
import { userFromHeader } from './api.ts';
import * as ws from './workspace.ts';
import * as run from './runner.ts';
import * as shares from './share-links.ts';
import { reportSecurityIncident } from './security.ts';
import { DATA_DIR, getDoc } from './store.ts';
import path from 'node:path';
import { analyzeProject } from './project-analyzer.ts';

const { WsError, limits } = ws;

type AuthedUser = { uid: string; username: string; isAdmin: boolean };

const asStr = (v: unknown) => (typeof v === 'string' ? v : undefined);
const asPaths = (v: unknown): string[] => {
  if (!Array.isArray(v) || !v.length || v.length > 200 || v.some(x => typeof x !== 'string')) throw new WsError(400, 'Invalid selection');
  return v as string[];
};

/** يسجّل كل مسارات /api/ws على تطبيق express. raw = express.raw */
export function registerWorkspaceRoutes(app: any, raw: (opts: any) => any) {
  const migrationReady = ws.prepareServerWorkspaces();

  const guard = (fn: (req: any, res: any, u: AuthedUser) => Promise<void> | void) => async (req: any, res: any) => {
    const u = userFromHeader(req.headers.authorization);
    if (!u) return res.status(401).json({ message: 'Please log in again' });
    try {
      const serverId = asStr(req.query?.serverId) || asStr(req.body?.serverId);
      if (serverId) {
        await migrationReady;
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(serverId)) throw new WsError(400, 'Invalid server');
        const server = getDoc('servers', serverId);
        if (!server) throw new WsError(404, 'Server not found');
        if (!u.isAdmin && server.ownerId !== u.uid) throw new WsError(403, 'Access denied');
        await ws.initializeServerWorkspace(server.ownerId || u.uid, serverId, false);
        req.workspaceUid = ws.serverWorkspaceKey(server.ownerId || u.uid, serverId);
      } else {
        req.workspaceUid = u.uid;
      }
      await fn(req, res, u);
    } catch (e: any) {
      if (res.headersSent) { res.destroy(); return; } // فشل أثناء البث (مثل النسخة الاحتياطية)
      if (e instanceof WsError) return res.status(e.status).json({ message: e.message });
      console.error('[files]', e);
      reportSecurityIncident('workspace_internal_error', req, 'Workspace handler failed', true);
      if (!res.headersSent) res.status(500).json({ message: 'Server error' });
    }
  };

  const adminOnly = (fn: (req: any, res: any, u: AuthedUser) => Promise<void> | void) =>
    guard((req, res, u) => {
      if (!u.isAdmin) throw new WsError(403, 'Admins only');
      return fn(req, res, u);
    });

  // ---------- الحالة العامة (لوحة التحكم) ----------
  app.get('/api/ws/status', guard(async (req, res, u) => {
    const py = run.findPython();
    res.json({
      username: u.username,
      isAdmin: u.isAdmin,
      usage: { used: await ws.usage(req.workspaceUid), quota: ws.quotaFor(req.workspaceUid) },
      python: py ? py.label : null,
      limits: { maxUpload: limits.maxUpload, maxRunning: u.isAdmin ? 0 : run.limitsRun.perUser, trashDays: limits.trashDays },
      processes: run.listProcesses(req.workspaceUid),
    });
  }));

  // ---------- تحليل بنية المشروع واكتشاف ملفات التشغيل ----------
  app.post('/api/ws/analyze', guard(async (req, res, u) => {
    res.json(await analyzeProject(req.workspaceUid, req.body?.path ?? ''));
  }));

  // ---------- الملفات ----------
  app.get('/api/ws/list', guard(async (req, res, u) => {
    res.json({ entries: await ws.list(req.workspaceUid, req.query.path) });
  }));

  app.get('/api/ws/read', guard(async (req, res, u) => {
    res.json(await ws.readFile(req.workspaceUid, req.query.path));
  }));

  app.get('/api/ws/raw', guard(async (req, res, u) => {
    const f = await ws.rawFile(req.workspaceUid, req.query.path);
    const inline = req.query.inline === '1' && ws.imageMime(f.name);
    res.setHeader('Content-Type', inline ? ws.imageMime(f.name)! : 'application/octet-stream');
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    fs.createReadStream(f.full).on('error', () => res.destroy()).pipe(res);
  }));

  app.post('/api/ws/write', guard(async (req, res, u) => {
    await ws.writeText(req.workspaceUid, req.body?.path, req.body?.content);
    res.json({ ok: true });
  }));

  app.post('/api/ws/create', guard(async (req, res, u) => {
    await ws.createFile(req.workspaceUid, req.body?.path, asStr(req.body?.content) ?? '');
    res.json({ ok: true });
  }));

  app.post('/api/ws/mkdir', guard(async (req, res, u) => {
    await ws.makeDir(req.workspaceUid, req.body?.path);
    res.json({ ok: true });
  }));

  app.post('/api/ws/rename', guard(async (req, res, u) => {
    run.stopPrefix(req.workspaceUid, ws.segments(req.body?.from));
    await ws.rename(req.workspaceUid, req.body?.from, req.body?.to);
    res.json({ ok: true });
  }));

  app.post('/api/ws/delete', guard(async (req, res, u) => {
    let n = 0;
    for (const p of asPaths(req.body?.paths)) {
      const segs = ws.segments(p);
      run.stopPrefix(req.workspaceUid, segs);
      await ws.moveToTrash(req.workspaceUid, segs);
      n++;
    }
    res.json({ moved: n });
  }));

  app.put('/api/ws/upload', raw({ type: () => true, limit: limits.maxUpload + 4096 }), guard(async (req, res, u) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.json(await ws.upload(req.workspaceUid, req.query.path, req.query.name, data, req.query.overwrite === '1'));
  }));

  app.post('/api/ws/extract', guard(async (req, res, u) => {
    const file = await ws.rawFile(req.workspaceUid, req.body?.path);
    const segs = ws.segments(req.body?.path);
    const zip = await fs.promises.readFile(file.full);
    res.json(await ws.extractZip(req.workspaceUid, segs.slice(0, -1).join('/'), zip, req.body?.overwrite === true));
  }));

  app.put('/api/ws/extract-upload', raw({ type: () => true, limit: limits.maxUpload + 4096 }), guard(async (req, res, u) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.json(await ws.extractZip(req.workspaceUid, req.query.path, data, req.query.overwrite === '1'));
  }));

  app.get('/api/ws/backup', guard(async (_req, res, u) => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${u.username}-files-${new Date().toISOString().slice(0, 10)}.zip"`);
    await ws.writeBackup(req.workspaceUid, b => new Promise<void>(resolve => { if (res.write(b)) resolve(); else res.once('drain', () => resolve()); }));
    res.end();
  }));

  // ---------- روابط المشاركة الآمنة ----------
  app.get('/api/ws/shares', guard(async (_req, res, u) => {
    res.json({ links: await shares.listShares(req.workspaceUid) });
  }));
  app.post('/api/ws/shares', guard(async (req, res, u) => {
    res.status(201).json(await shares.createShare(req.workspaceUid, req.body?.path, req.body?.expiresInHours));
  }));
  app.delete('/api/ws/shares/:token', guard(async (req, res, u) => {
    await shares.revokeShare(req.workspaceUid, req.params.token);
    res.json({ ok: true });
  }));

  // ---------- سلة المحذوفات ----------
  app.get('/api/ws/trash', guard(async (_req, res, u) => {
    res.json({ items: await ws.listTrash(req.workspaceUid) });
  }));
  app.post('/api/ws/trash/restore', guard(async (req, res, u) => {
    res.json({ path: await ws.restoreTrash(req.workspaceUid, req.body?.id) });
  }));
  app.post('/api/ws/trash/purge', guard(async (req, res, u) => {
    await ws.purgeTrash(req.workspaceUid, req.body?.id);
    res.json({ ok: true });
  }));
  app.post('/api/ws/trash/empty', guard(async (_req, res, u) => {
    await ws.purgeTrash(req.workspaceUid);
    res.json({ ok: true });
  }));

  // ---------- التشغيل ----------
  app.post('/api/ws/run', guard(async (req, res, u) => {
    res.json(run.startScript(req.workspaceUid, req.body?.path, { keepAlive: typeof req.body?.keepAlive === 'boolean' ? req.body.keepAlive : undefined }));
  }));
  app.post('/api/ws/stop', guard(async (req, res, u) => {
    run.stopScript(req.workspaceUid, req.body?.path);
    res.json({ ok: true });
  }));
  app.post('/api/ws/restart', guard(async (req, res, u) => {
    res.json(await run.restartScript(req.workspaceUid, req.body?.path));
  }));
  app.post('/api/ws/keepalive', guard(async (req, res, u) => {
    run.setKeepAlive(req.workspaceUid, req.body?.path, req.body?.value === true);
    res.json({ ok: true });
  }));
  app.post('/api/ws/install', guard(async (req, res, u) => {
    res.json(run.installRequirements(req.workspaceUid, req.body?.path));
  }));
  app.get('/api/ws/logs', guard(async (req, res, u) => {
    const from = req.query.from === undefined ? -1 : Number(req.query.from);
    res.json(run.readLog(req.workspaceUid, req.query.path, from));
  }));
  app.post('/api/ws/logs/clear', guard(async (req, res, u) => {
    run.clearLog(req.workspaceUid, req.body?.path);
    res.json({ ok: true });
  }));

  // ---------- الأدمن ----------
  app.get('/api/ws/admin/overview', adminOnly(async (_req, res) => {
    res.json({ processes: run.listAllActive(), limits: { perUser: run.limitsRun.perUser, total: run.limitsRun.total } });
  }));
  app.post('/api/ws/admin/stop', adminOnly(async (req, res) => {
    const uid = asStr(req.body?.uid);
    if (!uid) throw new WsError(400, 'Invalid user');
    run.stopScript(uid, req.body?.path);
    res.json({ ok: true });
  }));
  app.get('/api/ws/admin/security-events', adminOnly(async (req, res) => {
    const requested = Number(req.query.limit || 100);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(300, Math.floor(requested))) : 100;
    const file = path.join(DATA_DIR, 'security-events.jsonl');
    let events: any[] = [];
    try {
      const lines = (await fs.promises.readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).slice(-limit).reverse();
      events = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    } catch { /* no security events recorded yet */ }
    res.json({ events, count: events.length, source: 'local-audit-log' });
  }));

  // ---------- صيانة ----------
  ws.purgeOldTrash().catch(() => {});
  setInterval(() => ws.purgeOldTrash().catch(() => {}), 6 * 3600 * 1000).unref();
  migrationReady.then(() => run.restoreOnBoot()).catch(e => console.error('[runner] restore after workspace migration failed:', e));
}
