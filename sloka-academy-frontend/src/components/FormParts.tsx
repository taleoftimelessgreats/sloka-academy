import { useId, type FormEventHandler, type ReactNode } from "react";
import { site } from "@/config/site";
import { Icon } from "./Icon";

/**
 * Form layout: one column, two columns once the form itself is at least 32rem wide.
 * Sized by the form's container (not the viewport) because forms sit in narrow cards and dialogs.
 */
export function FormGrid({ onSubmit, children }: { onSubmit: FormEventHandler<HTMLFormElement>; children: ReactNode }) {
  return (
    <div className="@container">
      <form onSubmit={onSubmit} className="grid items-start gap-x-5 gap-y-6 @lg:grid-cols-2">
        {children}
      </form>
    </div>
  );
}

/**
 * Labelled field wrapper: label above the control, hint or error below it.
 * The hint id is `${id}-hint` and the error id `${id}-error`, for aria-describedby (see fieldProps).
 */
export function Field({
  id,
  label,
  optional,
  hint,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  /** Spans both columns of a FormGrid. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${wide ? "@lg:col-span-2" : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional && <span className="field-optional"> (optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Props for an input inside <Field>: id, name, error/hint wiring and the shared field style. */
export function fieldProps(uid: string, name: string, errors: Record<string, string>, { hint = false } = {}) {
  const id = `${uid}-${name}`;
  const describedBy = errors[name] ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return {
    id,
    name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": describedBy,
    className: "field",
  };
}

/** Honeypot: hidden from people and assistive tech; the API discards submissions that fill it. */
export function Honeypot({ uid }: { uid: string }) {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label htmlFor={`${uid}-website`}>Leave this empty</label>
      <input id={`${uid}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
    </div>
  );
}

/** Required consent checkbox linked to the Privacy Notice. Opens the form's closing group (consent, errors, submit). */
export function Consent({ error, children }: { error?: string; children: ReactNode }) {
  const errorId = useId();
  return (
    <div className="border-t border-line pt-6 @lg:col-span-2">
      <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
        <input
          type="checkbox"
          name="consent"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="check mt-px"
        />
        <span>
          {children}{" "}
          <a href="/privacy/" target="_blank" rel="noopener" className="text-text underline underline-offset-4">
            Privacy Notice
          </a>
          .
        </span>
      </label>
      {error && (
        <p id={errorId} className="field-error pl-8">
          {error}
        </p>
      )}
    </div>
  );
}

/** Form-level error with the admissions number as a fallback. */
export function FormError({ message }: { message: string }) {
  return (
    <p role="alert" className="flex gap-3 rounded-xl border border-red/50 bg-red/10 px-4 py-3.5 text-sm leading-relaxed @lg:col-span-2">
      <Icon name="info" size={17} className="mt-0.5 shrink-0 text-red-hi" />
      <span>
        {message}{" "}
        <a href={site.contact.phones[0].href} className="whitespace-nowrap underline underline-offset-4">
          {site.contact.phones[0].display}
        </a>
      </span>
    </p>
  );
}

/** Full-width submit button; spans both columns. */
export function SubmitButton({ sending, label, sendingLabel }: { sending: boolean; label: string; sendingLabel: string }) {
  return (
    <div className="@lg:col-span-2">
      <button type="submit" disabled={sending} className="btn btn-red w-full disabled:opacity-60">
        {sending ? sendingLabel : label}
        {!sending && <Icon name="arrow" size={18} />}
      </button>
    </div>
  );
}
