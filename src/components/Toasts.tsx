import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";

import { useT } from "../i18n";

interface Toast {
  id: number;
  tone: "success" | "error";
  message: string;
}

interface ToastApi {
  success(message: string): void;
  error(message: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const t = useT();

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (tone: Toast["tone"], message: string) => {
      const id = nextId++;
      setToasts((all) => [...all.slice(-3), { id, tone, message }]);
      // Errors stay longer: they usually tell the user what to fix.
      setTimeout(() => dismiss(id), tone === "error" ? 9000 : 3500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push("success", m), error: (m) => push("error", m) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-panel p-3 shadow-lg"
          >
            {toast.tone === "success" ? (
              <CircleCheck className="mt-px size-4 shrink-0 text-ok" />
            ) : (
              <CircleAlert className="mt-px size-4 shrink-0 text-err" />
            )}
            <p className="flex-1 leading-snug select-text">{toast.message}</p>
            <button className="text-faint hover:text-ink" onClick={() => dismiss(toast.id)} aria-label={t("toast.close")}>
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
