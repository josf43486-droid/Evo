import React from 'react';
import { motion } from 'motion/react';
import { Shield, Mail, MessageCircle, CheckCircle2, Globe, Zap, Cpu } from 'lucide-react';
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM_URL } from '../config';
import Footer from '../components/Footer';
import { useAuth } from '../App';

export function AboutPage() {
  return (
    <div className="pt-20 sm:pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-right" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12 sm:mb-16"
      >
        <h1 className="text-3xl sm:text-4xl lg:text-6xl font-black mb-4 sm:mb-6 tracking-tighter">عن EVO</h1>
        <p className="text-base sm:text-xl text-gray-400 max-w-3xl mx-auto px-2">
          منصة استضافة بسيطة للمطورين، تشغّل مشاريع Python و Node.js و PHP من لوحة تحكم واحدة.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8 mb-16 sm:mb-20">
        <div className="p-6 sm:p-8 bg-white/5 border border-white/10 rounded-3xl">
          <Zap className="w-10 h-10 sm:w-12 sm:h-12 text-brand-500 mb-4 sm:mb-6" />
          <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-4">رؤيتنا</h3>
          <p className="text-sm sm:text-base text-gray-400 leading-relaxed">
            أن تكون الاستضافة سهلة وواضحة لكل من يريد تشغيل مشروعه.
          </p>
        </div>
        <div className="p-6 sm:p-8 bg-white/5 border border-white/10 rounded-3xl">
          <Shield className="w-10 h-10 sm:w-12 sm:h-12 text-green-500 mb-4 sm:mb-6" />
          <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-4">قيمنا</h3>
          <p className="text-sm sm:text-base text-gray-400 leading-relaxed">
            الوضوح والبساطة.
          </p>
        </div>
        <div className="p-6 sm:p-8 bg-white/5 border border-white/10 rounded-3xl">
          <Globe className="w-10 h-10 sm:w-12 sm:h-12 text-purple-500 mb-4 sm:mb-6" />
          <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-4">مهمتنا</h3>
          <p className="text-sm sm:text-base text-gray-400 leading-relaxed">
            سيرفرات مستقرة بأسعار مناسبة ودعم يرد عليك.
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}

export function ContactPage() {
  return (
    <div className="pt-20 sm:pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-right" dir="rtl">
      <div className="text-center mb-12 sm:mb-16">
        <h1 className="text-3xl sm:text-4xl font-black mb-3 sm:mb-4 tracking-tighter">اتصل بنا</h1>
        <p className="text-sm sm:text-base text-gray-400">راسلنا وسنرد عليك.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12">
        <div className="space-y-4 sm:space-y-8">
          <div className="flex items-center gap-4 sm:gap-6 p-5 sm:p-6 bg-white/5 border border-white/10 rounded-3xl">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-brand-600/20 rounded-2xl flex items-center justify-center text-brand-500 shrink-0">
              <Mail className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h4 className="font-bold text-base sm:text-lg">البريد الإلكتروني</h4>
              <p className="text-sm sm:text-base text-gray-400" dir="ltr">{SUPPORT_EMAIL}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 sm:gap-6 p-5 sm:p-6 bg-white/5 border border-white/10 rounded-3xl">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-green-600/20 rounded-2xl flex items-center justify-center text-green-500 shrink-0">
              <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h4 className="font-bold text-base sm:text-lg">تيليجرام</h4>
              <p className="text-sm sm:text-base text-gray-400" dir="ltr">{SUPPORT_TELEGRAM_URL.replace('https://t.me/', '@')}</p>
            </div>
          </div>
        </div>

        <form className="p-6 sm:p-8 bg-white/5 border border-white/10 rounded-3xl space-y-5 sm:space-y-6">
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">الاسم بالكامل</label>
            <input type="text" className="w-full px-4 py-2.5 sm:py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-brand-500 text-sm" placeholder="أدخل اسمك" />
          </div>
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">البريد الإلكتروني</label>
            <input type="email" className="w-full px-4 py-2.5 sm:py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-brand-500 text-sm" placeholder="example@mail.com" />
          </div>
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">الرسالة</label>
            <textarea className="w-full px-4 py-2.5 sm:py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-brand-500 h-24 sm:h-32 resize-none text-sm" placeholder="كيف يمكننا مساعدتك؟"></textarea>
          </div>
          <button className="w-full py-3.5 sm:py-4 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-brand-600/20 text-sm sm:text-base">
            إرسال الرسالة
          </button>
        </form>
      </div>
      <Footer />
    </div>
  );
}

export function PricingPage() {
  const { globalSettings } = useAuth();
  const plans = (globalSettings?.plans || []).filter(plan => plan.enabled);
  return (
    <div className="pt-20 sm:pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-right" dir="rtl">
      <div className="text-center mb-12 sm:mb-16">
        <h1 className="text-3xl sm:text-4xl font-black mb-3 sm:mb-4 tracking-tighter">خطط الأسعار</h1>
        <p className="text-sm sm:text-base text-gray-400">اختر الخطة التي تناسب احتياجات مشروعك.</p>
      </div>
      {plans.length === 0 ? <div className="max-w-xl mx-auto p-8 text-center rounded-3xl border border-white/10 bg-white/5 text-gray-400">لا توجد خطط متاحة للشراء حالياً.</div> :
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {plans.map(plan => <div key={plan.id} className="relative p-6 sm:p-8 rounded-3xl border border-brand-500/30 bg-[#0f0a0b] shadow-xl shadow-black/20">
            <div className="flex items-start justify-between gap-3 mb-4"><h3 className="text-xl sm:text-2xl font-black">{plan.name}</h3><span className="text-xs px-3 py-1 rounded-full bg-brand-500/10 text-brand-300">{plan.durationDays} يوم</span></div>
            <div className="mb-6"><span className="text-4xl font-black">{plan.price}</span><span className="text-gray-500 mr-2">{plan.currency}</span></div>
            <ul className="space-y-3 text-sm text-gray-300 mb-7"><li>{plan.serverLimit} خادم</li><li>{(plan.ramMb / 1024).toFixed(2)} GB RAM</li><li>{plan.cpuCores} vCPU</li><li>{plan.storageGb} GB تخزين</li><li>{plan.projectLimit} مشروع</li>{plan.description && <li className="text-gray-500">{plan.description}</li>}</ul>
            <a href="/recharge" className="block text-center w-full py-3.5 rounded-xl bg-brand-600 hover:bg-brand-500 font-bold transition-colors">اشترك الآن</a>
          </div>)}
        </div>}
      <Footer />
    </div>
  );
}

export function PrivacyPolicy() {
  return (
    <div className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-right" dir="rtl">
      <h1 className="text-3xl font-black mb-8">سياسة الخصوصية</h1>
      <div className="prose prose-invert max-w-none space-y-6 text-gray-400">
        <p>نحن في EVO نلتزم بحماية خصوصيتك وبياناتك الشخصية.</p>
        <h2 className="text-xl font-bold text-white">1. البيانات التي نجمعها</h2>
        <p>نجمع اسم المستخدم الذي تسجل به عند إنشاء الحساب.</p>
        <h2 className="text-xl font-bold text-white">2. كيف نستخدم بياناتك</h2>
        <p>نستخدم بياناتك لتحسين خدماتنا، والتواصل معك بخصوص حسابك، وضمان أمان المنصة.</p>
        <h2 className="text-xl font-bold text-white">3. حماية البيانات</h2>
        <p>كلمات المرور مخزنة مشفرة، وكل مستخدم لا يصل إلا إلى بياناته.</p>
      </div>
      <Footer />
    </div>
  );
}

export function TermsOfService() {
  return (
    <div className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-right" dir="rtl">
      <h1 className="text-3xl font-black mb-8">شروط الاستخدام</h1>
      <div className="prose prose-invert max-w-none space-y-6 text-gray-400">
        <p>باستخدامك لخدمات EVO، فإنك توافق على الالتزام بالشروط التالية.</p>
        <h2 className="text-xl font-bold text-white">1. الاستخدام المقبول</h2>
        <p>يمنع استخدام خدماتنا في أي أنشطة غير قانونية أو تضر بالآخرين.</p>
        <h2 className="text-xl font-bold text-white">2. الحسابات والأمان</h2>
        <p>أنت مسؤول عن الحفاظ على سرية معلومات حسابك وكلمة المرور.</p>
        <h2 className="text-xl font-bold text-white">3. إلغاء الخدمة</h2>
        <p>نحتفظ بالحق في تعليق أو إلغاء حسابك في حال مخالفة شروط الاستخدام.</p>
      </div>
      <Footer />
    </div>
  );
}
