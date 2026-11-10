import React from 'react';
import { Link } from 'react-router-dom';
import { Send, Mail } from 'lucide-react';
import { OWNER_TELEGRAM_URL, SUPPORT_EMAIL, OWNER_NAME } from '../config';

export default function Footer() {
  return (
    <footer className="py-12 border-t border-white/10 px-4 sm:px-6 lg:px-8 bg-[#0a0708]" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <img src="/evo-icon.svg" alt="EVO" className="w-9 h-9 rounded-xl" />
              <span className="text-xl font-black tracking-[.18em]">EVO</span>
            </div>
            <p className="text-gray-500 text-sm max-w-sm leading-relaxed">
              منصة EVO — بهوية Kairo، لاستضافة مشاريعك وإدارتها بسهولة وأمان.
            </p>
            <div className="mt-5 flex flex-wrap gap-4 text-sm">
              <a href={OWNER_TELEGRAM_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-brand-400 hover:text-brand-300"><Send size={15}/> تليجرام Kairo</a>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center gap-2 text-gray-400 hover:text-white"><Mail size={15}/> {SUPPORT_EMAIL}</a>
            </div>
            <p className="mt-3 text-xs text-gray-600">المالك: {OWNER_NAME} · @vx_rw</p>
          </div>
        </div>
        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="text-gray-600 text-xs">© 2026 EVO. جميع الحقوق محفوظة.</p>
        </div>
      </div>
    </footer>
  );
}
