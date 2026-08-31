"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

// P2-4 — a minimal toast system (no dependency pulled in) used for
// "Copied!" confirmations after clicking a CopyButton. Rendered once at
// the root in layout.tsx; any client component reaches it via useToast().
interface Toast {
  id: number;
  message: string;
}

const ToastContext = createContext<((message: string) => void) | null>(null);

export function useToast(): (message: string) => void {
  const showToast = useContext(ToastContext);
  if (!showToast) {
    // Fails soft rather than crashing a page that forgot the provider —
    // copy-to-clipboard still works, it just won't announce itself.
    return () => {};
  }
  return showToast;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((toast) => toast.id !== id));
    }, 2200);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-toast-in rounded-full bg-navy px-4 py-2 text-xs font-medium text-white shadow-popover"
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
