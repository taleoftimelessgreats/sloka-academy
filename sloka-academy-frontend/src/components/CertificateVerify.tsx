"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { site } from "@/config/site";
import { certificatePreviewUrl, formatDate, normaliseCertificateId, verifyCertificate, type Verification } from "@/lib/certificates";
import { CertificatePreview } from "./CertificatePreview";
import { Icon } from "./Icon";

type Result = { state: "idle" } | { state: "checking" } | Verification;

function Outcome({ result }: { result: Result }) {
  if (result.state === "idle") return null;
  if (result.state === "checking") return <p className="text-muted">Checking…</p>;
  if (result.state === "not_found") {
    return (
      <div className="rounded-[var(--radius)] border border-red/50 bg-red/10 p-6">
        <p className="h-sub">No certificate found</p>
        <p className="mt-2 leading-relaxed text-muted">
          No Sloka Academy certificate has this ID. Check that it matches the ID printed at the bottom of the
          certificate, for example SLK-2026-7K4M9Q2X.
        </p>
      </div>
    );
  }
  if (result.state === "error") {
    return (
      <p className="rounded-[var(--radius)] border border-line p-6 text-muted">
        We couldn&rsquo;t check that right now. Please try again, or email {site.contact.email}.
      </p>
    );
  }
  const valid = result.state === "valid";
  return (
    <div
      className={`rounded-[var(--radius)] border p-6 sm:p-8 ${valid ? "border-emerald-400/40 bg-emerald-400/[0.06]" : "border-red/50 bg-red/10"}`}
    >
      <p className="flex items-center gap-3 h-sub">
        {valid ? (
          <Icon name="check" size={22} strokeWidth={2.4} className="text-emerald-400" />
        ) : (
          <Icon name="close" size={22} strokeWidth={2.4} className="text-red-hi" />
        )}
        {valid ? "Genuine certificate" : "This certificate has been revoked"}
      </p>
      {!valid && (
        <p className="mt-2 text-sm text-muted">Sloka Academy issued this certificate but has since withdrawn it.</p>
      )}
      <div className="mt-6">
        <CertificatePreview
          key={result.id}
          url={certificatePreviewUrl(result.id)}
          label={`The certificate ${result.id}, issued to ${result.name}${valid ? "" : ", stamped revoked"}`}
        />
      </div>
      <dl className="mt-7 divide-y divide-line border-y border-line text-[0.95rem]">
        {[
          ["Issued to", result.name],
          ["Session", result.sessionTitle],
          ["Session date", formatDate(result.sessionDate)],
          ["Issued on", formatDate(result.issuedAt)],
          ["Certificate ID", result.id],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1 py-3.5 sm:grid-cols-[150px_1fr] sm:gap-4">
            <dt className="text-muted-2">{label}</dt>
            <dd className={label === "Certificate ID" ? "font-mono" : "font-medium"}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Certificate lookup by ID. `?id=` (printed on each certificate) checks on load. */
export function CertificateVerify() {
  const initial = normaliseCertificateId(useSearchParams().get("id") ?? "");
  const [id, setId] = useState(initial);
  const [result, setResult] = useState<Result>(initial ? { state: "checking" } : { state: "idle" });

  useEffect(() => {
    if (!initial) return;
    let cancelled = false;
    verifyCertificate(initial).then((r) => !cancelled && setResult(r));
    return () => {
      cancelled = true;
    };
  }, [initial]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalised = normaliseCertificateId(id);
    if (!normalised) return;
    setId(normalised);
    window.history.replaceState(null, "", `?id=${encodeURIComponent(normalised)}`);
    setResult({ state: "checking" });
    setResult(await verifyCertificate(normalised));
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="certificate-id" className="sr-only">
          Certificate ID
        </label>
        <input
          id="certificate-id"
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          required
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          placeholder="SLK-2026-XXXXXXXX"
          className="field flex-1 font-mono uppercase tracking-[0.12em]"
        />
        <button type="submit" disabled={result.state === "checking"} className="btn btn-red disabled:opacity-60">
          Verify
          <Icon name="arrow" size={18} />
        </button>
      </form>
      <div aria-live="polite" className="mt-8">
        <Outcome result={result} />
      </div>
    </div>
  );
}
