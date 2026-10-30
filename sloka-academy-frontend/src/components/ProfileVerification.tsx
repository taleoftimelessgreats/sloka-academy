"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { resendCode, verifyCode, type ProfileVerification as Verification } from "@/lib/profileVerification";
import { Field, SubmitButton } from "./FormParts";
import { Icon } from "./Icon";

/** Why the team, not the student, will confirm the details. */
type PendingReason = Verification["reason"] | "skipped" | "locked" | "not_found";

type Phase =
  | { phase: "code" }
  | { phase: "pending"; reason: PendingReason }
  | { phase: "closed" }
  | { phase: "verified"; studentId: string };

type Message = { tone: "error" | "info"; text: string } | null;

const RESEND_WAIT_SECONDS = 60;

const expiryTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null;

/**
 * Shown after a registration or enquiry when its details differ from the student's existing profile:
 * the student enters the code emailed to the address on that profile, or leaves it to the team.
 * Never says which details differ.
 */
export function ProfileVerification({
  verification,
  what,
  showStudentId = true,
  onVerified,
}: {
  verification: Verification;
  /** What was submitted, for the copy: "registration", "enquiry", "request". */
  what: string;
  /** False when the caller shows the Student ID itself (e.g. the certificate view). */
  showStudentId?: boolean;
  onVerified?: (studentId: string) => void;
}) {
  const uid = useId();
  const codeId = `${uid}-code`;
  const [current, setCurrent] = useState(verification);
  const [phase, setPhase] = useState<Phase>(
    verification.codeSent ? { phase: "code" } : { phase: "pending", reason: verification.reason },
  );
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [canResend, setCanResend] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Ask for the code straight away; afterwards, move focus to the outcome so nobody is left on a removed input.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (phase.phase === "code") inputRef.current?.focus();
      return;
    }
    if (phase.phase !== "code") resultRef.current?.focus();
  }, [phase.phase]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setMessage({ tone: "error", text: "Enter the 6-digit code from the email." });
      inputRef.current?.focus();
      return;
    }
    setChecking(true);
    setMessage(null);
    const result = await verifyCode(current.token, code);
    setChecking(false);
    switch (result.state) {
      case "verified":
        setPhase({ phase: "verified", studentId: result.studentId });
        onVerified?.(result.studentId);
        return;
      case "wrong_code":
        setCode("");
        setMessage({
          tone: "error",
          text:
            result.attemptsLeft > 0
              ? `That code isn't right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left.`
              : "That code isn't right.",
        });
        inputRef.current?.focus();
        return;
      case "invalid":
        setMessage({ tone: "error", text: result.message });
        inputRef.current?.focus();
        return;
      case "expired":
        setCode("");
        setMessage({ tone: "error", text: "This code has expired. Send a new code and enter that one." });
        return;
      case "locked":
        setPhase({ phase: "pending", reason: "locked" });
        return;
      case "closed":
        setPhase({ phase: "closed" });
        return;
      case "not_found":
        setPhase({ phase: "pending", reason: "not_found" });
        return;
      case "rate_limited":
        setMessage({ tone: "error", text: "Too many attempts from this connection. Please wait a few minutes and try again." });
        return;
      default:
        setMessage({ tone: "error", text: "We couldn't check the code. Please check your connection and try again." });
    }
  }

  async function onResend() {
    setSending(true);
    setMessage(null);
    const result = await resendCode(current.token);
    setSending(false);
    switch (result.state) {
      case "sent":
        setCurrent(result.verification);
        if (!result.verification.codeSent) {
          setPhase({ phase: "pending", reason: result.verification.reason });
          return;
        }
        setCode("");
        setCooldown(RESEND_WAIT_SECONDS);
        setMessage({ tone: "info", text: `We've sent a new code to ${result.verification.sentTo ?? "your email"}. The earlier code no longer works.` });
        inputRef.current?.focus();
        return;
      case "too_soon":
        setCooldown(result.retryAfter);
        setMessage({ tone: "info", text: "A code was sent a moment ago. Please check your inbox (and spam folder) first." });
        return;
      case "resend_limit":
        setCanResend(false);
        setMessage({ tone: "info", text: "We can't send any more codes for this. Enter the latest code, or skip and our team will confirm your details." });
        return;
      case "locked":
        setPhase({ phase: "pending", reason: "locked" });
        return;
      case "closed":
        setPhase({ phase: "closed" });
        return;
      case "not_found":
        setPhase({ phase: "pending", reason: "not_found" });
        return;
      case "rate_limited":
        setMessage({ tone: "error", text: "Too many requests from this connection. Please wait a few minutes and try again." });
        return;
      default:
        setMessage({ tone: "error", text: "We couldn't send a new code. Please check your connection and try again." });
    }
  }

  const box = "rounded-[var(--radius)] border border-line-2 bg-white/[0.03] p-6";

  if (phase.phase === "verified") {
    return (
      <div ref={resultRef} tabIndex={-1} role="status" className={`${box} outline-none`}>
        <p className="flex items-center gap-3 font-medium">
          <Icon name="check" size={20} strokeWidth={2.4} className="shrink-0 text-red-hi" />
          Profile confirmed
        </p>
        <p className="mt-3 leading-relaxed text-muted">
          Thank you. Your profile is up to date and this {what} is linked to it.
        </p>
        {showStudentId && (
          <p className="mt-4 text-[0.95rem]">
            Your Student ID: <span className="font-mono font-medium text-text">{phase.studentId}</span>
            <span className="mt-1 block text-sm leading-relaxed text-muted">Keep it for future registrations with Sloka Academy.</span>
          </p>
        )}
      </div>
    );
  }

  if (phase.phase === "closed") {
    return (
      <div ref={resultRef} tabIndex={-1} role="status" className={`${box} outline-none`}>
        <p className="leading-relaxed text-muted">Nothing more to do: your details have already been confirmed.</p>
      </div>
    );
  }

  if (phase.phase === "pending") {
    const extra =
      phase.reason === "email_limit"
        ? " We can't send any more emails to the address on your profile today."
        : phase.reason === "locked"
          ? " The code was entered incorrectly too many times, so it no longer works."
          : "";
    return (
      <div ref={resultRef} tabIndex={-1} role="status" className={`${box} outline-none`}>
        <p className="flex items-center gap-3 font-medium">
          <Icon name="info" size={19} className="shrink-0 text-red-hi" />
          Your {what} is saved
        </p>
        <p className="mt-3 leading-relaxed text-muted">
          Some of the details you entered differ from an existing Sloka Academy profile, so our team will confirm them
          before your profile is updated.{extra}
        </p>
      </div>
    );
  }

  const expires = expiryTime(current.expiresAt);
  return (
    <div className={box}>
      <h3 className="h-sub">Confirm it&rsquo;s you</h3>
      <p className="mt-3 leading-relaxed text-muted">
        Some of the details you entered differ from your existing Sloka Academy profile. To update your profile and
        link this {what} to it, enter the 6-digit code we sent to{" "}
        <span className="text-text">{current.sentTo ?? "the email on your profile"}</span>.
        {expires && <> The code works until {expires}.</>}
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-5">
        <Field id={codeId} label="Verification code" hint="Check your spam folder if it hasn't arrived.">
          <input
            ref={inputRef}
            id={codeId}
            name="code"
            className="field max-w-[14rem] font-mono text-lg tracking-[0.4em]"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-invalid={message?.tone === "error" ? true : undefined}
            aria-describedby={message ? `${uid}-message` : `${codeId}-hint`}
          />
        </Field>

        <div aria-live="polite">
          {message && (
            <p
              id={`${uid}-message`}
              role={message.tone === "error" ? "alert" : undefined}
              className={message.tone === "error" ? "field-error mt-0" : "text-sm leading-relaxed text-muted"}
            >
              {message.text}
            </p>
          )}
        </div>

        <SubmitButton sending={checking} label="Verify" sendingLabel="Checking…" />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {canResend && (
            <button
              type="button"
              onClick={onResend}
              disabled={sending || cooldown > 0}
              className="underline underline-offset-4 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
            >
              {sending ? "Sending…" : cooldown > 0 ? `Send a new code (${cooldown}s)` : "Send a new code"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setPhase({ phase: "pending", reason: "skipped" })}
            className="text-muted underline underline-offset-4 hover:text-text"
          >
            Skip for now
          </button>
        </div>
      </form>
    </div>
  );
}
