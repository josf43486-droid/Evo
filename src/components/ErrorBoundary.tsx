import React, { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const { children } = this.props;
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0a0708] flex items-center justify-center p-4" dir="rtl">
          <div className="max-w-md w-full bg-white/[0.02] border border-white/10 p-8 rounded-[2.5rem] text-center space-y-6 backdrop-blur-3xl">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <h2 className="text-2xl font-black tracking-tighter text-white">عذراً، حدث خطأ غير متوقع</h2>
            <p className="text-gray-400 leading-relaxed text-sm">
              حدث خطأ أثناء تشغيل هذا الجزء من التطبيق. يرجى محاولة إعادة تحميل الصفحة.
            </p>
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-mono text-left overflow-auto max-h-32">
              {this.state.error?.message}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-brand-600 hover:bg-brand-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
            >
              <RefreshCcw className="w-5 h-5" />
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
