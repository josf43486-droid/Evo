export function appAlert(message: string, tone: 'info' | 'success' | 'error' = 'info') {
  if (typeof document === 'undefined') return;
  let root = document.getElementById('nexus-toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'nexus-toast-root';
    root.style.cssText = 'position:fixed;z-index:300;top:18px;left:18px;right:18px;display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none';
    document.body.appendChild(root);
  }
  const toast = document.createElement('div');
  const border = tone === 'success' ? '#16a34a' : tone === 'error' ? '#dc2626' : '#7c3aed';
  toast.style.cssText = `pointer-events:auto;max-width:460px;width:100%;padding:15px 18px;border:1px solid ${border}66;border-right:4px solid ${border};border-radius:16px;background:#151016;color:#fff;box-shadow:0 18px 50px #0009;font:600 13px/1.8 system-ui;direction:rtl;animation:nexusToastIn .18s ease-out`;
  toast.textContent = message;
  root.appendChild(toast);
  window.setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-6px)'; window.setTimeout(() => toast.remove(), 180); }, 4200);
}
