import type { Express } from 'express';
import { userFromHeader } from './api.ts';
import { resolveTxt } from 'node:dns/promises';
import { authByUid, authByEmail, getDoc, putDoc, removeDoc, listDocs, genId } from './store.ts';

const clean = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const now = () => Date.now();

/** Community chat, support inbox and domain registry. Domain records are requests/configuration;
 * public routing and TLS still require a configured reverse proxy and DNS at deployment. */
export function registerCommunityRoutes(app: Express) {
  const auth = (req: any, res: any, next: (e?: any) => void) => {
    const u = userFromHeader(req.headers.authorization);
    if (!u) return res.status(401).json({ message: 'يجب تسجيل الدخول' });
    req.communityUser = u; next();
  };
  const admin = (req: any, res: any, next: (e?: any) => void) => {
    if (!req.communityUser?.isAdmin) return res.status(403).json({ message: 'هذه العملية للمطور فقط' });
    next();
  };
  const audit = (actor: string, action: string, target: string, details = '') => {
    const id = genId(); putDoc('auditLogs', id, { actor, action, target, details: details.slice(0, 300), at: now() });
  };
  const settings = () => getDoc('communitySettings', 'global') || { chatEnabled: true, chatReadOnly: false, supportEnabled: true, maxMessageLength: 2000 };

  app.get('/api/community/settings', auth, (req: any, res) => res.json(settings()));
  app.post('/api/community/settings', auth, admin, (req: any, res) => {
    const old = settings();
    const next = {
      ...old,
      chatEnabled: typeof req.body?.chatEnabled === 'boolean' ? req.body.chatEnabled : old.chatEnabled,
      chatReadOnly: typeof req.body?.chatReadOnly === 'boolean' ? req.body.chatReadOnly : old.chatReadOnly,
      supportEnabled: typeof req.body?.supportEnabled === 'boolean' ? req.body.supportEnabled : old.supportEnabled,
    };
    putDoc('communitySettings', 'global', next); audit(req.communityUser.uid, 'community.settings', 'global'); res.json(next);
  });

  // Shared public room. Cursor-based polling avoids pretending to provide WebSocket push.
  app.get('/api/community/messages', auth, (req: any, res) => {
    const s = settings(); if (!s.chatEnabled) return res.status(423).json({ message: 'الدردشة مغلقة من الإدارة' });
    const after = Math.max(0, Number(req.query.after) || 0);
    const rows = listDocs('communityMessages').map(([id, d]) => ({ id, ...d })).filter(m => m.createdAt > after && !m.deletedAt).sort((a,b) => a.createdAt-b.createdAt).slice(-100);
    res.json({ messages: rows, serverTime: now(), readOnly: !!s.chatReadOnly });
  });
  app.post('/api/community/messages', auth, (req: any, res) => {
    const s = settings(); if (!s.chatEnabled) return res.status(423).json({ message: 'الدردشة مغلقة' });
    if (s.chatReadOnly && !req.communityUser.isAdmin) return res.status(423).json({ message: 'الدردشة للقراءة فقط حالياً' });
    const text = clean(req.body?.text, Math.min(2000, Number(s.maxMessageLength) || 2000));
    if (!text) return res.status(400).json({ message: 'اكتب رسالة أولاً' });
    const id = genId(), profile = getDoc('users', req.communityUser.uid) || {};
    const msg = { uid: req.communityUser.uid, displayName: clean(profile.displayName || req.communityUser.username, 50), text, createdAt: now() };
    putDoc('communityMessages', id, msg); res.status(201).json({ id, ...msg });
  });
  app.delete('/api/community/messages/:id', auth, (req: any, res) => {
    const msg = getDoc('communityMessages', req.params.id);
    if (!msg) return res.status(404).json({ message: 'الرسالة غير موجودة' });
    if (!req.communityUser.isAdmin && msg.uid !== req.communityUser.uid) return res.status(403).json({ message: 'غير مسموح' });
    removeDoc('communityMessages', req.params.id); audit(req.communityUser.uid, 'chat.message.delete', req.params.id); res.json({ ok: true });
  });

  app.post('/api/support/tickets', auth, (req: any, res) => {
    if (!settings().supportEnabled) return res.status(423).json({ message: 'الدعم مغلق مؤقتاً' });
    const text = clean(req.body?.text, 3000); if (!text) return res.status(400).json({ message: 'اكتب تفاصيل طلبك' });
    const id = genId(); putDoc('supportTickets', id, { uid: req.communityUser.uid, subject: clean(req.body?.subject, 100) || 'طلب دعم', status: 'open', messages: [{ uid: req.communityUser.uid, text, at: now() }], createdAt: now(), updatedAt: now() });
    res.status(201).json({ id });
  });
  app.get('/api/support/tickets', auth, (req: any, res) => {
    const rows = listDocs('supportTickets').filter(([,d]) => req.communityUser.isAdmin || d.uid === req.communityUser.uid).map(([id,d]) => ({ id, ...d })).sort((a,b) => b.updatedAt-a.updatedAt);
    res.json({ tickets: rows });
  });
  app.post('/api/support/tickets/:id/reply', auth, (req: any, res) => {
    const ticket = getDoc('supportTickets', req.params.id); if (!ticket) return res.status(404).json({ message: 'التذكرة غير موجودة' });
    if (!req.communityUser.isAdmin && ticket.uid !== req.communityUser.uid) return res.status(403).json({ message: 'غير مسموح' });
    const text = clean(req.body?.text, 3000); if (!text) return res.status(400).json({ message: 'الرد فارغ' });
    const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
    messages.push({ uid: req.communityUser.uid, text, at: now(), admin: !!req.communityUser.isAdmin });
    putDoc('supportTickets', req.params.id, { ...ticket, messages: messages.slice(-500), status: req.communityUser.isAdmin ? 'answered' : 'open', updatedAt: now() }); res.json({ ok: true });
  });
  app.delete('/api/support/tickets/:id/messages/:index', auth, admin, (req: any, res) => {
    const ticket = getDoc('supportTickets', req.params.id); if (!ticket) return res.status(404).json({ message: 'التذكرة غير موجودة' });
    const index = Number(req.params.index); const messages = Array.isArray(ticket.messages) ? [...ticket.messages] : [];
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) return res.status(404).json({ message: 'الرسالة غير موجودة' });
    messages.splice(index, 1); putDoc('supportTickets', req.params.id, { ...ticket, messages, updatedAt: now() });
    audit(req.communityUser.uid, 'support.message.delete', `${req.params.id}:${index}`); res.json({ ok: true });
  });
  app.delete('/api/support/tickets/:id', auth, (req: any, res) => {
    const ticket = getDoc('supportTickets', req.params.id); if (!ticket) return res.status(404).json({ message: 'التذكرة غير موجودة' });
    if (!req.communityUser.isAdmin && ticket.uid !== req.communityUser.uid) return res.status(403).json({ message: 'غير مسموح' });
    removeDoc('supportTickets', req.params.id); audit(req.communityUser.uid, 'support.ticket.delete', req.params.id); res.json({ ok: true });
  });

  app.post('/api/support/tickets/:id/status', auth, admin, (req: any, res) => {
    const ticket = getDoc('supportTickets', req.params.id); if (!ticket) return res.status(404).json({ message: 'التذكرة غير موجودة' });
    const status = ['open','in_progress','answered','closed'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ message: 'حالة غير صالحة' });
    putDoc('supportTickets', req.params.id, { ...ticket, status, updatedAt: now() }); audit(req.communityUser.uid, 'support.status', req.params.id, status); res.json({ ok: true });
  });

  // Domain registry. A verified record is not live until reverse-proxy routing and TLS are configured.
  app.get('/api/domains', auth, (req: any, res) => {
    const rows = listDocs('domains').filter(([,d]) => req.communityUser.isAdmin || d.uid === req.communityUser.uid).map(([id,d]) => ({ id, ...d })); res.json({ domains: rows });
  });
  app.post('/api/domains', auth, (req: any, res) => {
    const domain = clean(req.body?.domain, 253).toLowerCase().replace(/\.$/, '');
    const projectId = clean(req.body?.projectId, 100);
    if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return res.status(400).json({ message: 'اسم الدومين غير صالح' });
    const duplicate = listDocs('domains').some(([,d]) => d.domain === domain);
    if (duplicate) return res.status(409).json({ message: 'الدومين مستخدم بالفعل' });
    const id = genId(), token = `nexus-verify=${genId()}`;
    putDoc('domains', id, { uid: req.communityUser.uid, domain, projectId, verificationToken: token, status: 'pending_dns', sslStatus: 'not_configured', createdAt: now() });
    res.status(201).json({ id, domain, verificationToken: token, status: 'pending_dns', note: 'يلزم إضافة سجل DNS والتحقق ثم إعداد reverse proxy وSSL على الخادم' });
  });
  app.post('/api/admin/domains/:id/verify', auth, admin, async (req: any, res) => {
    const d = getDoc('domains', req.params.id); if (!d) return res.status(404).json({ message: 'الدومين غير موجود' });
    try {
      const records = await resolveTxt(d.domain);
      const flat = records.flat().join(' ');
      if (!flat.includes(d.verificationToken)) return res.status(409).json({ message: 'لم يتم العثور على رمز التحقق في سجلات TXT' });
      putDoc('domains', req.params.id, { ...d, status: 'dns_verified', verifiedAt: now() });
      audit(req.communityUser.uid, 'domain.verify', req.params.id); res.json({ ok: true, status: 'dns_verified', note: 'تم التحقق من DNS. يلزم إعداد reverse proxy وSSL لتفعيل الرابط العام.' });
    } catch { res.status(422).json({ message: 'تعذر قراءة DNS. تأكد من إضافة سجل TXT وانتظر انتشار DNS.' }); }
  });

  app.delete('/api/domains/:id', auth, (req: any, res) => {
    const d = getDoc('domains', req.params.id); if (!d) return res.status(404).json({ message: 'الدومين غير موجود' });
    if (!req.communityUser.isAdmin && d.uid !== req.communityUser.uid) return res.status(403).json({ message: 'غير مسموح' });
    removeDoc('domains', req.params.id); audit(req.communityUser.uid, 'domain.delete', req.params.id); res.json({ ok: true });
  });

  app.get('/api/admin/community/users', auth, admin, (_req: any, res) => {
    const users = listDocs('users').map(([id,u]) => ({ uid:id, email:u.email, displayName:u.displayName, role:u.role, isBanned:!!u.isBanned, createdAt:u.createdAt })); res.json({ users });
  });
  app.post('/api/admin/community/users/:uid/ban', auth, admin, (req: any, res) => {
    if (req.params.uid === req.communityUser.uid) return res.status(400).json({ message: 'لا يمكنك حظر حسابك الحالي' });
    const u = getDoc('users', req.params.uid); if (!u) return res.status(404).json({ message: 'الحساب غير موجود' });
    putDoc('users', req.params.uid, { ...u, isBanned: req.body?.banned !== false }); audit(req.communityUser.uid, 'user.ban', req.params.uid); res.json({ ok: true });
  });
  app.delete('/api/admin/community/users/:uid', auth, admin, (req: any, res) => {
    const uid = req.params.uid; if (uid === req.communityUser.uid) return res.status(400).json({ message: 'لا يمكنك حذف حسابك الحالي' });
    const rec = authByUid.get(uid); if (!rec) return res.status(404).json({ message: 'الحساب غير موجود' });
    // Preserve project/payment records for audit; revoke login and suspend the profile.
    authByUid.delete(uid); authByEmail.delete(rec.email);
    const u = getDoc('users', uid); if (u) putDoc('users', uid, { ...u, isBanned: true, deletedAt: now(), displayName: 'Deleted user', email: '' });
    audit(req.communityUser.uid, 'user.delete_access', uid, 'Login revoked; financial and project records retained'); res.json({ ok: true, note: 'تم تعطيل تسجيل الدخول مع الاحتفاظ بالسجلات المرتبطة للمراجعة' });
  });
}
