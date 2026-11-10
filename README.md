# EVO

مشروع منصة استضافة متعددة الأنواع قيد التطوير. النسخة الحالية مبنية على React وTypeScript وVite وExpress، وتحتوي على إدارة ملفات وتشغيل أساسي لسكربتات Python وNode.js وPHP. تم اعتماد هوية EVO بهوية Kairo.

## تشغيل نسخة التطوير

1. ثبّت Node.js LTS.
2. انسخ `.env.example` إلى `.env`.
3. غيّر `ADMIN_USERNAME` و`ADMIN_PASSWORD` إلى بيانات خاصة قوية. كلمة المرور الافتراضية الموجودة في المثال يجب استبدالها قبل التشغيل.
4. نفّذ:

```bash
npm ci
npm run dev
```

افتح `http://localhost:3000`.

## روابط المشاركة الآمنة - المرحلة الأولى

تمت إضافة واجهات API لإنشاء روابط مشاركة مؤقتة للملفات، عرض روابط المستخدم، وإلغاء الرابط. الرابط العام ينزّل الملف كمرفق ولا يعرض HTML أو JavaScript مباشرة، ويستخدم رمزاً عشوائياً قوياً، مع انتهاء صلاحية من ساعة إلى 30 يوماً.

- `POST /api/ws/shares` مع `{ "path": "folder/file.zip", "expiresInHours": 168 }`
- `GET /api/ws/shares`
- `DELETE /api/ws/shares/:token`
- `GET /s/:token` رابط التنزيل العام

كل واجهات الإدارة تتطلب Bearer token صالحاً. تُحفظ بيانات الروابط داخل `data/share-links.json` بصلاحيات ملف مقيدة.

## تغييرات الأمان في هذه المرحلة

- تم تعطيل `POST /api/execute` القديم لأنه كان ينفذ أوامر من مدخلات المستخدم عبر shell. لا تستخدمه؛ يلزم استكمال ترحيل شاشة تفاصيل السيرفر إلى محرك مساحة العمل.
- أزيلت بيانات دخول المالك الثابتة من الكود. يتطلب التشغيل ضبط `ADMIN_USERNAME` و`ADMIN_PASSWORD` في `.env`.
- استُبعد مجلد `data/` والأسرار وملفات البيئة و`node_modules` من ملفات التوزيع عبر `.gitignore`.
- روابط المشاركة لا تسمح بعرض ملفات HTML/JS مباشرة، لتجنب تشغيل محتوى غير موثوق على نطاق المنصة.

## ما لم يُنفذ بعد

هذه نسخة تطوير أولية وليست إصدار إنتاج. لا تزال هناك مراحل مطلوبة، منها: تسجيل البريد الحقيقي وتأكيده، HTML static-site deployment والدومينات وHTTPS، التجربة المجانية وتجديدها، دفع USDT اليدوي ومراجعة الإثباتات، دمج واجهة إدارة الروابط، نقل تشغيل جميع المشاريع إلى Sandbox مع cgroups، واختبارات الضغط والأمان.

## تنبيه تشغيل

محرك التشغيل الحالي لا يوفّر عزلاً كاملاً بين المستخدمين. لا تعرض هذه النسخة للإنترنت أو لمستخدمين غير موثوقين قبل إكمال العزل الأمني واختبارات الإنتاج. كذلك لا توجد نتيجة بناء ناجحة مؤكدة في هذه الحزمة؛ يلزم تثبيت نظيف للاعتماديات ثم تشغيل `npm run build` على نظام الهدف.

## الخطط ووسائل الدفع المخصصة

من لوحة المالك افتح **الخطط ووسائل الدفع**. يمكن إنشاء خطة بمدة بالأيام وحدود خوادم وRAM وCPU وتخزين ومشاريع، أو تعديلها وتعطيلها وحذفها. ويمكن إضافة وسائل USDT مع تحديد الشبكة والعنوان، أو Vodafone Cash مع رقم المحفظة وتعليمات التحويل. تظهر الوسائل المفعلة فقط للمستخدمين.

طلبات الاشتراك تحفظ لقطة الخطة التي اعتمدها الخادم من الإعدادات (ولا تثق في حدود الموارد القادمة من المتصفح)، مع صورة إثبات التحويل ورقم العملية. الموافقة من لوحة المالك هي التي تفعّل الاشتراك، ويُحسب تاريخ الانتهاء من لحظة الموافقة. طلبات الشحن العادي تضيف الرصيد بعد الموافقة. لا يوجد تحقق تلقائي من صور التحويل أو من شبكة USDT؛ يجب مراجعة المعاملة فعلياً قبل قبولها.

## إشعارات Telegram

1. أنشئ بوت إشعارات خاصاً بك عبر BotFather، ولا تضع التوكن داخل ملفات الواجهة أو المستودع.
2. انسخ `.env.example` إلى `.env` واملأ `TELEGRAM_BOT_TOKEN`، واضبط `TELEGRAM_OWNER_USERNAME=vx_rw` ليوزر المالك.
3. عيّن قيمة طويلة وعشوائية في `TELEGRAM_WEBHOOK_SECRET`، ثم شغّل المنصة على عنوان HTTPS عام.
4. سجّل Webhook للبوت على `https://YOUR_DOMAIN/telegram/webhook` مع تمرير قيمة `secret_token` نفسها. بعد ذلك يرسل المالك والمستخدمون `/start` للبوت لربط حساباتهم.
5. يمكن بدلاً من ربط يوزر المالك استخدام `TELEGRAM_OWNER_CHAT_ID` كرقم chat_id مباشر.

ترسل المنصة تنبيهات طلبات الدفع وأخطاء API والأخطاء غير المعالجة إلى المالك. وتصل تحديثات قبول/رفض الطلب إلى المستخدم الذي سبق أن ربط حسابه بإرسال `/start` للبوت. لا يمكن للبوت مراسلة حساب Telegram لمجرد معرفة `@username`؛ يجب أن يبدأ المستخدم المحادثة أولاً.

## ملاحظات التشغيل والاختبار

- صورة إثبات الدفع تحفظ في قاعدة البيانات بحد أقصى 2MB للصورة، وتُستبعد من قوائم الطلبات الدورية حتى لا تتكرر حركة بياناتها؛ تُحمّل فقط عند فتح تفاصيل الطلب.
- انتهاء الاشتراك يعلّق السيرفر مع الاحتفاظ بملفاته. لا تحذف المنصة بيانات المشاريع تلقائياً عند الانتهاء.
- تنبيه: حدود RAM/CPU/التخزين المسجلة في الخطة لا تصبح عزلاً فعلياً إلا إذا ربطها مشغل الخوادم بقيود النظام (مثل cgroups/حاويات معزولة) على عقدة الاستضافة.

## مركز الحماية — Phase 3

تتضمن هذه النسخة طبقة حماية HTTP، وفحص Origin لطلبات التغيير، وحدود طلبات API وتسجيل الدخول، ورفض مسارات الفحص المشبوهة، وسجل أحداث أمني محلي محدود الحجم مع إخفاء جزء من عنوان IP. أضيفت صفحة **مركز الحماية** للمالك لعرض آخر الأحداث، وتنبيهات Telegram للأحداث الأمنية المتكررة والأخطاء الداخلية عند ضبط إعدادات البوت.

راجع `SECURITY.md` لمعرفة حدود الحماية ومتطلبات الإنتاج. اختبارات المساعدات الأمنية:

```bash
npm run test:security
```

هذه الإجراءات لا تستبدل عزل كل مشروع بحاوية rootless وحدود cgroups، ولا جدار حماية/WAF أمامي. لا تستخدم الاستضافة العامة متعددة المستخدمين قبل تنفيذ متطلبات الإنتاج المذكورة في `SECURITY.md`.

### Project analysis
The Files workspace includes **Analyze Project**. It scans the current project folder (bounded to 2,500 files and 12 directory levels), skips symlinks and common dependency/build folders, detects Python/Node/PHP/HTML entry-point candidates, and inspects common dependency manifests. The authenticated endpoint is `POST /api/ws/analyze` with `{ "path": "relative/project/folder" }`. The result is advisory: choose the intended entry point before starting a project. Static inspection is not malware certification and does not execute project code.

## Community, support and domain registry (expanded build)

This build adds authenticated REST endpoints under `/api/community`, `/api/support`, `/api/domains`, and `/api/admin/community`.

- Public room: `GET /api/community/messages?after=<timestamp>` and `POST /api/community/messages` with `{ "text": "..." }`. The browser polls for new messages; this is near-live polling, not WebSocket push.
- Moderation: `DELETE /api/community/messages/:id` (owner or admin). Admin can switch the room on/off or read-only through `POST /api/community/settings`.
- Support: `POST /api/support/tickets`, `GET /api/support/tickets`, `POST /api/support/tickets/:id/reply`, and admin-only status changes at `/api/support/tickets/:id/status`.
- Domains: `POST /api/domains` creates a pending domain request and TXT verification token. Admin can check the TXT record with `POST /api/admin/domains/:id/verify`; deletion is `DELETE /api/domains/:id`.
- Admin accounts: `GET /api/admin/community/users`, `POST /api/admin/community/users/:uid/ban`, and `DELETE /api/admin/community/users/:uid` revoke login access while preserving project/financial records for audit.

### Domain deployment requirement

DNS verification only proves control of the domain. It does **not** automatically publish the project. A production deployment still needs a reverse proxy/host router that maps the verified hostname to the correct isolated project, plus certificate provisioning/renewal (for example, ACME) and firewall rules. Until that infrastructure is configured, domain records remain registry entries and must not be presented as live URLs.

### Capacity and real-time behavior

The room has no fixed product-level member cap, but practical concurrent usage is limited by the Railway instance's CPU, RAM, network and persistent storage. Messages are persisted in the existing JSON document store. For a high-traffic deployment, migrate this data to a transactional database and use WebSockets or a message broker; polling is intentionally used here to avoid adding a new runtime service dependency.

### Account deletion behavior

The admin delete action revokes the user's login record and marks the profile deleted while retaining project/payment records and audit context. This is a soft deletion for traceability, not a hard purge of all personal data. A separate retention and erasure policy is required before offering irreversible deletion.

### Build verification

The source archive includes these modules, but this environment could not complete `npm ci` within the available execution window. Run `npm ci`, `npm run build`, and `npm run test:security` in the deployment environment before publishing. Domain routing, TLS automation, WebSocket push, and file attachments in support are not included in this phase.
