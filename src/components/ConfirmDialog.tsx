import React, { useCallback, useRef, useState } from 'react';

type ConfirmOptions = { title?: string; message: string; confirmText?: string; danger?: boolean };

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOptions(next);
  }), []);
  const finish = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };
  const Dialog = () => options ? (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-4" role="presentation">
      <button aria-label="إغلاق" className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => finish(false)} />
      <section role="alertdialog" aria-modal="true" aria-labelledby="nexus-confirm-title" className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#151016] p-6 sm:p-8 shadow-2xl">
        <div className="w-11 h-11 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5 text-brand-400">!</div>
        <h3 id="nexus-confirm-title" className="text-xl font-black mb-3">{options.title || 'تأكيد العملية'}</h3>
        <p className="text-sm leading-7 text-gray-400 mb-7">{options.message}</p>
        <div className="flex gap-3"><button onClick={() => finish(false)} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 font-bold">إلغاء</button><button onClick={() => finish(true)} className={`flex-1 py-3 rounded-xl font-bold text-white ${options.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-brand-600 hover:bg-brand-500'}`}>{options.confirmText || 'تأكيد'}</button></div>
      </section>
    </div>
  ) : null;
  return { confirm, ConfirmDialog: Dialog };
}
