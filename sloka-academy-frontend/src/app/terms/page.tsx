import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/components/PolicyPage";
import { paymentPolicy, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "The terms and conditions for Sloka Academy's website, programs, registrations and payments.",
  alternates: { canonical: "/terms/" },
};

// CONFIRM: have these terms reviewed by Sloka Academy's legal adviser.
export default function TermsPage() {
  return (
    <PolicyPage title="Terms &amp; Conditions" updated="20 November 2026">
      <p>
        These terms apply to this website and to registration for {site.name}&rsquo;s programs, including the{" "}
        {site.programName}. By using the website, registering for a program or making a payment, you agree to them. If
        you do not agree, please do not use the website or register.
      </p>

      <h2>Registration</h2>
      <p>
        Registration is completed with our admissions team, who confirm your course domain, batch, the program fee
        and the payment schedule. Your slot is confirmed when the registration amount is received. You are responsible
        for giving accurate details (name, mobile number, email, college); they are printed on your documents.
      </p>

      <h2>Fees and payments</h2>
      <ul>
        {paymentPolicy.map((clause) => (
          <li key={clause}>
            <strong>{clause}</strong>
          </li>
        ))}
        <li>
          The fee agreed at registration, the amounts paid and the balance with its due date are recorded against your
          registration. The balance is payable by the due date confirmed to you.
        </li>
        <li>
          After every payment we email you an updated invoice showing your payment history, the total paid and the
          outstanding balance. Please check it and tell us at once if anything is wrong.
        </li>
        <li>
          Payments are made only through the channels our admissions team confirms to you. This website does not take
          payments.
        </li>
      </ul>
      <p>
        See also our <Link href="/refund-policy/">Payment &amp; Refund Policy</Link>.
      </p>

      <h2>Internship and offer letter</h2>
      <p>
        The internship offered with the program is <strong>unpaid</strong>: no stipend, salary or other remuneration is
        payable. The fee you pay is for training. Your internship offer letter is issued once the program fee has been
        paid in full, and states the internship start date and duration.
      </p>

      <h2>Certificates</h2>
      <p>
        Certificates are issued on meeting the completion requirements of the program or session, and can be checked on
        our <Link href="/verify/">Verify</Link> page. We may revoke a certificate issued in error or obtained with
        false details.
      </p>

      <h2>No guarantee of outcomes</h2>
      <p>
        The {site.programName} includes training, a short-term internship opportunity and certification on meeting
        completion requirements. It does not guarantee employment, paid internships or placement. Career roles shown on
        domain pages are illustrative. Company names mentioned anywhere are not hiring partnerships unless stated as
        such.
      </p>

      <h2>Information on this website</h2>
      <p>
        We aim to keep domain descriptions, program structure and other details accurate and up to date. Curricula,
        batch dates, internship arrangements and certification details are confirmed by our admissions team at the time
        of registration and may change. Where the website and written confirmation from admissions differ, the written
        confirmation applies.
      </p>

      <h2>Conduct</h2>
      <p>
        Learners are expected to follow the academy&rsquo;s guidelines, respect mentors and fellow learners, and keep
        confidential any project material shared with them. We may suspend access for misconduct; fees are not
        refunded in that case.
      </p>

      <h2>Your information</h2>
      <p>
        How we handle your details is set out in our <Link href="/privacy/">Privacy Policy</Link>.
      </p>

      <h2>External services</h2>
      <p>
        Links to the learning platform (Teachmint), maps, social networks or external forms take you to services we do
        not control. Their terms and privacy policies apply.
      </p>

      <h2>Intellectual property</h2>
      <p>
        The {site.name} name, logo, course material, brochures and website content belong to {site.name}. Do not copy,
        share or reuse them without permission.
      </p>

      <h2>Changes and governing law</h2>
      <p>
        We may update these terms; the date above shows the latest version. These terms are governed by the laws of
        India, and the courts at Hyderabad, Telangana have jurisdiction.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a> or{" "}
        <a href={site.contact.phones[0].href}>{site.contact.phones[0].display}</a>.
      </p>
    </PolicyPage>
  );
}
