import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db, addDoc, collection, serverTimestamp, createUserWithEmailAndPassword, signInWithEmailAndPassword } from '../backend';
import { motion } from 'motion/react';
import { ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { BRAND_FIRST, BRAND_SECOND, BRAND_NAME, usernameToEmail, USERNAME_REGEX } from '../config';

/** رسم "Control Plane" أعلى البطاقة */
function ControlPlaneArt() {
  return (
    <svg viewBox="0 0 400 230" className="w-full h-full" aria-hidden="true">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e8283f" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#e8283f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="105" r="150" fill="url(#glow)" />
      <circle cx="200" cy="105" r="118" fill="none" stroke="#e8283f" strokeOpacity="0.10" />
      <circle cx="200" cy="105" r="82" fill="none" stroke="#e8283f" strokeOpacity="0.22" />

      <g stroke="#e8283f" strokeOpacity="0.55" strokeDasharray="3 4" fill="none">
        <path d="M112 62 H150 L162 72" />
        <path d="M238 72 H280" />
        <path d="M238 128 L252 140 H288" />
        <path d="M112 150 H150 L162 142" />
      </g>
      <g fill="#e8283f">
        <circle cx="112" cy="62" r="2.5" />
        <circle cx="280" cy="72" r="2.5" />
        <circle cx="288" cy="140" r="2.5" />
        <circle cx="112" cy="150" r="2.5" />
      </g>

      <polygon points="200,18 242,40 242,170 200,192 158,170 158,40" fill="#150e10" stroke="#fff" strokeOpacity="0.14" />
      <polygon points="200,28 234,46 234,164 200,182 166,164 166,46" fill="#110b0d" stroke="#fff" strokeOpacity="0.08" />
      {[0, 44, 88].map((y) => (
        <g key={y} transform={`translate(0 ${y})`}>
          <polygon points="172,60 200,46 228,60 228,78 200,92 172,78" fill="#0e090b" stroke="#fff" strokeOpacity="0.14" />
          <polygon points="172,78 200,92 228,78 228,92 200,106 172,92" fill="#000" />
          <path d="M184 64 L196 70" stroke="#fff" strokeOpacity="0.35" strokeLinecap="round" />
          <circle cx="220" cy="64" r="2.4" fill="#e8283f" />
        </g>
      ))}
    </svg>
  );
}

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const name = username.trim().toLowerCase();

    if (!isLogin) {
      if (!USERNAME_REGEX.test(name)) {
        setError('Username must be 3-20 characters: letters, numbers, dot, dash or underscore.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
    } else if (!name || !password) {
      setError('Please enter your username and password.');
      return;
    }

    setLoading(true);
    try {
      const email = usernameToEmail(name);

      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        navigate('/dashboard');
      } else {
        // تسجيل مباشر: بدون تأكيد إيميل ولا أي خطوة إضافية (الخادم ينشئ الملف الشخصي)
        const cred = await createUserWithEmailAndPassword(auth, email, password, name);

        try {
          await addDoc(collection(db, 'activities'), {
            uid: cred.user.uid,
            type: 'account_created',
            description: `تم إنشاء حساب جديد باسم: ${name}`,
            createdAt: serverTimestamp(),
          });
        } catch {}

        navigate('/dashboard');
      }
    } catch (err: any) {
      switch (err.code) {
        case 'auth/email-already-in-use':
          setError('This username is already taken.');
          break;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          setError('Invalid username or password.');
          break;
        case 'auth/weak-password':
          setError('Password is too weak (min 6 characters).');
          break;
        case 'auth/invalid-email':
          setError('Invalid username.');
          break;
        case 'auth/too-many-requests':
          setError('Too many attempts. Please try again in a few minutes.');
          break;
        case 'unavailable':
          setError('Network error. Check your connection and try again.');
          break;
        default:
          setError(err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'block w-full px-5 py-4 bg-[#0f0a0b] border border-white/10 rounded-2xl text-white placeholder-gray-500 ' +
    'focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 transition-all text-base';

  return (
    <div
      dir="ltr"
      className="min-h-screen flex items-center justify-center px-4 py-8 bg-[#0b0708] relative overflow-hidden"
      style={{
        backgroundImage:
          'radial-gradient(ellipse at 50% 0%, rgba(232,40,63,0.10), transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(232,40,63,0.06), transparent 55%)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md bg-[#140d0f] border border-white/10 rounded-[28px] shadow-2xl overflow-hidden"
      >
        <div className="p-4 pb-0">
          <div className="relative h-52 sm:h-56 rounded-[22px] border border-white/10 bg-[#110b0d] overflow-hidden">
            <ControlPlaneArt />
            <div className="absolute bottom-3 right-4 flex items-center gap-3">
              <span className="w-10 h-px bg-brand-500" />
              <span className="text-[10px] tracking-[0.3em] text-gray-400 font-mono uppercase">
                Control Plane · 01
              </span>
            </div>
          </div>
        </div>

        <div className="h-px bg-white/10 mt-4" />

        <div className="px-7 sm:px-8 pt-8 pb-8">
          <div className="flex items-center gap-3 mb-6">
            <span className="w-8 h-8 rounded-full bg-brand-500/15 flex items-center justify-center">
              <span className="w-3 h-3 rounded-full bg-brand-500" />
            </span>
            <span className="text-xs tracking-[0.3em] text-gray-300 uppercase font-medium">
              {isLogin ? 'Server Access' : 'Create Account'}
            </span>
          </div>

          <h1 className="text-4xl sm:text-[2.6rem] font-black tracking-tight text-white leading-none">
            {BRAND_FIRST} <span className="text-brand-500">{BRAND_SECOND}</span>
          </h1>
          <p className="text-gray-400 mt-3 mb-8">Server Management Panel</p>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-5 bg-brand-500/10 border border-brand-500/30 p-3.5 rounded-xl flex items-start gap-3 text-brand-300 text-sm"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="username" className="block text-sm font-bold text-gray-300 mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-bold text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-white text-lg
                         bg-gradient-to-b from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500
                         shadow-lg shadow-brand-600/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {isLogin ? 'Login' : 'Create account'}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <p className="text-sm text-gray-400 mt-6 text-center">
            {isLogin ? "Don't have an account?" : 'Already have an account?'}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="ml-2 font-bold text-brand-400 hover:text-brand-300 underline underline-offset-4 transition-colors"
            >
              {isLogin ? 'Sign up' : 'Login'}
            </button>
          </p>

          <p className="text-gray-500 mt-8 text-sm">{BRAND_NAME} © 2026</p>
        </div>
      </motion.div>
    </div>
  );
}
