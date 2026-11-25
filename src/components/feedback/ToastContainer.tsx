import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { dismissToast, type ToastMessage } from '../../features/notifications/toastSlice';

function ToastItem({ toast }: { toast: ToastMessage }) {
  const dispatch = useAppDispatch();
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.durationMs);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (paused) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
      return;
    }

    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      dispatch(dismissToast(toast.id));
    }, remainingRef.current);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [paused, dispatch, toast.id]);

  const variantStyles = {
    success: {
      container: 'border-emerald-200 bg-white text-[#0F1D3A]',
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />,
      bar: 'bg-emerald-500',
    },
    error: {
      container: 'border-rose-200 bg-white text-[#0F1D3A]',
      icon: <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />,
      bar: 'bg-rose-500',
    },
    warning: {
      container: 'border-amber-200 bg-white text-[#0F1D3A]',
      icon: <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />,
      bar: 'bg-amber-500',
    },
    info: {
      container: 'border-blue-200 bg-white text-[#0F1D3A]',
      icon: <Info className="h-5 w-5 text-[#1155EE] shrink-0" />,
      bar: 'bg-[#1155EE]',
    },
  }[toast.variant];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast-item"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`novara-toast-enter relative overflow-hidden rounded-xl border bg-white/95 backdrop-blur-sm shadow-[0_12px_32px_-8px_rgba(15,29,58,0.18)] transition-all duration-200 ${variantStyles.container}`}
    >
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 pr-9">
        <div className="mt-0.5 shrink-0">{variantStyles.icon}</div>
        <div className="min-w-0 flex-1">
          {toast.title && (
            <p className="text-xs font-semibold leading-tight tracking-tight text-[#0F1D3A]">{toast.title}</p>
          )}
          <p className="text-[13px] leading-snug text-[#334155]">{toast.message}</p>
        </div>
        <button
          type="button"
          onClick={() => dispatch(dismissToast(toast.id))}
          aria-label="Dismiss notification"
          className="absolute right-2 top-2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-[#1155EE]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Mandatory animated right-to-left progress bar (4s default) */}
      <div className="h-[3px] w-full bg-slate-100">
        <div
          className={`h-full w-full novara-toast-progress ${variantStyles.bar}`}
          style={{
            animationDuration: `${toast.durationMs}ms`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      </div>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useAppSelector((s) => s.toast.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      data-testid="toast-container"
      className="pointer-events-none fixed left-1/2 top-3 sm:top-5 z-[110] flex w-[calc(100vw-1.5rem)] max-w-[420px] -translate-x-1/2 flex-col gap-2 sm:w-[calc(100vw-2.5rem)]"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto w-full">
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>
  );
}
