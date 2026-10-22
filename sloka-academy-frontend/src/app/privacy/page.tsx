import type { Metadata } from "next";
import { PolicyPage } from "@/components/PolicyPage";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description: "How the Sloka Academy website handles information.",
  alternates: { canonical: "/privacy/" },
};

// CONFIRM: have this notice reviewed and approved by Sloka Academy before launch.
export default function PrivacyPage() {
  return (
    <PolicyPage title="Privacy Notice" updated="22 October 2026">
      <p>
        This notice explains how {site.name} handles information when you use this website. The website is an
        informational site: it has no user accounts, contact forms or payment pages.
      </p>

      <h2>Information we collect on this website</h2>
      <p>
        This website does not ask you to submit personal information. Searching or filtering domains happens in your
        browser and is not sent to us. Your search and filter choices may appear in the page address so that you can
        refresh or share the page.
      </p>

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
