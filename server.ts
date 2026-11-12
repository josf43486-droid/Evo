import './server/env.ts';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile, mkdir, rm } from 'fs/promises';
import os from 'os';
import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import crypto from 'node:crypto';
import { handleApi, authorizeServer } from './server/api.ts';
import { registerWorkspaceRoutes } from './server/ws-routes.ts';
import { ensureAdminAccount } from './server/admin.ts';
import * as shareLinks from './server/share-links.ts';
import { notifyOwner } from './server/notifications.ts';
import { putDoc } from './server/store.ts';
import { installSecurity, reportSecurityIncident } from './server/security.ts';
import { registerCommunityRoutes } from './server/community.ts';
import * as workspaceRunner from './server/runner.ts';
import { serverWorkspaceKey } from './server/workspace.ts';

// لا نسمح لخطأ غير متوقع بإيقاف الموقع بالكامل
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e); void notifyOwner(`EVO | خطأ غير معالج\n${String(e).slice(0, 1000)}`); });
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e); void notifyOwner(`EVO | خطأ تشغيل حرج\n${String(e).slice(0, 1000)}`); });

const execAsync = promisify(exec);

// Process manager to track running servers and their logs
const activeProcesses = new Map<string, { process: ChildProcess; logs: string[] }>();

const addLog = (serverId: string, message: string) => {
  const data = activeProcesses.get(serverId);
  if (data) {
    const timestamp = new Date().toLocaleTimeString();
    // Split by newline but keep empty lines if they are not just whitespace
    const lines = message.split(/\r?\n/);
    lines.forEach(line => {
      if (line.trim() || lines.length === 1) {
        data.logs.push(`[${timestamp}] ${line}`);
      }
    });
    // Keep only last 2000 lines
    if (data.logs.length > 2000) {
      data.logs = data.logs.slice(-2000);
    }
  }
};

async function startServer() {
  const app = express();
  await ensureAdminAccount();

  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
  installSecurity(app, isProd);

  // خلف Nginx/Cloudflare: فعّل TRUST_PROXY=1 ليقرأ عنوان الزائر الحقيقي
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use('/api', express.json({ limit: '3mb', strict: true }));

  // ربط حسابات تيليجرام: المستخدم يرسل /start للبوت، ثم نربط username مع chat_id.
  app.post('/telegram/webhook', express.json({ limit: '64kb' }), (req, res) => {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    const supplied = req.header('x-telegram-bot-api-secret-token') || '';
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
    const message = req.body?.message;
    const username = String(message?.from?.username || '').replace(/^@/, '').trim().toLowerCase();
    const chatId = message?.chat?.id;
    if (username && (typeof chatId === 'number' || typeof chatId === 'string')) {
      putDoc('telegramLinks', username, { username, chatId: String(chatId), linkedAt: Date.now() });
      if (process.env.TELEGRAM_BOT_TOKEN) {
        void fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: 'تم ربط حساب تيليجرام بإشعارات EVO. ستصلك تحديثات طلبات الدفع هنا.' }),
        }).catch(error => console.error('[telegram] welcome message failed:', error));
      }
    }
    res.sendStatus(200);
  });

  app.get('/s/:token', async (req, res) => {
    try {
      const file = await shareLinks.resolveShare(req.params.token);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(file.size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      fs.createReadStream(file.full).on('error', () => res.destroy()).pipe(res);
    } catch (e: any) {
      res.status(e?.status || 404).json({ message: e?.message || 'الرابط غير متاح' });
    }
  });

  // الحسابات وقاعدة البيانات
  const dataApi = async (req: express.Request, res: express.Response) => {
    const r = await handleApi({
      method: req.method,
      path: req.baseUrl + req.path,
      body: req.body,
      authorization: req.headers.authorization,
      ip: req.ip,
    });
    if (r.status === 401 && req.path === '/login' && req.baseUrl === '/api/auth') reportSecurityIncident('failed_login', req, 'Invalid login credentials', true);
    if (r.status >= 500) reportSecurityIncident('api_internal_error', req, 'API handler returned an internal error', true);
    res.status(r.status).json(r.body);
  };
  app.use('/api/auth', dataApi);
  app.use('/api/db', dataApi);

  // مساحة الملفات وتشغيل السكربتات
  registerWorkspaceRoutes(app, express.raw);
  registerCommunityRoutes(app);

  // التحقق من صلاحية التحكم بالسيرفر قبل أي تشغيل/إيقاف/سجلات
  const guard = (req: express.Request, res: express.Response, serverId: any) => {
    const a = authorizeServer(req.headers.authorization, String(serverId || ''));
    if (!a.ok) { res.status(a.status).json({ message: a.message }); return false; }
    return true;
  };

  // API routes go here
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/logs/:serverId', (req, res) => {
    const { serverId } = req.params;
    if (!guard(req, res, serverId)) return;
    const data = activeProcesses.get(serverId);
    if (!data) return res.status(404).json({ message: 'No active process found' });
    res.json({ logs: data.logs });
  });

  // Legacy command endpoint is intentionally disabled. All execution must go through
  // the authenticated workspace runner; this endpoint previously accepted arbitrary shell input.
  app.post('/api/execute', (_req, res) => {
    res.status(410).json({ message: 'تم إيقاف واجهة التشغيل القديمة لأسباب أمنية. استخدم محرك تشغيل مساحة العمل.' });
  });

  app.post('/api/stop', (req, res) => {
    const { serverId } = req.body;
    if (!guard(req, res, serverId)) return;
    const auth = authorizeServer(req.headers.authorization, String(serverId || ''));
    if (auth.ok) workspaceRunner.stopAll(serverWorkspaceKey(auth.uid, String(serverId)));
    const data = activeProcesses.get(serverId);
    if (data) {
      try {
        data.process.kill('SIGKILL');
      } catch (e) {
        console.error('Error killing process:', e);
      }
      activeProcesses.delete(serverId);
      return res.json({ status: 'stopped' });
    }
    res.json({ status: 'not_running' });
  });

  // أخطاء JSON غير صالح وغيرها
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.status >= 500) reportSecurityIncident('http_internal_error', req, 'Unhandled HTTP middleware error', true);
    res.status(err?.status || 400).json({ message: err?.type === 'entity.too.large' ? 'Request too large' : 'Bad request' });
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      console.error('لم يتم العثور على مجلد dist. شغّل: npm run build  ثم أعد التشغيل.');
      process.exit(1);
    }
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EVO يعمل على http://localhost:${PORT}`);
  });
}

startServer();
