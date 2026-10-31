import { site } from "@/config/site";

/**
 * Client for the Career Guidance Certificate endpoints of sloka-academy-backend.
 * The response shapes here are the API contract; keep them in sync with the backend.
 */

export interface GuidanceSession {
  id: number;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  venue: string;
  mode: "in-person" | "online";
}

export interface IssuedCertificate {
  id: string;
  name: string;
  sessionTitle: string;
  sessionDate: string;
  issuedAt: string;
  /** Path on the API, including a one-off download token. */
  downloadPath: string;
  /** The student's master-record ID, e.g. "SLK-STU-2026-00042". */
  studentId?: string | null;
}

export type Verification =
  | { state: "valid" | "revoked"; id: string; name: string; sessionTitle: string; sessionDate: string; issuedAt: string }
  | { state: "not_found" }
  | { state: "error" };

/** "2026-11-12" or an ISO timestamp → "12 November 2026". */
export function formatDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/** Certificate IDs are case-insensitive; people often paste them with spaces. */
export const normaliseCertificateId = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

export async function fetchOpenSessions(): Promise<GuidanceSession[]> {
  const res = await fetch(`${site.apiUrl}/api/public/sessions`);
  if (!res.ok) throw new Error(`Sessions request failed: ${res.status}`);
  return ((await res.json()) as { sessions: GuidanceSession[] }).sessions;
}

export async function verifyCertificate(rawId: string): Promise<Verification> {
  try {
    const res = await fetch(`${site.apiUrl}/api/public/certificates/${encodeURIComponent(normaliseCertificateId(rawId))}/verify`);
    if (res.status === 404) return { state: "not_found" };
    if (!res.ok) return { state: "error" };
    const body = (await res.json()) as Omit<Extract<Verification, { state: "valid" }>, "state"> & { status: "valid" | "revoked" };
    return { state: body.status, id: body.id, name: body.name, sessionTitle: body.sessionTitle, sessionDate: body.sessionDate, issuedAt: body.issuedAt };
  } catch {
    return { state: "error" };
  }
}

export const certificateDownloadUrl = (cert: IssuedCertificate) => `${site.apiUrl}${cert.downloadPath}`;

/** The certificate as issued (stamped REVOKED if withdrawn), for showing with a verification. Anyone with the ID may view it. */
export const certificatePreviewUrl = (id: string) =>
  `${site.apiUrl}/api/public/certificates/${encodeURIComponent(normaliseCertificateId(id))}/preview`;
