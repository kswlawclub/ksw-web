"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

type ActionStatus = "idle" | "pending" | "success";

type ActionFeedbackOptions<T> = {
  errorMessage?: (result: T) => string | null | undefined;
  errorTitle?: string;
  id: string;
  loadingMessage: string;
  successMessage: string;
  successTitle?: string;
};

type AdminActionFeedbackContextValue = {
  getStatus: (id: string) => ActionStatus;
  runAction: <T>(options: ActionFeedbackOptions<T>, action: () => Promise<T>) => Promise<T | null>;
};

type FeedbackNotice = {
  id: number;
  message: string;
  tone: "error" | "success";
  title: string;
};

const AdminActionFeedbackContext = createContext<AdminActionFeedbackContextValue | null>(null);

function actionResultError(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const result = value as Record<string, unknown>;
  const error = typeof result.error === "string" && result.error.trim() ? result.error : null;
  if (result.ok === false || result.success === false) return error ?? "ไม่สามารถดำเนินการได้";
  return error;
}

export function AdminActionFeedbackProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, ActionStatus>>({});
  const [notice, setNotice] = useState<FeedbackNotice | null>(null);
  const timers = useRef(new Map<string, number>());
  const noticeId = useRef(0);

  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer));
  }, []);

  const setStatus = useCallback((id: string, status: ActionStatus) => {
    setStatuses((current) => ({ ...current, [id]: status }));
  }, []);

  const showNotice = useCallback((tone: FeedbackNotice["tone"], title: string, message: string) => {
    const id = ++noticeId.current;
    setNotice({ id, message, title, tone });
    if (tone === "success") {
      window.setTimeout(() => {
        setNotice((current) => current?.id === id ? null : current);
      }, 3000);
    }
  }, []);

  const runAction = useCallback(async <T,>(options: ActionFeedbackOptions<T>, action: () => Promise<T>) => {
    if (statuses[options.id] === "pending") return null;

    const existingTimer = timers.current.get(options.id);
    if (existingTimer) clearTimeout(existingTimer);
    setStatus(options.id, "pending");

    try {
      const result = await action();
      const returnedError = options.errorMessage?.(result) ?? actionResultError(result);
      if (returnedError) {
        setStatus(options.id, "idle");
        showNotice("error", options.errorTitle ?? "ดำเนินการไม่สำเร็จ", returnedError);
        return result;
      }

      setStatus(options.id, "success");
      showNotice("success", options.successTitle ?? "สำเร็จ", options.successMessage);
      timers.current.set(options.id, window.setTimeout(() => {
        setStatus(options.id, "idle");
        timers.current.delete(options.id);
      }, 1200));
      return result;
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
      setStatus(options.id, "idle");
      showNotice("error", options.errorTitle ?? "ดำเนินการไม่สำเร็จ", message);
      return null;
    }
  }, [setStatus, showNotice, statuses]);

  const value = useMemo(() => ({
    getStatus: (id: string) => statuses[id] ?? "idle",
    runAction,
  }), [runAction, statuses]);

  return (
    <AdminActionFeedbackContext.Provider value={value}>
      {children}
      {notice ? (
        <div aria-atomic="true" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[100] mx-auto w-auto max-w-md sm:left-auto sm:right-6 sm:mx-0" role="status">
          <div className={`pointer-events-auto rounded-lg border px-4 py-3 shadow-xl ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-red-200 bg-red-50 text-red-950"}`}>
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 text-base font-black">{notice.tone === "success" ? "✓" : "✕"}</span>
              <div className="min-w-0 flex-1"><p className="text-sm font-black">{notice.title}</p><p className="mt-0.5 text-sm font-semibold">{notice.message}</p></div>
              {notice.tone === "error" ? <button aria-label="ปิดข้อความแจ้งเตือน" className="min-h-8 min-w-8 rounded text-lg leading-none" onClick={() => setNotice(null)} type="button">×</button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </AdminActionFeedbackContext.Provider>
  );
}

export function useActionFeedback() {
  const context = useContext(AdminActionFeedbackContext);
  if (!context) throw new Error("useActionFeedback must be used inside AdminActionFeedbackProvider.");
  return context;
}

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  actionId: string;
  children: ReactNode;
  loadingLabel: string;
  successLabel?: string;
};

export function ActionButton({ actionId, children, className, disabled, loadingLabel, successLabel = "บันทึกแล้ว", ...props }: ActionButtonProps) {
  const { getStatus } = useActionFeedback();
  const status = getStatus(actionId);
  const label = status === "pending" ? loadingLabel : status === "success" ? successLabel : children;
  return <button {...props} aria-busy={status === "pending" || undefined} className={className} disabled={disabled || status === "pending"} type={props.type ?? "button"}>{status === "pending" ? <span aria-hidden="true" className="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-0.1em]" /> : null}{status === "success" ? <span aria-hidden="true" className="mr-1">✓</span> : null}{label}</button>;
}
