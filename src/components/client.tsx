"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fieldErrors: Record<string, string[]> = {},
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** JSON fetch against the app's API with the consistent error shape. */
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError("You appear to be offline, or the server cannot be reached. Your changes were not saved.", 0, "offline");
  }
  const data = (await response.json().catch(() => null)) as { error?: { message: string; code: string; fieldErrors?: Record<string, string[]>; details?: Record<string, unknown> } } | null;
  if (!response.ok) {
    const e = data?.error;
    throw new ApiError(e?.message ?? `Request failed (${response.status}).`, response.status, e?.code ?? "error", e?.fieldErrors, e?.details);
  }
  return data as T;
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ── Toast ───────────────────────────────────────────────────────────────────
const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 5000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">
        {message && <div className="toast">{message}</div>}
      </div>
    </ToastContext.Provider>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────────
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose, danger }: { title: string; children: ReactNode; confirmLabel: string; onConfirm: () => Promise<void> | void; onClose: () => void; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="prose">{children}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? "btn danger" : "btn primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

// ── Actions ─────────────────────────────────────────────────────────────────
/** Run a mutation with busy/error state, then refresh server-rendered data. */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const run = useCallback(
    async <T,>(name: string, work: () => Promise<T>, success?: string | ((result: T) => string)): Promise<T | undefined> => {
      setBusy(name);
      setError(null);
      try {
        const result = await work();
        if (success) toast(typeof success === "function" ? success(result) : success);
        router.refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e : new Error("Something went wrong."));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [router, toast],
  );
  return { run, busy, error, setError, fieldErrors: error instanceof ApiError ? error.fieldErrors : {} };
}

export function ActionButton({ label, busyLabel, path, method = "POST", body, success, className = "btn", confirm, onDone }: { label: ReactNode; busyLabel?: string; path: string; method?: string; body?: unknown; success?: string; className?: string; confirm?: { title: string; text: string; danger?: boolean }; onDone?: (result: unknown) => void }) {
  const { run, busy, error } = useAction();
  const [asking, setAsking] = useState(false);
  const go = async () => {
    const result = await run("go", () => api(path, { method, body: body ?? {} }), success);
    if (result !== undefined) onDone?.(result);
  };
  return (
    <>
      <button type="button" className={className} disabled={!!busy} onClick={() => (confirm ? setAsking(true) : void go())}>
        {busy ? (busyLabel ?? "Working…") : label}
      </button>
      {error && <span className="field"><span className="error" role="alert">{error.message}</span></span>}
      {asking && confirm && (
        <ConfirmDialog title={confirm.title} confirmLabel={typeof label === "string" ? label : "Confirm"} danger={confirm.danger} onClose={() => setAsking(false)} onConfirm={go}>
          <p>{confirm.text}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

// ── Jobs ────────────────────────────────────────────────────────────────────
export interface JobView {
  id: string;
  status: "queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "cancelled";
  progress: { done: number; total: number; step?: string };
  error: string | null;
  result: Record<string, unknown> | null;
}

/** Poll a persisted job until it reaches a terminal state. Gives up after two minutes instead of spinning forever. */
export function useJob(onFinished?: (job: JobView) => void) {
  const [job, setJob] = useState<JobView | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });
  const active = job && (job.status === "queued" || job.status === "running") ? job.id : null;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const started = Date.now();
    const tick = async () => {
      try {
        const next = await api<JobView>(`/api/jobs/${active}`);
        if (cancelled) return;
        setJob(next);
        if (next.status !== "queued" && next.status !== "running") finished.current?.(next);
        else if (Date.now() - started > 120_000) setPollError("This is taking longer than expected. Reload the page to check its status.");
        else setTimeout(tick, 700);
      } catch (e) {
        if (!cancelled) setPollError(errorMessage(e));
      }
    };
    const handle = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [active]);

  return { job, setJob, pollError, running: !!active && !pollError };
}

export function JobStatus({ job, pollError, noun }: { job: JobView | null; pollError: string | null; noun: string }) {
  if (!job) return null;
  if (pollError) return <p className="form-error" role="alert">{pollError}</p>;
  if (job.status === "failed") return <p className="form-error" role="alert">{noun} failed: {job.error}</p>;
  if (job.status === "succeeded") return null;
  const pct = job.progress.total ? job.progress.done / job.progress.total : 0;
  return (
    <div className="note" role="status" aria-live="polite">
      {noun} {job.status === "queued" ? "is queued" : "is running"}
      {job.progress.total > 1 ? ` — ${job.progress.done} of ${job.progress.total}${job.progress.step ? ` (${job.progress.step})` : ""}` : "…"}
      {job.progress.total > 1 && (
        <div className="progress blue" style={{ marginTop: 8 }}>
          <span style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Warn before leaving the page while a form has unsaved changes. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="error" role="alert">{errors.join(" ")}</span>;
}

export function downloadText(fileName: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
