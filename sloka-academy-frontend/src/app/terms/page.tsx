import type { Metadata } from "next";
import { PolicyPage } from "@/components/PolicyPage";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms for using the Sloka Academy website.",
  alternates: { canonical: "/terms/" },
};

// CONFIRM: have these terms reviewed and approved by Sloka Academy before launch.
export default function TermsPage() {
  return (
    <PolicyPage title="Terms of Use" updated="22 October 2026">
      <p>
        By using this website you agree to these terms. If you do not agree, please do not use the website.
      </p>

      <h2>Information on this website</h2>
      <p>
        We aim to keep domain descriptions, program structure and other details accurate and up to date. Curricula,
        fees, batch dates, internship arrangements and certification details are confirmed by our admissions team at
        the time of registration and may change. Where the website and written confirmation from admissions differ,
        the written confirmation applies.
      </p>

      <h2>No guarantee of outcomes</h2>
      <p>
        The {site.programName} includes short-term internship opportunities and certification on meeting completion
        requirements. It does not guarantee employment, paid internships or placement. Career roles shown on domain
        pages are illustrative. Company names mentioned anywhere are not hiring partnerships unless stated as such.
      </p>

      <h2>External services</h2>
      <p>
        Links to the learning platform (Teachmint), maps, social networks or external forms take you to services we
        do not control. Their terms and privacy policies apply.
      </p>

      <h2>Intellectual property</h2>
      <p>
        The {site.name} name, logo, brochures and website content belong to {site.name}. Do not copy or reuse them
        without permission.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>.
      </p>
    </PolicyPage>
  );
}
