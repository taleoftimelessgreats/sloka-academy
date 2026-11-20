/**
 * Site-wide configuration. Every external destination lives here so it can be
 * updated in one place and redeployed.
 *
 * Before launch, confirm each value marked CONFIRM with Sloka Academy.
 */

/** NEXT_PUBLIC_API_URL as set at build time: "" (no API), "/" (this domain) or a full URL. */
const apiSetting = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();

/** A Sloka Academy branch. `head`, when set, is shown with the branch on the Contact page. */
export interface Branch {
  /** The area, e.g. "Madhapur". */
  name: string;
  city: string;
  primary: boolean;
  lines: string[];
  mapUrl: string;
  head?: { name: string; role: string; phone: { display: string; href: string }; email: string };
}

export const site = {
  name: "Sloka Academy",
  programName: "Internship Course Program",
  url: "https://www.slokaacademy.com",
  description:
    "Sloka Academy's 2-Month Internship Course Program combines structured learning, practical projects and short-term internship opportunities with certification across 42 domains.",

  /**
   * Internship Course Program fee (INR). Shown as original (struck through) and current.
   */
  fee: {
    original: 14999,
    current: 9999,
  },

  /**
   * Where the forms send to: the Sloka Academy API (sloka-academy-backend: enquiries and session
   * certificates), set at build time. On Vercel the API runs on this site's own domain, so
   * NEXT_PUBLIC_API_URL=/ ; a full URL (e.g. http://localhost:4000) points at a separate server.
   * While unset, the Pre-register, Contact, brochure and certificate forms are not shown and
   * visitors are pointed to phone and email instead, so no data is collected without somewhere
   * to send it. Empty here means "this domain".
   */
  apiUrl: apiSetting.replace(/\/+$/, ""),

  /**
   * CONFIRM: Sloka Academy's academy-specific Teachmint login URL.
   * Leave empty until verified. While empty, the LMS navbar link opens the
   * internal /lms page, which directs learners to support, instead of a
   * broken or generic Teachmint link.
   */
  lmsUrl: "",

  /**
   * CONFIRM: Hosted external pre-registration form URL (e.g. Google Form).
   * While empty, Pre-register actions go to the Contact page enquiry section.
   */
  preRegisterUrl: "",

  contact: {
    phones: [
      { display: "+91 94926 31715", href: "tel:+919492631715" },
      { display: "+91 94926 91715", href: "tel:+919492691715" },
    ],
    email: "info@slokaacademy.com",
    // CONFIRM: WhatsApp enquiry channel. Leave empty to hide.
    whatsapp: "",
    // CONFIRM: support hours, e.g. "Monday to Saturday, 9:30 AM – 6:30 PM IST". Hidden while empty.
    supportHours: "",
    /** Branches, the primary branch first. CONFIRM: map destinations. */
    branches: [
      {
        name: "Barakatpura",
        city: "Hyderabad",
        primary: true,
        lines: ["3-4-493, Flat No. 502", "Om Sri Maa Gayatri Plaza, Barakatpura", "Hyderabad, Telangana 500027"],
        mapUrl: "https://www.google.com/maps/search/?api=1&query=Om+Sri+Maa+Gayatri+Plaza+Barakatpura+Hyderabad+500027",
        head: {
          name: "Sanjay Kumar Surya",
          role: "Director",
          phone: { display: "+91 93470 30881", href: "tel:+919347030881" },
          email: "sanjay@slokaacademy.com",
        },
      },
      {
        name: "Madhapur",
        city: "Hyderabad",
        primary: false,
        lines: [
          "4th Floor, NEA Building, Unit #403",
          "Plot No. 470/471, 100 Feet Road, Ayyappa Society",
          "Madhapur, Hyderabad, Telangana 500081",
        ],
        mapUrl:
          "https://www.google.com/maps/search/?api=1&query=NEA+Building+100+Feet+Road+Ayyappa+Society+Madhapur+Hyderabad+500081",
      },
    ] as Branch[],
  },

  /** CONFIRM: approved social profiles. Empty entries are hidden. */
  social: [
    { label: "Instagram", href: "" },
    { label: "LinkedIn", href: "" },
    { label: "YouTube", href: "" },
    { label: "Facebook", href: "" },
  ],

  /**
   * CONFIRM: legal entity name and registration details for the footer,
   * e.g. { label: "CIN", value: "…" }, { label: "GSTIN", value: "…" }. Hidden while empty.
   */
  legal: {
    entityName: "",
    registrations: [] as { label: string; value: string }[],
  },
} as const;

export const formsEnabled = apiSetting !== "";

/** "A", "A or B", "A, B or C" (conjunction "and" or "or"). */
const joinList = (items: string[], conjunction: "and" | "or") =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;

/** Where to visit, for page copy: e.g. "Barakatpura or Madhapur, Hyderabad". */
export const branchAreas = (conjunction: "and" | "or" = "or") => {
  const { branches } = site.contact;
  const cities = [...new Set(branches.map((b) => b.city))];
  return cities.length === 1
    ? `${joinList(branches.map((b) => b.name), conjunction)}, ${cities[0]}`
    : joinList(branches.map((b) => `${b.name}, ${b.city}`), conjunction);
};
export const branchLabel = (b: Branch) => (b.primary ? "Primary branch" : "Branch");

export const lmsHref = site.lmsUrl || "/lms/";
export const lmsIsExternal = Boolean(site.lmsUrl);
// The on-site form feeds the inquiry dashboard, so it wins over an external form once the API is set.
export const preRegisterIsExternal = Boolean(site.preRegisterUrl) && !formsEnabled;
export const preRegisterHref = preRegisterIsExternal ? site.preRegisterUrl : "/pre-register/";

export const navLinks = [
  { href: "/", label: "Home" },
  { href: "/domains/", label: "Domains" },
  { href: "/internship-course-program/", label: "Internship Course Program" },
  { href: "/about/", label: "About" },
  { href: "/contact/", label: "Contact" },
] as const;

/** The header's "Verify Certificate" button. */
export const verifyLink = { href: "/verify/", label: "Verify Certificate" } as const;

/** Career Guidance Program certificates, in the footer. The form itself is shared by session link or QR code. */
export const certificateLinks = [
  { href: "/certificate/", label: "Career Guidance Certificate" },
  { href: "/verify/", label: "Verify a certificate" },
] as const;

export const policyLinks = [
  { href: "/privacy/", label: "Privacy Policy" },
  { href: "/terms/", label: "Terms & Conditions" },
  { href: "/refund-policy/", label: "Payment & Refund Policy" },
] as const;

/**
 * The payment policy, word for word wherever payments are mentioned (the same clauses are printed on invoices,
 * offer letters and emails: sloka-academy-backend/src/constants.js PAYMENT_POLICY).
 */
export const paymentPolicy = ["All payments are non-refundable.", "Payments are collected exclusively for training purposes."] as const;

/** Prefilled email to admissions, used where the enquiry forms are not available. */
export const enquiryMailto = (subject: string) =>
  `mailto:${site.contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    "Name:\nPhone:\nWhat I studied / am studying:\nDomain I'm interested in:\nMy question:\n",
  )}`;

export const formatINR = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;
export const feeSaving = site.fee.original - site.fee.current;
