"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { site } from "@/config/site";
import { YEARS_OF_STUDY } from "@/data/inquiry";
import { STREAMS } from "@/data/streams";
import {
  certificateDownloadUrl,
  certificatePreviewUrl,
  fetchOpenSessions,
  formatDate,
  type GuidanceSession,
  type IssuedCertificate,
} from "@/lib/certificates";
import type { ProfileVerification as Verification } from "@/lib/profileVerification";
import { CertificatePreview } from "./CertificatePreview";
import { Consent, Field, FormError, FormGrid, Honeypot, SubmitButton, fieldProps } from "./FormParts";
import { Icon } from "./Icon";
import { ProfileVerification } from "./ProfileVerification";
import { Note } from "./ui";

type Sessions = { state: "loading" } | { state: "ready"; list: GuidanceSession[] } | { state: "failed" };

/** Step 2: the certificate as it will be printed (stamped PREVIEW), before it is issued. */
type Preview = {
  state: "preview";
  pdf: ArrayBuffer;
  /** The checked registration, sent again to issue the certificate. */
  payload: Record<string, unknown>;
  details: [string, string][];
  email: string;
  referred: number;
  confirming: boolean;
  error: string | null;
};

type Status =
  | { state: "idle" | "sending" }
  | Preview
  | { state: "issued"; certificate: IssuedCertificate; emailedTo: string | null; verification: Verification | null; referred: number }
  | { state: "already"; emailed: boolean }
  | { state: "error"; message: string; fields: Record<string, string> };

/** One friend under "Refer a friend". `key` only identifies the row in the form. */
type Friend = { key: number; name: string; phone: string; college: string };
const MAX_FRIENDS = 3;

type Answer = {
  certificate?: IssuedCertificate;
  emailing?: boolean;
  fields?: Record<string, string>;
  emailed?: boolean;
  verification?: Verification;
} | null;

const NOT_SENT = "That didn't go through. Please try again, or call us.";

function sessionLabel(s: GuidanceSession) {
  return `${s.title} · ${formatDate(s.date)} · ${s.mode === "online" ? "Online" : s.venue}`;
}

function Issued({
  certificate,
  emailedTo,
  referred,
  verification,
}: {
  certificate: IssuedCertificate;
  emailedTo: string | null;
  /** Friends referred with this registration. */
  referred: number;
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
        {referred > 0 && (
          <p className="mt-4 leading-relaxed text-muted">
            Thank you for referring {referred === 1 ? "your friend" : `${referred} friends`}. We will invite{" "}
            {referred === 1 ? "them" : "each of them"} to our upcoming sessions.
          </p>
        )}
      </div>
      <div className="mt-7">
        <CertificatePreview url={certificatePreviewUrl(certificate.id)} label={`Your certificate, issued to ${certificate.name}`} />
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

/** Step 2: the student checks the certificate before it is issued, then confirms or goes back to the form. */
function PreviewStep({ preview, onConfirm, onEdit }: { preview: Preview; onConfirm: () => void; onEdit: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <div>
      <p className="kicker">Preview</p>
      <h2 ref={headingRef} tabIndex={-1} className="display mt-5 scroll-mt-32 text-[2rem] outline-none">
        Check your certificate.
      </h2>
      <p className="mt-4 leading-relaxed text-muted">
        This is how your certificate will look. Make sure your name is spelled exactly as it should be printed. The
        certificate ID is added when the certificate is issued.
      </p>
      <div className="mt-7">
        <CertificatePreview data={preview.pdf} label={`Preview of the certificate for ${preview.details[0][1]}`} />
      </div>
      <dl className="mt-7 divide-y divide-line border-y border-line text-[0.95rem]">
        {preview.details.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-3.5 sm:grid-cols-[150px_1fr] sm:gap-4">
            <dt className="text-muted-2">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {preview.error && (
        <div className="mt-6">
          <FormError message={preview.error} />
        </div>
      )}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={onConfirm} disabled={preview.confirming} className="btn btn-red flex-1 disabled:opacity-60">
          {preview.confirming ? "Issuing…" : "Confirm and get my certificate"}
          {!preview.confirming && <Icon name="arrow" size={18} />}
        </button>
        <button type="button" onClick={onEdit} disabled={preview.confirming} className="btn btn-glass flex-1 disabled:opacity-60">
          Edit details
        </button>
      </div>
    </div>
  );
}

/**
 * The Career Guidance Certificate form (separate from Internship Course Program
 * pre-registration). Lists the sessions open for registration and checks the session
 * code. The student previews the certificate, confirms, and gets it straight away; the
 * backend also emails the PDF. `?session=<id>` preselects a session (for links and QR codes).
 */
export function CertificateForm() {
  const uid = useId();
  const requested = Number(useSearchParams().get("session"));
  const [sessions, setSessions] = useState<Sessions>({ state: "loading" });
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const nextKey = useRef(1);
  const [friends, setFriends] = useState<Friend[]>([{ key: 0, name: "", phone: "", college: "" }]);
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

  const post = (payload: Record<string, unknown>) =>
    fetch(`${site.apiUrl}/api/public/certificate-registrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  /** Answers both steps handle the same way. False when the response is none of them. */
  function settled(status: number, body: Answer) {
    if (status === 409) setStatus({ state: "already", emailed: Boolean(body?.emailed) });
    else if (status === 400) setStatus({ state: "error", message: "Please check the highlighted fields.", fields: body?.fields ?? {} });
    else if (status === 429) {
      setStatus({
        state: "error",
        message: "Too many attempts from this connection. Please wait a few minutes and try again, or call us.",
        fields: {},
      });
    } else return false;
    return true;
  }

  // Step 1: check the details and show the certificate as it will be printed. Nothing is saved yet.
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    // The friends go as a list whose indexes match the form, so errors land on the right field.
    const data = Object.fromEntries(Object.entries(form).filter(([k]) => !k.startsWith("referrals.")));
    const payload = {
      ...data,
      sessionId: Number(data.sessionId),
      consent: data.consent === "on",
      referrals: friends.map(({ name, phone, college }) => ({ name, phone, college })),
      referralConsent: data.referralConsent === "on",
    };
    const session = sessions.state === "ready" ? sessions.list.find((s) => s.id === payload.sessionId) : undefined;
    setStatus({ state: "sending" });
    try {
      const res = await post({ ...payload, preview: true });
      if (res.ok && res.headers.get("Content-Type")?.startsWith("application/pdf")) {
        const details: [string, string][] = [
          ["Name", data.name.trim()],
          ["College", data.college.trim()],
        ];
        if (session) details.push(["Session", session.title], ["Session date", formatDate(session.date)]);
        setStatus({
          state: "preview",
          pdf: await res.arrayBuffer(),
          payload,
          details,
          email: data.email.trim(),
          referred: friends.length,
          confirming: false,
          error: null,
        });
        return;
      }
      if (settled(res.status, await res.json().catch(() => null))) return;
      throw new Error(`Unexpected status ${res.status}`);
    } catch {
      setStatus({ state: "error", message: NOT_SENT, fields: {} });
    }
  }

  // Step 2: issue the certificate the student has checked.
  async function confirm(preview: Preview) {
    setStatus({ ...preview, confirming: true, error: null });
    try {
      const res = await post(preview.payload);
      const body = (await res.json().catch(() => null)) as Answer;
      if (res.status === 201 && body?.certificate) {
        setStatus({
          state: "issued",
          certificate: body.certificate,
          emailedTo: body.emailing ? preview.email : null,
          verification: body.verification ?? null,
          referred: preview.referred,
        });
        return;
      }
      if (settled(res.status, body)) return;
      throw new Error(`Unexpected status ${res.status}`);
    } catch {
      setStatus({ ...preview, confirming: false, error: NOT_SENT });
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
        referred={status.referred}
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

  // The form stays in the page (hidden) during the preview, so "Edit details" returns to what was typed.
  return (
    <>
      {status.state === "preview" && (
        <PreviewStep preview={status} onConfirm={() => confirm(status)} onEdit={() => setStatus({ state: "idle" })} />
      )}
      <div hidden={status.state === "preview"}>
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

          <ReferFriends
            uid={uid}
            friends={friends}
            errors={errors}
            onChange={(i, patch) => setFriends((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)))}
            onAdd={() => setFriends((list) => [...list, { key: nextKey.current++, name: "", phone: "", college: "" }])}
            onRemove={(i) => setFriends((list) => list.filter((_, j) => j !== i))}
          />

          <Honeypot uid={uid} />

          <Consent error={errors.consent}>
            I agree that Sloka Academy may keep these details to issue, email and verify my certificate. Anyone with my
            certificate ID can view the certificate and confirm my name, the session and its date. See the
          </Consent>

          {status.state === "error" && <FormError message={status.message} />}

          <SubmitButton sending={status.state === "sending"} label="Preview my certificate" sendingLabel="Preparing your preview…" />
        </FormGrid>
      </div>
    </>
  );
}

/**
 * "Refer a friend": one to three friends from other colleges whom admissions can invite to upcoming sessions.
 * Every field is required, as is the student's confirmation that the friends agreed to be contacted.
 * Referred friends become enquiries for the admissions team; they do not get a certificate.
 */
function ReferFriends({
  uid,
  friends,
  errors,
  onChange,
  onAdd,
  onRemove,
}: {
  uid: string;
  friends: Friend[];
  errors: Record<string, string>;
  onChange: (index: number, patch: Partial<Friend>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const headingId = `${uid}-refer`;
  const consentError = errors.referralConsent;
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="min-w-0 rounded-[var(--radius)] border border-line-2 bg-white/[0.03] p-5 @lg:col-span-2 sm:p-6"
    >
      <p className="kicker">Refer a friend</p>
      <h3 id={headingId} className="h-sub mt-4">
        Know someone at another college who would enjoy a session like this?
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Refer at least one friend (up to {MAX_FRIENDS}) and we will invite them to our upcoming sessions.
      </p>

      <div className="mt-6 grid gap-6">
        {friends.map((f, i) => {
          const bind = (key: "name" | "phone" | "college") => ({
            ...fieldProps(uid, `referrals.${i}.${key}`, errors),
            value: f[key],
            onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(i, { [key]: e.target.value }),
          });
          return (
            <div key={f.key} className={`grid items-start gap-x-5 gap-y-5 @lg:grid-cols-2 ${i > 0 ? "border-t border-line pt-6" : ""}`}>
              {friends.length > 1 && (
                <div className="flex items-center justify-between gap-4 @lg:col-span-2">
                  <p className="text-sm font-medium">Friend {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={`Remove friend ${i + 1}`}
                    className="min-h-11 px-2 text-sm text-muted underline underline-offset-4 transition-colors hover:text-text"
                  >
                    Remove
                  </button>
                </div>
              )}
              <Field id={`${uid}-referrals.${i}.name`} label="Friend's full name" error={errors[`referrals.${i}.name`]}>
                <input {...bind("name")} type="text" required minLength={2} maxLength={100} autoComplete="off" />
              </Field>
              <Field id={`${uid}-referrals.${i}.phone`} label="Friend's mobile number" error={errors[`referrals.${i}.phone`]}>
                <input {...bind("phone")} type="tel" required inputMode="tel" maxLength={20} autoComplete="off" placeholder="10-digit mobile" />
              </Field>
              <Field id={`${uid}-referrals.${i}.college`} label="Friend's college" error={errors[`referrals.${i}.college`]} wide>
                <input {...bind("college")} type="text" required minLength={2} maxLength={150} autoComplete="off" />
              </Field>
            </div>
          );
        })}
      </div>

      {friends.length < MAX_FRIENDS && (
        <button type="button" onClick={onAdd} className="btn btn-glass mt-6">
          Add another friend
        </button>
      )}

      <div className="mt-6 border-t border-line pt-6">
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
          <input
            type="checkbox"
            name="referralConsent"
            required
            aria-invalid={consentError ? true : undefined}
            aria-describedby={consentError ? `${uid}-referralConsent-error` : undefined}
            className="check mt-px"
          />
          <span>My friends know I am sharing their details and agree that Sloka Academy may contact them about its sessions.</span>
        </label>
        {consentError && (
          <p id={`${uid}-referralConsent-error`} className="field-error pl-8">
            {consentError}
          </p>
        )}
      </div>
    </div>
  );
}
