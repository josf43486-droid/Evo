export type Plan = 'free' | 'premium' | 'unlimited';
export type ServerStatus = 'running' | 'stopped' | 'starting' | 'error' | 'suspended';
export type ServerLanguage = 'python' | 'javascript' | 'php';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  plan: Plan;
  serverCount: number;
  balance: number; // In SYP
  telegram?: string;
  isBanned?: boolean;
  role?: 'admin' | 'user';
  subscription?: { planId: string; planName: string; status: 'active' | 'expired' | 'cancelled'; startsAt: any; expiresAt: any; serverLimit: number; ramMb: number; cpuCores: number; storageGb: number; projectLimit: number };
  createdAt: any;
}

export interface ServerInstance {
  id: string;
  ownerId: string;
  name: string;
  language: ServerLanguage;
  status: ServerStatus;
  plan: Plan;
  ip: string;
  cpu: number;
  ram: number;
  version?: string;
  mainFile?: string;
  expiresAt?: any;
  lastRenewedAt?: any;
  isSuspended?: boolean;
  ramLimitMb?: number;
  cpuLimitCores?: number;
  storageLimitGb?: number;
  projectLimit?: number;
  autoRenew?: boolean;
  createdAt: any;
}

export interface Activity {
  id: string;
  uid: string;
  serverId?: string;
  serverName?: string;
  type: 'start' | 'stop' | 'restart' | 'create' | 'delete' | 'recharge' | 'suspend' | 'unsuspend' | 'ban' | 'unban';
  description: string;
  createdAt: any;
}

export interface ServerFile {
  id: string;
  serverId: string;
  name: string;
  content: string;
  path: string;
  type: 'file' | 'folder';
  updatedAt: any;
}

export interface DatabaseInstance {
  id: string;
  serverId: string;
  name: string;
  type: 'mysql' | 'postgresql' | 'mongodb';
  user: string;
  host: string;
  port: number;
  createdAt: any;
}

export interface BackupInstance {
  id: string;
  serverId: string;
  name: string;
  size: number;
  status: 'completed' | 'pending' | 'failed';
  createdAt: any;
}

export interface RechargeRequest {
  id: string;
  uid: string;
  email: string;
  telegram: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  screenshotUrl?: string;
  screenshotDataUrl?: string;
  methodName?: string;
  methodAccount?: string;
  methodNetwork?: string;
  planId?: string;
  planSnapshot?: CustomPlan | null;
  currency?: string;
  planName?: string;
  reference?: string;
  createdAt: any;
}

export interface GlobalSettings {
  isSiteClosed: boolean;
  premiumPlanPrice: number;
  allowFreePlans: boolean;
  allowPremiumPlans: boolean;
  exemptedEmails?: string[];
  siteName?: string;
  maintenanceMessage?: string;
  announcement?: string;
  defaultBalance?: number;
  maxFreeServers?: number;
  plans?: CustomPlan[];
  paymentMethods?: PaymentMethod[];
}

export interface CustomPlan {
  id: string; name: string; price: number; currency: string; durationDays: number;
  serverLimit: number; ramMb: number; cpuCores: number; storageGb: number; projectLimit: number;
  enabled: boolean; description?: string;
}

export interface PaymentMethod {
  id: string; name: string; type: 'usdt' | 'vodafone' | 'manual';
  account: string; network?: string; instructions?: string; enabled: boolean;
}

export interface PlanDetails {
  id: Plan;
  name: string;
  price: number;
  features: string[];
  serverLimit: number;
}

export const PLANS: Record<Plan, PlanDetails> = {
  free: {
    id: 'free',
    name: 'الخطة المجانية',
    price: 0,
    features: ['خادم واحد فقط', 'معالج مشترك', '512MB رام', 'دعم مجتمعي'],
    serverLimit: 1,
  },
  premium: {
    id: 'premium',
    name: 'الخطة المميزة',
    price: 300,
    features: ['خوادم غير محدودة', 'معالج مخصص', '4GB رام', 'دعم بأولوية'],
    serverLimit: 100,
  },
  unlimited: {
    id: 'unlimited',
    name: 'خطة المشرف (غير محدودة)',
    price: 0,
    features: ['خوادم غير محدودة', 'موارد غير محدودة', 'دعم فوري', 'صلاحيات كاملة'],
    serverLimit: 9999,
  },
};
