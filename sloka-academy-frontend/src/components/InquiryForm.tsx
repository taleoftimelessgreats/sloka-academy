"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { site } from "@/config/site";
import { CATEGORIES, VISIBLE_DOMAINS } from "@/data/domains";
import { YEARS_OF_STUDY, type InquirySource } from "@/data/inquiry";
import { STREAMS } from "@/data/streams";
import type { ProfileVerification as Verification } from "@/lib/profileVerification";
import { Consent, Field, FormError, FormGrid, Honeypot, SubmitButton, fieldProps } from "./FormParts";
import { Icon } from "./Icon";
import { ProfileVerification } from "./ProfileVerification";

type Status =
  | { state: "idle" | "sending" }
  | { state: "sent"; name: string; phone: string; verification: Verification | null }
  | { state: "error"; message: string; fields: Record<string, string> };

/** Fields shown per form. Name, phone, email and consent are always present. */
const EXTRA_FIELDS: Record<InquirySource, readonly string[]> = {
  brochure: ["stream"],
  "pre-register": ["college", "stream", "yearOfStudy", "domain"],
  contact: ["college", "stream", "yearOfStudy", "domain", "message"],
};

const REQUIRED_EXTRAS: Record<InquirySource, readonly string[]> = {
  brochure: ["stream"],
  "pre-register": ["stream"],
  contact: [],
};

/**
 * Enquiry form for the Pre-register, Contact and brochure flows. Sends the
 * details to the inquiry dashboard API; nothing is stored in the browser.
 * Only rendered when `site.apiUrl` is set.
 */
export function InquiryForm({
  source,
  brochure,
  onSent,
  sentMessage,
  sentAction,
  submitLabel = "Send",
}: {
  source: InquirySource;
  /** Brochure file being requested (brochure form only). */
  brochure?: string;
  onSent?: () => void;
  /** Replaces the default thank-you text. */
  sentMessage?: ReactNode;
  /** Shown under the thank-you text once the enquiry is recorded, e.g. a download button. */
  sentAction?: ReactNode;
  submitLabel?: string;
}) {
  const uid = useId();
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const extras = EXTRA_FIELDS[source];
  const required = (f: string) => REQUIRED_EXTRAS[source].includes(f);
  const fieldErrors = status.state === "error" ? status.fields : {};

  const bind = (name: string) => fieldProps(uid, name, fieldErrors);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setStatus({ state: "sending" });
    try {
      const res = await fetch(`${site.apiUrl}/api/public/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, source, consent: data.consent === "on", ...(brochure ? { brochure } : {}) }),
      });
      if (res.status === 201) {
        const body = (await res.json().catch(() => null)) as { verification?: Verification } | null;
        setStatus({ state: "sent", name: data.name.trim(), phone: data.phone.trim(), verification: body?.verification ?? null });
        onSent?.();
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { fields?: Record<string, string> } | null;
        setStatus({ state: "error", message: "Please check the highlighted fields.", fields: body?.fields ?? {} });
        return;
      }
      if (res.status === 429) {
        setStatus({
          state: "error",
          message: "We have received several requests from this connection. Please try again later, or call admissions.",
          fields: {},
        });
        return;
      }
      throw new Error(`Unexpected status ${res.status}`);
    } catch {
      setStatus({
        state: "error",
        message: "That didn't go through. Please try again, or call admissions.",
        fields: {},
      });
    }
  }

  if (status.state === "sent") {
    return (
      <div className="grid gap-5">
        <div role="status" className="rounded-[var(--radius)] border border-red/40 bg-red/[0.06] p-6">
          <p className="flex items-center gap-3 font-medium">
            <Icon name="check" size={20} strokeWidth={2.4} className="shrink-0 text-red-hi" />
            Thank you, {status.name}.
          </p>
          <p className="mt-3 leading-relaxed text-muted">
            {sentMessage ?? <>Admissions will call you back on {status.phone}.</>}
          </p>
          {sentAction && <div className="mt-5">{sentAction}</div>}
        </div>
        {status.verification && (
          <ProfileVerification verification={status.verification} what={source === "brochure" ? "request" : "enquiry"} />
        )}
      </div>
    );
  }

  return (
    <FormGrid onSubmit={onSubmit}>
      <Field id={`${uid}-name`} label="Full name" error={fieldErrors.name}>
        <input {...bind("name")} type="text" required minLength={2} maxLength={100} autoComplete="name" />
      </Field>
      <Field id={`${uid}-phone`} label="Mobile number" error={fieldErrors.phone}>
        <input {...bind("phone")} type="tel" required inputMode="tel" maxLength={20} autoComplete="tel" placeholder="10-digit mobile" />
      </Field>
      <Field id={`${uid}-email`} label="Email" error={fieldErrors.email}>
        <input {...bind("email")} type="email" required maxLength={254} autoComplete="email" />
      </Field>

      {extras.includes("college") && (
        <Field id={`${uid}-college`} label="College" optional error={fieldErrors.college}>
          <input {...bind("college")} type="text" maxLength={150} autoComplete="organization" />
        </Field>
      )}

      {extras.includes("stream") && (
        <Field id={`${uid}-stream`} label="Stream" optional={!required("stream")} error={fieldErrors.stream}>
          <select {...bind("stream")} required={required("stream")} defaultValue="">
            <option value="" disabled={required("stream")}>
              Select your stream
            </option>
            {STREAMS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {extras.includes("yearOfStudy") && (
        <Field id={`${uid}-yearOfStudy`} label="Year of study" optional error={fieldErrors.yearOfStudy}>
          <select {...bind("yearOfStudy")} defaultValue="">
            <option value="">Select</option>
            {YEARS_OF_STUDY.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {extras.includes("domain") && (
        <Field
          id={`${uid}-domain`}
          label="Domain of interest"
          optional
          error={fieldErrors.domain}
          wide
        >
          <select {...bind("domain")} defaultValue="">
            <option value="">Not sure yet</option>
            {CATEGORIES.map((category) => (
              <optgroup key={category} label={category}>
                {VISIBLE_DOMAINS.filter((d) => d.category === category).map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
      )}

      {extras.includes("message") && (
        <Field id={`${uid}-message`} label="Your question" optional error={fieldErrors.message} wide>
          <textarea {...bind("message")} rows={4} maxLength={2000} />
        </Field>
      )}

      <Honeypot uid={uid} />

      <Consent error={fieldErrors.consent}>
        I agree that Sloka Academy may contact me about this enquiry and keep these details as described in the
      </Consent>

      {status.state === "error" && <FormError message={status.message} />}

      <SubmitButton sending={status.state === "sending"} label={submitLabel} sendingLabel="Sending…" />
    </FormGrid>
  );
}
