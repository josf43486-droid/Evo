/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, auth, db, doc, getDoc, setDoc, serverTimestamp, type AuthUser, onSnapshot } from './backend';
import { UserProfile, GlobalSettings } from './types';
import { checkExpiredServers } from './services/subscriptionService';
import LandingPage from './pages/LandingPage';
import ErrorBoundary from './components/ErrorBoundary';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import FilesPage from './pages/FilesPage';
import ServerDetail from './pages/ServerDetail';
import AdminDashboard from './pages/AdminDashboard';
import RechargePage from './pages/RechargePage';
import CommunityPage from './pages/CommunityPage';
import Navbar from './components/Navbar';
import { AboutPage, ContactPage, PricingPage, PrivacyPolicy, TermsOfService } from './pages/StaticPages';
import { ShieldAlert, Lock } from 'lucide-react';
import { emailToUsername } from './config';

interface AuthContextType {
  user: AuthUser | null;
  profile: UserProfile | null;
  loading: boolean;
  globalSettings: GlobalSettings | null;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  globalSettings: null,
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function MaintenancePage({ message }: { message?: string }) {
  return (
    <div className="min-h-screen bg-[#0b0708] flex items-center justify-center px-4 text-center" dir="rtl">
      <div className="max-w-md">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <Lock className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-4xl font-black tracking-tighter mb-4">الموقع مغلق حالياً</h1>
        <p className="text-gray-400 text-lg">{message || 'نحن نقوم ببعض التحديثات الضرورية. يرجى العودة لاحقاً.'}</p>
      </div>
    </div>
  );
}

function BannedPage() {
  return (
    <div className="min-h-screen bg-[#0b0708] flex items-center justify-center px-4 text-center" dir="rtl">
      <div className="max-w-md">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-4xl font-black tracking-tighter mb-4">حسابك محظور</h1>
        <p className="text-gray-400 text-lg">لقد تم حظر حسابك من قبل المشرف. يرجى التواصل مع الدعم للمزيد من المعلومات.</p>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (uid: string) => {
    try {
      const currentEmail = auth.currentUser?.email || '';

      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        setProfile(userDoc.data() as UserProfile);
      } else {
        const newProfile: UserProfile = {
          uid,
          email: currentEmail,
          displayName: auth.currentUser?.displayName || emailToUsername(currentEmail),
          photoURL: auth.currentUser?.photoURL || '',
          plan: 'free',
          serverCount: 0,
          balance: globalSettings?.defaultBalance || 0,
          role: 'user',
          createdAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'users', uid), newProfile);
        setProfile(newProfile);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  useEffect(() => {
    const unsubscribeSettings = onSnapshot(doc(db, 'config', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        setGlobalSettings(snapshot.data() as GlobalSettings);
      }
    }, (error) => {
      console.error('Error in global settings listener:', error);
    });

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await fetchProfile(currentUser.uid);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      unsubscribeSettings();
      unsubscribeAuth();
    };
  }, []);

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.uid);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0708] flex items-center justify-center">
        <div className="nexus-boot flex flex-col items-center gap-5 px-6 text-center">
          <div className="nexus-orbit"><span>E</span></div>
          <div><p className="text-2xl font-black tracking-[.22em]">EVO</p><p className="mt-2 text-[10px] tracking-[.35em] text-gray-500">POWERED BY KAIRO</p></div>
          <div className="nexus-loading"><i /></div>
          <p className="text-xs text-gray-500">تهيئة مساحة العمل الآمنة...</p>
        </div>
      </div>
    );
  }

  const isAdmin = profile?.role === 'admin';
  const isBanned = profile?.isBanned;
  const isExempted = globalSettings?.exemptedEmails?.includes(profile?.email || '');
  const isSiteClosed = globalSettings?.isSiteClosed && !isAdmin && !isExempted;

  if (isBanned) return <BannedPage />;
  if (isSiteClosed) return <MaintenancePage message={globalSettings?.maintenanceMessage} />;

  return (
    <AuthContext.Provider value={{ user, profile, loading, globalSettings, refreshProfile }}>
      <Router>
        <ErrorBoundary>
          <div className="min-h-screen bg-[#0b0708] text-white font-sans">
            <Navbar />
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/auth" element={!user ? <AuthPage /> : <Navigate to="/dashboard" />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/auth" />} />
              <Route path="/files" element={user ? <FilesPage /> : <Navigate to="/auth" />} />
              <Route path="/server/:id" element={user ? <ServerDetail /> : <Navigate to="/auth" />} />
              <Route path="/recharge" element={user ? <RechargePage /> : <Navigate to="/auth" />} />
              <Route path="/community" element={user ? <CommunityPage /> : <Navigate to="/auth" />} />
              <Route path="/admin" element={isAdmin ? <AdminDashboard /> : <Navigate to="/dashboard" />} />
            </Routes>
          </div>
        </ErrorBoundary>
      </Router>
    </AuthContext.Provider>
  );
}
