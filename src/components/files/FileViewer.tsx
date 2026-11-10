import React, { useEffect, useRef, useState } from 'react';
import { X, Play, Square, RotateCcw, Download, Save, Trash2, Loader2, Archive, Package } from 'lucide-react';
import { api, downloadFile, imageObjectUrl, FileInfo, ProcInfo } from '../../lib/workspaceApi';
import { useConsoleBg, ConsoleBgLayer, ConsoleBgButtons } from '../../lib/consoleBg';
import { btn, ConfirmDialog, PromptDialog, StatusChip, formatSize, formatDuration, formatDate, stripAnsi } from './ui';

const ACTIVE = ['starting', 'installing', 'running', 'restarting'];
const isRequirements = (name: string) => /^requirements.*\.txt$/i.test(name);

function useLogs(path: string | null) {
  const [text, setText] = useState('');
  const offset = useRef(-1);
  const busy = useRef(false);

  useEffect(() => {
    if (!path) return;
    let stopped = false;
    offset.current = -1;
    setText('');
    const tick = async () => {
      if (busy.current || stopped || document.hidden) return;
      busy.current = true;
      try {
        const r = await api.logs(path, offset.current);
        if (stopped) return;
        offset.current = r.offset;
        if (r.text || r.reset) {
          const chunk = stripAnsi(r.text);
          setText(prev => (r.reset ? chunk : prev + chunk).slice(-150000));
        }
      } catch { /* نعيد المحاولة في الدورة القادمة */ } finally { busy.current = false; }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { stopped = true; clearInterval(id); };
  }, [path]);

  const clear = async () => {
    if (!path) return;
    await api.clearLogs(path);
    setText('');
    offset.current = 0;
  };
  return { text, clear };
}

export default function FileViewer({ path, processes, onClose, onChanged, notify }: {
  path: string;
  processes: ProcInfo[];
  onClose: () => void;
  onChanged: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imgUrl, setImgUrl] = useState('');
  const [askDelete, setAskDelete] = useState(false);
  const [askRename, setAskRename] = useState(false);
  const [askClose, setAskClose] = useState(false);

  const name = path.split('/').pop() || path;
  const dirty = info?.kind === 'text' && text !== saved;
  const proc = processes.find(p => p.path === path);
  const active = !!proc && ACTIVE.includes(proc.status);
  const showConsole = !!info && (info.runnable || isRequirements(info.name));
  const { text: logs, clear: clearLogs } = useLogs(showConsole ? path : null);
  const bg = useConsoleBg();

  // تحميل الملف
  useEffect(() => {
    let url = '';
    let cancelled = false;
    setInfo(null); setError('');
    api.read(path).then(async f => {
      if (cancelled) return;
      setInfo(f);
      setText(f.content ?? '');
      setSaved(f.content ?? '');
      if (f.kind === 'image') {
        try { url = await imageObjectUrl(path); if (!cancelled) setImgUrl(url); } catch {}
      }
    }).catch(e => !cancelled && setError(e.message));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [path]);

  // تمرير الكونسول للأسفل عند وصول سطور جديدة
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const requestClose = () => (dirty ? setAskClose(true) : onClose());

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) notify(okMsg);
    } catch (e: any) {
      notify(e.message || 'Something went wrong', true);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!info || info.kind !== 'text' || saving) return;
    setSaving(true);
    try {
      await api.write(path, text);
      setSaved(text);
      onChanged();
      notify('Saved');
    } catch (e: any) {
      notify(e.message, true);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const refreshSoon = () => { onChanged(); setTimeout(onChanged, 1200); };

  const run = () => act(async () => {
    if (dirty) await save();
    await api.run(path);
    refreshSoon();
  });
  const restart = () => act(async () => {
    if (dirty) await save();
    await api.restart(path);
    refreshSoon();
  });
  const stop = () => act(async () => { await api.stop(path); refreshSoon(); });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save().catch(() => {});
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = el;
      const next = text.slice(0, s) + '    ' + text.slice(en);
      setText(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 flex items-stretch sm:items-center justify-center sm:p-4">
      <div className="flex flex-col w-full sm:max-w-4xl sm:h-[90vh] bg-[#0f0a0b] sm:border border-white/10 sm:rounded-lg overflow-hidden">
        {/* العنوان */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/10">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white truncate" dir="auto">{name}</h2>
              {dirty && <span className="text-[11px] text-amber-300 border border-amber-500/30 rounded px-1.5 py-0.5">unsaved</span>}
              {proc && info?.runnable && <StatusChip status={proc.status} />}
            </div>
            {info && (
              <p className="text-xs text-gray-500 mt-0.5">
                {formatSize(info.size)} · {formatDate(info.mtime)}
                {proc && active && proc.uptime > 0 && <> · up {formatDuration(proc.uptime)}</>}
                {proc && active && proc.pid && <> · PID {proc.pid}</>}
              </p>
            )}
          </div>
          <button onClick={requestClose} className="p-1.5 text-gray-400 hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {/* الأدوات */}
        {info && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-[#0c0809]">
            {info.runnable && (
              active ? (
                <>
                  <button onClick={stop} disabled={busy} className={btn.smallDanger}><Square className="w-3.5 h-3.5" /> Stop</button>
                  <button onClick={restart} disabled={busy} className={btn.small}><RotateCcw className="w-3.5 h-3.5" /> Restart</button>
                </>
              ) : (
                <button onClick={run} disabled={busy} className={btn.smallPrimary}><Play className="w-3.5 h-3.5" /> {dirty ? 'Save & Run' : 'Run'}</button>
              )
            )}
            {isRequirements(info.name) && (
              <button onClick={() => act(async () => { await api.install(path); refreshSoon(); })} disabled={busy || active} className={btn.smallPrimary}>
                <Package className="w-3.5 h-3.5" /> Install packages
              </button>
            )}
            {info.isZip && (
              <button
                onClick={() => act(async () => {
                  const r = await api.extract(path);
                  onChanged();
                  notify(`Extracted ${r.files} file${r.files === 1 ? '' : 's'}${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
                })}
                disabled={busy}
                className={btn.smallPrimary}
              >
                <Archive className="w-3.5 h-3.5" /> Extract here
              </button>
            )}
            {info.kind === 'text' && (
              <button onClick={() => save().catch(() => {})} disabled={!dirty || saving} className={btn.small}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
            )}
            <button onClick={() => act(() => downloadFile(path))} className={btn.small}><Download className="w-3.5 h-3.5" /> Download</button>
            <button onClick={() => setAskRename(true)} className={btn.small}>Rename</button>
            <button onClick={() => setAskDelete(true)} className={btn.smallDanger}><Trash2 className="w-3.5 h-3.5" /> Delete</button>

            {info.runnable && (
              <label className="ml-auto flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none" title="Restart automatically after a crash or when the panel restarts">
                <input
                  type="checkbox"
                  className="accent-brand-500"
                  checked={proc?.keepAlive ?? true}
                  onChange={e => act(async () => { await api.keepAlive(path, e.target.checked); onChanged(); })}
                />
                Keep alive
              </label>
            )}
          </div>
        )}

        {/* المحتوى */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            {error && <div className="p-6 text-brand-300 text-sm">{error}</div>}
            {!info && !error && <div className="p-6 text-gray-500 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>}

            {info?.kind === 'text' && (
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={onKeyDown}
                spellCheck={false}
                wrap="off"
                dir="ltr"
                className="absolute inset-0 w-full h-full resize-none bg-[#0a0708] text-gray-100 font-mono text-[13px] leading-5 p-4 outline-none whitespace-pre overflow-auto"
              />
            )}

            {info?.kind === 'image' && (
              <div className="absolute inset-0 overflow-auto bg-[#0a0708] flex items-center justify-center p-4">
                {imgUrl ? <img src={imgUrl} alt={name} className="max-w-full max-h-full object-contain" /> : <Loader2 className="w-5 h-5 animate-spin text-gray-500" />}
              </div>
            )}

            {(info?.kind === 'binary' || info?.kind === 'large') && (
              <div className="p-6 text-sm text-gray-400 space-y-1">
                <p>{info.kind === 'large' ? 'This file is too large to preview.' : 'No preview is available for this type of file.'}</p>
                <p className="text-gray-500">You can still download it{info.isZip ? ' or extract it here' : ''}.</p>
              </div>
            )}
          </div>

          {showConsole && (
            <div className="relative h-56 shrink-0 border-t border-white/10 flex flex-col bg-black overflow-hidden">
              <ConsoleBgLayer bg={bg} dim={0.82} />
              <div className="relative flex items-center justify-between px-4 py-1 border-b border-white/10 text-xs text-gray-400">
                <span>Console</span>
                <span className="flex items-center gap-2">
                  <ConsoleBgButtons bg={bg} />
                  <button onClick={() => clearLogs().catch(e => notify(e.message, true))} className="px-2 py-1 rounded hover:text-white hover:bg-white/10">Clear</button>
                </span>
              </div>
              <pre ref={logRef} dir="ltr" className="relative flex-1 overflow-auto px-4 py-2 font-mono text-[12px] leading-[18px] text-gray-200 whitespace-pre-wrap break-words">
                {logs || <span className="text-gray-600">No output yet. Press Run to start.</span>}
              </pre>
            </div>
          )}
        </div>
      </div>

      {askDelete && (
        <ConfirmDialog
          title="Move to trash"
          message={<>"{name}" will be moved to the trash. You can restore it from the Trash tab{proc && active ? ', and the running script will be stopped' : ''}.</>}
          confirmLabel="Move to trash"
          danger
          onClose={() => setAskDelete(false)}
          onConfirm={async () => {
            try { await api.remove([path]); onChanged(); onClose(); notify('Moved to trash'); }
            catch (e: any) { notify(e.message, true); setAskDelete(false); }
          }}
        />
      )}

      {askRename && (
        <PromptDialog
          title="Rename"
          label="New name"
          initial={name}
          confirmLabel="Rename"
          onClose={() => setAskRename(false)}
          onSubmit={async v => {
            if (dirty) await save().catch(() => {});
            try {
              const dir = path.split('/').slice(0, -1);
              await api.rename(path, [...dir, v].join('/'));
              onChanged(); onClose(); notify('Renamed');
            } catch (e: any) { notify(e.message, true); }
          }}
        />
      )}

      {askClose && (
        <ConfirmDialog
          title="Unsaved changes"
          message="You have changes that have not been saved. Close without saving?"
          confirmLabel="Close without saving"
          danger
          onClose={() => setAskClose(false)}
          onConfirm={() => onClose()}
        />
      )}
    </div>
  );
}
