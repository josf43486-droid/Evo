
// ============================================================
//  إعدادات الموقع المركزية — عدّل هنا فقط
// ============================================================

/** اسم الموقع */
export const BRAND_FIRST = 'EVO';
export const BRAND_SECOND = '';
export const OWNER_NAME = 'Kairo';
export const OWNER_USERNAME = '@vx_rw';
export const OWNER_TELEGRAM_URL = 'https://t.me/Super_Evo_x/425';
export const BRAND_NAME = BRAND_FIRST;

/** بيانات الدعم */
export const SUPPORT_TELEGRAM_URL = OWNER_TELEGRAM_URL;
export const SUPPORT_EMAIL = 'yousefvipman@gmail.com';

/** نطاق تسجيل الدخول الداخلي */
export const AUTH_EMAIL_DOMAIN = 'nexus.internal';

export const usernameToEmail = (input: string) => {
  const v = input.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${AUTH_EMAIL_DOMAIN}`;
};

/** يعرض اسم المستخدم بدون الدومين الداخلي */
export const emailToUsername = (email?: string | null) =>
  (email || '').replace(`@${AUTH_EMAIL_DOMAIN}`, '');

export const USERNAME_REGEX = /^[a-z0-9._-]{3,20}$/;

/** مفتاح تخزين صورة الكونسول */
export const CONSOLE_BG_KEY = 'far3on_console_bg';
export const DEFAULT_CONSOLE_BG = '/console-bg.svg';
