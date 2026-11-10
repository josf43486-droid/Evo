import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ProcStatus } from '../../lib/workspaceApi';

// ---------------- تنسيقات ----------------

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export const formatDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// ---------------- أزرار ----------------

const base = 'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const btn = {
  primary: `${base} px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white`,
  secondary: `${base} px-4 py-2.5 bg-[#1a1114] border border-white/10 hover:border-brand-500/50 text-gray-200`,
  danger: `${base} px-4 py-2.5 bg-[#1a1114] border border-brand-700/60 hover:bg-brand-900/40 text-brand-300`,
  small: `${base} px-3 py-1.5 bg-[#1a1114] border border-white/10 hover:border-brand-500/50 text-gray-200 text-xs`,
  smallPrimary: `${base} px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs`,
  smallDanger: `${base} px-3 py-1.5 bg-[#1a1114] border border-brand-700/60 hover:bg-brand-900/40 text-brand-300 text-xs`,
};

// ---------------- حالة التشغيل ----------------

const STATUS_STYLE: Record<ProcStatus, { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'text-green-400 bg-green-500/10 border-green-500/25' },
  installing: { label: 'Installing', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  starting: { label: 'Starting', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  restarting: { label: 'Restarting', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  crashed: { label: 'Crashed', cls: 'text-brand-300 bg-brand-500/10 border-brand-500/30' },
  stopped: { label: 'Stopped', cls: 'text-gray-400 bg-white/5 border-white/10' },
};

export function StatusChip({ status }: { status: ProcStatus }) {
  const s = STATUS_STYLE[status];
  return <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-medium ${s.cls}`}>{s.label}</span>;
}

// ---------------- نوافذ ----------------

export function Modal({ title, onClose, children, width = 'max-w-md' }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`w-full ${width} bg-[#0f0a0b] border border-white/10 rounded-lg shadow-xl`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <h3 className="font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function PromptDialog({ title, label, initial = '', confirmLabel, onSubmit, onClose }: {
  title: string; label: string; initial?: string; confirmLabel: string;
  onSubmit: (value: string) => void | Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(value.trim()); } finally { setBusy(false); }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm text-gray-400">
          {label}
          <input
            ref={ref}
            value={value}
            onChange={e => setValue(e.target.value)}
            className="mt-2 w-full px-3 py-2.5 bg-[#0a0708] border border-white/10 rounded-md text-white focus:outline-none focus:border-brand-500"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
          <button type="submit" disabled={busy || !value.trim()} className={btn.primary}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onClose }: {
  title: string; message: React.ReactNode; confirmLabel: string; danger?: boolean;
  onConfirm: () => void | Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-sm text-gray-300 leading-relaxed mb-5">{message}</div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btn.secondary}>Cancel</button>
        <button
          disabled={busy}
          onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
          className={danger ? btn.danger : btn.primary}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------------- إشعار صغير ----------------

export interface ToastState { text: string; error?: boolean }

export function Toast({ toast, onDone }: { toast: ToastState | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, toast.error ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[90] px-4 w-full max-w-md pointer-events-none">
      <div className={`px-4 py-3 rounded-md border text-sm bg-[#150e10] ${toast.error ? 'border-brand-600/70 text-brand-200' : 'border-white/15 text-gray-100'}`}>
        {toast.text}
      </div>
    </div>
  );
}
