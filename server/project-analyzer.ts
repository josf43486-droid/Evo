import fs from 'node:fs/promises';
import path from 'node:path';
import { userDir, segments, WsError, extOf } from './workspace.ts';

export type ProjectLanguage = 'python' | 'node' | 'php' | 'html' | 'unknown';
export interface ProjectCandidate { path: string; language: ProjectLanguage; score: number; reasons: string[] }
export interface ProjectAnalysis {
  filesScanned: number; directoriesScanned: number; totalBytes: number;
  languages: Record<string, number>; candidates: ProjectCandidate[];
  manifests: Array<{ path: string; type: string; details: string[] }>;
  warnings: string[]; recommendations: string[];
}
const MAX_FILES = 2500;
const MAX_DEPTH = 12;
const MAX_FILE = 256 * 1024;
const IGNORE = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', '.far3on']);
const PRIORITY: Record<string, number> = {
  'main.py': 100, 'app.py': 96, 'bot.py': 94, 'run.py': 88, 'index.py': 82,
  'server.js': 100, 'index.js': 96, 'app.js': 94, 'main.js': 92, 'bot.js': 88,
  'index.php': 100, 'app.php': 90, 'main.php': 88,
  'index.html': 100, 'home.html': 80,
};
const LANG: Record<string, ProjectLanguage> = { py: 'python', pyw: 'python', js: 'node', mjs: 'node', cjs: 'node', php: 'php', html: 'html', htm: 'html' };

export async function analyzeProject(uid: string, requestedPath: unknown = ''): Promise<ProjectAnalysis> {
  const root = path.join(userDir(uid), ...segments(requestedPath));
  let st;
  try { st = await fs.lstat(root); } catch { throw new WsError(404, 'Project folder not found'); }
  if (!st.isDirectory() || st.isSymbolicLink()) throw new WsError(400, 'Choose a project folder');
  const result: ProjectAnalysis = { filesScanned: 0, directoriesScanned: 0, totalBytes: 0, languages: {}, candidates: [], manifests: [], warnings: [], recommendations: [] };
  const stack: Array<{ dir: string; rel: string; depth: number }> = [{ dir: root, rel: '', depth: 0 }];
  while (stack.length && result.filesScanned < MAX_FILES) {
    const cur = stack.pop()!;
    let entries;
    try { entries = await fs.readdir(cur.dir, { withFileTypes: true }); } catch { continue; }
    result.directoriesScanned++;
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.env.example') continue;
      if (IGNORE.has(ent.name)) continue;
      const full = path.join(cur.dir, ent.name);
      const rel = cur.rel ? `${cur.rel}/${ent.name}` : ent.name;
      let info;
      try { info = await fs.lstat(full); } catch { continue; }
      if (info.isSymbolicLink()) { result.warnings.push(`تم تجاهل رابط رمزي: ${rel}`); continue; }
      if (info.isDirectory()) { if (cur.depth < MAX_DEPTH) stack.push({ dir: full, rel, depth: cur.depth + 1 }); continue; }
      if (!info.isFile()) continue;
      result.filesScanned++; result.totalBytes += info.size;
      const ext = extOf(ent.name); const language = LANG[ext];
      if (language) result.languages[language] = (result.languages[language] || 0) + 1;
      const base = ent.name.toLowerCase();
      if (base === 'package.json') {
        try { const p = JSON.parse(await fs.readFile(full, 'utf8')); result.manifests.push({ path: rel, type: 'Node.js', details: [`name: ${String(p.name || 'unnamed')}`, `start: ${String(p.scripts?.start || 'غير محدد')}`, `dependencies: ${Object.keys(p.dependencies || {}).length}`] });
          if (typeof p.main === 'string') result.candidates.push({ path: path.posix.join(path.posix.dirname(rel), p.main), language: 'node', score: 110, reasons: ['محدد في package.json كملف main'] });
        } catch { result.warnings.push(`package.json غير صالح: ${rel}`); }
      }
      if (base === 'requirements.txt') result.manifests.push({ path: rel, type: 'Python requirements', details: [`حزم معلنة: ${Math.min(500, (await fs.readFile(full, 'utf8').catch(() => '')).split(/\r?\n/).filter(x => x.trim() && !x.trim().startsWith('#')).length)}`] });
      if (base === 'pyproject.toml') result.manifests.push({ path: rel, type: 'Python project', details: ['تم العثور على إعدادات المشروع'] });
      if (base === 'composer.json') result.manifests.push({ path: rel, type: 'PHP Composer', details: ['تم العثور على تعريف اعتماديات PHP'] });
      if (language && base in PRIORITY) result.candidates.push({ path: rel, language, score: PRIORITY[base] - cur.depth * 3, reasons: [`اسم شائع لملف التشغيل: ${ent.name}`] });
      if (base === 'index.html' && !result.candidates.some(x => x.path === rel)) result.candidates.push({ path: rel, language: 'html', score: 100 - cur.depth * 3, reasons: ['نقطة دخول موقع ثابت'] });
    }
  }
  if (result.filesScanned >= MAX_FILES) result.warnings.push(`توقف الفحص عند الحد الآمن ${MAX_FILES} ملف`);
  result.candidates = result.candidates.filter(c => {
    const p = path.join(root, ...c.path.split('/'));
    return p.startsWith(root + path.sep) && true;
  }).sort((a,b) => b.score-a.score).slice(0, 30);
  if (!result.candidates.length) result.recommendations.push('لم يتم العثور على ملف تشغيل واضح. أضف main.py أو bot.py أو app.py أو server.js أو index.js أو index.php أو index.html.');
  if (result.candidates.length > 1 && result.candidates[0].score - result.candidates[1].score < 12) result.recommendations.push('تم العثور على أكثر من ملف محتمل؛ اختر ملف التشغيل بنفسك قبل النشر.');
  if (result.manifests.some(m => m.type === 'Node.js') && !result.candidates.some(c => c.language === 'node')) result.recommendations.push('يوجد package.json لكن لم يتم تحديد ملف تشغيل JavaScript واضح.');
  if (result.manifests.some(m => m.type === 'Python requirements')) result.recommendations.push('راجع requirements.txt قبل تثبيت الحزم، وثبّت الاعتماديات في بيئة معزولة.');
  result.recommendations.push('الفحص ثابت للملفات والبيانات الوصفية فقط؛ لا يشغّل المشروع ولا يضمن اكتشاف كل الملفات الضارة.');
  return result;
}
