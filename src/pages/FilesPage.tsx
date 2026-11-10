import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, File as FileIcon, FileCode, Image as ImageIcon, Archive, Database, Play, Loader2, Download } from 'lucide-react';
import { useAuth } from '../App';
import {
  api, uploadFile, downloadBackup, WsApiError,
  Entry, Status, ProcInfo, TrashItem, AdminProc, ProjectAnalysis,
} from '../lib/workspaceApi';
import FileViewer from '../components/files/FileViewer';
import {
  btn, ConfirmDialog, PromptDialog, Modal, StatusChip, Toast, ToastState,
  formatSize, formatDuration, formatDate,
} from '../components/files/ui';

type Tab = 'files' | 'processes' | 'trash' | 'admin';
const RUNNABLE = new Set(['py', 'pyw', 'js', 'mjs', 'php']);
const ACTIVE = ['starting', 'installing', 'running', 'restarting'];
const extOf = (n: string) => (n.includes('.') ? n.split('.').pop()!.toLowerCase() : '');

function iconFor(e: Entry) {
  if (e.type === 'dir') return <Folder className="w-5 h-5 text-brand-400 shrink-0" />;
  const x = extOf(e.name);
  if (RUNNABLE.has(x) || ['json', 'html', 'css', 'ts', 'tsx', 'sh', 'yml', 'yaml'].includes(x)) return <FileCode className="w-5 h-5 text-gray-400 shrink-0" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(x)) return <ImageIcon className="w-5 h-5 text-gray-400 shrink-0" />;
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(x)) return <Archive className="w-5 h-5 text-gray-400 shrink-0" />;
  if (['db', 'sqlite', 'sqlite3'].includes(x)) return <Database className="w-5 h-5 text-gray-400 shrink-0" />;
  return <FileIcon className="w-5 h-5 text-gray-400 shrink-0" />;
}

const joinPath = (dir: string[], name: string) => [...dir, name].join('/');

export default function FilesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('files');
  const [cwd, setCwd] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [loadError, setLoadError] = useState('');

  const [dialog, setDialog] = useState<null | 'newFile' | 'newDir' | 'rename' | 'delete'>(null);
  const [progress, setProgress] = useState<{ label: string; fraction: number } | null>(null);
  const [conflict, setConflict] = useState<null | { name: string; decide: (a: 'replace' | 'skip' | 'replaceAll' | 'skipAll') => void }>(null);
  const [dragging, setDragging] = useState(false);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const cwdPath = cwd.join('/');

  // ---------- تحميل البيانات ----------
  const refreshStatus = useCallback(async () => {
    try { setStatus(await api.status()); } catch { /* يعاد في الدورة القادمة */ }
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const list = await api.list(cwdPath);
      setEntries(prev => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      setLoadError('');
    } catch (e: any) {
      if (e instanceof WsApiError && e.status === 404 && cwd.length) { setCwd([]); return; }
      setLoadError(e.message);
      setEntries(prev => prev ?? []);
    }
  }, [cwdPath]);

  const refreshAll = useCallback(() => { refreshStatus(); refreshList(); }, [refreshStatus, refreshList]);

  useEffect(() => { setEntries(null); setSelected(new Set()); refreshList(); }, [cwdPath]);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(() => { if (!document.hidden) refreshStatus(); }, 3000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden && !viewing && !dialog) refreshList(); }, 8000);
    return () => clearInterval(id);
  }, [refreshList, viewing, dialog]);

  // ---------- الرفع ----------
  const askConflict = (name: string) =>
    new Promise<'replace' | 'skip' | 'replaceAll' | 'skipAll'>(resolve => setConflict({ name, decide: a => { setConflict(null); resolve(a); } }));

  const uploadMany = async (files: File[]) => {
    if (!files.length) return;
    const max = status?.limits.maxUpload;
    let mode: 'ask' | 'replaceAll' | 'skipAll' = 'ask';
    let done = 0, skipped = 0;
    const errors: string[] = [];

    for (const [i, file] of files.entries()) {
      if (max && file.size > max) { errors.push(`${file.name}: larger than ${formatSize(max)}`); continue; }
      const label = `Uploading ${i + 1}/${files.length}: ${file.name}`;
      setProgress({ label, fraction: 0 });
      try {
        try {
          await uploadFile(cwdPath, file, { overwrite: mode === 'replaceAll', onProgress: f => setProgress({ label, fraction: f }) });
          done++;
        } catch (e: any) {
          if (!(e instanceof WsApiError && e.status === 409 && e.message === 'exists')) throw e;
          if (mode === 'skipAll') { skipped++; continue; }
          let choice: 'replace' | 'skip' | 'replaceAll' | 'skipAll' = 'replace';
          if (mode === 'ask') {
            setProgress(null);
            choice = await askConflict(file.name);
            if (choice === 'replaceAll') mode = 'replaceAll';
            if (choice === 'skipAll') mode = 'skipAll';
          }
          if (choice === 'skip' || choice === 'skipAll') { skipped++; continue; }
          setProgress({ label, fraction: 0 });
          await uploadFile(cwdPath, file, { overwrite: true, onProgress: f => setProgress({ label, fraction: f }) });
          done++;
        }
      } catch (e: any) {
        errors.push(`${file.name}: ${e.message}`);
      }
    }
    setProgress(null);
    refreshAll();
    if (errors.length) notify(errors.slice(0, 3).join('\n'), true);
    else notify(`Uploaded ${done} file${done === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}`);
  };

  const extractZipUpload = async (file: File) => {
    const label = `Extracting ${file.name}`;
    setProgress({ label, fraction: 0 });
    try {
      const r = await uploadFile(cwdPath, file, { extract: true, onProgress: f => setProgress({ label, fraction: f }) });
      refreshAll();
      notify(`Extracted ${r.files} file${r.files === 1 ? '' : 's'}${r.skipped?.length ? `, ${r.skipped.length} skipped` : ''}`);
    } catch (e: any) {
      notify(e.message, true);
    } finally {
      setProgress(null);
    }
  };

  // ---------- أفعال ----------
  const guarded = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try { await fn(); if (okMsg) notify(okMsg); refreshAll(); } catch (e: any) { notify(e.message || 'Something went wrong', true); }
  };

  const selectedNames = [...selected];
  const selectedEntries = (entries || []).filter(e => selected.has(e.name));
  const toggle = (name: string) => setSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const allSelected = !!entries?.length && selected.size === entries.length;

  const procFor = (path: string): ProcInfo | undefined => status?.processes.find(p => p.path === path);
  const runningCount = status?.processes.filter(p => p.kind === 'script' && ACTIVE.includes(p.status)).length ?? 0;

  const openEntry = (e: Entry) => {
    if (e.type === 'dir') setCwd([...cwd, e.name]);
    else setViewing(joinPath(cwd, e.name));
  };

  const analyzeCurrentProject = async () => {
    setAnalyzing(true); setAnalysis(null);
    try { setAnalysis(await api.analyze(cwdPath)); notify('Project scan completed'); }
    catch (e: any) { notify(e.message || 'Project scan failed', true); }
    finally { setAnalyzing(false); }
  };

  const quotaPct = status && status.usage.quota > 0 ? Math.min(100, (status.usage.used / status.usage.quota) * 100) : 0;

  // ---------- العرض ----------
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'files', label: 'Files' },
    { id: 'processes', label: 'Processes', badge: runningCount || undefined },
    { id: 'trash', label: 'Trash' },
    ...(status?.isAdmin ? [{ id: 'admin' as Tab, label: 'All users' }] : []),
  ];

  return (
    <div dir="ltr" className="min-h-screen bg-[#0a0708] text-gray-200 pt-20 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-semibold text-white">Files</h1>
            <p className="text-sm text-gray-500 mt-1">Upload your scripts, open them and run them. Everything is saved to your account.</p>
          </div>
          <button
            onClick={() => downloadBackup(status?.username || user?.displayName || 'account').catch((e: any) => notify(e.message, true))}
            className={`${btn.small} shrink-0`}
            title="Download all your files as a ZIP"
          >
            <Download className="w-3.5 h-3.5" /> Backup
          </button>
        </div>

        {/* لوحة التحكم */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-[#0f0a0b] border border-white/10 rounded-lg p-4">
            <p className="text-xs text-gray-500">Storage</p>
            <p className="text-lg font-semibold text-white mt-1">
              {status ? formatSize(status.usage.used) : '—'}
              <span className="text-sm font-normal text-gray-500"> {status && (status.usage.quota > 0 ? `/ ${formatSize(status.usage.quota)}` : '/ unlimited')}</span>
            </p>
            <div className="h-1.5 bg-white/10 rounded-full mt-2.5 overflow-hidden">
              <div className={`h-full ${quotaPct > 90 ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${quotaPct}%` }} />
            </div>
          </div>
          <div className="bg-[#0f0a0b] border border-white/10 rounded-lg p-4">
            <p className="text-xs text-gray-500">Running scripts</p>
            <p className="text-lg font-semibold text-white mt-1">
              {runningCount}
              <span className="text-sm font-normal text-gray-500"> {status && status.limits.maxRunning > 0 ? `/ ${status.limits.maxRunning}` : ''}</span>
            </p>
            <p className="text-xs text-gray-500 mt-2.5">{status?.processes.length ?? 0} script{(status?.processes.length ?? 0) === 1 ? '' : 's'} on this account</p>
          </div>
          <div className="bg-[#0f0a0b] border border-white/10 rounded-lg p-4">
            <p className="text-xs text-gray-500">Python</p>
            <p className={`text-lg font-semibold mt-1 ${status && !status.python ? 'text-brand-300' : 'text-white'}`}>
              {status ? (status.python ? `Python ${status.python}` : 'Not found') : '—'}
            </p>
            <p className="text-xs text-gray-500 mt-2.5">
              {status && !status.python ? 'Install Python 3 on the server to run .py files' : 'Packages from requirements.txt install automatically'}
            </p>
          </div>
        </div>

        {/* التبويبات */}
        <div className="flex gap-1 border-b border-white/10 mb-5 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t.id ? 'text-brand-400 border-brand-500 font-medium' : 'text-gray-400 border-transparent hover:text-white'}`}
            >
              {t.label}
              {t.badge ? <span className="ml-2 text-[11px] bg-green-500/15 text-green-400 rounded px-1.5 py-0.5">{t.badge}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'files' && (
          <>
            {/* الأزرار */}
            <input ref={fileInput} type="file" multiple className="hidden" onChange={e => { uploadMany([...(e.target.files || [])]); e.target.value = ''; }} />
            <input ref={zipInput} type="file" accept=".zip,application/zip" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) extractZipUpload(f); e.target.value = ''; }} />
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-5">
              <button onClick={() => setDialog('newDir')} className={`${btn.secondary} col-span-2`}>Create Directory</button>
              <button onClick={analyzeCurrentProject} disabled={analyzing} className={btn.secondary}>{analyzing ? 'Scanning…' : 'Analyze Project'}</button>
              <button onClick={() => fileInput.current?.click()} className={btn.primary}>Upload</button>
              <button onClick={() => setDialog('newFile')} className={btn.secondary}>New File</button>
              <button onClick={() => zipInput.current?.click()} className={btn.secondary}><Archive className="w-4 h-4" /> Extract ZIP</button>
            </div>

            {analysis && (
              <section className="mb-5 rounded-xl border border-brand-500/25 bg-[#100b12] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-white">Project analysis</h3><button className="text-xs text-gray-400 hover:text-white" onClick={() => setAnalysis(null)}>Close</button></div>
                <div className="grid grid-cols-3 gap-2 text-xs"><div className="rounded-lg bg-white/5 p-2"><b className="block text-white text-base">{analysis.filesScanned}</b>Files</div><div className="rounded-lg bg-white/5 p-2"><b className="block text-white text-base">{analysis.directoriesScanned}</b>Folders</div><div className="rounded-lg bg-white/5 p-2"><b className="block text-white text-base">{formatSize(analysis.totalBytes)}</b>Scanned</div></div>
                <div><p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Detected entry points</p>{analysis.candidates.length ? analysis.candidates.map(c => <div key={c.path} className="flex items-center justify-between gap-3 border-t border-white/5 py-2 text-sm"><div className="min-w-0"><b className="block truncate text-gray-200">{c.path}</b><span className="text-xs text-gray-500">{c.language} · score {c.score} · {c.reasons.join(', ')}</span></div><button onClick={() => { setViewing(c.path); setAnalysis(null); }} className="shrink-0 text-xs text-brand-300 hover:text-white">Open</button></div>) : <p className="text-sm text-gray-400">No entry point detected.</p>}</div>
                {analysis.manifests.length > 0 && <div><p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Manifests</p>{analysis.manifests.map(m => <p key={m.path} className="text-xs text-gray-300 py-1">{m.type}: {m.path} — {m.details.join(' · ')}</p>)}</div>}
                {[...analysis.warnings, ...analysis.recommendations].length > 0 && <div className="space-y-1">{[...analysis.warnings, ...analysis.recommendations].map((w,i) => <p key={i} className="text-xs text-amber-300/90">• {w}</p>)}</div>}
                <p className="text-[11px] text-gray-500">Static inspection only. Project files are not executed during analysis; this scan cannot guarantee malware detection.</p>
              </section>
            )}

            {progress && (
              <div className="mb-4 bg-[#0f0a0b] border border-white/10 rounded-lg px-4 py-3">
                <div className="flex justify-between text-xs text-gray-400 mb-2"><span className="truncate">{progress.label}</span><span>{Math.round(progress.fraction * 100)}%</span></div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-brand-500 transition-all" style={{ width: `${progress.fraction * 100}%` }} /></div>
              </div>
            )}

            {/* المسار */}
            <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm mb-3 text-gray-500" aria-label="Path">
              <span>/</span>
              <button onClick={() => setCwd([])} className={cwd.length ? 'text-brand-400 hover:text-brand-300' : 'text-gray-300'}>Home</button>
              {cwd.map((seg, i) => (
                <React.Fragment key={i}>
                  <span>/</span>
                  <button onClick={() => setCwd(cwd.slice(0, i + 1))} className={i < cwd.length - 1 ? 'text-brand-400 hover:text-brand-300' : 'text-gray-300'}>{seg}</button>
                </React.Fragment>
              ))}
              <span>/</span>
            </nav>

            {/* شريط التحديد */}
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 bg-brand-900/20 border border-brand-700/40 rounded-lg text-sm">
                <span className="text-gray-300 mr-2">{selected.size} selected</span>
                {selected.size === 1 && <button onClick={() => setDialog('rename')} className={btn.small}>Rename</button>}
                {selected.size === 1 && selectedEntries[0]?.type === 'file' && extOf(selectedEntries[0].name) === 'zip' && (
                  <button onClick={() => guarded(async () => {
                    const r = await api.extract(joinPath(cwd, selectedEntries[0].name));
                    notify(`Extracted ${r.files} file${r.files === 1 ? '' : 's'}${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
                  })} className={btn.small}>Extract here</button>
                )}
                <button onClick={() => setDialog('delete')} className={btn.smallDanger}>Delete</button>
                <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-gray-400 hover:text-white">Clear</button>
              </div>
            )}

            {/* القائمة */}
            <div
              className={`bg-[#0f0a0b] border rounded-lg overflow-hidden ${dragging ? 'border-brand-500' : 'border-white/10'}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); uploadMany([...e.dataTransfer.files]); }}
            >
              {entries === null ? (
                <div className="p-8 text-center text-gray-500 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
              ) : loadError ? (
                <div className="p-6 text-brand-300 text-sm">{loadError}</div>
              ) : entries.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-gray-300">This folder is empty</p>
                  <p className="text-sm text-gray-500 mt-1">Upload your Python files, or drop them here.</p>
                </div>
              ) : (
                <>
                  <label className="flex items-center gap-3 px-4 py-2 border-b border-white/5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" className="accent-brand-500 w-4 h-4" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(entries.map(e => e.name)))} />
                    Select all
                  </label>
                  <ul className="divide-y divide-white/5">
                    {entries.map(e => {
                      const rel = joinPath(cwd, e.name);
                      const proc = e.type === 'file' ? procFor(rel) : undefined;
                      const active = !!proc && ACTIVE.includes(proc.status);
                      const runnable = e.type === 'file' && RUNNABLE.has(extOf(e.name));
                      return (
                        <li key={e.name} className={`flex items-center gap-3 px-4 py-3 ${selected.has(e.name) ? 'bg-white/[0.04]' : 'hover:bg-white/[0.025]'}`}>
                          <input type="checkbox" className="accent-brand-500 w-4 h-4 shrink-0" checked={selected.has(e.name)} onChange={() => toggle(e.name)} aria-label={`Select ${e.name}`} />
                          <button onClick={() => openEntry(e)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                            {iconFor(e)}
                            <span className="truncate text-gray-100" dir="auto">{e.name}</span>
                            {active && <span className="shrink-0 w-2 h-2 rounded-full bg-green-500" title="Running" />}
                          </button>
                          {runnable && !active && (
                            <button
                              onClick={() => guarded(() => api.run(rel), `Started ${e.name}`)}
                              className="shrink-0 p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10"
                              title="Run"
                              aria-label={`Run ${e.name}`}
                            >
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          <span className="shrink-0 w-16 text-right text-xs text-gray-500 tabular-nums">{e.type === 'file' ? formatSize(e.size) : ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </>
        )}

        {tab === 'processes' && (
          <ProcessesTab
            processes={status?.processes.filter(p => p.kind === 'script') || []}
            onOpen={p => { setViewing(p); }}
            onChanged={refreshStatus}
            notify={notify}
          />
        )}

        {tab === 'trash' && <TrashTab days={status?.limits.trashDays ?? 30} onRestored={refreshAll} notify={notify} />}

        {tab === 'admin' && status?.isAdmin && <AdminTab notify={notify} />}
      </div>

      {viewing && (
        <FileViewer
          path={viewing}
          processes={status?.processes || []}
          onClose={() => setViewing(null)}
          onChanged={refreshAll}
          notify={notify}
        />
      )}

      {dialog === 'newDir' && (
        <PromptDialog
          title="Create directory" label="Folder name" confirmLabel="Create"
          onClose={() => setDialog(null)}
          onSubmit={async v => { await guarded(() => api.mkdir(joinPath(cwd, v)), 'Folder created'); setDialog(null); }}
        />
      )}
      {dialog === 'newFile' && (
        <PromptDialog
          title="New file" label="File name (for example main.py)" confirmLabel="Create"
          onClose={() => setDialog(null)}
          onSubmit={async v => {
            try { await api.create(joinPath(cwd, v)); refreshAll(); setDialog(null); setViewing(joinPath(cwd, v)); }
            catch (e: any) { notify(e.message, true); }
          }}
        />
      )}
      {dialog === 'rename' && selectedNames.length === 1 && (
        <PromptDialog
          title="Rename" label="New name" initial={selectedNames[0]} confirmLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async v => {
            await guarded(() => api.rename(joinPath(cwd, selectedNames[0]), joinPath(cwd, v)), 'Renamed');
            setSelected(new Set()); setDialog(null);
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Move to trash"
          message={<>{selected.size === 1 ? <>"{selectedNames[0]}"</> : <>{selected.size} items</>} will be moved to the trash. Nothing is deleted permanently, and you can restore it from the Trash tab for {status?.limits.trashDays ?? 30} days.</>}
          confirmLabel="Move to trash" danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await guarded(() => api.remove(selectedNames.map(n => joinPath(cwd, n))), 'Moved to trash');
            setSelected(new Set()); setDialog(null);
          }}
        />
      )}

      {conflict && (
        <Modal title="File already exists" onClose={() => conflict.decide('skip')}>
          <p className="text-sm text-gray-300 mb-5 leading-relaxed">
            "{conflict.name}" already exists in this folder. If you replace it, the old version is kept in the trash.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={() => conflict.decide('skip')} className={btn.secondary}>Skip</button>
            <button onClick={() => conflict.decide('skipAll')} className={btn.secondary}>Skip all</button>
            <button onClick={() => conflict.decide('replaceAll')} className={btn.secondary}>Replace all</button>
            <button onClick={() => conflict.decide('replace')} className={btn.primary}>Replace</button>
          </div>
        </Modal>
      )}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

// ---------------- تبويب العمليات ----------------

function ProcessesTab({ processes, onOpen, onChanged, notify }: {
  processes: ProcInfo[]; onOpen: (path: string) => void; onChanged: () => void; notify: (t: string, e?: boolean) => void;
}) {
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); onChanged(); setTimeout(onChanged, 1200); } catch (e: any) { notify(e.message, true); }
  };

  if (!processes.length) {
    return (
      <div className="bg-[#0f0a0b] border border-white/10 rounded-lg p-10 text-center">
        <p className="text-gray-300">No scripts yet</p>
        <p className="text-sm text-gray-500 mt-1">Open a .py file in the Files tab and press Run. It will appear here.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0f0a0b] border border-white/10 rounded-lg divide-y divide-white/5">
      {processes.map(p => {
        const active = ACTIVE.includes(p.status);
        return (
          <div key={p.path} className="px-4 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1 basis-48">
              <button onClick={() => onOpen(p.path)} className="text-gray-100 hover:text-brand-300 truncate max-w-full text-left" dir="auto">{p.path}</button>
              <p className="text-xs text-gray-500 mt-0.5">
                {active && p.uptime > 0 ? `up ${formatDuration(p.uptime)}` : p.exitCode !== null ? `exit code ${p.exitCode}` : 'not running'}
                {p.restarts > 0 && ` · ${p.restarts} restart${p.restarts === 1 ? '' : 's'}`}
                {p.memoryKb ? ` · ${formatSize(p.memoryKb * 1024)} RAM` : ''}
                {p.pid ? ` · PID ${p.pid}` : ''}
              </p>
            </div>
            <StatusChip status={p.status} />
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none" title="Restart automatically after a crash or when the panel restarts">
              <input type="checkbox" className="accent-brand-500" checked={p.keepAlive} onChange={e => act(() => api.keepAlive(p.path, e.target.checked))} />
              Keep alive
            </label>
            <div className="flex gap-2">
              <button onClick={() => onOpen(p.path)} className={btn.small}>Logs</button>
              {active ? (
                <>
                  <button onClick={() => act(() => api.restart(p.path))} className={btn.small}>Restart</button>
                  <button onClick={() => act(() => api.stop(p.path))} className={btn.smallDanger}>Stop</button>
                </>
              ) : (
                <button onClick={() => act(() => api.run(p.path))} className={btn.smallPrimary}>Start</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- تبويب السلة ----------------

function TrashTab({ days, onRestored, notify }: { days: number; onRestored: () => void; notify: (t: string, e?: boolean) => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [askEmpty, setAskEmpty] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.trash()); } catch (e: any) { notify(e.message, true); setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); notify(msg); await load(); onRestored(); } catch (e: any) { notify(e.message, true); }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-gray-500">Deleted items stay here for {days} days, then they are removed automatically.</p>
        {!!items?.length && <button onClick={() => setAskEmpty(true)} className={btn.smallDanger}>Empty trash</button>}
      </div>
      <div className="bg-[#0f0a0b] border border-white/10 rounded-lg">
        {items === null ? (
          <div className="p-8 text-center text-gray-500 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-gray-400">The trash is empty</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map(i => (
              <li key={i.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {i.isDir ? <Folder className="w-5 h-5 text-brand-400 shrink-0" /> : <FileIcon className="w-5 h-5 text-gray-400 shrink-0" />}
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-gray-100 truncate" dir="auto">{i.name}</p>
                  <p className="text-xs text-gray-500 truncate" dir="auto">from /{i.originalPath} · {formatDate(i.deletedAt)} · {formatSize(i.size)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => act(() => api.restore(i.id), 'Restored')} className={btn.smallPrimary}>Restore</button>
                  <button onClick={() => act(() => api.purge(i.id), 'Deleted permanently')} className={btn.smallDanger}>Delete forever</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {askEmpty && (
        <ConfirmDialog
          title="Empty trash"
          message="Everything in the trash will be deleted permanently. This cannot be undone."
          confirmLabel="Delete everything" danger
          onClose={() => setAskEmpty(false)}
          onConfirm={async () => { await act(() => api.emptyTrash(), 'Trash emptied'); setAskEmpty(false); }}
        />
      )}
    </div>
  );
}

// ---------------- تبويب الأدمن ----------------

function AdminTab({ notify }: { notify: (t: string, e?: boolean) => void }) {
  const [rows, setRows] = useState<AdminProc[] | null>(null);
  const [limits, setLimits] = useState<{ perUser: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try { const r = await api.adminOverview(); setRows(r.processes); setLimits(r.limits); } catch (e: any) { notify(e.message, true); }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 4000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">
        Scripts running right now across all accounts
        {limits && <> · limit {limits.perUser > 0 ? `${limits.perUser} per user` : 'none per user'}, {limits.total} in total</>}.
      </p>
      <div className="bg-[#0f0a0b] border border-white/10 rounded-lg">
        {rows === null ? (
          <div className="p-8 text-center text-gray-500 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-gray-400">Nothing is running</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.map(p => (
              <li key={p.uid + p.path} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-gray-100 truncate" dir="auto">{p.path}</p>
                  <p className="text-xs text-gray-500">
                    {p.username} · up {formatDuration(p.uptime)}{p.memoryKb ? ` · ${formatSize(p.memoryKb * 1024)} RAM` : ''}{p.pid ? ` · PID ${p.pid}` : ''}
                  </p>
                </div>
                <StatusChip status={p.status} />
                <button
                  onClick={async () => { try { await api.adminStop(p.uid, p.path); notify('Stopped'); setTimeout(load, 800); } catch (e: any) { notify(e.message, true); } }}
                  className={btn.smallDanger}
                >
                  Stop
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
