// يحمّل ملف .env إن وُجد (يجب أن يُستورد قبل أي ملف يقرأ المتغيرات)
import fs from 'fs';

if (fs.existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch {}
}
