"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { site } from "@/config/site";
import { YEARS_OF_STUDY } from "@/data/inquiry";
import { STREAMS } from "@/data/streams";
import {
  certificateDownloadUrl,
  fetchOpenSessions,
  formatDate,
  type GuidanceSession,
  type IssuedCertificate,
} from "@/lib/certificates";
import type { ProfileVerification as Verification } from "@/lib/profileVerification";
import { Consent, Field, FormError, FormGrid, Honeypot, SubmitButton, fieldProps } from "./FormParts";
import { Icon } from "./Icon";
import { ProfileVerification } from "./ProfileVerification";
import { Note } from "./ui";

type Sessions = { state: "loading" } | { state: "ready"; list: GuidanceSession[] } | { state: "failed" };

type Status =
  | { state: "idle" | "sending" }
  | { state: "issued"; certificate: IssuedCertificate; emailedTo: string | null; verification: Verification | null }
  | { state: "already"; emailed: boolean }
  | { state: "error"; message: string; fields: Record<string, string> };

function sessionLabel(s: GuidanceSession) {
  return `${s.title} · ${formatDate(s.date)} · ${s.mode === "online" ? "Online" : s.venue}`;
}

function Issued({
  certificate,
  emailedTo,
  verification,
}: {
  certificate: IssuedCertificate;
  emailedTo: string | null;
  /** Profile verification step, when the details differ from the student's existing profile. */
  verification?: ReactNode;
}) {
  return (
    <div>
      {/* Only the announcement is a live region: the verification step below is interactive. */}
      <div role="status">
        <p className="kicker">Certificate issued</p>
        <h2 className="display mt-5 text-[2rem]">Your certificate is ready.</h2>
        {emailedTo && (
          <p className="mt-4 leading-relaxed text-muted">
            We are also emailing it to <span className="text-text">{emailedTo}</span>. If it hasn&rsquo;t arrived in a
            few minutes, check your spam folder.
          </p>
        )}
      </div>
      <dl className="mt-7 divide-y divide-line border-y border-line text-[0.95rem]">
        {[
          ["Name", certificate.name],
          ["Session", certificate.sessionTitle],
          ["Session date", formatDate(certificate.sessionDate)],
          ["Certificate ID", certificate.id],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1 py-3.5 sm:grid-cols-[150px_1fr] sm:gap-4">
            <dt className="text-muted-2">{label}</dt>
            <dd className={label === "Certificate ID" ? "font-mono text-text" : "font-medium"}>{value}</dd>
          </div>
        ))}
      </dl>
      {certificate.studentId && (
        <div className="mt-6 rounded-xl border border-line-2 bg-white/[0.03] px-4 py-3.5">
          <p className="text-[0.95rem]">
            Your Student ID: <span className="font-mono font-medium text-text">{certificate.studentId}</span>
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">Keep it for future registrations with Sloka Academy.</p>
        </div>
      )}
      {verification && <div className="mt-6">{verification}</div>}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <a href={certificateDownloadUrl(certificate)} className="btn btn-red flex-1">
          <Icon name="download" size={18} />
          Download certificate (PDF)
        </a>
        <Link href={`/verify/?id=${encodeURIComponent(certificate.id)}`} className="btn btn-glass flex-1">
          Verify it
        </Link>
      </div>
      <div className="mt-6">
        <Note>
          Download the PDF now and keep it, along with your certificate ID. Anyone, such as a college or employer, can
          confirm the certificate is genuine on our Verify page using that ID.
        </Note>
      </div>
    </div>
  );
}

/**
 * The Career Guidance Certificate form (separate from Internship Course Program
 * pre-registration). Lists the sessions open for registration, checks the
 * session code and issues the certificate straight away; the backend also emails
 * the PDF. `?session=<id>` preselects a session (for links and QR codes).
 */
export function CertificateForm() {
  const uid = useId();
  const requested = Number(useSearchParams().get("session"));
  const [sessions, setSessions] = useState<Sessions>({ state: "loading" });
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const errors = status.state === "error" ? status.fields : {};
  const bind = (name: string, opts?: { hint?: boolean }) => fieldProps(uid, name, errors, opts);

  useEffect(() => {
    let cancelled = false;
    fetchOpenSessions()
      .then((list) => !cancelled && setSessions({ state: "ready", list }))
      .catch(() => !cancelled && setSessions({ state: "failed" }));
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setStatus({ state: "sending" });
    try {
      const res = await fetch(`${site.apiUrl}/api/public/certificate-registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, sessionId: Number(data.sessionId), consent: data.consent === "on" }),
      });
      const body = (await res.json().catch(() => null)) as {
        certificate?: IssuedCertificate;
        emailing?: boolean;
        fields?: Record<string, string>;
        emailed?: boolean;
        verification?: Verification;
      } | null;
      if (res.status === 201 && body?.certificate) {
        setStatus({
          state: "issued",
          certificate: body.certificate,
          emailedTo: body.emailing ? data.email.trim() : null,
          verification: body.verification ?? null,
        });
        return;
      }
      if (res.status === 409) {
        setStatus({ state: "already", emailed: Boolean(body?.emailed) });
        return;
      }
      if (res.status === 400) {
        setStatus({ state: "error", message: "Please check the highlighted fields.", fields: body?.fields ?? {} });
        return;
      }
      if (res.status === 429) {
        setStatus({
          state: "error",
          message: "Too many attempts from this connection. Please wait a few minutes and try again, or call us.",
          fields: {},
        });
        return;
      }
      throw new Error(`Unexpected status ${res.status}`);
    } catch {
      setStatus({ state: "error", message: "That didn't go through. Please try again, or call us.", fields: {} });
    }
  }

  if (status.state === "issued") {
    // Once the student confirms the code, the Student ID appears in the certificate details (shown once).
    const linkStudent = (studentId: string) =>
      setStatus((s) => (s.state === "issued" ? { ...s, certificate: { ...s.certificate, studentId } } : s));
    return (
      <Issued
        certificate={status.certificate}
        emailedTo={status.emailedTo}
        verification={
          status.verification && (
            <ProfileVerification verification={status.verification} what="registration" showStudentId={false} onVerified={linkStudent} />
          )
        }
      />
    );
  }

  if (status.state === "already") {
    return (
      <div role="status">
        <p className="kicker">Already registered</p>
        <h2 className="display mt-5 text-[2rem]">You already have this certificate.</h2>
        <p className="mt-5 leading-relaxed text-muted">
          A certificate for this session has already been issued to you (we matched your email or mobile number).{" "}
          {status.emailed
            ? "We have emailed it again to the address you first registered with."
            : `Email ${site.contact.email} or call ${site.contact.phones[0].display} and we will send it to you again.`}
        </p>
      </div>
    );
  }

  if (sessions.state === "loading") return <p className="text-muted">Loading sessions…</p>;
  if (sessions.state === "failed") {
    return <FormError message="We couldn't load the session list. Please refresh the page, or call us." />;
  }
  if (sessions.list.length === 0) {
    return (
      <div>
        <h2 className="h-sub">No sessions are open for registration right now.</h2>
        <p className="mt-3 leading-relaxed text-muted">
          If you attended a session recently and can&rsquo;t find it here, email {site.contact.email} with the session
          name and date.
        </p>
      </div>
    );
  }

  const preselected = sessions.list.some((s) => s.id === requested)
    ? String(requested)
    : sessions.list.length === 1
      ? String(sessions.list[0].id)
      : "";

  return (
    <FormGrid onSubmit={onSubmit}>
      <Field id={`${uid}-sessionId`} label="Session you attended" error={errors.sessionId} wide>
        <select {...bind("sessionId")} required defaultValue={preselected}>
          <option value="" disabled>
            Select the session
          </option>
          {sessions.list.map((s) => (
            <option key={s.id} value={s.id}>
              {sessionLabel(s)}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id={`${uid}-code`}
        label="Session code"
        hint="Announced at the end of the session."
        error={errors.code}
        wide
      >
        <input
          {...bind("code", { hint: true })}
          type="text"
          required
          minLength={4}
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="field font-mono uppercase tracking-[0.3em]"
        />
      </Field>

      <Field
        id={`${uid}-name`}
        label="Name on certificate"
        hint="In English letters, exactly as it should be printed."
        error={errors.name}
        wide
      >
        <input {...bind("name", { hint: true })} type="text" required minLength={2} maxLength={80} autoComplete="name" />
      </Field>

      <Field id={`${uid}-email`} label="Email" error={errors.email}>
        <input {...bind("email")} type="email" required maxLength={254} autoComplete="email" />
      </Field>
      <Field id={`${uid}-phone`} label="Mobile number" error={errors.phone}>
        <input {...bind("phone")} type="tel" required inputMode="tel" maxLength={20} autoComplete="tel" placeholder="10-digit mobile" />
      </Field>

      <Field
        id={`${uid}-college`}
        label="College"
        hint="In English letters, as it may be printed on the certificate."
        error={errors.college}
        wide
      >
        <input {...bind("college", { hint: true })} type="text" required maxLength={150} autoComplete="organization" />
      </Field>

      <Field id={`${uid}-stream`} label="Stream" optional error={errors.stream}>
        <select {...bind("stream")} defaultValue="">
          <option value="">Select</option>
          {STREAMS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${uid}-yearOfStudy`} label="Year of study" optional error={errors.yearOfStudy}>
        <select {...bind("yearOfStudy")} defaultValue="">
          <option value="">Select</option>
          {YEARS_OF_STUDY.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label}
            </option>
          ))}
        </select>
      </Field>

      <Honeypot uid={uid} />

      <Consent error={errors.consent}>
        I agree that Sloka Academy may keep these details to issue, email and verify my certificate. Anyone with my
        certificate ID can confirm my name, the session and its date. See the
      </Consent>

      {status.state === "error" && <FormError message={status.message} />}

      <SubmitButton sending={status.state === "sending"} label="Get my certificate" sendingLabel="Issuing…" />
    </FormGrid>
  );
}
