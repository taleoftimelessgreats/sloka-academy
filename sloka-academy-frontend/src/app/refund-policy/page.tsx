import type { Metadata } from "next";
import { PolicyPage } from "@/components/PolicyPage";
import { Note } from "@/components/ui";
import { formatINR, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Payment, Cancellation & Refund Policy",
  description: "How payments, cancellations and refunds work for the Sloka Academy Internship Course Program.",
  alternates: { canonical: "/refund-policy/" },
};

// CONFIRM: replace with Sloka Academy's approved payment, cancellation and refund policy before launch.
export default function RefundPolicyPage() {
  return (
    <PolicyPage title="Payment, Cancellation &amp; Refund" updated="22 October 2026">
      <Note>
        Sloka Academy&rsquo;s approved payment, cancellation and refund terms will be published on this page. Until
        then, admissions shares the terms in writing before you make any payment.
      </Note>

      <h2>Program fee</h2>
      <p>
        The {site.programName} fee is {formatINR(site.fee.current)} (reduced from {formatINR(site.fee.original)}), the
        same for every domain.
      </p>

      <h2>Payments</h2>
      <p>
        This website does not process payments. The pre-registration amount, the balance and its due date are
        confirmed by our admissions team for your domain and batch. Payments are made only through the channels
        admissions confirms to you in writing.
      </p>

      <h2>Cancellation and refunds</h2>
      <p>
        Cancellation and refund eligibility, timelines and any deductions are set out in the written terms you receive
        at pre-registration. Please read them before you pay.
      </p>

      <h2>Questions</h2>
      <p>
        Contact <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a> or call{" "}
        <a href={site.contact.phones[0].href}>{site.contact.phones[0].display}</a>.
      </p>
    </PolicyPage>
  );
}
