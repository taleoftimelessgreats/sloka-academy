# Sloka Academy website

Static, frontend-only website for Sloka Academy's 2-Month Internship Course Program. It is built with Next.js (App Router) and exported as plain HTML/CSS/JS. There is no backend, database, login or payment processing.

## Commands

```bash
npm install
npm run dev            # local development at http://localhost:3000
npm run validate:data  # check the 42-domain catalogue and stream mappings
npm run build          # validates data, writes sitemap, exports static site to out/
npm start              # preview the built out/ folder
```

## Hosting

Upload the contents of `out/` to any static host (Netlify, Vercel, Cloudflare Pages, S3, cPanel, etc.). URLs use trailing slashes (`/domains/vlsi/` → `domains/vlsi/index.html`). Serve `404.html` for missing pages.

## Where content lives

| What | File |
| --- | --- |
| Program fee (original ₹14,999, current ₹9,999), LMS URL, pre-registration URL, phones, email, address, socials, support hours | `src/config/site.ts` |
| Photography (Unsplash, monochrome; replace with the academy's own) | `public/images/` (see `CREDITS.md`) |
| All 42 domains: name, category, stream tags, search aliases, availability, curriculum, fees, batches, brochure | `src/data/domains.ts` |
| Stream filter buttons (order, URL ids, aliases) | `src/data/streams.ts` |
| Program roadmap, pillars, FAQs | `src/data/program.ts` |
| Brochures (PDF) | `public/brochures/` (then set `brochure: "/brochures/<file>.pdf"` on the domain) |
| Logo | `public/brand/` (supplied artwork, unchanged) |

Change the file, run `npm run build`, and redeploy.

### Before launch: values to confirm (search the code for `CONFIRM`)

- **`site.lmsUrl`**: Sloka Academy's academy-specific Teachmint login URL. While it is empty, the **LMS** navbar link opens an internal `/lms/` help page rather than a broken or generic link.
- **`site.preRegisterUrl`**: hosted pre-registration form. While it is empty, Pre-register goes to the Contact page.
- Support hours, WhatsApp, social profiles and the map link.
- The Privacy, Terms and Refund policy text (`src/app/privacy`, `terms`, `refund-policy`).
- Verified team profiles (`src/app/about/page.tsx`).
- Per domain: approved `modules` (session-wise curriculum), `projects`, `prerequisites`, `deliveryMode`, `fees`, `batches`, `brochure`. Set `availability: "open"` only after admissions confirms details. Until then the page shows "Enquire for next batch" and enquiry actions.

## Domain catalogue behaviour

- Ten stream buttons in the brief's order. One stream is active at a time, and clicking it again clears it. **Clear Filters** resets both stream and search.
- Search is case-insensitive and alias-aware (AI/ML, IoT, EEE, ServiceNow, Selenium, …). It is combined with the stream filter using AND.
- State is kept in the URL (`/domains/?stream=pharmacy&q=sas`), so refresh, shared links and the browser Back button restore the view.
- `scripts/validate-data.mjs` checks the following on every build: 42 records, no duplicates, every visible domain has a stream, every stream matches the brief's mapping tables, and the acceptance examples hold.
