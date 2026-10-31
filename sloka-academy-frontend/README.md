# Sloka Academy website

Website for Sloka Academy's 2-Month Internship Course Program, built with Next.js (App Router) and exported as plain HTML/CSS/JS. There is no payment processing.

Everything runs on one domain:

| Path | What |
| --- | --- |
| `/` and the other pages | The website (this Next.js app) |
| `/login/` | Login page: students to the LMS, staff to the admin portal |
| `/admin/` | Staff admin portal (`public/admin`, a vanilla-JS app; noindex) |
| `/api/...` | The Sloka Academy API (`../sloka-academy-backend`), run by the Vercel Function in `api/index.mjs` |

The Pre-register, Contact and brochure forms send enquiries to that API (see [Enquiry forms](#enquiry-forms)).

## Commands

```bash
npm install
npm run dev            # local development at http://localhost:3000 (forwards /api to the API on :4000)
npm run validate:data  # check the domain catalogue, stream mappings, plans and showcase data
npm run build          # validates data, writes sitemap, exports static site to out/
npm start              # preview the built out/ folder
```

## Hosting (Vercel)

`vercel.json` deploys the website, the admin portal and the API as one project: it builds the static site into `out/`, sends `/api/*` to the function in `api/index.mjs` (Tokyo region, next to the database), adds security headers to `/admin/`, and redirects paths without a trailing slash (`/domains/vlsi` → `/domains/vlsi/`). Project settings and environment variables are listed in `../sloka-academy-backend/README.md` → *Deploying on Vercel*; the key one here is `NEXT_PUBLIC_API_URL=/`.

**Local development** runs two servers: the API (`npm run dev` in `../sloka-academy-backend`, port 4000) and this site (`npm run dev`, port 3000). The site forwards `/api` to the API, so http://localhost:3000/admin/ is the portal, as on the live site.

Without the API, `out/` is still a complete static site for any static host (URLs use trailing slashes; serve `404.html` for missing pages), with the forms switched off.

## Where content lives

| What | File |
| --- | --- |
| Program fee (original ₹14,999, current ₹9,999), LMS URL, pre-registration URL, phones, email, address, socials, support hours | `src/config/site.ts` |
| Photography (Unsplash, monochrome; replace with the academy's own) | `public/images/` (see `CREDITS.md`) |
| All 42 domains: name, category, stream tags, search aliases, availability, curriculum, fees, batches, brochure | `src/data/domains.ts` |
| Stream filter buttons (order, URL ids, aliases) | `src/data/streams.ts` |
| Program roadmap, pillars, FAQs | `src/data/program.ts` |
| Student reviews, sample certificate, recognitions, program and stream brochures | `src/data/showcase.ts` |
| Legal entity name and registration numbers (footer) | `src/config/site.ts` (`legal`) |
| Brochures (PDF) | `public/brochures/` (then set `brochure: "/brochures/<file>.pdf"` on the domain, plan or stream) |
| Logo | `public/brand/` (supplied artwork, unchanged) |

Change the file, run `npm run build`, and redeploy.

### Content that waits for Sloka Academy

The homepage sections for reviews, certification and brochures only publish real content. While a list in `showcase.ts` is empty, that section is **left out of the built site**, and `npm run dev` shows a dashed "To be confirmed" panel in its place listing exactly what is needed. The program has one fee (`site.fee`), the same for every domain.

- **Reviews** need written permission on file (`permissionOnFile: true`). Reviews are quoted exactly as published, with their source, rating and month; add the link to the original when there is one.
  - The reviews section labels every one "Student testimonial", gives it a dashed border and no stars, and its intro says samples are not from real students.
  - Keep them free of outcome claims (jobs, placements, salaries).
  - Replace them with genuine reviews as those come in, or switch them all off with `SHOW_STUDENT_TESTIMONIALS = false`.
- **Student reviews section:** rows of review cards scroll in opposite directions. The rows pause on hover or focus. Visitors who prefer reduced motion get still, swipeable rows.
- **Sample certificate:** `SAMPLE_CERTIFICATE` in `showcase.ts`. The image is in `public/certificates/`.
- **Program brochure:** `PROGRAM_BROCHURE` in `showcase.ts`, with the PDF in `public/brochures/`. The "Take the details with you" section shows the brochure form, and the Download brochure button appears once the details are sent.
- `npm run validate:data` fails the build if an image or brochure file is missing, a domain id is unknown, or a plan has inconsistent prices.

## Enquiry forms

The Pre-register page (`/pre-register/`), the Contact page and the brochure downloads post to the Sloka Academy API. Set where it is at build time:

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=/  (this domain; `npm run dev` forwards /api to :4000)
```

The same backend runs the career guidance session certificates:

- **`/certificate/`**: students pick the session they attended (sessions open for registration are loaded from the API), enter the code announced at the end of the session, and download their PDF certificate straight away. `/certificate/?session=<id>` preselects a session, for links or QR codes shown at the session; the dashboard shows this link for each session.
- **`/verify/`**: anyone can check a certificate ID (printed on each certificate as `/verify/?id=…`). It shows only the name, session, date and whether the certificate is valid or revoked.

Both pages are linked from the footer, not the header, which keeps the live site's menu.

With `NEXT_PUBLIC_API_URL=/` the forms call `/api` on the same domain, so no CORS setup is needed. A full URL (another server) must be in that server's `ALLOWED_ORIGINS`. While `NEXT_PUBLIC_API_URL` is unset, no form is shown: Pre-register and Contact offer phone and email instead, brochures download directly, and the Privacy Notice keeps its "no forms" wording. Every form has a consent checkbox linked to the Privacy Notice.

### Before launch: values to confirm (search the code for `CONFIRM`)

- **`site.lmsUrl`**: Sloka Academy's academy-specific Teachmint login URL. While it is empty, the LMS option on the **Login** page opens an internal `/lms/` help page rather than a broken or generic link.
- **`site.preRegisterUrl`**: optional hosted pre-registration form, used only while the inquiry dashboard is not connected. Otherwise Pre-register goes to `/pre-register/`.
- **`NEXT_PUBLIC_API_URL`**: `/` on Vercel, where the API runs on the same domain (see [Enquiry forms](#enquiry-forms)).
- Everything in `src/data/showcase.ts`, and `site.legal`.
- The Privacy Notice wording for the forms, including requirements under India's Digital Personal Data Protection Act, with a legal adviser.
- Support hours, WhatsApp, social profiles and the map link.
- The Privacy, Terms and Refund policy text (`src/app/privacy`, `terms`, `refund-policy`).
- Verified team profiles (`src/app/about/page.tsx`).
- Per domain: approved `modules` (session-wise curriculum), `projects`, `prerequisites`, `deliveryMode`, `fees`, `batches`, `brochure`. Set `availability: "open"` only after admissions confirms details. Until then the page shows "Enquire for next batch" and enquiry actions.

## Domain catalogue behaviour

- Ten stream buttons in the brief's order. One stream is active at a time, and clicking it again clears it. **Clear Filters** resets both stream and search.
- Search is case-insensitive and alias-aware (AI/ML, IoT, EEE, ServiceNow, Selenium, …). It is combined with the stream filter using AND.
- State is kept in the URL (`/domains/?stream=pharmacy&q=sas`), so refresh, shared links and the browser Back button restore the view.
- `scripts/validate-data.mjs` checks the following on every build: 42 records, no duplicates, every visible domain has a stream, every stream matches the brief's mapping tables, and the acceptance examples hold.
