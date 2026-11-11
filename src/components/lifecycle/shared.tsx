"use client";

import { useRouter } from "next/navigation";
import { useCallback, useId, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, Dialog, errorMessage, FieldError, useToast } from "@/components/client";

export interface MemberOption {
  id: string;
  name: string;
  role: "owner" | "editor" | "viewer";
}

/** The `YYYY-MM-DD` value of a stored date, for `<input type="date">`. */
export const dayValue = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/** Call the API, then refresh the server-rendered data. Errors are thrown to the caller, which shows them in place. */
export function useSubmit() {
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    async <T,>(path: string, options: { method?: string; body?: unknown }, success?: string): Promise<T> => {
      const result = await api<T>(path, { method: options.method, body: options.body ?? {} });
      if (success) toast(success);
      router.refresh();
      return result;
    },
    [router, toast],
  );
}

/** Busy, error and field-error state for a form that closes itself when the work succeeds. */
export function useFormSubmit(work: () => Promise<unknown>, onDone?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await work();
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, fieldErrors, submit };
}

export function MemberSelect({ label, value, onChange, members, disabled, none = "Unassigned", decidersOnly, errors, className = "select" }: { label: string; value: string | null; onChange: (value: string | null) => void; members: MemberOption[]; disabled?: boolean; none?: string; decidersOnly?: boolean; errors?: string[]; className?: string }) {
  const id = useId();
  const options = decidersOnly ? members.filter((m) => m.role !== "viewer" || m.id === value) : members;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className={className} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{none}</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <FieldError errors={errors} />
    </div>
  );
}

export function DialogActions({ busy, label, busyLabel = "Saving…", onClose, danger }: { busy: boolean; label: string; busyLabel?: string; onClose: () => void; danger?: boolean }) {
  return (
    <div className="actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
      <button type="button" className="btn" onClick={onClose} disabled={busy}>
        Cancel
      </button>
      <button type="submit" className={danger ? "btn danger" : "btn primary"} disabled={busy}>
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}

/** A dialog that asks for one piece of text — a reason or a note — and submits it. */
export function ReasonDialog({ title, label, hint, confirmLabel, danger, optional, children, onSubmit, onClose }: { title: string; label: string; hint?: string; confirmLabel: string; danger?: boolean; optional?: boolean; children?: ReactNode; onSubmit: (text: string) => Promise<unknown>; onClose: () => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const { busy, error, fieldErrors, submit } = useFormSubmit(() => onSubmit(text), onClose);
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate className="stack" style={{ gap: 12 }}>
        {children}
        <div className="field">
          <label htmlFor={id}>
            {label} {optional && <span className="muted">(optional)</span>}
          </label>
          <textarea id={id} className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!(fieldErrors.reason ?? fieldErrors.note)} />
          {hint && <span className="hint">{hint}</span>}
          <FieldError errors={fieldErrors.reason ?? fieldErrors.note} />
        </div>
        {error && !(fieldErrors.reason ?? fieldErrors.note) && <p className="form-error" role="alert">{error}</p>}
        <DialogActions busy={busy} label={confirmLabel} busyLabel="Working…" onClose={onClose} danger={danger} />
      </form>
    </Dialog>
  );
}
