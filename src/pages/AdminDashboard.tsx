import React, { useState, useEffect } from 'react';
import { usernameToEmail, emailToUsername } from '../config';
import { useAuth } from '../App';
import { db, authHeaders, collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, getDocs, getDoc, setDoc, orderBy, limit, addDoc, serverTimestamp } from '../backend';
import { UserProfile, ServerInstance, GlobalSettings, RechargeRequest, PLANS, Activity, ServerFile, CustomPlan, PaymentMethod } from '../types';
import { 
  Users, Server, Settings, Activity as ActivityIcon, Trash2, Shield, ShieldAlert, 
  Plus, Minus, Power, PowerOff, LayoutDashboard, Database, 
  Folder, Download, Trash, UserX, UserCheck, CreditCard, Check, X, AlertTriangle, Camera, ShieldCheck, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Footer from '../components/Footer';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { appAlert } from '../lib/dialogs';

export default function AdminDashboard() {
  const { user, profile } = useAuth();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [rechargeRequests, setRechargeRequests] = useState<RechargeRequest[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<RechargeRequest | null>(null);
  const [userServers, setUserServers] = useState<ServerInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'requests' | 'billing' | 'settings' | 'servers' | 'activities' | 'security'>('users');
  const [securityEvents, setSecurityEvents] = useState<any[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [exemptEmailInput, setExemptEmailInput] = useState('');
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  const [allUserFiles, setAllUserFiles] = useState<ServerFile[]>([]);
  const [fetchingFiles, setFetchingFiles] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState<string>('');
  const [planDraft, setPlanDraft] = useState<CustomPlan>({ id: '', name: '', price: 0, currency: 'EGP', durationDays: 30, serverLimit: 1, ramMb: 512, cpuCores: 0.5, storageGb: 2, projectLimit: 1, enabled: true, description: '' });
  const [methodDraft, setMethodDraft] = useState<PaymentMethod>({ id: '', name: '', type: 'usdt', account: '', network: 'TRC20', instructions: '', enabled: true });
  const [manualSubDraft, setManualSubDraft] = useState({ name: 'اشتراك مخصص', days: 30, servers: 1, ramMb: 1024, cpuCores: 1, storageGb: 5, projects: 2 });

  const refreshSecurityEvents = async () => {
    setSecurityLoading(true);
    try {
      const response = await fetch('/api/ws/admin/security-events?limit=150', { headers: authHeaders() });
      if (!response.ok) throw new Error('تعذر تحميل سجل الحماية');
      const data = await response.json();
      setSecurityEvents(Array.isArray(data.events) ? data.events : []);
    } catch (error) {
      console.error('[security-center]', error);
      appAlert('تعذر تحميل سجل الحماية. تحقق من اتصال الخادم.');
    } finally { setSecurityLoading(false); }
  };

  useEffect(() => {
    if (!user || profile?.role !== 'admin') return;

    // Fetch Users
    const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => {
      console.error('Error in admin users listener:', error);
    });

    // Fetch Servers
    const unsubscribeServers = onSnapshot(collection(db, 'servers'), (snapshot) => {
      setServers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServerInstance)));
    }, (error) => {
      console.error('Error in admin servers listener:', error);
    });

    // Fetch Recharge Requests
    const unsubscribeRequests = onSnapshot(collection(db, 'rechargeRequests'), (snapshot) => {
      setRechargeRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RechargeRequest)));
    }, (error) => {
      console.error('Error in admin recharge requests listener:', error);
    });

    // Fetch Activities
    const unsubscribeActivities = onSnapshot(query(collection(db, 'activities'), orderBy('createdAt', 'desc'), limit(50)), (snapshot) => {
      setActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Activity)));
    }, (error) => {
      console.error('Error in admin activities listener:', error);
    });

    // Fetch Global Settings
    const unsubscribeSettings = onSnapshot(doc(db, 'config', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        setGlobalSettings(snapshot.data() as GlobalSettings);
      } else {
        // Initialize if not exists
        const initialSettings: GlobalSettings = {
          isSiteClosed: false,
          premiumPlanPrice: 300,
          allowFreePlans: true,
          allowPremiumPlans: true,
        };
        setDoc(doc(db, 'config', 'global'), initialSettings);
        setGlobalSettings(initialSettings);
      }
      setLoading(false);
    });

    return () => {
      unsubscribeUsers();
      unsubscribeServers();
      unsubscribeRequests();
      unsubscribeActivities();
      unsubscribeSettings();
    };
  }, [user, profile]);

  useEffect(() => {
    if (activeTab === 'security' && user && profile?.role === 'admin') void refreshSecurityEvents();
  }, [activeTab, user, profile?.role]);

  useEffect(() => {
    if (selectedUser) {
      const q = query(collection(db, 'servers'), where('ownerId', '==', selectedUser.uid));
      const unsubscribeUserServers = onSnapshot(q, (snapshot) => {
        setUserServers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServerInstance)));
      });
      return () => unsubscribeUserServers();
    }
  }, [selectedUser]);

  if (profile?.role !== 'admin') {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">غير مصرح لك بالدخول</h1>
          <p className="text-gray-400">هذه الصفحة مخصصة للمشرفين فقط.</p>
        </div>
      </div>
    );
  }

  const handleUpdateSettings = async (updates: Partial<GlobalSettings>) => {
    if (!globalSettings) return;
    await updateDoc(doc(db, 'config', 'global'), updates);
  };

  const savePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalSettings || !planDraft.name.trim() || planDraft.price < 0 || planDraft.durationDays < 1) return;
    const id = planDraft.id.trim() || `plan_${Date.now().toString(36)}`;
    const plans = [...(globalSettings.plans || []).filter(p => p.id !== id), { ...planDraft, id, name: planDraft.name.trim() }];
    await handleUpdateSettings({ plans });
    setPlanDraft({ id: '', name: '', price: 0, currency: 'EGP', durationDays: 30, serverLimit: 1, ramMb: 512, cpuCores: 0.5, storageGb: 2, projectLimit: 1, enabled: true, description: '' });
  };

  const saveMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalSettings || !methodDraft.name.trim() || !methodDraft.account.trim()) return;
    const id = methodDraft.id.trim() || `pay_${Date.now().toString(36)}`;
    const paymentMethods = [...(globalSettings.paymentMethods || []).filter(m => m.id !== id), { ...methodDraft, id, name: methodDraft.name.trim(), account: methodDraft.account.trim() }];
    await handleUpdateSettings({ paymentMethods });
    setMethodDraft({ id: '', name: '', type: 'usdt', account: '', network: 'TRC20', instructions: '', enabled: true });
  };

  const removePlan = async (id: string) => handleUpdateSettings({ plans: (globalSettings?.plans || []).filter(p => p.id !== id) });
  const removeMethod = async (id: string) => handleUpdateSettings({ paymentMethods: (globalSettings?.paymentMethods || []).filter(m => m.id !== id) });

  const handleAssignManualSubscription = async () => {
    if (!selectedUser || manualSubDraft.days < 1 || manualSubDraft.servers < 1 || manualSubDraft.ramMb < 128) return;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + manualSubDraft.days * 86400000);
    const subscription = {
      planId: `manual_${Date.now().toString(36)}`, planName: manualSubDraft.name.trim() || 'اشتراك مخصص',
      status: 'active', startsAt: now, expiresAt, serverLimit: manualSubDraft.servers,
      ramMb: manualSubDraft.ramMb, cpuCores: manualSubDraft.cpuCores,
      storageGb: manualSubDraft.storageGb, projectLimit: manualSubDraft.projects,
      assignedBy: user?.uid, assignedAt: now,
    };
    try {
      await updateDoc(doc(db, 'users', selectedUser.uid), { plan: 'premium', subscription });
      setSelectedUser({ ...selectedUser, plan: 'premium', subscription } as UserProfile);
      await addDoc(collection(db, 'activities'), { uid: selectedUser.uid, type: 'subscription', description: `تم منح ${emailToUsername(selectedUser.email)} اشتراكاً مخصصاً لمدة ${manualSubDraft.days} يوم`, createdAt: serverTimestamp() });
      appAlert('تم تفعيل الاشتراك المخصص للمستخدم.', 'success');
    } catch (error) { console.error(error); appAlert('تعذر تفعيل الاشتراك.', 'error'); }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmailInput.trim()) return;

    try {
      const q = query(collection(db, 'users'), where('email', '==', usernameToEmail(adminEmailInput)));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        appAlert('المستخدم غير موجود.');
        return;
      }

      const userDoc = snapshot.docs[0];
      await updateDoc(userDoc.ref, { role: 'admin' });
      appAlert('تمت إضافة المشرف بنجاح.');
      setAdminEmailInput('');
    } catch (error) {
      console.error('Error adding admin:', error);
      appAlert('حدث خطأ أثناء إضافة المشرف.');
    }
  };

  const handleDemoteAdmin = async (uid: string) => {
    if (await confirm({ title: 'إزالة صلاحية المشرف', message: 'هل أنت متأكد من إزالة هذا المشرف؟', danger: true })) {
      try {
        await updateDoc(doc(db, 'users', uid), { role: 'user' });
        appAlert('تمت إزالة المشرف بنجاح.');
        if (selectedUser?.uid === uid) {
          setSelectedUser({ ...selectedUser, role: 'user' });
        }
      } catch (error) {
        console.error('Error demoting admin:', error);
        appAlert('حدث خطأ أثناء إزالة المشرف.');
      }
    }
  };

  const fetchUserFiles = async (uid: string) => {
    setFetchingFiles(true);
    setIsFilesModalOpen(true);
    setAllUserFiles([]);

    try {
      const serversQ = query(collection(db, 'servers'), where('ownerId', '==', uid));
      const serversSnapshot = await getDocs(serversQ);
      const serverIds = serversSnapshot.docs.map(doc => doc.id);

      if (serverIds.length === 0) {
        setFetchingFiles(false);
        return;
      }

      const allFiles: ServerFile[] = [];
      for (const serverId of serverIds) {
        const filesSnapshot = await getDocs(collection(db, 'servers', serverId, 'files'));
        filesSnapshot.docs.forEach(doc => {
          allFiles.push({ id: doc.id, ...doc.data() } as ServerFile);
        });
      }

      setAllUserFiles(allFiles);
    } catch (error) {
      console.error('Error fetching user files:', error);
      appAlert('حدث خطأ أثناء جلب الملفات.');
    } finally {
      setFetchingFiles(false);
    }
  };

  const handleDownloadFile = (file: ServerFile) => {
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenRequest = async (request: RechargeRequest) => {
    setSelectedRequest(request);
    try {
      const full = await getDoc(doc(db, 'rechargeRequests', request.id));
      if (full.exists()) setSelectedRequest({ id: request.id, ...full.data() } as RechargeRequest);
    } catch (error) { console.error('Could not load payment proof:', error); }
  };

  const handleApproveRequest = async (request: RechargeRequest) => {
    try {
      const requestRef = doc(db, 'rechargeRequests', request.id);
      const freshRequest = await getDoc(requestRef);
      if (!freshRequest.exists() || freshRequest.data().status !== 'pending') throw new Error('تمت معالجة هذا الطلب بالفعل');
      const userRef = doc(db, 'users', request.uid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const current = userDoc.data();
        const updates: any = { balance: (current.balance || 0) + (request.planId ? 0 : request.amount) };
        if (request.planId && request.planSnapshot) {
          const plan = request.planSnapshot as CustomPlan;
          const expiresAt = new Date(Date.now() + Math.max(1, Number(plan.durationDays) || 30) * 86400000);
          updates.plan = 'premium';
          updates.subscription = { planId: plan.id, planName: plan.name, status: 'active', startsAt: new Date(), expiresAt, serverLimit: plan.serverLimit, ramMb: plan.ramMb, cpuCores: plan.cpuCores, storageGb: plan.storageGb, projectLimit: plan.projectLimit, approvedAt: new Date() };
        }
        await updateDoc(userRef, updates);
      }

      await updateDoc(requestRef, { status: 'approved', reviewedAt: serverTimestamp(), reviewNote: 'تم التحقق والموافقة من لوحة المالك' });

      await addDoc(collection(db, 'activities'), {
        uid: request.uid,
        type: 'recharge',
        description: request.planName ? `تم تفعيل خطة ${request.planName} للمستخدم ${emailToUsername(request.email)}` : `تم شحن رصيد بقيمة ${request.amount} ${request.currency || 'EGP'} للمستخدم ${emailToUsername(request.email)}`,
        createdAt: serverTimestamp()
      });

      appAlert(request.planName ? `تم تفعيل خطة ${request.planName} بنجاح.` : 'تمت الموافقة على طلب الشحن وإضافة الرصيد.', 'success');
      setSelectedRequest(null);
    } catch (error) {
      console.error('Error approving request:', error);
      appAlert('حدث خطأ أثناء معالجة الطلب.');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await updateDoc(doc(db, 'rechargeRequests', requestId), { status: 'rejected', reviewedAt: serverTimestamp(), reviewNote: 'تم رفض الطلب من لوحة المالك' });
      setSelectedRequest(null);
    } catch (error) {
      console.error('Error rejecting request:', error);
      appAlert('حدث خطأ أثناء رفض الطلب.');
    }
  };

  const handleUserAction = async (uid: string, action: 'ban' | 'unban' | 'addBalance' | 'subBalance', amount?: number) => {
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) return;

    if (action === 'ban') {
      await updateDoc(userRef, { isBanned: true });
      await addDoc(collection(db, 'activities'), {
        uid,
        type: 'ban',
        description: `تم حظر المستخدم ${emailToUsername(userDoc.data().email)}`,
        createdAt: serverTimestamp()
      });
    } else if (action === 'unban') {
      await updateDoc(userRef, { isBanned: false });
      await addDoc(collection(db, 'activities'), {
        uid,
        type: 'unban',
        description: `تم إلغاء حظر المستخدم ${emailToUsername(userDoc.data().email)}`,
        createdAt: serverTimestamp()
      });
    } else if (action === 'addBalance' && amount) {
      const currentBalance = userDoc.data().balance || 0;
      await updateDoc(userRef, { balance: currentBalance + amount });
      await addDoc(collection(db, 'activities'), {
        uid,
        type: 'balance_add',
        description: `تم إضافة ${amount} SYP لرصيد المستخدم ${emailToUsername(userDoc.data().email)}`,
        createdAt: serverTimestamp()
      });
    } else if (action === 'subBalance' && amount) {
      const currentBalance = userDoc.data().balance || 0;
      await updateDoc(userRef, { balance: Math.max(0, currentBalance - amount) });
      await addDoc(collection(db, 'activities'), {
        uid,
        type: 'balance_sub',
        description: `تم خصم ${amount} SYP من رصيد المستخدم ${emailToUsername(userDoc.data().email)}`,
        createdAt: serverTimestamp()
      });
    }
  };

  const handleServerAction = async (serverId: string, action: 'start' | 'stop' | 'delete') => {
    try {
      const serverRef = doc(db, 'servers', serverId);
      const serverDoc = await getDoc(serverRef);
      if (!serverDoc.exists()) {
        appAlert('السيرفر غير موجود.');
        return;
      }
      const serverData = serverDoc.data() as ServerInstance;

      if (action === 'start') {
        await updateDoc(serverRef, { status: 'running' });
        await addDoc(collection(db, 'activities'), {
          uid: serverData.ownerId,
          serverId,
          serverName: serverData.name,
          type: 'start',
          description: `تم تشغيل السيرفر ${serverData.name}`,
          createdAt: serverTimestamp()
        });
        appAlert('تم تشغيل السيرفر بنجاح.');
      } else if (action === 'stop') {
        await updateDoc(serverRef, { status: 'stopped' });
        await addDoc(collection(db, 'activities'), {
          uid: serverData.ownerId,
          serverId,
          serverName: serverData.name,
          type: 'stop',
          description: `تم إيقاف السيرفر ${serverData.name}`,
          createdAt: serverTimestamp()
        });
        appAlert('تم إيقاف السيرفر بنجاح.');
      } else if (action === 'delete') {
        if (await confirm({ title: 'حذف السيرفر', message: 'هل أنت متأكد من حذف هذا السيرفر؟ سيتم حذف بياناته المرتبطة.', danger: true, confirmText: 'حذف' })) {
          await deleteDoc(serverRef);
          await addDoc(collection(db, 'activities'), {
            uid: serverData.ownerId,
            serverId,
            serverName: serverData.name,
            type: 'delete',
            description: `تم حذف السيرفر ${serverData.name}`,
            createdAt: serverTimestamp()
          });
          appAlert('تم حذف السيرفر بنجاح.');
        }
      }
    } catch (error) {
      console.error('Error in server action:', error);
      appAlert('حدث خطأ أثناء تنفيذ العملية. يرجى المحاولة مرة أخرى.');
    }
  };

  const handleGlobalServerAction = async (action: 'startAll' | 'stopAll') => {
    if (await confirm({ title: 'تأكيد إجراء جماعي', message: `هل أنت متأكد من ${action === 'startAll' ? 'تشغيل' : 'إيقاف'} جميع السيرفرات؟`, danger: action === 'stopAll' })) {
      const snapshot = await getDocs(collection(db, 'servers'));
      const promises = snapshot.docs.map(doc => 
        updateDoc(doc.ref, { status: action === 'startAll' ? 'running' : 'stopped' })
      );
      await Promise.all(promises);
      appAlert('تم تنفيذ العملية بنجاح.');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0708] pt-20 sm:pt-24 pb-12 px-3 sm:px-6 lg:px-8" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-6 sm:gap-8">
          <aside className="w-full lg:w-64 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 scrollbar-hide sticky top-16 sm:top-20 z-30 bg-[#0a0708] -mx-3 px-3 sm:mx-0 sm:px-0">
            <button 
              onClick={() => setActiveTab('users')}
              className={`flex-shrink-0 lg:w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm ${activeTab === 'users' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
            >
              <Users className="w-4 h-4 sm:w-5 sm:h-5" /> المستخدمين
            </button>
            <button 
              onClick={() => setActiveTab('requests')}
              className={`flex-shrink-0 lg:w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm ${activeTab === 'requests' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
            >
              <CreditCard className="w-4 h-4 sm:w-5 sm:h-5" /> طلبات الشحن
              {rechargeRequests.filter(r => r.status === 'pending').length > 0 && (
                <span className="bg-red-500 text-white text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full mr-1.5 sm:mr-2">
                  {rechargeRequests.filter(r => r.status === 'pending').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('billing')}
              className={`flex-shrink-0 lg:w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm ${activeTab === 'billing' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
            >
              <CreditCard className="w-4 h-4 sm:w-5 sm:h-5" /> الخطط ووسائل الدفع
            </button>
            <button 
              onClick={() => setActiveTab('servers')}
              className={`flex-shrink-0 lg:w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm ${activeTab === 'servers' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
            >
              <Server className="w-4 h-4 sm:w-5 sm:h-5" /> جميع السيرفرات
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={`flex-shrink-0 lg:w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm ${activeTab === 'settings' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" /> إعدادات الموقع
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`flex-shrink-0 lg:w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm ${activeTab === 'security' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
            >
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" /> مركز الحماية
            </button>
            <button 
              onClick={() => setActiveTab('activities')}
              className={`flex-shrink-0 lg:w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-all whitespace-nowrap text-xs sm:text-sm ${activeTab === 'activities' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-white/5'}`}
            >
              <ActivityIcon className="w-4 h-4 sm:w-5 sm:h-5" /> النشاط
            </button>
          </aside>

          <main className="flex-1">
            {activeTab === 'users' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h2 className="text-xl sm:text-2xl font-bold">المستخدمين ({users.length})</h2>
                  <form onSubmit={handleAddAdmin} className="flex flex-col sm:flex-row gap-2">
                    <input 
                      type="text" 
                      placeholder="البريد لإضافة مشرف"
                      value={adminEmailInput}
                      onChange={(e) => setAdminEmailInput(e.target.value)}
                      className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 text-sm w-full sm:w-64"
                    />
                    <button type="submit" className="px-4 py-2.5 bg-brand-600 hover:bg-brand-500 rounded-xl text-sm font-bold transition-all whitespace-nowrap">إضافة مشرف</button>
                  </form>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {users.map(u => (
                    <button 
                      key={u.uid}
                      onClick={() => setSelectedUser(u)}
                      className={`p-3 sm:p-4 bg-[#0f0a0b] border rounded-2xl text-right transition-all hover:border-brand-500/50 ${selectedUser?.uid === u.uid ? 'border-brand-500 bg-brand-500/5' : 'border-white/10'}`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 mb-1 sm:mb-2">
                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-lg font-bold shrink-0 ${u.isBanned ? 'bg-red-500/20 text-red-500' : 'bg-brand-500/20 text-brand-500'}`}>
                          {emailToUsername(u.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate text-xs sm:text-base">{emailToUsername(u.email)}</p>
                          <p className="text-[10px] sm:text-xs text-gray-500">{u.balance || 0} SYP</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {selectedUser && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 sm:p-8 bg-[#0f0a0b] border border-white/10 rounded-3xl space-y-8"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <h3 className="text-xl font-bold">تفاصيل المستخدم: {emailToUsername(selectedUser.email)}</h3>
                      <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-white/5 rounded-full self-end sm:self-auto"><X /></button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                            <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">الرصيد</p>
                            <p className="text-sm font-bold text-white">{selectedUser.balance || 0} SYP</p>
                          </div>
                          <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                            <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">الحالة</p>
                            <p className={`text-sm font-bold ${selectedUser.isBanned ? 'text-red-500' : 'text-green-500'}`}>{selectedUser.isBanned ? 'محظور' : 'نشط'}</p>
                          </div>
                        </div>
                        <p className="text-gray-400 text-sm">التلجرام: <span className="text-white font-bold">{selectedUser.telegram || 'غير متوفر'}</span></p>
                        
                        <div className="flex flex-col sm:flex-row gap-2">
                          <button 
                            onClick={() => handleUserAction(selectedUser.uid, selectedUser.isBanned ? 'unban' : 'ban')}
                            className={`flex-1 py-2 rounded-xl font-bold flex items-center justify-center gap-2 ${selectedUser.isBanned ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}
                          >
                            {selectedUser.isBanned ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                            {selectedUser.isBanned ? 'إلغاء الحظر' : 'حظر المستخدم'}
                          </button>
                          
                          {selectedUser.role === 'admin' && (
                            <button 
                              onClick={() => handleDemoteAdmin(selectedUser.uid)}
                              className="flex-1 py-2 bg-yellow-500/10 text-yellow-500 rounded-xl font-bold flex items-center justify-center gap-2"
                            >
                              <ShieldAlert className="w-4 h-4" /> إزالة مشرف
                            </button>
                          )}
                        </div>

                        <button 
                          onClick={() => fetchUserFiles(selectedUser.uid)}
                          className="w-full py-3 bg-brand-600/10 text-brand-500 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand-600/20 transition-all"
                        >
                          <Folder className="w-5 h-5" /> ملفات المستخدم
                        </button>
                      </div>

                      <div className="space-y-4">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">إدارة الرصيد</p>
                        <div className="flex gap-2">
                          <input 
                            type="number" 
                            placeholder="المبلغ" 
                            value={balanceAmount}
                            onChange={(e) => setBalanceAmount(e.target.value)}
                            className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-xl outline-none"
                          />
                          <button 
                            onClick={() => {
                              const amount = Number(balanceAmount);
                              if (amount) {
                                handleUserAction(selectedUser.uid, 'addBalance', amount);
                                setBalanceAmount('');
                              }
                            }}
                            className="p-2 bg-green-500/10 text-green-500 rounded-xl"
                          >
                            <Plus />
                          </button>
                          <button 
                            onClick={() => {
                              const amount = Number(balanceAmount);
                              if (amount) {
                                handleUserAction(selectedUser.uid, 'subBalance', amount);
                                setBalanceAmount('');
                              }
                            }}
                            className="p-2 bg-red-500/10 text-red-500 rounded-xl"
                          >
                            <Minus />
                          </button>
                        </div>
                      </div>
                      <div className="mt-6 p-4 bg-brand-500/5 border border-brand-500/20 rounded-2xl space-y-3">
                        <h4 className="font-bold text-sm">منح اشتراك مخصص لهذا المستخدم</h4>
                        <input value={manualSubDraft.name} onChange={e=>setManualSubDraft({...manualSubDraft,name:e.target.value})} placeholder="اسم الاشتراك" className="field-admin" />
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs text-gray-500">المدة بالأيام<input type="number" min="1" value={manualSubDraft.days} onChange={e=>setManualSubDraft({...manualSubDraft,days:Number(e.target.value)})} className="field-admin mt-1" /></label>
                          <label className="text-xs text-gray-500">عدد الخوادم<input type="number" min="1" value={manualSubDraft.servers} onChange={e=>setManualSubDraft({...manualSubDraft,servers:Number(e.target.value)})} className="field-admin mt-1" /></label>
                          <label className="text-xs text-gray-500">RAM بالجيجابايت<input type="number" min="0.125" step="0.125" value={manualSubDraft.ramMb / 1024} onChange={e=>setManualSubDraft({...manualSubDraft,ramMb:Math.round(Number(e.target.value)*1024)})} className="field-admin mt-1" /></label>
                          <label className="text-xs text-gray-500">CPU Cores<input type="number" min="0.1" step="0.1" value={manualSubDraft.cpuCores} onChange={e=>setManualSubDraft({...manualSubDraft,cpuCores:Number(e.target.value)})} className="field-admin mt-1" /></label>
                          <label className="text-xs text-gray-500">التخزين GB<input type="number" min="1" value={manualSubDraft.storageGb} onChange={e=>setManualSubDraft({...manualSubDraft,storageGb:Number(e.target.value)})} className="field-admin mt-1" /></label>
                          <label className="text-xs text-gray-500">عدد المشاريع<input type="number" min="1" value={manualSubDraft.projects} onChange={e=>setManualSubDraft({...manualSubDraft,projects:Number(e.target.value)})} className="field-admin mt-1" /></label>
                        </div>
                        <button onClick={handleAssignManualSubscription} className="w-full py-3 bg-brand-600 hover:bg-brand-500 rounded-xl font-bold text-sm">تفعيل الاشتراك الآن</button>
                        {selectedUser.subscription && <p className="text-xs text-gray-500">الاشتراك الحالي: {selectedUser.subscription.planName} · ينتهي {new Date(selectedUser.subscription.expiresAt?.toDate ? selectedUser.subscription.expiresAt.toDate() : selectedUser.subscription.expiresAt).toLocaleString('ar-EG')}</p>}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-bold">سيرفرات المستخدم ({userServers.length})</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {userServers.map(s => (
                          <div key={s.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between">
                            <div>
                              <p className="font-bold">{s.name}</p>
                              <p className="text-xs text-gray-500">{s.ip}</p>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => handleServerAction(s.id, 'stop')} className="p-2 text-yellow-500 hover:bg-yellow-500/10 rounded-lg"><PowerOff className="w-4 h-4" /></button>
                              <button onClick={() => handleServerAction(s.id, 'delete')} className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg"><Trash className="w-4 h-4" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {activeTab === 'requests' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold">طلبات الشحن</h2>
                <div className="space-y-4">
                  {rechargeRequests.filter(r => r.status === 'pending').map(r => (
                    <button 
                      key={r.id} 
                      onClick={() => void handleOpenRequest(r)}
                      className="w-full p-6 bg-[#0f0a0b] border border-white/10 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-right hover:border-brand-500/50 transition-all"
                    >
                      <div>
                        <p className="font-bold text-lg">{r.amount} {r.currency || 'EGP'}</p><p className="text-xs text-brand-300">{r.planName || 'شحن رصيد'} · {r.methodName || 'وسيلة غير محددة'}</p>
                        <p className="text-sm text-gray-400">{emailToUsername(r.email)}</p>
                        <p className="text-sm text-brand-400">{r.telegram}</p>
                      </div>
                      <div className="flex gap-3 self-end md:self-auto">
                        <div className="px-4 py-2 bg-brand-600/10 text-brand-500 rounded-xl font-bold text-sm">عرض التفاصيل</div>
                      </div>
                    </button>
                  ))}
                  {rechargeRequests.filter(r => r.status === 'pending').length === 0 && (
                    <div className="p-12 text-center text-gray-500">لا توجد طلبات معلقة حالياً.</div>
                  )}
                </div>

                <AnimatePresence>
                  {selectedRequest && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedRequest(null)}
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                      />
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-lg bg-[#0f0a0b] border border-white/10 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden"
                        dir="rtl"
                      >
                        <div className="flex items-center justify-between mb-8">
                          <h3 className="text-2xl font-black tracking-tighter">تفاصيل طلب الشحن</h3>
                          <button onClick={() => setSelectedRequest(null)} className="p-2 hover:bg-white/5 rounded-full"><X /></button>
                        </div>

                        <div className="space-y-6">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                              <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">المبلغ</p>
                              <p className="text-xl font-black text-green-500">{selectedRequest.amount} SYP</p>
                            </div>
                            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                              <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">يوزر التلجرام</p>
                              <p className="text-lg font-bold text-brand-400" dir="ltr">{selectedRequest.telegram || 'غير متوفر'}</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase font-bold">البريد الإلكتروني</p>
                            <p className="text-white font-bold">{emailToUsername(selectedRequest.email)}</p><p className="text-xs text-gray-500 mt-1">{selectedRequest.methodName || 'وسيلة غير محددة'} · {selectedRequest.methodAccount || ''}</p><p className="text-xs text-gray-500">{selectedRequest.planName || 'شحن رصيد'} · مرجع: {selectedRequest.reference || 'غير متوفر'}</p>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase font-bold">يوزر التلجرام</p>
                            <p className="text-brand-400 font-bold">{selectedRequest.telegram}</p>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase font-bold mb-2">صورة التحويل</p>
                            <div className="aspect-video bg-white/5 rounded-2xl border border-white/10 flex items-center justify-center overflow-hidden group relative">
                              {selectedRequest.screenshotDataUrl ? <img src={selectedRequest.screenshotDataUrl} alt="إثبات التحويل" className="w-full h-full object-contain" /> : <div className="text-center p-4"><Camera className="w-12 h-12 text-gray-600 mx-auto mb-2" /><p className="text-xs text-gray-500">لا توجد صورة إثبات مرفقة</p></div>}
                            </div>
                          </div>

                          <div className="flex gap-4 pt-4">
                            <button 
                              onClick={() => handleApproveRequest(selectedRequest)}
                              className="flex-1 py-4 bg-green-600 hover:bg-green-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-green-600/20 flex items-center justify-center gap-2"
                            >
                              <Check className="w-5 h-5" /> موافقة
                            </button>
                            <button 
                              onClick={() => handleRejectRequest(selectedRequest.id)}
                              className="flex-1 py-4 bg-red-600/10 text-red-500 border border-red-500/20 hover:bg-red-600/20 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                            >
                              <X className="w-5 h-5" /> رفض
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {activeTab === 'servers' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h2 className="text-2xl font-bold">جميع السيرفرات ({servers.length})</h2>
                  <div className="flex flex-wrap gap-3">
                    <button 
                      onClick={() => handleGlobalServerAction('startAll')}
                      className="flex-1 sm:flex-none px-4 py-2 bg-green-500/10 text-green-500 border border-green-500/20 rounded-xl font-bold flex items-center justify-center gap-2"
                    >
                      <Power className="w-4 h-4" /> تشغيل الكل
                    </button>
                    <button 
                      onClick={() => handleGlobalServerAction('stopAll')}
                      className="flex-1 sm:flex-none px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl font-bold flex items-center justify-center gap-2"
                    >
                      <PowerOff className="w-4 h-4" /> إيقاف الكل
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {servers.map(s => (
                    <div key={s.id} className="p-4 bg-[#0f0a0b] border border-white/10 rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold truncate">{s.name}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.status === 'running' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                          {s.status === 'running' ? 'يعمل' : s.status === 'stopped' ? 'متوقف' : 'جاري التشغيل'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-4">{s.ip}</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleServerAction(s.id, 'stop')} className="flex-1 py-1.5 bg-yellow-500/10 text-yellow-500 rounded-lg"><PowerOff className="w-4 h-4 mx-auto" /></button>
                        <button onClick={() => handleServerAction(s.id, 'delete')} className="flex-1 py-1.5 bg-red-500/10 text-red-500 rounded-lg"><Trash className="w-4 h-4 mx-auto" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'billing' && globalSettings && (
              <div className="space-y-7">
                <div><h2 className="text-2xl font-black mb-2">الخطط والاشتراكات</h2><p className="text-sm text-gray-500">أنشئ خططاً بمدة وموارد وحدود مستقلة، ثم اربطها بوسائل الدفع.</p></div>
                <form onSubmit={savePlan} className="p-5 sm:p-7 bg-[#0f0a0b] border border-white/10 rounded-3xl space-y-4">
                  <h3 className="font-bold">إنشاء / تعديل خطة</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input value={planDraft.name} onChange={e=>setPlanDraft({...planDraft,name:e.target.value})} placeholder="اسم الخطة" className="field-admin" required />
                    <input value={planDraft.id} onChange={e=>setPlanDraft({...planDraft,id:e.target.value})} placeholder="معرّف الخطة (اتركه فارغاً للجديد)" className="field-admin" />
                    <input type="number" min="0" value={planDraft.price} onChange={e=>setPlanDraft({...planDraft,price:Number(e.target.value)})} placeholder="السعر" className="field-admin" required />
                    <select value={planDraft.currency} onChange={e=>setPlanDraft({...planDraft,currency:e.target.value})} className="field-admin"><option>EGP</option><option>USD</option><option>USDT</option><option>SYP</option></select>
                    <input type="number" min="1" value={planDraft.durationDays} onChange={e=>setPlanDraft({...planDraft,durationDays:Number(e.target.value)})} placeholder="المدة بالأيام" className="field-admin" />
                    <input type="number" min="1" value={planDraft.serverLimit} onChange={e=>setPlanDraft({...planDraft,serverLimit:Number(e.target.value)})} placeholder="عدد الخوادم" className="field-admin" />
                    <label className="text-xs text-gray-500">RAM بالجيجابايت<input type="number" min="0.125" step="0.125" value={planDraft.ramMb / 1024} onChange={e=>setPlanDraft({...planDraft,ramMb:Math.round(Number(e.target.value)*1024)})} className="field-admin mt-1" /></label>
                    <input type="number" min="0.1" step="0.1" value={planDraft.cpuCores} onChange={e=>setPlanDraft({...planDraft,cpuCores:Number(e.target.value)})} placeholder="CPU Cores" className="field-admin" />
                    <input type="number" min="1" value={planDraft.storageGb} onChange={e=>setPlanDraft({...planDraft,storageGb:Number(e.target.value)})} placeholder="التخزين GB" className="field-admin" />
                    <input type="number" min="1" value={planDraft.projectLimit} onChange={e=>setPlanDraft({...planDraft,projectLimit:Number(e.target.value)})} placeholder="عدد المشاريع" className="field-admin" />
                  </div>
                  <textarea value={planDraft.description || ''} onChange={e=>setPlanDraft({...planDraft,description:e.target.value})} placeholder="وصف الخطة ومميزاتها" className="field-admin min-h-20 w-full" />
                  <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={planDraft.enabled} onChange={e=>setPlanDraft({...planDraft,enabled:e.target.checked})}/> الخطة متاحة للشراء</label>
                  <button className="px-6 py-3 bg-brand-600 hover:bg-brand-500 rounded-xl font-bold">حفظ الخطة</button>
                </form>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{(globalSettings.plans || []).map(plan=><div key={plan.id} className="p-5 bg-[#0f0a0b] border border-white/10 rounded-2xl"><div className="flex justify-between gap-3"><b>{plan.name}</b><span className="text-brand-300">{plan.price} {plan.currency}</span></div><p className="text-xs text-gray-500 mt-2">{plan.durationDays} يوم · {plan.serverLimit} خادم · {(plan.ramMb / 1024).toFixed(2)}GB RAM · {plan.cpuCores} CPU · {plan.storageGb}GB</p><div className="flex gap-2 mt-4"><button onClick={()=>setPlanDraft({...plan})} className="px-3 py-2 bg-white/10 rounded-lg text-xs">تعديل</button><button onClick={()=>removePlan(plan.id)} className="px-3 py-2 bg-red-500/10 text-red-300 rounded-lg text-xs">حذف</button><span className="mr-auto text-xs text-gray-500">{plan.enabled?'مفعلة':'متوقفة'}</span></div></div>)}</div>
                <form onSubmit={saveMethod} className="p-5 sm:p-7 bg-[#0f0a0b] border border-white/10 rounded-3xl space-y-4">
                  <h3 className="font-bold">إضافة / تعديل وسيلة دفع</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input value={methodDraft.name} onChange={e=>setMethodDraft({...methodDraft,name:e.target.value})} placeholder="اسم الوسيلة مثل Vodafone Cash" className="field-admin" required />
                    <select value={methodDraft.type} onChange={e=>setMethodDraft({...methodDraft,type:e.target.value as PaymentMethod['type']})} className="field-admin"><option value="usdt">USDT</option><option value="vodafone">Vodafone Cash</option><option value="manual">تحويل يدوي / أخرى</option></select>
                    <input value={methodDraft.account} onChange={e=>setMethodDraft({...methodDraft,account:e.target.value})} placeholder="رقم المحفظة أو عنوان التحويل" className="field-admin" required />
                    <input value={methodDraft.network || ''} onChange={e=>setMethodDraft({...methodDraft,network:e.target.value})} placeholder="الشبكة مثل TRC20 (اختياري)" className="field-admin" />
                    <input value={methodDraft.id} onChange={e=>setMethodDraft({...methodDraft,id:e.target.value})} placeholder="معرّف الوسيلة (للتعديل اكتب نفس المعرف)" className="field-admin sm:col-span-2" />
                  </div>
                  <textarea value={methodDraft.instructions || ''} onChange={e=>setMethodDraft({...methodDraft,instructions:e.target.value})} placeholder="تعليمات التحويل التي تظهر للمستخدم" className="field-admin w-full min-h-20" />
                  <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={methodDraft.enabled} onChange={e=>setMethodDraft({...methodDraft,enabled:e.target.checked})}/> وسيلة الدفع مفعلة</label>
                  <button className="px-6 py-3 bg-brand-600 hover:bg-brand-500 rounded-xl font-bold">حفظ وسيلة الدفع</button>
                </form>
                <div className="space-y-3">{(globalSettings.paymentMethods || []).map(method=><div key={method.id} className="p-4 bg-[#0f0a0b] border border-white/10 rounded-2xl flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><b>{method.name}</b><p dir="ltr" className="text-xs text-gray-500 break-all">{method.account} {method.network ? `· ${method.network}` : ''}</p></div><button onClick={()=>setMethodDraft({...method})} className="px-3 py-2 bg-white/10 rounded-lg text-xs">تعديل</button><button onClick={()=>removeMethod(method.id)} className="px-3 py-2 bg-red-500/10 text-red-300 rounded-lg text-xs">حذف</button><span className="text-xs text-gray-500">{method.enabled?'مفعلة':'متوقفة'}</span></div>)}</div>
                <p className="text-xs text-amber-300/80">تنبيه: بيانات المحافظ والعناوين تظهر للمستخدمين عند اختيار وسيلة الدفع. لا تضع مفاتيح خاصة أو كلمات مرور في هذه الحقول.</p>
              </div>
            )}

            {activeTab === 'settings' && globalSettings && (
              <div className="space-y-8">
                <h2 className="text-2xl font-bold">إعدادات الموقع</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="p-8 bg-[#0f0a0b] border border-white/10 rounded-3xl space-y-6">
                    <h3 className="font-bold flex items-center gap-2"><ActivityIcon className="text-brand-500" /> حالة الموقع</h3>
                    <div className="flex items-center justify-between">
                      <span>إغلاق الموقع للمستخدمين</span>
                      <button 
                        onClick={() => handleUpdateSettings({ isSiteClosed: !globalSettings.isSiteClosed })}
                        className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.isSiteClosed ? 'bg-red-500' : 'bg-gray-700'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${globalSettings.isSiteClosed ? 'left-1' : 'left-7'}`}></div>
                      </button>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500">رسالة الإغلاق</label>
                      <textarea 
                        value={globalSettings.maintenanceMessage || ''}
                        onChange={(e) => handleUpdateSettings({ maintenanceMessage: e.target.value })}
                        placeholder="رسالة تظهر للمستخدمين عند إغلاق الموقع"
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl outline-none min-h-[100px]"
                      />
                    </div>

                    <div className="space-y-4 pt-4 border-t border-white/5">
                      <h4 className="text-sm font-bold">المستخدمين المستثنين من الإغلاق</h4>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="البريد الإلكتروني"
                          value={exemptEmailInput}
                          onChange={(e) => setExemptEmailInput(e.target.value)}
                          className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-xl outline-none"
                        />
                        <button 
                          onClick={() => {
                            if (!exemptEmailInput.trim()) return;
                            const current = globalSettings.exemptedEmails || [];
                            if (!current.includes(usernameToEmail(exemptEmailInput))) {
                              handleUpdateSettings({ exemptedEmails: [...current, usernameToEmail(exemptEmailInput)] });
                              setExemptEmailInput('');
                            }
                          }}
                          className="px-4 py-2 bg-brand-600 rounded-xl"
                        >
                          إضافة
                        </button>
                      </div>
                      <div className="space-y-2">
                        {(globalSettings.exemptedEmails || []).map(email => (
                          <div key={email} className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
                            <span className="text-sm">{emailToUsername(email)}</span>
                            <button 
                              onClick={() => {
                                const current = globalSettings.exemptedEmails || [];
                                handleUpdateSettings({ exemptedEmails: current.filter(e => e !== email) });
                              }}
                              className="text-red-500 hover:text-red-400"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="p-8 bg-[#0f0a0b] border border-white/10 rounded-3xl space-y-6">
                    <h3 className="font-bold flex items-center gap-2"><CreditCard className="text-brand-500" /> الخطط والأسعار</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span>السماح بالخطط المجانية</span>
                        <button 
                          onClick={() => handleUpdateSettings({ allowFreePlans: !globalSettings.allowFreePlans })}
                          className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.allowFreePlans ? 'bg-green-500' : 'bg-gray-700'}`}
                        >
                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${globalSettings.allowFreePlans ? 'left-7' : 'left-1'}`}></div>
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>السماح بالخطط المميزة</span>
                        <button 
                          onClick={() => handleUpdateSettings({ allowPremiumPlans: !globalSettings.allowPremiumPlans })}
                          className={`w-12 h-6 rounded-full transition-all relative ${globalSettings.allowPremiumPlans ? 'bg-green-500' : 'bg-gray-700'}`}
                        >
                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${globalSettings.allowPremiumPlans ? 'left-7' : 'left-1'}`}></div>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs text-gray-500">سعر الخطة المميزة (SYP)</label>
                          <input 
                            type="number" 
                            value={globalSettings.premiumPlanPrice}
                            onChange={(e) => handleUpdateSettings({ premiumPlanPrice: Number(e.target.value) })}
                            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl outline-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-gray-500">أقصى عدد خوادم مجانية</label>
                          <input 
                            type="number" 
                            value={globalSettings.maxFreeServers || 1}
                            onChange={(e) => handleUpdateSettings({ maxFreeServers: Number(e.target.value) })}
                            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-8 bg-[#0f0a0b] border border-white/10 rounded-3xl space-y-6 md:col-span-2">
                    <h3 className="font-bold flex items-center gap-2"><LayoutDashboard className="text-brand-500" /> إعدادات إضافية</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs text-gray-500">اسم الموقع</label>
                        <input 
                          type="text" 
                          value={globalSettings.siteName || ''}
                          onChange={(e) => handleUpdateSettings({ siteName: e.target.value })}
                          placeholder="مثال: لوحة تحكم السيرفرات"
                          className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl outline-none"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-gray-500">الرصيد الافتراضي للمستخدمين الجدد</label>
                        <input 
                          type="number" 
                          value={globalSettings.defaultBalance || 0}
                          onChange={(e) => handleUpdateSettings({ defaultBalance: Number(e.target.value) })}
                          className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl outline-none"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs text-gray-500">إعلان عام (يظهر في لوحة التحكم)</label>
                        <textarea 
                          value={globalSettings.announcement || ''}
                          onChange={(e) => handleUpdateSettings({ announcement: e.target.value })}
                          placeholder="اكتب إعلاناً ليظهر لجميع المستخدمين..."
                          className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl outline-none min-h-[80px]"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'security' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-emerald-400" /> مركز الحماية</h2>
                    <p className="text-sm text-gray-500 mt-1">أحداث أمنية مسجلة من الخادم — لا تعرض كلمات المرور أو مفاتيح الجلسات.</p>
                  </div>
                  <button onClick={refreshSecurityEvents} disabled={securityLoading} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm">
                    <RefreshCw className={`w-4 h-4 ${securityLoading ? 'animate-spin' : ''}`} /> تحديث السجل
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-gray-500">الأحداث المعروضة</p><p className="text-2xl font-bold mt-1">{securityEvents.length}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-gray-500">محاولات دخول مرفوضة</p><p className="text-2xl font-bold mt-1 text-amber-300">{securityEvents.filter(e => e.event === 'failed_login' || e.event === 'authentication_rate_limited').length}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-gray-500">محاولات ومسارات مشبوهة</p><p className="text-2xl font-bold mt-1 text-red-400">{securityEvents.filter(e => e.event === 'suspicious_path' || e.event === 'origin_rejected').length}</p></div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0f0a0b] overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10 text-sm font-semibold">سجل الأحداث الأمنية</div>
                  {securityLoading ? <div className="p-8 text-center text-gray-500">جارٍ تحميل السجل...</div> : securityEvents.length === 0 ? <div className="p-8 text-center text-gray-500">لا توجد أحداث مسجلة حتى الآن.</div> : (
                    <div className="divide-y divide-white/5">
                      {securityEvents.map((event, index) => (
                        <div key={`${event.at}-${index}`} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5">
                          <span className={`text-xs font-bold px-2 py-1 rounded-lg w-fit ${String(event.event).includes('error') || String(event.event).includes('suspicious') ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-200'}`}>{event.event || 'security_event'}</span>
                          <div className="flex-1 min-w-0"><p className="text-sm text-gray-300 break-all">{event.method} {event.path}</p><p className="text-xs text-gray-500 mt-1">IP مخفي جزئيًا: {event.ip || 'غير متاح'} · {event.detail || 'بدون تفاصيل'}</p></div>
                          <time className="text-xs text-gray-500 whitespace-nowrap">{event.at ? new Date(event.at).toLocaleString('ar-EG') : '—'}</time>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500">السجل محلي ومحدود الحجم. التنبيهات عبر Telegram تعتمد على إعدادات البوت واتصال الخادم.</p>
              </div>
            )}
            {activeTab === 'activities' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold">آخر العمليات</h2>
                <div className="bg-[#0f0a0b] border border-white/10 rounded-3xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-right">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5">
                          <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">العملية</th>
                          <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">الوصف</th>
                          <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">التاريخ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {activities.map((activity) => (
                          <tr key={activity.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${
                                activity.type === 'recharge' ? 'bg-green-500/10 text-green-500' :
                                activity.type === 'delete' ? 'bg-red-500/10 text-red-500' :
                                activity.type === 'account_created' ? 'bg-purple-500/10 text-purple-400' :
                                'bg-brand-500/10 text-brand-500'
                              }`}>
                                {activity.type === 'recharge' ? 'شحن' : 
                                 activity.type === 'delete' ? 'حذف' : 
                                 activity.type === 'start' ? 'تشغيل' : 
                                 activity.type === 'stop' ? 'إيقاف' : 
                                 activity.type === 'ban' ? 'حظر' : 
                                 activity.type === 'unban' ? 'إلغاء حظر' : 
                                 activity.type === 'account_created' ? 'تسجيل جديد' : activity.type}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-300">{activity.description}</td>
                            <td className="px-6 py-4 text-xs text-gray-500">
                              {activity.createdAt?.toDate().toLocaleString('ar-EG')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
      <AnimatePresence>
        {isFilesModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFilesModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            ></motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-[#0f0a0b] border border-white/10 rounded-3xl p-8 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black tracking-tighter">ملفات المستخدم</h2>
                <button onClick={() => setIsFilesModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-all">
                  <X className="w-6 h-6 text-gray-500" />
                </button>
              </div>

              {fetchingFiles ? (
                <div className="flex-1 flex items-center justify-center py-20">
                  <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : allUserFiles.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20 text-gray-500">
                  <Folder className="w-16 h-16 mb-4 opacity-20" />
                  <p>لا توجد ملفات لهذا المستخدم.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                  {allUserFiles.map(file => (
                    <div key={file.id} className="p-4 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between group hover:border-brand-500/50 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-brand-600/10 rounded-lg flex items-center justify-center text-brand-500">
                          {file.type === 'folder' ? <Folder className="w-5 h-5" /> : <ActivityIcon className="w-5 h-5" />}
                        </div>
                        <div>
                          <p className="font-bold text-sm">{file.name}</p>
                          <p className="text-[10px] text-gray-500 font-mono" dir="ltr">{file.path}</p>
                        </div>
                      </div>
                      {file.type === 'file' && (
                        <button 
                          onClick={() => handleDownloadFile(file)}
                          className="p-2 bg-brand-600/10 text-brand-500 rounded-lg hover:bg-brand-600 hover:text-white transition-all"
                          title="تنزيل"
                        >
                          <Download className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog />
      <div className="mt-20">
        <Footer />
      </div>
    </div>
  );
}
