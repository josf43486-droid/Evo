import { authHeaders, signOut } from '../backend';

export type ProcStatus = 'starting' | 'installing' | 'running' | 'restarting' | 'stopped' | 'crashed';

export interface Entry { name: string; type: 'dir' | 'file'; size: number; mtime: number }

export interface FileInfo {
  name: string; path: string; size: number; mtime: number; ext: string;
  kind: 'text' | 'image' | 'binary' | 'large';
  content?: string; runnable: boolean; language?: string; isZip: boolean;
}

export interface ProcInfo {
  path: string; status: ProcStatus; pid: number | null; startedAt: number | null; uptime: number;
  restarts: number; keepAlive: boolean; exitCode: number | null; memoryKb: number | null; kind: 'script' | 'pip';
}

export interface Status {
  username: string;
  isAdmin: boolean;
  usage: { used: number; quota: number };
  python: string | null;
  limits: { maxUpload: number; maxRunning: number; trashDays: number };
  processes: ProcInfo[];
}

export interface TrashItem { id: string; name: string; originalPath: string; deletedAt: number; isDir: boolean; size: number }
export interface ExtractResult { files: number; dirs: number; skipped: Array<{ name: string; reason: string }> }
export interface AdminProc extends ProcInfo { uid: string; username: string }

export class WsApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function failFrom(res: Response): Promise<never> {
  let msg = `Request failed (${res.status})`;
  try { const d = await res.json(); if (d?.message) msg = d.message; } catch {}
  if (res.status === 401) await signOut();
  throw new WsApiError(res.status, msg);
}

async function req<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new WsApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (!res.ok) return failFrom(res);
  return res.json();
}

const q = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

export interface ProjectAnalysis { filesScanned: number; directoriesScanned: number; totalBytes: number; languages: Record<string, number>; candidates: Array<{ path: string; language: string; score: number; reasons: string[] }>; manifests: Array<{ path: string; type: string; details: string[] }>; warnings: string[]; recommendations: string[] }

export const api = {
  status: () => req<Status>('GET', '/api/ws/status'),
  analyze: (path: string) => req<ProjectAnalysis>('POST', '/api/ws/analyze', { path }),
  list: (path: string) => req<{ entries: Entry[] }>('GET', `/api/ws/list?${q({ path })}`).then(r => r.entries),
  read: (path: string) => req<FileInfo>('GET', `/api/ws/read?${q({ path })}`),
  write: (path: string, content: string) => req('POST', '/api/ws/write', { path, content }),
  create: (path: string, content = '') => req('POST', '/api/ws/create', { path, content }),
  mkdir: (path: string) => req('POST', '/api/ws/mkdir', { path }),
  rename: (from: string, to: string) => req('POST', '/api/ws/rename', { from, to }),
  remove: (paths: string[]) => req<{ moved: number }>('POST', '/api/ws/delete', { paths }),
  extract: (path: string, overwrite = false) => req<ExtractResult>('POST', '/api/ws/extract', { path, overwrite }),

  trash: () => req<{ items: TrashItem[] }>('GET', '/api/ws/trash').then(r => r.items),
  restore: (id: string) => req<{ path: string }>('POST', '/api/ws/trash/restore', { id }),
  purge: (id: string) => req('POST', '/api/ws/trash/purge', { id }),
  emptyTrash: () => req('POST', '/api/ws/trash/empty', {}),

  run: (path: string, keepAlive?: boolean) => req<ProcInfo>('POST', '/api/ws/run', { path, keepAlive }),
  stop: (path: string) => req('POST', '/api/ws/stop', { path }),
  restart: (path: string) => req<ProcInfo>('POST', '/api/ws/restart', { path }),
  keepAlive: (path: string, value: boolean) => req('POST', '/api/ws/keepalive', { path, value }),
  install: (path: string) => req<ProcInfo>('POST', '/api/ws/install', { path }),
  logs: (path: string, from: number) =>
    req<{ text: string; offset: number; size: number; reset: boolean }>('GET', `/api/ws/logs?${q({ path, from })}`),
  clearLogs: (path: string) => req('POST', '/api/ws/logs/clear', { path }),

  adminOverview: () => req<{ processes: AdminProc[]; limits: { perUser: number; total: number } }>('GET', '/api/ws/admin/overview'),
  adminStop: (uid: string, path: string) => req('POST', '/api/ws/admin/stop', { uid, path }),
};

// ---------------- الرفع (مع نسبة التقدم) ----------------

export function uploadFile(
  dir: string,
  file: File,
  opts: { overwrite?: boolean; extract?: boolean; onProgress?: (fraction: number) => void } = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    const params: Record<string, string> = { path: dir };
    if (!opts.extract) params.name = file.name;
    if (opts.overwrite) params.overwrite = '1';
    const url = `${opts.extract ? '/api/ws/extract-upload' : '/api/ws/upload'}?${new URLSearchParams(params)}`;

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(new WsApiError(0, 'Network error while uploading'));
    xhr.onload = () => {
      let data: any = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) signOut();
      reject(new WsApiError(xhr.status, data?.message || (xhr.status === 413 ? 'The file is too large' : `Upload failed (${xhr.status})`)));
    };
    xhr.send(file);
  });
}

// ---------------- التنزيل ----------------

async function fetchBlob(url: string): Promise<Blob> {
  let res: Response;
  try { res = await fetch(url, { headers: authHeaders() }); } catch { throw new WsApiError(0, 'Cannot reach the server'); }
  if (!res.ok) return failFrom(res);
  return res.blob();
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

export async function downloadFile(path: string) {
  saveBlob(await fetchBlob(`/api/ws/raw?${q({ path })}`), path.split('/').pop() || 'file');
}

export async function downloadBackup(username: string) {
  saveBlob(await fetchBlob('/api/ws/backup'), `${username}-files-${new Date().toISOString().slice(0, 10)}.zip`);
}

export const imageObjectUrl = async (path: string) =>
  URL.createObjectURL(await fetchBlob(`/api/ws/raw?${q({ path, inline: 1 })}`));
