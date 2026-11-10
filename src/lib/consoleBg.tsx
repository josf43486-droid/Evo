import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { useAuth } from '../App';
import { db, doc, getDoc, updateDoc } from '../backend';
import { CONSOLE_BG_KEY, DEFAULT_CONSOLE_BG } from '../config';

/** صورة خلفية الكونسول: تُحفظ في المتصفح، وإن كان المستخدم مسجلاً تُحفظ بحسابه أيضاً */
export function useConsoleBg() {
  const { user } = useAuth();
  const [image, setImage] = useState<string>(() => {
    try { return localStorage.getItem(CONSOLE_BG_KEY) || ''; } catch { return ''; }
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      const saved = snap.exists() ? (snap.data() as any).consoleBg : '';
      if (saved) setImage(saved);
    }).catch(() => {});
  }, [user?.uid]);

  const persist = async (value: string) => {
    setImage(value);
    try { value ? localStorage.setItem(CONSOLE_BG_KEY, value) : localStorage.removeItem(CONSOLE_BG_KEY); } catch {}
    if (user) { try { await updateDoc(doc(db, 'users', user.uid), { consoleBg: value }); } catch {} }
  };

  const pick = (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    setError('');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // نصغّر الصورة ونضغطها حتى يسهل حفظها
      const scale = Math.min(1, 900 / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      persist(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); setError('Could not read this image.'); };
    img.src = url;
  };

  return { image, active: image || DEFAULT_CONSOLE_BG, error, pick, clear: () => persist('') };
}

type Bg = ReturnType<typeof useConsoleBg>;

/** طبقة الصورة + التعتيم (ضعها داخل عنصر relative قبل المحتوى) */
export function ConsoleBgLayer({ bg, dim = 0.78 }: { bg: Bg; dim?: number }) {
  return (
    <>
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bg.active}")` }} />
      <div className="absolute inset-0" style={{ backgroundColor: `rgba(10,7,8,${dim})` }} />
    </>
  );
}

/** زر تغيير الصورة / إزالتها */
export function ConsoleBgButtons({ bg, label = false, className = '' }: { bg: Bg; label?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) bg.pick(f); e.target.value = ''; }} />
      <button type="button" onClick={() => input.current?.click()} title="Change console image" aria-label="Change console image"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-white/10 text-xs">
        <ImageIcon className="w-3.5 h-3.5" />{label && 'Change image'}
      </button>
      {bg.image && (
        <button type="button" onClick={bg.clear} title="Remove image" aria-label="Remove image"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"><X className="w-3.5 h-3.5" /></button>
      )}
      {bg.error && <span className="text-[11px] text-brand-300">{bg.error}</span>}
    </span>
  );
}
