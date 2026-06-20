"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

type ToastTone = "success" | "error" | "warning" | "info";
type Toast = { id: string; message: string; tone: ToastTone; duration?: number };

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone, duration?: number) => void;
};

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<ToastTone, string> = {
  success: "✓",
  error: "✕",
  warning: "!",
  info: "›",
};

const COLORS: Record<ToastTone, string> = {
  success: "border-green-800/60 bg-green-950/80 text-green-300",
  error:   "border-red-800/60   bg-red-950/80   text-red-300",
  warning: "border-amber-800/60 bg-amber-950/80 text-amber-300",
  info:    "border-slate-700/60 bg-[#0d0d18]/90  text-slate-300",
};

const DOT: Record<ToastTone, string> = {
  success: "bg-green-500",
  error:   "bg-red-500",
  warning: "bg-amber-500",
  info:    "bg-cyan-500",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = "info", duration = 4000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, tone, duration }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 rounded border px-4 py-2.5 text-[12px] font-medium backdrop-blur-md transition-all ${COLORS[t.tone]}`}
            style={{ animation: "slideIn 0.2s ease" }}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[t.tone]}`} />
            {t.message}
            <button
              type="button"
              onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              className="ml-2 text-[10px] opacity-50 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </ToastContext.Provider>
  );
}
