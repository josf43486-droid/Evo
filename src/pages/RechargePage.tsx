import React, { useMemo, useState } from 'react';
import { useAuth } from '../App';
import { db, collection, addDoc, serverTimestamp } from '../backend';
import { motion } from 'motion/react';
import { Send, CheckCircle, Camera, User, CreditCard, Copy, Wallet } from 'lucide-react';
import Footer from '../components/Footer';
import { SUPPORT_TELEGRAM_URL } from '../config';

const readImage = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('تعذر قراءة صورة التحويل'));
  reader.readAsDataURL(file);
});

export default function RechargePage() {
  const { user, profile, globalSettings } = useAuth();
  const methods = useMemo(() => (globalSettings?.paymentMethods || []).filter(m => m.enabled), [globalSettings]);
  const plans = useMemo(() => (globalSettings?.plans || []).filter(p => p.enabled), [globalSettings]);
  const [methodId, setMethodId] = useState('');
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('');
  const [telegram, setTelegram] = useState('');
  const [reference, setReference] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const selectedMethod = methods.find(m => m.id === methodId);
  const selectedPlan = plans.find(p => p.id === planId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    setError('');
    if (!selectedMethod) return setError('اختر وسيلة الدفع أولاً.');
    if (selectedPlan && !selectedPlan.enabled) return setError('هذه الخطة غير متاحة حالياً.');
    const finalAmount = selectedPlan ? selectedPlan.price : Number(amount);
    if (!Number.isFinite(finalAmount) || finalAmount <= 0) return setError('أدخل مبلغاً صحيحاً.');
    if (!screenshot) return setError('ارفع صورة إثبات التحويل.');
    if (screenshot.size > 2 * 1024 * 1024) return setError('حجم الصورة يجب ألا يتجاوز 2 ميجابايت.');
    setLoading(true);
    try {
      const screenshotDataUrl = await readImage(screenshot);
      await addDoc(collection(db, 'rechargeRequests'), {
        uid: user.uid, email: user.email, telegram: telegram.trim(), amount: finalAmount,
        currency: selectedPlan?.currency || 'EGP', methodId: selectedMethod.id,
        methodName: selectedMethod.name, methodAccount: selectedMethod.account,
        methodNetwork: selectedMethod.network || '', planId: selectedPlan?.id || '',
        planName: selectedPlan?.name || '', planSnapshot: selectedPlan || null,
        reference: reference.trim(), screenshotName: screenshot.name,
        screenshotDataUrl, status: 'pending', createdAt: serverTimestamp(),
      });
      setSuccess(true);
    } catch (err) {
      console.error('Payment request error:', err);
      setError('تعذر إرسال الطلب. تحقق من اتصالك وحاول مرة أخرى.');
    } finally { setLoading(false); }
  };

  if (success) return (
    <div className="min-h-screen pt-24 flex items-center justify-center px-4" dir="rtl">
      <motion.div initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-[#0f0a0b] border border-white/10 rounded-3xl p-8 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-5" />
        <h2 className="text-2xl font-black mb-3">تم إرسال طلب الدفع</h2>
        <p className="text-gray-400 mb-7">الطلب الآن قيد المراجعة. لن يتم تفعيل الخطة إلا بعد التحقق من التحويل وموافقة المالك.</p>
        <button onClick={() => window.history.back()} className="w-full py-3.5 bg-brand-600 hover:bg-brand-500 rounded-xl font-bold">العودة</button>
      </motion.div>
    </div>
  );

  return (
    <div className="min-h-screen pt-20 sm:pt-24 pb-12 px-3 sm:px-6" dir="rtl">
      <div className="max-w-2xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="bg-[#0f0a0b] border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-2"><Wallet className="w-7 h-7 text-brand-400"/><h1 className="text-3xl font-black tracking-tight">الاشتراكات والدفع</h1></div>
          <p className="text-gray-500 mb-7">اختر الخطة ووسيلة الدفع، ثم أرسل إثبات التحويل لمراجعته.</p>
          {plans.length > 0 && <div className="mb-6">
            <label className="block text-xs font-bold text-gray-400 mb-2">الخطة المطلوبة</label>
            <select value={planId} onChange={e => { setPlanId(e.target.value); setAmount(''); }} className="w-full px-4 py-3 bg-[#171217] border border-white/10 rounded-xl text-white outline-none focus:border-brand-500">
              <option value="">شحن رصيد فقط / مبلغ مخصص</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name} — {p.price} {p.currency} / {p.durationDays} يوم</option>)}
            </select>
            {selectedPlan && <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[['الخوادم', selectedPlan.serverLimit],['RAM', `${(selectedPlan.ramMb / 1024).toFixed(2)} GB`],['CPU', `${selectedPlan.cpuCores} vCPU`],['التخزين', `${selectedPlan.storageGb} GB`]].map(([k,v]) => <div key={String(k)} className="p-3 bg-white/5 rounded-xl"><span className="block text-gray-500 mb-1">{k}</span><b>{v}</b></div>)}
            </div>}
          </div>}
          <form onSubmit={handleSubmit} className="space-y-5">
            {!selectedPlan && <div><label className="block text-xs font-bold text-gray-400 mb-2">المبلغ</label><input type="number" min="1" required value={amount} onChange={e => setAmount(e.target.value)} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-brand-500" placeholder="اكتب المبلغ" /></div>}
            <div><label className="block text-xs font-bold text-gray-400 mb-2">وسيلة الدفع</label><select required value={methodId} onChange={e => setMethodId(e.target.value)} className="w-full px-4 py-3 bg-[#171217] border border-white/10 rounded-xl text-white outline-none focus:border-brand-500"><option value="">اختر وسيلة الدفع</option>{methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            {selectedMethod && <div className="p-4 sm:p-5 bg-brand-500/10 border border-brand-500/20 rounded-2xl space-y-3">
              <div className="flex items-center justify-between gap-3"><b>{selectedMethod.name}</b><span className="text-xs text-brand-300">بيانات التحويل</span></div>
              {selectedMethod.network && <p className="text-sm text-gray-400">الشبكة: <b className="text-white">{selectedMethod.network}</b></p>}
              <div className="flex items-center gap-2"><code dir="ltr" className="flex-1 break-all text-sm text-white">{selectedMethod.account}</code><button type="button" onClick={() => navigator.clipboard?.writeText(selectedMethod.account)} className="p-2 bg-white/10 rounded-lg" title="نسخ"><Copy className="w-4 h-4"/></button></div>
              {selectedMethod.instructions && <p className="text-xs leading-6 text-gray-400">{selectedMethod.instructions}</p>}
            </div>}
            <div><label className="block text-xs font-bold text-gray-400 mb-2">رقم العملية / مرجع التحويل (اختياري)</label><input value={reference} onChange={e => setReference(e.target.value)} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl outline-none" placeholder="رقم العملية" /></div>
            <div><label className="block text-xs font-bold text-gray-400 mb-2">صورة إثبات التحويل (حتى 2MB)</label><label className="w-full px-4 py-4 bg-white/5 border border-dashed border-white/20 rounded-xl text-gray-400 cursor-pointer flex items-center gap-3"><Camera className="w-5 h-5"/>{screenshot ? screenshot.name : 'اضغط لاختيار صورة التحويل'}<input type="file" accept="image/png,image/jpeg,image/webp" required className="hidden" onChange={e => setScreenshot(e.target.files?.[0] || null)}/></label></div>
            <div><label className="block text-xs font-bold text-gray-400 mb-2">يوزر تيليجرام للتواصل</label><div className="relative"><User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500"/><input required value={telegram} onChange={e => setTelegram(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl outline-none" placeholder="@username"/></div></div>
            {error && <div role="alert" className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
            <button type="submit" disabled={loading || methods.length === 0} className="w-full py-4 bg-brand-600 hover:bg-brand-500 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">{loading ? 'جارٍ إرسال الطلب...' : <><Send className="w-5 h-5"/> إرسال طلب الدفع</>}</button>
            {methods.length === 0 && <p className="text-sm text-amber-300">لا توجد وسائل دفع مفعلة حاليًا. يرجى التواصل مع الدعم.</p>}
          </form>
          <div className="mt-6 pt-5 border-t border-white/5 text-center text-sm text-gray-500">للدعم: <a className="text-brand-400" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer">@vx_rw</a></div>
        </motion.div>
      </div><div className="mt-16"><Footer/></div>
    </div>
  );
}
