import type { Metadata } from "next";
import { PolicyPage } from "@/components/PolicyPage";
import { formsEnabled, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description: "How the Sloka Academy website handles information.",
  alternates: { canonical: "/privacy/" },
};

// CONFIRM: have this notice reviewed and approved by Sloka Academy before launch, including
// requirements under India's Digital Personal Data Protection Act (DPDP) with a legal adviser.
export default function PrivacyPage() {
  return (
    <PolicyPage title="Privacy Notice" updated="31 October 2026">
      {formsEnabled ? (
        <>
          <p>
            This notice explains how {site.name} handles information when you use this website. The website has no
            user accounts or payment pages. It has a few short forms: Pre-register, Contact, the form you fill in before
            downloading a brochure, and the Career Guidance Certificate form.
          </p>

          <h2>Information you give us through our forms</h2>
          <p>
            Each form asks for your name, mobile number and email, and depending on the form, your stream, college,
            year of study, the domain and plan you are interested in, and your question. We also record which form you
            used, when you sent it and that you agreed to this notice. We collect nothing else through the forms.
          </p>

          <h2>Career guidance certificates</h2>
          <p>
            The certificate form asks for the name to print on your certificate, your email, mobile number and
            college, optionally your stream and year of study, and the session you attended. We use these details to
            issue your certificate, email it to you and answer questions about it. Each certificate has an ID. Anyone
            who has that ID can confirm on our Verify page that the certificate is genuine; the check shows your name,
            the session and its date, and the certificate itself as it was printed.
          </p>
          <p>
            If you have also enquired about one of our programs, we keep both in a single student record, so that our
            staff see your full history with us.
          </p>

          <h2>Referring a friend</h2>
          <p>
            The certificate form asks you to refer one to three friends by giving each friend&rsquo;s name, mobile
            number and college. Please do this only if your friend has agreed; you confirm that they have before sending
            the form. Referred friends do not receive a certificate. Our admissions team uses these details only to contact your friend about upcoming {site.name}{" "}
            sessions, and records that you referred them. If a friend does not want to hear from us, they can tell us
            when we call, or email <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>, and we will
            delete their details.
          </p>

          <h2>Why we use it</h2>
          <p>
            Only for the purpose you gave it for: to respond to your enquiry (to call or email you, advise you on the
            program and domains, and manage your pre-registration if you ask us to), to issue and verify your
            certificate, or to invite a friend you referred to our sessions. We do not sell your details or share them with other organisations for their marketing.
          </p>

          <h2>Who can see it</h2>
          <p>
            Your details are stored in an internal system that only {site.name} staff can access, each with their own
            login. Certificate registrations and referred friends are also copied to a Google Sheet that only{" "}
            {site.name} staff can open, and certificates are sent through our email provider.
          </p>
          {/* CONFIRM with the legal adviser (DPDP review): name the email provider and Google as processors if required. */}

          <h2>How long we keep it, and your choices</h2>
          <p>
            We keep your details only for as long as we need them for these purposes. You can ask us at any time to
            show you, correct or delete the details we hold about you by emailing{" "}
            <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>, and we will delete them on request.
          </p>

          <h2>Searching the website</h2>
          <p>
            Searching or filtering domains happens in your browser and is not sent to us. Your search and filter
            choices may appear in the page address so that you can refresh or share the page.
          </p>
        </>
      ) : (
        <>
          <p>
            This notice explains how {site.name} handles information when you use this website. The website is an
            informational site: it has no user accounts, contact forms or payment pages.
          </p>

          <h2>Information we collect on this website</h2>
          <p>
            This website does not ask you to submit personal information. Searching or filtering domains happens in
            your browser and is not sent to us. Your search and filter choices may appear in the page address so that
            you can refresh or share the page.
          </p>
        </>
      )}

      <h2>When you contact us</h2>
      <p>
        If you call, email or use an external pre-registration or enquiry link, the information you choose to share
        is received by our admissions team (or by the external service you use) and used to respond to your enquiry
        and manage registration. External services have their own privacy terms.
      </p>

      <h2>Learning platform</h2>
      <p>
        The LMS link takes you to our learning platform hosted by Teachmint. Login, course access and learner data on
        that platform are handled by Teachmint under its own terms. This website never asks for your LMS login
        details.
      </p>

      <h2>Hosting and technical data</h2>
      <p>
        Like most websites, our hosting provider may record standard technical information (such as IP address,
        browser type and pages requested) in server logs for security and reliability.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions, email <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>.
      </p>
    </PolicyPage>
  );
}
