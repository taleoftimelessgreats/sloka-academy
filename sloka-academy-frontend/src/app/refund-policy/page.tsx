import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/components/PolicyPage";
import { Note } from "@/components/ui";
import { formatINR, paymentPolicy, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Payment & Refund Policy",
  description: "How payments, invoices and refunds work for the Sloka Academy Internship Course Program.",
  alternates: { canonical: "/refund-policy/" },
};

export default function RefundPolicyPage() {
  return (
    <PolicyPage title="Payment &amp; Refund Policy" updated="20 November 2026">
      <Note>{paymentPolicy.join(" ")}</Note>

      <h2>Program fee</h2>
      <p>
        The {site.programName} fee is {formatINR(site.fee.current)} (reduced from {formatINR(site.fee.original)}), the
        same for every domain. The fee agreed with you at registration is the one that applies to you.
      </p>

      <h2>Payments</h2>
      <p>
        Payments are collected exclusively for training purposes. This website does not process payments: the
        registration amount, the balance and its due date are confirmed by our admissions team for your domain and
        batch, and payments are made only through the channels admissions confirms to you.
      </p>

      <h2>Invoices</h2>
      <p>
        After every payment we email you an updated invoice. It lists each payment you have made, the total paid and
        the outstanding balance with its due date. Keep it for your records, and tell us at once if anything on it is
        wrong.
      </p>

      <h2>Cancellation and refunds</h2>
      <p>
        All payments are non-refundable. This includes the registration amount and any instalments, whether or not you
        go on to attend the program. Please be sure of your decision before you pay.
      </p>

      <h2>Questions</h2>
      <p>
        Contact <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a> or call{" "}
        <a href={site.contact.phones[0].href}>{site.contact.phones[0].display}</a>. See also our{" "}
        <Link href="/terms/">Terms &amp; Conditions</Link>.
      </p>
    </PolicyPage>
  );
}
