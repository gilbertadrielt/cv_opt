"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Transient confirmations ("Defect updated", "Sent to the retraining queue").
 *
 * Deliberately the only global notification channel: anything the inspector
 * must act on belongs in the page, not in a message that disappears.
 */

const VISIBLE_MS = 2600;

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: string) => {
    setMessage(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), VISIBLE_MS);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Always mounted so assistive tech announces changes in place. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-60 flex justify-center px-4"
      >
        {message && (
          <span className="rounded-sm bg-ink px-4 py-2.5 text-panel shadow-lg">{message}</span>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within a ToastProvider");
  return value;
}
