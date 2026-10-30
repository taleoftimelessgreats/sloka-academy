import { site } from "@/config/site";

/**
 * Client for profile verification in sloka-academy-backend. When a registration or enquiry matches an
 * existing student by email or mobile number but some details differ, the student confirms it is them
 * with a one-time code sent to the email already on their profile. Until then (or if they cannot),
 * the submission is saved as "pending verification" for the Sloka Academy team.
 * The response shapes here are the API contract; keep them in sync with the backend.
 */

export interface ProfileVerification {
  /** Opaque handle for the verify/resend calls. */
  token: string;
  /** A 6-digit code was emailed to the address already on the student's profile. */
  codeSent: boolean;
  /** That address, masked, e.g. "r•••@gmail.com". */
  sentTo: string | null;
  /** When the code stops working (ISO timestamp). */
  expiresAt: string | null;
  /** Why no code was sent (when codeSent is false). email_failed: the mail server refused it. */
  reason: null | "no_email" | "email_limit" | "email_off" | "email_failed";
}

export type VerifyResult =
  | { state: "verified"; studentId: string }
  | { state: "wrong_code"; attemptsLeft: number }
  | { state: "invalid"; message: string }
  | { state: "expired" | "locked" | "closed" | "not_found" | "rate_limited" | "error" };

export type ResendResult =
  | { state: "sent"; verification: ProfileVerification }
  | { state: "too_soon"; retryAfter: number }
  | { state: "resend_limit" | "locked" | "closed" | "not_found" | "rate_limited" | "error" };

type Body = { error?: string; status?: string; studentId?: string; attemptsLeft?: number; retryAfter?: number; fields?: Record<string, string>; verification?: ProfileVerification };

async function post(token: string, action: "verify" | "resend", payload: object): Promise<{ status: number; body: Body | null }> {
  const res = await fetch(`${site.apiUrl}/api/public/profile-verifications/${encodeURIComponent(token)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Body | null };
}

/** Check the code the student typed. */
export async function verifyCode(token: string, code: string): Promise<VerifyResult> {
  try {
    const { status, body } = await post(token, "verify", { code });
    if (status === 200 && body?.status === "verified" && body.studentId) return { state: "verified", studentId: body.studentId };
    if (status === 400 && body?.error === "wrong_code") return { state: "wrong_code", attemptsLeft: Math.max(0, Number(body.attemptsLeft) || 0) };
    if (status === 400) return { state: "invalid", message: body?.fields?.code ?? "Enter the 6-digit code from the email." };
    if (status === 410) return { state: "expired" };
    if (status === 409) return { state: body?.error === "locked" ? "locked" : "closed" };
    if (status === 404) return { state: "not_found" };
    if (status === 429) return { state: "rate_limited" };
    return { state: "error" };
  } catch {
    return { state: "error" };
  }
}

/** Ask for a new code (the previous one stops working). */
export async function resendCode(token: string): Promise<ResendResult> {
  try {
    const { status, body } = await post(token, "resend", {});
    if (status === 200 && body?.verification) return { state: "sent", verification: body.verification };
    if (status === 429 && body?.error === "too_soon") return { state: "too_soon", retryAfter: Math.max(1, Math.ceil(Number(body.retryAfter) || 60)) };
    if (status === 429) return { state: "rate_limited" };
    if (status === 409) {
      const e = body?.error;
      return { state: e === "resend_limit" || e === "locked" ? e : "closed" };
    }
    if (status === 404) return { state: "not_found" };
    return { state: "error" };
  } catch {
    return { state: "error" };
  }
}
