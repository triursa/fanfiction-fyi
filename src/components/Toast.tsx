import { h } from 'preact';
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

let toastIdCounter = 0;
const listeners: Array<(msg: ToastMessage) => void> = [];

/**
 * Show a toast notification. Can be called from anywhere (even non-Preact code).
 * Usage: (window as any).showToast('Saved!', 'success')
 */
export function showToast(message: string, type: ToastType = 'info') {
  const msg: ToastMessage = { id: ++toastIdCounter, message, type };
  listeners.forEach(fn => fn(msg));
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handler = (msg: ToastMessage) => {
      setToasts(prev => [...prev, msg]);
      // Auto-dismiss after 4 seconds (8 for errors)
      const duration = msg.type === 'error' ? 8000 : 4000;
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== msg.id));
      }, duration);
    };
    listeners.push(handler);
    // Also register on window for global access
    (window as any).showToast = showToast;
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
      delete (window as any).showToast;
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const typeIcon: Record<ToastType, string> = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  return (
    <div class="toast-container" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} class={`toast toast--${t.type}`} onClick={() => dismiss(t.id)}>
          <span class="toast-icon">{typeIcon[t.type]}</span>
          <span class="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}