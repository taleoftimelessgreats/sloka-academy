# Sloka Academy — API

The API behind the Sloka Academy website and its staff admin portal. It does these jobs:

1. **Career Guidance Certificate form**: students who attended a career guidance session fill in the form on the website (`/certificate/`) with the session code. The certificate of participation is issued immediately: they download it on the spot, it is **emailed to them as a PDF**, and the registration is **copied to a Google Sheet**. Anyone can verify a certificate by its ID.
2. **Master student database**: every career guidance registration and every Internship Course Program enquiry is linked to one student record with its own **Student ID** (e.g. `SLK-STU-2026-00042`). Students are matched by email or mobile number, so a returning student is never added twice and staff see each student's full history.
3. **Internship enquiries**: `POST /api/public/inquiries` receives the Pre-register (Internship Course Program), Contact and Brochure-download forms. This process is separate from the certificate form; the two only share the student records.
4. **Internship registrations** by the BD team: each registration is checked against the student master (mobile number and email), records the committed fee and the token amount, and keeps a **payment ledger** with the balance, the due date and the payment status (Slot Confirmed → Partially Paid → Fully Paid, with an Overdue flag). See [Internship registrations](#internship-registrations).
5. **Offer letters**: an Internship Offer Letter (PDF, ID `SLK/OL/2026/0001`), issued once the student's fee is fully paid with the internship start date the associate enters, on the built-in letterhead or an uploaded template, downloaded or emailed to the student. See [Offer letters](#offer-letters).
6. **Admin portal**: a small vanilla-JS app (ES modules, no build step) that is part of the website (`sloka-academy-frontend/public/admin`, served at `/admin/`, sign in at `/admin/#/login`); this server provides its API. Who may do what is set per role on the **Roles & permissions** screen and enforced by the API. See [Roles & permissions](#roles--permissions) and [Associates](#associates).

This server serves **API routes only** (`/api/...`); anything else is a JSON 404. Staff reach the portal from the website's Sign in page (`/login/`). Every response carries `X-Robots-Tag: noindex, nofollow`, and the website's `robots.txt` disallows `/admin/` and `/api/`.

On Vercel the website, the portal and this API run as **one project on one domain**: see [Deploying on Vercel](#deploying-on-vercel).

Stack: Node ≥ 22.13 (developed on 24), Express 5, a MySQL-compatible database (TiDB Cloud) through `mysql2`, `bcryptjs`, `jsonwebtoken`, `nodemailer`, `pdf-lib` (PDFs) and `pdfjs-dist` (reading placeholders in uploaded PDFs; the `@napi-rs/canvas` it installs renders a page to pick the colours of covers and letters). Word and PowerPoint templates are converted to PDF in the staff member's browser before they are uploaded (`sloka-academy-frontend/public/admin/convert/`), so no conversion service is needed. There is no build step.

## Setup

```bash
npm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
# set DATABASE_URL and JWT_SECRET in .env (generate the secret with the command below)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npm run create-admin          # prompts for name, email, password (input hidden)
npm run dev                   # API on http://localhost:4000 (or: npm start)
```

Then start the website (`npm run dev` in `sloka-academy-frontend`), open http://localhost:3000/admin/ and sign in. The website forwards `/api` to this server, as Vercel does in production. `.env` is loaded with Node's built-in `process.loadEnvFile`. Real environment variables take precedence over it.

## Database

The data lives in a MySQL-compatible database, set by `DATABASE_URL`: `mysql://USER:PASSWORD@HOST:PORT/DATABASE`. The project uses TiDB Cloud Serverless (Tokyo, port 4000).

- **First start.** The server creates the database if it does not exist and creates the tables. Later schema changes are added to `MIGRATIONS` in `src/db.js` and applied on start.
- **Database name.** Use a database of the app's own, e.g. `sloka_academy`. The server refuses built-in schemas such as `sys` or `mysql`.
- **Encryption.** Connections use TLS and verify the server certificate. Only a database server on your own machine may turn this off, with `?ssl=false`.
- **Text matching.** Text compares without regard to letter case (`utf8mb4_general_ci`). Searches, email matching and the unique keys treat `Asha@X.com` and `asha@x.com` as the same.
- **Uploaded designs.** Certificate design files are stored in 2 MB parts (`certificate_template_files`), because TiDB holds at most 6 MiB in one row.
- **Transactions.** A transaction is retried automatically after a deadlock or write conflict.
- **Latency.** Every query is a round trip to the database, so host the server in or near the database's region (AWS `ap-northeast-1`). From India each round trip is about 125 ms.

**Creating the first Super Admin.** `npm run create-admin` prompts for the details. Git Bash/mintty has no interactive TTY, so there you either run it from PowerShell/cmd or pass the values as environment variables:

```bash
ADMIN_NAME="Anita" ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-long-password' npm run create-admin
```

Everyone else is added under **Associates** in the portal, and receives an invite (see [Associates](#associates)). Migration 4 made the portal's original admins Super Admins.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `DATABASE_URL` | none, **required** | `mysql://USER:PASSWORD@HOST:PORT/DATABASE`. See [Database](#database). |
| `TEST_DATABASE_URL` | the server in `DATABASE_URL` | Database server for `npm test`. See [Tests](#tests). |
| `JWT_SECRET` | none, **required** | ≥ 32 chars. The server refuses to start without it. |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated **other** origins allowed to call the public endpoints (exact match). Pages on the API's own domain are always allowed. |
| `TRUST_PROXY` | off (`1` on Vercel) | Set behind a reverse proxy: `1` (number of hops), `loopback`, or proxy IPs. Needed for correct client IPs in rate limiting. |
| `DASHBOARD_URL` | `http://localhost:3000/admin/` | Public URL of the staff portal (part of the website). Used for links in team notifications and associate invites. Production: `https://www.slokaacademy.com/admin/`. |
| `PUBLIC_API_URL` | origin of `DASHBOARD_URL` | Base URL that serves this API, used in emailed certificate download links: the website, which forwards `/api`. Only set it if students should see a different hostname. |
| `NODE_ENV` | | `production` turns on `Secure`/`__Host-` cookies and HSTS |
| `TZ` | system | Set to `Asia/Kolkata` so "today", "overdue" and certificate dates follow Indian dates |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_FROM` | | Outgoing email. With these five set, students are emailed their certificate PDF on registration. Port 465 uses implicit TLS; other ports require STARTTLS. For Google Workspace/Gmail use `smtp.gmail.com`, port `465`, and an [app password](https://support.google.com/accounts/answer/185833). |
| `NOTIFY_TO` | | Team address(es) for new-enquiry emails (needs the five SMTP variables too) |
| `NOTIFY_WEBHOOK_URL` | | Optional Slack/Google Chat incoming webhook for new enquiries. Receives `{"text": "..."}`. |
| `CERT_ID_PREFIX` | `SLK` | Certificate ID prefix, 2–8 letters/digits: `SLK-2026-7K4M9Q2X` |
| `STUDENT_ID_PREFIX` | `SLK` | Student ID prefix, 2–8 letters/digits: `SLK-STU-2026-00042`. Changing it does not change IDs already given out. |
| `CERT_VERIFY_URL` | `https://www.slokaacademy.com/verify/` | Website verify page. Certificates print `<CERT_VERIFY_URL>?id=<ID>`. |
| `CERT_SIGNATORY_NAME`, `CERT_SIGNATORY_TITLE` | | Optional signatory printed on certificates. If unset, the footer just says "Sloka Academy". |
| `SITE_URL` | `https://www.slokaacademy.com` | Public website. Staff see the student link `<SITE_URL>/certificate/?session=<id>`. |

When neither email nor a webhook is configured, the server logs one line per new enquiry. Notifications contain the name, source, stream, domain, plan and a dashboard link. They never contain the enquirer's message, phone or email. Notifications are fire-and-forget: a failure never affects the public request.

## Public API contract

`POST /api/public/inquiries` with `Content-Type: application/json` and a body of at most 10 kb.

| Field | Rules |
|---|---|
| `source` | required: `pre-register` \| `contact` \| `brochure` |
| `name` | required, trimmed, 2–100 chars |
| `phone` | required. Non-digits are stripped; a 12-digit number starting `91` or an 11-digit number starting `0` keeps its last 10 digits. Must match `^[6-9]\d{9}$`. Stored as `+91XXXXXXXXXX`. |
| `email` | required, valid, ≤ 254 chars, stored lowercased |
| `college` | ≤ 150 |
| `stream` | `computer-science` `management` `pharmacy` `life-sciences` `civil` `mechanical` `electronics` `eee` `commerce` `more` |
| `yearOfStudy` | `year-1` … `year-5` `graduated` `working` |
| `domain` | ≤ 80 (display name, e.g. `VLSI`) |
| `plan` | `basic` \| `premium` \| `undecided` |
| `brochure` | ≤ 200. Stored only when `source` is `brochure`. |
| `message` | ≤ 2000 |
| `consent` | required, must be boolean `true`. The server stores the consent timestamp. |
| `website` | honeypot. If non-empty, the response is `201 {"ok":true}` but nothing is stored or notified. |

Optional fields sent as empty strings count as not provided. Unknown keys are ignored.

Responses:

- `201 {"ok":true}` (the record id is never returned), or `201 {"ok":true,"verification":{…}}` when the email or mobile number belongs to a student whose other details differ (see [Profile verification](#profile-verification-website))
- `400 {"error":"validation","fields":{"name":"…"}}`
- `400 {"error":"invalid_json"}` for malformed JSON
- `413` when the body is too large
- `415` when the request is not JSON
- `429 {"error":"rate_limited"}`: at most 20 submissions per IP per 10 minutes (students on one college network share an IP), in memory, with a `Retry-After` header
- `403 {"error":"origin_not_allowed"}` when an `Origin` header is present but not allow-listed

### Profile verification (website)

When a registration or enquiry needs verification (see [Master student database](#master-student-database)), its 201 response includes:

```json
"verification": { "token": "…32 hex…", "codeSent": true, "sentTo": "r•••@gmail.com", "expiresAt": "2026-10-30T06:49:17.879Z", "reason": null }
```

`reason` says why no code was sent when `codeSent` is false: `no_email`, `email_limit`, `email_off` or `email_failed`. The form never learns which details differ.

- `POST /api/public/profile-verifications/:token/verify` `{ "code": "123456" }`: `200 {"status":"verified","studentId":"SLK-STU-…"}`, `400 {"error":"wrong_code","attemptsLeft":n}`, `410 {"error":"expired"}`, `409 {"error":"locked"}` (too many wrong codes; staff decide), `409 {"error":"closed"}`, `404`.
- `POST /api/public/profile-verifications/:token/resend`: `200 {"verification":{…}}`, `429 {"error":"too_soon","retryAfter":s}` (one code a minute), `409 {"error":"resend_limit"}` (3 codes in all).
- Both are limited to 30 requests per IP per 10 minutes.

### Daily email limit

The server sends at most **5 emails per recipient address per day**, whatever they are for: certificates, re-sends, verification codes and team notifications. Every email passes through one check in `src/notify.js` (`src/emailQuota.js`, table `email_quota`). The count is per address in any letter case, and resets at local midnight. An email over the limit is not sent:
- a certificate email is marked failed, with the reason, and can be sent again the next day;
- a verification code is not sent (`reason: "email_limit"`);
- an "already registered" re-send is skipped (`emailed: false`).

An email that fails to send does not count. The limit is `emailDailyLimit` in `src/config.js`.

CORS applies only to the `/api/public/*` routes (this one and the certificate routes below). It reflects allow-listed origins, allows `GET, POST, OPTIONS` and the `Content-Type` header, and never allows credentials. All rate limits are constants in `src/config.js`.

## Roles & permissions

Every API route checks one permission, `<module>.<action>` (`src/permissions.js`): the modules are internship registrations, payments, offer letters, offer letter templates, the course master, the student master, enquiries, sessions, certificates, certificate designs, settings, associates, roles & permissions and the audit log; the actions are View, Create, Edit, Delete and Export (where they mean something). Hiding a button in the portal is never the protection: the API refuses (403) whatever the role does not allow.

Roles are rows in the database, edited by Super Admins on the **Roles & permissions** screen (a grid of every permission against every role). They start as:

| Module / action | Super Admin | Admin | BD Manager | BD Associate | Accounts |
|---|---|---|---|---|---|
| Register students | ✓ | ✓ | ✓ (team) | ✓ (own) | — |
| View registered students | All | All | Team | Own | All |
| Edit fee/payment after submission | ✓ | ✓ | — | — | ✓ |
| Record later payments | ✓ | ✓ | — | — | ✓ |
| Export student data | ✓ | ✓ | Team | — | ✓ |
| Manage associates | ✓ | ✓ (not Super Admins) | — | — | — |
| Manage offer letter templates | ✓ | ✓ | — | — | — |
| Generate/send offer letters | ✓ | ✓ | Team | Own | — |
| Roles & permissions | ✓ | — | — | — | — |

Admin also has every other module (students, enquiries, sessions, certificates, designs, settings, audit log). BD Managers and BD Associates also work enquiries. The portal's two original roles are kept as roles too: **Manager** (sessions, certificate designs, revoking certificates, settings, associates below them, enquiries) and **Counsellor** (enquiries; views students, sessions and certificates).

- **Data scope** (per role): *own* records, *team* records (theirs and everyone who reports to them, directly or not, through **Reporting manager**: every associate assigned to a manager is in their team) or *all*. It is applied on the server, the same way everywhere (`src/scope.js`):
  - internship registrations (by BD Associate), with their payments, offer letters, insights and the export;
  - enquiries assigned to (or entered by) someone in scope, and unassigned enquiries, which are new leads anyone may pick up; enquiries can only be assigned within the scope;
  - the student master: students with a registration or enquiry in scope;
  - the overview's numbers, and the associate filters and pickers (`GET /api/staff` marks who is `inScope`).

  A record outside the scope is "not found", and filtering for someone outside it finds nothing.
- **Enquiry data → View** (`enquiries.view`) and **Participant (student) data → View** (`students.view`) decide who sees those people's details, wherever they appear. Every enquiry route needs the first (as well as its own action, export included), and so do a student's enquiries on their profile and the friends a participant referred. Every student master route needs the second, and so do the certificates (the participants' records: list, details, PDFs, exports), session participant exports and the overview's latest participants. Internship registrations are the BD team's own records and keep their own permission; the duplicate check when registering shows the matching student, as the registration form requires.
- **Super Admin** always has every permission and sees everything; it cannot be restricted. At least one active Super Admin must remain.
- **Custom roles** can be created (optionally starting from another role's permissions), renamed and deleted when no associate has them. The five roles of the requirements cannot be deleted.
- **Per-associate overrides**: a Super Admin can grant or revoke single permissions for one associate on top of their role.
- **No escalation**: an associate can give someone a role, or manage an associate, only if every permission of it is one they hold themselves. Only Super Admins manage Super Admins.
- Changes to roles and overrides apply to signed-in associates at once (permissions are read on every request). Changing an associate's role signs them out.

`GET /api/auth/me` and the login response include `role`, `roleName`, `permissions`, `scope` and `mustChangePassword`.

## Associates

Associates are the people who can sign in to the portal (formerly "users"). **Add Associate** takes full name, employee ID, official email, mobile, department (BD/Sales, Operations, Accounts, …), designation, role, reporting manager (optional) and date of joining.

- On save the login is created with a random **temporary password** and an invite is emailed to the official email with the portal link. If email is not configured or fails, the portal shows the temporary password once to the person who added them.
- At first sign-in (and after **Reset password**, which works the same way) every API call except `/api/auth/*` answers `403 password_change_required` until they choose their own password.
- **Deactivating** revokes access at once (they are signed out everywhere and cannot sign in) and keeps everything: registrations stay tagged to them. Associates are never deleted. Only active associates can sign in.
- Email and employee ID are unique. A reporting manager is an active associate and never someone who reports to this associate (no loops).

## Audit log

`audit_log` records who changed what, when, and the old → new values: role and permission changes, per-associate overrides, associates (added, edited, deactivated, password reset), fees, due dates, BD reassignments and payments, student master edits and creations, verification decisions, certificate design and offer letter template uploads and changes, course master changes, the offer letter signatory, the Google Sheet connection, and every permanent deletion. Entries are written in the same transaction as the change. The portal shows it under **Audit log** (permission `audit.view`), filterable by what changed, who and when.

## Staff API (same-origin, cookie session)

The session is an httpOnly, `SameSite=Strict` cookie holding an 8-hour JWT. The associate is re-loaded from the database on every request, with their role's permissions and overrides, so deactivating them, changing their role or permissions, or resetting their password takes effect immediately. Failed logins are limited to 5 per email+IP and 30 per IP every 15 minutes. State-changing requests from another site are refused with 403, based on `Sec-Fetch-Site` and `Origin`.

"Needs" is the permission the route checks (see [Roles & permissions](#roles--permissions)); *signed in* means any associate.

| Method & path | Needs | Notes |
|---|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/password` | signed in | Login body: `{email, password}`. Password change: `{currentPassword, newPassword}` (also ends the temporary-password state). |
| `GET /api/meta` · `GET /api/staff` | signed in | Labels/enums (including roles and whether email works); associates for pickers and filters, each with `inScope` (within the user's data scope), and the user's `scope` |
| `GET /api/stats` | signed in | The overview, each part only with its permission and within the data scope: enquiry pipeline (`enquiries.view`), `students` and `pendingVerifications` (`students.view`), `certificates` (`certificates.view`) and `recentRegistrations` (with `students.view`), `sessions` (`sessions.view`), `registrations` totals (`registrations.view`), `openRegistrationFlags` (`students.edit`), `system` (`settings.view`) |
| `GET /api/students` | `students.view` | Master student list. Filters: `q` (name/email/phone/college/Student ID), `program` (`career-guidance`\|`internship`), `stream`, `yearOfStudy` (`none` = not specified), `sessionId`, `sort` (`recent`\|`name`\|`created`), `page`, `pageSize` ≤ 100 |
| `GET /api/students/:id` | `students.view` | `{student, certificates, enquiries, verifications}`. `student.programs` holds the programme tags; `student.registrations` counts internship registrations. `enquiries` is `null` (and `student.latestEnquiryStatus` absent, here and in the list) without `enquiries.view`. Every student route also needs `students.view`. |
| `GET /api/verifications?status=open\|closed\|all` · `GET /api/verifications/:id` | `students.view` | Records waiting for profile verification |
| `POST /api/verifications/:id/resolve` | `students.create` / `students.edit` | `{action}`: `link` or `new_profile` (`students.create`), `update` (accept the submitted details: `students.edit`). Logged. |
| `PATCH /api/students/:id` | `students.edit` | Master details: `name`, `email`, `phone`, `college`, `gender`, `dateOfBirth`, `qualification`, `specialization`, `stream`, `yearOfStudy`, `graduationYear`, `city`, `state`. The email and mobile number must not belong to another student. Every change is logged old → new. |
| `DELETE /api/students/:id` | `students.delete` | Permanent erasure of the student and **all** their registrations, certificates, internship registrations (with payments and offer letters) and enquiries |
| `GET /api/students/export` | `students.export` | CSV with the list filters |
| `GET /api/inquiries` | `enquiries.view` | Filters: `status`, `source`, `stream`, `plan`, `yearOfStudy` (`none` = not specified), `assignedTo` (`id`\|`me`\|`none`), `followUp` (`today`\|`overdue`\|`due`), `q`, `sort` (`createdAt`\|`updatedAt`\|`nextFollowUp`\|`name`\|`status`), `dir`, `page`, `pageSize` ≤ 100 |
| `POST /api/inquiries` | `enquiries.create` | Manual `phone-call` / `walk-in` enquiry. `consent: true` confirms the enquirer agreed. |
| `GET /api/inquiries/:id` · `PATCH /api/inquiries/:id` | `enquiries.view` · `enquiries.edit` | PATCH accepts status, assignedTo, nextFollowUp (`YYYY-MM-DD`/null) and the contact/interest fields. Each change is appended to the timeline. |
| `POST /api/inquiries/:id/notes` | `enquiries.edit` | `{body}`. Notes are append-only. |
| `GET /api/inquiries/export` | `enquiries.export` | CSV with the same filters as the list. See below. |
| `DELETE /api/inquiries/:id` | `enquiries.delete` | Permanent erasure of the enquiry and its notes (logged). Every enquiry route also needs `enquiries.view`. |
| `GET /api/associates` · `GET /api/associates/:id` | `associates.view` | Associates with role, department, reporting manager, status and last sign-in; the detail includes the permission overrides for those with `roles.view` |
| `POST /api/associates` | `associates.create` | Add Associate (fields above). Returns `invite: {emailed, error?, tempPassword?}` (the password only when it could not be emailed). |
| `PATCH /api/associates/:id` | `associates.edit` (`active`: `associates.delete`) | Any of the fields, or `{active}`. Nobody changes their own role or deactivates themselves; one active Super Admin remains. |
| `POST /api/associates/:id/reset-password` | `associates.edit` | New temporary password, emailed (or returned as above); signs them out |
| `PUT /api/associates/:id/permissions` | `roles.edit` | `{overrides: {"module.action": true\|false}}` (true grants, false revokes; absent = from the role) |
| `GET /api/roles` | `roles.view` | The modules, actions and scopes, and every role with its permissions, scope and number of associates |
| `POST /api/roles` · `PATCH /api/roles/:key` · `DELETE /api/roles/:key` | `roles.edit` | `{name, description?, scope, permissions}`. Super Admin's permissions cannot change; built-in roles and roles in use cannot be deleted. |
| `GET /api/audit` | `audit.view` | Filters: `entity`, `entityId`, `actorId`, `from`, `to` (dates), `page` (50 a page). Also returns the `entities` with their labels. |

All CSV exports are built for Excel: UTF-8 with a BOM, CRLF line endings and human-readable labels. Any cell starting with `= + - @`, a tab or a CR is prefixed with `'` to block formula injection. Phones are exported as the 10-digit national number (`9492631715`), so Excel shows them as-is.

"Due today" and "overdue" use the server's local date and exclude enquiries that are `enrolled` or `not-interested`. Conversion counts use each enquiry's current status.

## Internship registrations

The BD team registers students for the Internship Course Program under **Registrations** (`POST /api/registrations`). The form has two parts:

- **Student details** (saved to the student master): full name, mobile number, email, gender, date of birth, college/university, qualification, specialization, year of study, year of graduation, city and state. Mobile number, email, name and college are required.
- **Enrollment** (one per registration; a student can have several, e.g. different course domains): course domain (from the course master), batch / internship start date, the **committed program fee** (negotiated per student), the **registration (token) amount** with payment mode, transaction reference and date, the balance due date, the BD Associate (the person registering; those with `registrations.edit` can register for someone else) and remarks.

**Duplicate check.** As the mobile number and email are typed, the portal asks `GET /api/registrations/lookup` for master records with them. A match shows a dialog (name, masked mobile, email, college, earlier enrollments): **"Is this the same student?"**
- **Yes:** the student's details are filled in from the master record and locked; the new enrollment is linked to their Student ID (`studentId` in the request). The master record is not changed (blank email or mobile fields are filled).
- **No:** registration is blocked; the associate must re-verify the number and email with the student, and the conflict is flagged for an admin (`POST /api/registrations/flags`, reviewed under **Registrations → conflicts** by those with `students.edit`).
- The server checks again on submit: a known mobile number or email without a confirmed `studentId` gets `409 student_exists` with the matches.

**Rules.** The token amount is more than ₹0 and at most the committed fee. While a balance remains a balance due date is required, on or after the registration date. A later payment cannot be more than the balance or dated in the future. The fee cannot be lowered below what has been paid. Amounts are stored in paise.

**Status.** *Slot Confirmed* once the token is paid, *Partially Paid* after a later instalment, *Fully Paid* when nothing remains; **Overdue** is a flag on top while a balance remains after the due date. The registration date is recorded by the system.

**Registered students.** The list is searchable (name, mobile, email, Student ID) and filters by course domain, BD Associate (only the associates in the user's scope: a manager sees their team), payment status, registration period (quick picks: today, last 7 days, this month, last month, last 30 days, this quarter, this financial year, or custom dates) and due date range, with **Due this week** and **Overdue** views and a CSV export (`registrations.export`).

**Insights** above the list come from the same filters (`GET /api/registrations/insights`), so they always describe the registrations below them: registrations by payment status, fees committed and collected (with the collection rate), outstanding and overdue amounts, balances due this week, offer letters issued and fully paid students still waiting for one, and, when a period is chosen, the payments received in it (whenever the student registered). Managers and admins also see the same figures **per associate**, to compare individual and team performance. The student profile page shows the master details, every enrollment in scope and each enrollment's payment ledger, where later payments are recorded (`payments.create`) and fees, dates, payments and the BD Associate corrected (`registrations.edit`, logged old → new).

The **course master** (Settings → Course master) holds the course domains with the internship duration printed on offer letters and, optionally, each domain's offer letter template. It starts with the website's domains.

| Method & path | Needs | Notes |
|---|---|---|
| `GET /api/registrations` | `registrations.view` | Filters: `q`, `courseId`, `bdAssociateId`, `status` (`slot-confirmed`\|`partially-paid`\|`fully-paid`\|`overdue`), `view` (`due-week`\|`overdue`), `regFrom`, `regTo`, `dueFrom`, `dueTo`, `sort` (`recent`\|`due`\|`name`\|`balance`), `page`, `pageSize`. Within the data scope. |
| `GET /api/registrations/insights` | `registrations.view` | The list's filters → `{insights: {registrations, committed, collected, outstanding, collectionRate, fullyPaid, partiallyPaid, slotConfirmed, dueThisWeek, overdue, overdueAmount, offerLetters, awaitingOfferLetter, byAssociate: [...]}, views: {all, dueThisWeek, overdue}, received: {amount, payments, from, to} \| null}`. Within the scope. |
| `GET /api/registrations/export` | `registrations.export` | CSV with the list filters, within the scope |
| `GET /api/registrations/lookup?phone=&email=` | `registrations.create` | Master records with that mobile number or email (masked mobile, email, college, enrollments, the other master details) |
| `POST /api/registrations` | `registrations.create` | `{studentId?, student: {...}, enrollment: {...}}`. Errors are keyed `student.<field>` / `enrollment.<field>`. The offer letter follows once the fee is fully paid. |
| `GET /api/registrations/students/:studentId` | `registrations.view` | Student profile: master details and the enrollments in scope with payments and offer letter |
| `GET /api/registrations/:id` · `PATCH /api/registrations/:id` · `DELETE /api/registrations/:id` | `registrations.view` · `.edit` · `.delete` | PATCH: `courseId`, `batchStartDate`, `fee`, `balanceDueDate`, `bdAssociateId`, `remarks`. DELETE removes its payments and offer letter. Logged. |
| `POST /api/registrations/:id/payments` | `payments.create` | `{amount, paymentMode, transactionReference?, paidOn?, balanceDueDate?}` Emails the updated invoice; the response has `invoiceEmail` (`sent`\|`failed`\|`off`). |
| `GET /api/registrations/:id/invoice/pdf` · `POST …/invoice/send` | `registrations.view` · and one of `payments.create`, `registrations.create`, `registrations.edit` | The up-to-date invoice (`?inline=1` to view); email it again |
| `PATCH /api/registrations/:id/payments/:paymentId` · `DELETE …` | `registrations.edit` | Correct a payment, or remove a later one (the token payment stays). Logged. |
| `GET /api/registrations/flags?status=` · `POST /api/registrations/flags/:id/resolve` | `students.edit` | Conflicts associates flagged |
| `POST /api/registrations/flags` | `registrations.create` | `{name, phone, email, note?}` |
| `GET /api/courses` · `POST /api/courses` · `PATCH /api/courses/:id` | `courses.view` (or registering) · `.create` · `.edit` | `{name, duration, active, offerTemplateId}` |

## Invoices and the payment policy

Every registration has an **invoice** (`SLK/INV/<year>/<number>`, counted per year, never reused; `src/invoices.js`, `src/invoicePdf.js`). Its PDF, on the same letterhead as the offer letter, is drawn from the payment ledger each time it is asked for, so it always shows who it is billed to, **every payment** (date, description, mode, reference, amount), the **total paid** and the **outstanding balance** with its due date (or "paid in full").

- It is emailed to the student **at registration and after every later payment**, with the totals in the email. A correction or removal of a payment does not email by itself: staff send the corrected invoice from the student's profile, where it can also be downloaded. The last email's status (sent, or failed with the reason) is kept with the registration.
- Without email configured nothing is sent; staff download the invoice and share it.
- It is a statement of fees and payments, not a GST tax invoice: it shows no GSTIN or tax breakdown.

**The payment policy** (`PAYMENT_POLICY` in `src/constants.js`; the website's copy is `paymentPolicy` in `sloka-academy-frontend/src/config/site.ts`): "All payments are non-refundable." and "Payments are collected exclusively for training purposes." It is printed on invoices, in the invoice and offer letter emails, in the offer letter's terms, shown in the portal where a payment is taken, and on the website (Terms & Conditions, Payment & Refund Policy, the program fee and pre-register pages). The website's Privacy Policy (`/privacy/`), Terms & Conditions (`/terms/`) and Payment & Refund Policy (`/refund-policy/`) are linked from every page's footer, every form's consent, the portal's footer, and (the terms) invoices and emails.

## Offer letters

A registration's **Internship Offer Letter** is issued only once the fee is **fully paid** (the outstanding balance is zero): until then **Send offer letter** is unavailable and the API answers `409 balance_due`. When the associate sends it, the portal asks for the **internship start date** (required, not before the registration date), which is printed on the letter. The letter offers an **unpaid internship** in the course domain, with a **Certificate of Internship** on completing and submitting the assigned project. Offer letter IDs are `SLK/OL/<year>/<number>`, counted per year and never reused.

- **The built-in design** (`src/offerLetterPdf.js`): a corporate letterhead (brand stripe, the Sloka logo in ink for white paper, the academy's official address, HR email, optional phone and website), the reference and date under an accent rule, a faint logo watermark, and a footer with "a unit of Slifax Private Limited", the reference and page numbers. The default letter: private and confidential, the student's name, Student ID and college, the title, the offer, a shaded **internship details** panel (domain, commencement date, duration, unpaid, certificate on completion), what the internship involves, the terms (unpaid; guidelines, timelines, confidentiality), how to accept (by writing to the HR email, quoting the reference) and the signatory. One A4 page.
- The letterhead's address, HR email and phone are set in Settings → Offer letter templates → Letterhead (defaults: the primary branch at Barakatpura, `hr@slokaacademy.com`).
- A letter keeps a snapshot of what it says (the values, the text, the layout and the letterhead's contacts); its PDF is rendered from it on demand, on the same engine as the certificates. **Regenerate** refreshes it with the current details, template, signatory and letterhead, keeping its ID; the date becomes today.
- The emailed letter comes with a short note: the domain and start date, and how to accept.
- Delivery: download as PDF, or email it to the student (PDF attached). The status (*Generated*, *Sent*, *Failed* with the reason) and every event are recorded with timestamps.
- Placeholders: `{{student_name}}`, `{{student_id}}`, `{{course_domain}}`, `{{college_name}}`, `{{internship_start_date}}`, `{{internship_duration}}`, `{{offer_date}}`, `{{offer_letter_id}}`, `{{signatory_name}}`, `{{signatory_designation}}`, `{{hr_email}}`. In the letter text, `**text**` prints in bold and a blank line starts a paragraph; a line starting with `# ` is the title and `## ` a section heading, rows written `| Label | Value |` make a details panel, and a line with `---` leaves space (for a signature).
- **Templates** (Settings → Offer letter templates): the built-in Sloka letterhead with the default text, a text-only template on the letterhead, or an uploaded PDF, Word (.docx) or PowerPoint (.pptx) file (as certificate designs). On an uploaded letterhead the text is printed within margins set as percentages of the page. An uploaded PDF that **is** the letter (its own text with placeholders) needs no text of ours: its placeholders are filled in (all its pages are used). New templates are inactive until their placeholders are mapped and they have been previewed with sample data and activated. One template is the default; a course domain can have its own. Templates used by letters or course domains cannot be deleted.
- The signatory is set once in Settings (defaults to `CERT_SIGNATORY_NAME` / `CERT_SIGNATORY_TITLE`).

| Method & path | Needs | Notes |
|---|---|---|
| `GET /api/registrations/:id/offer-letter` · `GET …/offer-letter/pdf` | `offerLetters.view` | The letter with its log; the PDF (`?inline=1` to view) |
| `POST /api/registrations/:id/offer-letter/generate` · `POST …/send` | `offerLetters.create` | `{startDate}` (required). Fully paid registrations only (`409 balance_due` otherwise). Generate or regenerate (same ID); send emails it, regenerating it first if there is none or the start date changed. |
| `GET /api/offer-templates` | `offerTemplates.view` | Templates, the built-in text and layout, the placeholder fields, the signatory |
| `POST /api/offer-templates?name=…` · `POST /api/offer-templates/text` | `offerTemplates.create` | Upload a file (raw body, as certificate designs); or `{name, body?}` for text on the letterhead |
| `PATCH /api/offer-templates/:id` | `offerTemplates.edit` | `{name?, body?, layout?, active?}` |
| `PUT /api/offer-templates/default` · `PUT /api/offer-templates/signatory` · `PUT /api/offer-templates/letterhead` | `offerTemplates.edit` | `{id}` (null = built-in); `{name, designation}`; `{address (a line each, up to 4), email, phone?}` (logged) |
| `POST /api/offer-templates/preview` | `offerTemplates.view` | `{templateId?, body?, layout?}` → sample letter stamped PREVIEW |
| `POST /api/offer-templates/:id/placeholders` · `GET …/file` · `DELETE …/:id` | `offerTemplates.edit` · `.view` · `.delete` | Find placeholders again; the original file; delete an unused template |

## Placeholders in uploaded templates

A certificate design or offer letter template may already contain placeholders: text such as `{{Student Name}}`, `<<Certificate ID>>`, `«College»`, `[[Date]]`, `[Session Title]` or `{Course}`.

**Formats.** Only files whose text can be searched for placeholders: PDF, Word (.docx) and PowerPoint (.pptx). Images (PNG, JPEG, WebP, …) are refused: they have no text to find placeholders in. The server takes PDFs only and checks the file's own bytes, whatever the browser calls it (`src/certificateTemplates.js`); it refuses Word and PowerPoint files sent to it directly, and older .doc and .ppt files, with what to do.

**Word and PowerPoint files** are converted to PDF in the staff member's browser when they upload them, by the portal's converter (`sloka-academy-frontend/public/admin/convert/`), so nothing is sent to another service. The browser lays out each page (Word, with `docx-preview`) or slide (PowerPoint, drawn from `pptxtojson`'s description of it), `html2canvas` draws it as a picture, and `pdf-lib` puts the picture on a PDF page of the same size with an **invisible text layer**: every line of text where it is on the page, in a standard PDF font of the same size, squeezed or stretched to the same width. The server finds the placeholders in that text like in any PDF; the upload's `source` (`docx`, `pptx`) is kept so the portal can say what a template was converted from. The converter runs on a page of its own, in a hidden frame, because the renderers need inline styles that the portal's Content-Security-Policy refuses; `vercel.json` gives that page a policy of its own (scripts still only from the site). Its libraries are copied from `node_modules` into `public/admin/vendor/` by `scripts/copy-admin-vendor.mjs` before every build. Notes: pages are pictures (about 240 dpi; coarser when needed to stay under the upload limit), so their text cannot be selected; fonts the browser does not have are replaced by similar ones, so check the preview; Word documents are paged where Word last paged them (saved in the file), and a page that comes out longer than its paper is cut between lines; PowerPoint charts, video and audio are left out.

**Finding and mapping.** On upload the server reads the PDF's text layer with pdf.js (`src/placeholders.js`), finds each placeholder, where it is and its size and font (bold and italic too), and suggests the system field it means from its name (`Participant Name` → student name, `cert_no` → certificate ID, `Date of Joining` → internship start date, and so on). The portal then **asks staff to map every placeholder** before anything else: each one is given a field, or marked as not a placeholder. Until that mapping is confirmed (`layout.placeholdersConfirmed`), a certificate design cannot be the default or be given to a session, and an offer letter template cannot be activated or made the default. Placeholders found again later (**Find placeholders again**) are asked about the same way. The editor then fine-tunes each placeholder's font, size, colour and alignment.

When a document is made, each mapped placeholder is covered and its value printed in its place, in the colour of the placeholder's own letters (sampled from a rendering of the page when the template is scanned; editable):
- a placeholder on a line of its own is replaced where it is and may grow (a long name stays whole, shrinking only to fit); it is centred when it is centred on the page and alone on its line, otherwise it starts where the placeholder did;
- a placeholder inside a sentence has its line **set again** with the values in place, so `for attending [Session Title] on <<Date>>` reflows instead of a long title running into the words after it. A centred line is set again whole; in left-aligned text (a line starting at a left edge it shares with other lines, such as a margin or a table column) only from the first placeholder on, so the words before it stay as designed. The words keep the line's font and colour; each value has its placeholder's font and colour (a bold course name stays bold, the sentence around it does not become bold);
- a value never runs into the next text on the same line (`Ref: <<Ref No>>        Date: …`): it shrinks to fit before it;
- the cover is a box in the colour around the placeholder (white when the page cannot be rendered).

Limits: nothing is found in PDFs whose text was turned into outlines (place the details with the layout editor instead). Certificate designs uploaded as images before images were refused still work, with the layout editor. Values are printed in the standard PDF fonts (Helvetica, Times, Courier). The placeholder's original text stays in the PDF underneath the cover: it is invisible, but can show when the PDF's text is copied.

## Master student database

The `students` table holds one profile per student. Each career guidance registration and each enquiry is its own record, with its own details and timestamps, and points to a profile (`student_id`). A profile can have any number of them. Its **programme tags** come from those records: certificate registrations are Career Guidance, enquiries are the Internship Course Program (`PROGRAMS` in `src/constants.js`).

Each email and each mobile number belongs to at most one profile, which unique indexes enforce. A new registration or enquiry is compared with the profiles that have its email or its mobile number (`src/studentMatch.js`). Names, colleges and emails are compared without regard to letter case or extra spaces, and fields left blank on the form are not compared.

- **No match:** a new profile with a new Student ID.
- **Same details:** the record is linked to that profile. Fields the profile was missing are filled in; nothing is overwritten.
- **Different details** (e.g. another name or college, or a new email with a known number): the profile is **not** changed and the record is not linked yet. It is saved as **pending verification**:
  - A 6-digit code is emailed to the address **already on the profile**, and the website form asks for it. With the right code the profile takes the submitted details and the record is linked.
  - Codes expire after 10 minutes. After 5 wrong codes, or when no code could be sent, the record stays pending for staff. A code can't be sent when the profile has no email, email is off, or the address reached its daily limit.
  - Staff see waiting records under **Students → Profile verification** and on the record itself, side by side with the profile. Staff with `students.create` decide: link it and keep the profile as it is, or, for a different person, give it a profile and Student ID of its own; linking it and taking the submitted details edits a profile, so it needs `students.edit`. Decisions are logged. An email or number that belongs to the existing profile stays with it.
- **The email belongs to one profile and the number to another:** the record waits for verification against the email's profile.

A few other cases:
- A session gives one certificate per person: registering again with the same email, or the same mobile number under another email, gets the "already registered" answer.
- Staff cannot give a profile an email or mobile number that another student already has.
- Editing an enquiry's contact details changes the enquiry only, never the profile. If the edited details now point to a different student, the enquiry waits for verification.
- Correcting a certificate's email in the portal links it to the student with that email, without changing their profile. If the old address was only ever used by that registration (a typo), the profile's email is corrected instead.
- Deleting the last registration or enquiry of a student also deletes the empty profile. Deleting a student deletes everything linked to them. Records from other people that were waiting to be verified against that profile get profiles of their own.

**Student IDs** look like `SLK-STU-2026-00042`: the prefix, the year the student was first seen and a number that counts up within that year. A new student gets one in the same transaction that creates their record; students from before Student IDs existed get one when the server starts. Numbers are never reused, even after an erasure, and an ID never changes. It is shown in the portal, searchable on Students, included in the CSV exports and the Google Sheet, returned to the student after a certificate registration (`certificate.studentId`, null while the registration waits for verification) and printed in the certificate email.

## Career guidance certificates

Staff create a **session** (title, date, venue, in-person/online, optional closing time, optional certificate design). Each session gets a 6-character code from an alphabet without look-alikes (no 0/O/1/I/L), or staff who run sessions set their own (6–20 letters/digits). The code is announced at the end of the session. A student who enters the correct code on the website gets their certificate **immediately**; there is no approval step.

Each session has two student links (shown on the session's page in the portal): `/certificate/?session=<id>` opens the form with the session selected, and `/certificate/?session=<id>&code=<code>` also fills in the code. Anyone who has the second link can get a certificate, so share it (or a QR code of it) only at the end of the session.

The website form works in two steps. First it sends the registration with `preview: true`: the server checks it exactly as it would a registration (fields, session, code, an earlier registration) and answers with the certificate as it would be printed, stamped **PREVIEW** and with `SLK-<year>-XXXXXXXX` in place of the ID. Nothing is stored. The student checks their name and confirms, and the form sends the same registration again without `preview`, which issues the certificate. The website then shows the issued certificate (`/certificates/:id/preview`) with the download button. The Verify page shows the same view of the certificate under a successful check (stamped REVOKED if it was withdrawn).

After a successful registration the server, in the background:

1. generates the PDF and **emails it as an attachment** (with a personal download link and the verify link) when SMTP is configured. Each registration records the email status: `sent`, `failed` (with the mail server's reason), `pending` or `off` (email not configured). Failed emails show on the Overview; staff can correct the address and send again, and those with `certificates.edit` can resend all failed ones at once;
2. **appends a row to the Google Sheet** connected in Settings (see below).

### Refer a friend

The certificate form has a required **Refer a friend** section: one to three friends from other colleges, each with a full name, mobile number and college (all required). Each friend becomes a new enquiry with source **Referral** (status *New*) that points back at the registration (`inquiries.referred_by`), so the admissions team works them like any other lead: assign, follow up, note, filter by source and export.

- The student must confirm that their friends agreed to be contacted (`referralConsent: true`); that moment is the enquiry's consent time.
- A friend's number must be a valid Indian mobile, different from the student's own and from the other friends'. A registration without a friend, or with a friend's field left empty, is refused (400). A repeat registration (409) adds no friends.
- Referred friends get **no certificate** and no certificate ID: only the student who registered with the session code does.
- Referred friends get **no student profile**: they have not filled in a form, so nothing is created or changed from what someone else typed. A profile is linked the usual way if staff later edit the friend's contact details or the friend registers themselves.
- The registration's page lists the friends it referred with their status; each referral enquiry shows who referred them. The enquiries CSV has a **Referred by** column. Erasing the registration (or the student) keeps the friends' enquiries but removes the link to the student who referred them.

The PDF is generated on demand from the database, so a name correction takes effect on the next download.

### Certificate designs (templates)

Certificate artwork is uploaded in **Settings → Certificate designs** (`certTemplates.*`): a PDF, Word or PowerPoint file (its first page is used) of up to 4 MB. A PDF with placeholders has them found and mapped (see [Placeholders in uploaded templates](#placeholders-in-uploaded-templates)). Otherwise, in the layout editor staff choose where each detail is printed (student name, college, session title, session date, venue, issue date, certificate ID, verification link, Student ID) by position (% across and down the page), size, standard PDF font, colour, alignment, maximum width (long text shrinks to fit) and optional text before it, with a live PDF preview.

- One design is the **default** for new certificates; until one is chosen, the built-in Sloka design is used. A session can pick a different design.
- Each certificate **keeps the design it was issued with**, even if the default changes later. Editing a design's layout changes how its issued certificates look when downloaded again (the portal warns about this).
- Designs used by certificates or sessions cannot be deleted, only archived.
- Uploaded files are checked: real PDF content, not password-protected, a usable first page.

### Google Sheets

Registrations are copied to a Google Sheet through a small **Apps Script** that lives in the sheet itself. The script runs as the sheet's owner, so there is no Google Cloud project, service account or key file, and the sheet's sharing can stay **Restricted** to staff. (Link sharing does not help: Google's Sheets API never lets a server write to a sheet without signing in, whatever the sharing settings.) One-time setup, by an admin:

1. In the portal, open **Settings → Google Sheet** and click **Copy script**. The script contains a secret the server generated; only admins can see it.
2. Open the Google Sheet, then **Extensions → Apps Script**. Replace the code there with the script.
3. **Deploy → New deployment → Select type: Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then **Deploy** and allow access. (Google may warn that the app isn't verified: it is your own script, so choose **Advanced → Go to …**.)
4. Copy the **Web app URL** (it ends in `/exec`) into Settings and click **Connect**. The portal checks it straight away and shows the sheet's name.

"Anyone" means anyone can *call* the web app, but the script refuses every request without the secret, and the secret travels in the request body, never in the URL. If you edit the script later, deploy it again with **Deploy → Manage deployments → Edit → Version: New version**; the URL stays the same.

The script keeps two tabs, each with a header row:

- **Career Guidance Registrations**: one row per registration (submitted at, certificate ID, name on certificate, email, phone (10 digits), college, stream, year of study, session, session date, venue, mode, student ID).
- **Referrals**: one row per friend a student referred (referred at, the friend's name, phone and college, who referred them with their phone and college, their certificate ID, the session, and the enquiry ID in the portal).

Every value is written as plain text, so nothing is interpreted as a formula, number or date. The script skips rows whose certificate ID (or enquiry ID) is already in the tab, so a retry never duplicates a row.

- Registrations made before a sheet is connected are copied when it is connected. The script reports which spreadsheet it belongs to, and rows are tracked per spreadsheet: moving the script to a **different** sheet copies everything there too, and reconnecting the same sheet sends nothing twice. A sheet filled by the earlier service-account version continues where it left off.
- New registrations are copied within a couple of seconds. Rows that fail (Google unavailable, wrong secret, web app not shared with "Anyone") are retried; after a configuration error the server waits 10 minutes between automatic retries. **Sync now** retries immediately. Settings shows the last sync, rows waiting and the last error, with what to fix.
- Rows are only ever **added**. Corrections, revocations and deletions made in the portal are not written back to the sheet. When a student asks for their data to be deleted, delete their rows in the sheet as well.

No Google library is used: the server POSTs JSON to the web app with `fetch` (`src/sheets.js`, which also holds the script's source).

### Public certificate API (website)

| Route | Notes |
|---|---|
| `GET /api/public/sessions` | `200 {"sessions":[{"id","title","date","venue","mode"}]}`: sessions open for registration whose closing time (if any) is in the future, newest date first. The code is never included. |
| `POST /api/public/certificate-registrations` | JSON ≤ 10 kb: `sessionId`, `code`, `name` (2–80, English/Latin-1 letters, space `.` `'` `-`), `email`, `phone` (same rule as enquiries), `college` (≤ 150), optional `stream`/`yearOfStudy`, `consent: true`, `website` honeypot. `referrals`: 1–3 `{name, phone, college}`, all required (see [Refer a friend](#refer-a-friend)), with `referralConsent: true`; errors are keyed `referrals.<index>.<field>`. With `preview: true` nothing is stored: `200 application/pdf` (inline, stamped PREVIEW) when everything checks out, otherwise the same 400/409/429 answers as a registration. |
| `GET /api/public/certificates/:id/verify` | `200 {"id","status":"valid"\|"revoked","name","sessionTitle","sessionDate","issuedAt"}` or `404 {"error":"not_found"}`. The ID is case-insensitive. Limited to 60/min per IP. |
| `GET /api/public/certificates/:id/preview` | The certificate as issued, for showing with a verification: `200 application/pdf` inline (stamped REVOKED if revoked), `404 {"error":"not_found"}`. No token: anyone with the ID can already verify it. Not counted as a download; shares the PDF rate limit. |
| `GET /api/public/certificates/:id/pdf?token=…` | For plain navigation. `200 application/pdf` as an attachment, `Cache-Control: no-store`. A bad or missing token gives `404`; a revoked certificate gives `410` (plain text). Each student download is counted. |

Registration responses:

- `201 {"certificate":{"id","name","sessionTitle","sessionDate","issuedAt","downloadPath"},"emailing":bool}`, where `downloadPath` is `/api/public/certificates/<id>/pdf?token=<token>` and `emailing` says whether the PDF is being emailed.
- `201 {"ok":true}` for the honeypot. Nothing is stored.
- `400 {"error":"validation","fields":{…}}`. A wrong code, an unknown or closed session, and a name the PDF fonts can't print each have a dedicated message.
- `409 {"error":"already_registered","emailed":bool}` when this email has already registered for the session. The existing certificate is never returned. If email is configured, the certificate is emailed again to the address on file with a new download link (at most once per 10 minutes per certificate). `emailed` reports whether email is on.
- `429 {"error":"rate_limited"}`. Limits per IP: 300 registration attempts per 10 minutes, generous because a whole college shares one IP, and **100 wrong codes per 15 minutes**. After that, all attempts from that IP are refused until the window passes.

**Certificate IDs** look like `SLK-2026-7K4M9Q2X`: the prefix, the issue year and 8 random Crockford base32 characters. They are not sequential.

**Download tokens** are 32 random bytes. Only their SHA-256 is stored, compared in constant time. Rotating a token disables the old link.

The team is **not** notified about certificate registrations.

### Staff API

| Method & path | Needs | Notes |
|---|---|---|
| `GET /api/sessions` · `GET /api/sessions/:id` | `sessions.view` | Includes the code, the registration count, `templateId`, `studentLink` and `studentLinkWithCode` (the form link with `&code=`, which fills in the code) |
| `POST /api/sessions` · `PATCH /api/sessions/:id` | `sessions.create` · `sessions.edit` | `{title, sessionDate, venue, mode, description, code, registrationOpen, closesAt, templateId}`. Title and venue must be printable in the PDF fonts. `templateId: null` = the default design. |
| `POST /api/sessions/:id/regenerate-code` | `sessions.edit` | |
| `DELETE /api/sessions/:id` | `sessions.delete` | `409 has_registrations` if any student registered. Close registration instead. |
| `GET /api/sessions/:id/export` | `sessions.export` | CSV of that session's registrations |
| `GET /api/certificates` | `certificates.view` | `q` (name/email/phone/college/certificate ID), `sessionId`, `studentId`, `status` (`issued`\|`revoked`), `emailStatus` (`sent`\|`failed`\|`pending`\|`off`), `page`, `pageSize` |
| `GET /api/certificates/:id` · `GET /api/certificates/:id/pdf` | `certificates.view` | Detail with the activity log. The staff PDF copy is not counted as a download, and is watermarked if revoked. |
| `POST /api/certificates/:id/resend` | `certificates.view` | Emails the PDF again with a new download link (the old link stops working). Returns `result: "sent"\|"failed"`. Needs SMTP. |
| `POST /api/certificates/retry-emails` | `certificates.edit` | `202 {queued}`: resends every valid certificate whose email failed, in the background |
| `PATCH /api/certificates/:id` | `certificates.edit` | `{name?, email?}`. Corrections are logged old → new. |
| `POST /api/certificates/:id/revoke` · `POST /api/certificates/:id/reinstate` | `certificates.edit` | Revoking requires `{reason}`. |
| `DELETE /api/certificates/:id` | `certificates.delete` | Permanent erasure of the registration and its activity log (logged) |
| `GET /api/certificates/export` | `certificates.export` | CSV of all certificates, with the list filters |
| `GET /api/templates` | `certTemplates.view` (or creating/editing sessions) | Designs (without files), field/font lists, the placeholder fields, `builtInIsDefault` |
| `POST /api/templates?name=…&source=…` | `certTemplates.create` | Upload: the raw PDF as the body (`Content-Type: application/pdf`); `source` (`docx`\|`pptx`) when the portal converted it. Returns `placeholdersFound`; the design's `sourceType` keeps `source`. `400 fields.file` explains rejected files; `413` over 4 MB (Vercel refuses request bodies over 4.5 MB). |
| `GET /api/templates/:id` · `GET /api/templates/:id/file` | `certTemplates.view` | Detail with layout; the original file |
| `POST /api/templates/:id/placeholders` | `certTemplates.edit` | Find the placeholders in the file again, with suggested fields (nothing is saved) |
| `PATCH /api/templates/:id` | `certTemplates.edit` | `{name?, layout?, archived?}`. `layout.placeholders` holds the mappings. Errors come back per field, e.g. `fields["name.x"]`, `fields["placeholders.0.field"]`. |
| `PUT /api/templates/default` | `certTemplates.edit` | `{id}`, or `{id: null}` for the built-in design |
| `POST /api/templates/preview` | `certTemplates.view` | `{templateId?, layout?}` → sample certificate PDF (unsaved layouts allowed) |
| `DELETE /api/templates/:id` | `certTemplates.delete` | `409 in_use` if certificates or sessions use it (archive instead) |
| `GET /api/settings` | `settings.view` | Google Sheet status (web app URL, sheet name and link, rows waiting, last sync/error) and email status |
| `GET /api/settings/google-sheet/script` | `settings.edit` | `{script}`: the Apps Script to paste into the sheet (contains the shared secret) |
| `PUT /api/settings/google-sheet` | `settings.edit` | `{url}`: the web app URL ending in `/exec` (empty disconnects). Returns `check: {ok, title}` or `{ok: false, message}`. |
| `POST /api/settings/google-sheet/test` · `POST /api/settings/google-sheet/sync` | `settings.view` | Check access; copy waiting rows now |

`GET /api/stats` returns `certificates`: `openSessions`, `registrationsThisWeek` (since Monday, server time), `issuedTotal` (all-time, including revoked), `revoked`, `emailed`, `emailFailed`, `emailPending` and `recent` activity.

## Tests

```bash
npm test
```

The suite uses `node:test` and the global `fetch` against the app on an ephemeral port.
- **Database.** Each test file gets a new database named `sloka_test_…`, which is dropped when the file finishes; databases left by a crashed run are dropped after two hours. The database named in the URL is never touched.
- **Server.** The tests use the server in `TEST_DATABASE_URL`, or else the one in `DATABASE_URL`.
- **Speed.** Against TiDB Cloud from India the suite takes about two minutes. A local TiDB is much faster:

```bash
docker run -d --name tidb -p 4000:4000 pingcap/tidb:v8.5.3
TEST_DATABASE_URL='mysql://root:@127.0.0.1:4000/sloka?ssl=false' npm test
```

- Enquiries: submission, every validation rule, the honeypot, CORS, rate limits, 401/403 rules, login, updates and notes, stats, CSV escaping, deletion, deactivation and CSRF.
- Certificates: session listing, wrong and right codes, duplicates, name rules, honeypot, verification, PDF tokens, revoke and reinstate, name and email correction, the failed-code limiter, role checks, session deletion, CSV export, the emailed PDF, failed emails and resending.
- Students: matching across sessions and enquiries (by email and by phone), Student IDs, programme tags, filters, profile edits, CSV export, erasure, and the database's own rules (the seeded roles and course master, one profile per email and per number).
- Profile verification and email: same details link without changes, different details wait (wrong, expired and resent codes, locking after 5 wrong codes), staff decisions and who may make them, staff edits, erasure of a profile others were waiting on, and the daily email limit (5 per address of any kind, failed sends not counted, daily reset, team notifications included).
- Designs: layout validation, uploads (PDF; images and junk refused; empty pages, oversized files), previews, the default and per-session designs, issued certificates keeping their design, archive/delete rules.
- Google Sheets: web app URL parsing, and syncing through the real Apps Script source run against a fake spreadsheet (tabs and headers, back-fill, new rows, referred friends, plain-text values, no duplicates on resend), the wrong-secret, private-deployment and missing-URL errors and retry, and who may see the script.
- Refer a friend: required friends and fields, referral enquiries linked to the registration without profiles or certificates, no duplicates on a repeat registration, the CSV column, and erasure.
- Certificate previews: the PREVIEW PDF before issuing stores nothing and is checked like a registration; the issued certificate's view (also when revoked) and not found.
- Roles & permissions: the default matrix, custom roles applying at once at the API, data scope (a Manager on Team records sees only their team's registrations, insights, enquiries and students, finds nothing when filtering for others, and assigns enquiries only within the team; the associate list marks the team), Super Admin locked, built-in and in-use roles kept, the audit log's access and filters, and enquiry and participant data shown only with Enquiry data → View and Participant (student) data → View (certificates, session exports, referred friends, a student's enquiries, the overview). The original Manager role keeps its powers and cannot escalate.
- Associates: Add Associate with the emailed invite, the forced password change, unique email and employee ID, reporting-manager loops, deactivation, reset password (emailed or shown once), Super Admin protection, per-associate overrides, all logged.
- Internship registrations: validation (mobile and email, token, due date), the duplicate check (lookup, 409 on an unconfirmed match, confirming an existing student, flagging a conflict), payments and the status flow, overpaying, corrections and their audit entries, own/team/all scope (lists, profiles, PDFs and exports), Due This Week and Overdue, filters and search, insights that follow the filters (period, associate, both, views, payments received in the period, per associate), the offer letter (refused while a balance is due, the required start date, download, regenerate with the same ID, email sent and failed), CSV export and deletion, erasure, and the invoice (emailed at registration and after each payment with the totals and the policy, its PDF showing the ledger as it is, resending, a failed email, numbering).
- Templates and placeholders: field suggestions, placeholders found in a certificate design (alone and inside sentences, cover colour, fonts) and printed on issued certificates, images, offer letter templates (text-only, uploaded complete letters, preview, activation rules), which template a letter uses (course, default, built-in) and the signatory; mapping confirmed before a template can be used; images, and Word and PowerPoint files sent without the portal's conversion, refused with what to do; a converted Word letter (a picture of the page with an invisible text layer): its placeholders, their colours and covers, left-aligned lines, a value stopping before the next text on its line, and the filled-in preview.

## Deploying on Vercel

The website project (`sloka-academy-frontend`) deploys everything under one domain:

| Path | What | Where it comes from |
|---|---|---|
| `/`, `/domains/`, `/login/` … | The website | Next.js static export (`out/`) |
| `/admin/` | Staff portal | `sloka-academy-frontend/public/admin` |
| `/api/…` | This API | Vercel Function `sloka-academy-frontend/api/index.mjs`, which runs `src/serverless.js` |

`sloka-academy-frontend/vercel.json` holds the settings (build, output folder, the `/api` rewrite, security headers for `/admin/`, Tokyo region next to the database). In the Vercel project:

1. **Root Directory**: `sloka-academy-frontend`, with **Include files outside the root directory in the Build Step** on (the function uses this folder).
2. **Environment Variables** (Production and Preview):
   - `NEXT_PUBLIC_API_URL` = `/` (the forms send to this same domain)
   - `DATABASE_URL`, `JWT_SECRET`, and the SMTP/notification values from your `.env`
   - `NODE_ENV` = `production`, `TZ` = `Asia/Kolkata`
   - `DASHBOARD_URL` = `https://www.slokaacademy.com/admin/`
   - Not needed: `ALLOWED_ORIGINS` (same domain), `TRUST_PROXY` (defaults to 1 on Vercel), `PUBLIC_API_URL`
3. Create the first Super Admin from your computer against the same database (`npm run create-admin`), then sign in at `/admin/` and add everyone else under **Associates**.

How it behaves on Vercel:

- The app starts on the first request after a cold start (about 1–2 s: it opens the database and checks migrations).
- Emails, enquiry notifications and Sheets syncs that continue after a response are kept alive with `waitUntil`.
- The rate limits are kept in memory per running instance, so under load they are looser than on a single server.
- Google Sheets: there is no background timer between requests, so rows sync when a registration arrives or when staff press **Sync now** in Settings.
- Certificate-design and offer-template uploads are limited to 4 MB.
- Rendering a template page to pick its cover colours uses `@napi-rs/canvas` (an optional dependency of `pdfjs-dist` with prebuilt binaries). Where it is missing, covers default to white and can be set in the editor.

## Deployment notes (any host)

- The data is in the database, so the host needs no persistent disk. Host it close to the database region (AWS Tokyo, `ap-northeast-1`), since every query is a network round trip. Check the backup settings in the TiDB Cloud console.
- Serve over **HTTPS** and set `NODE_ENV=production`. That enables `Secure`/`__Host-` cookies and HSTS.
- Serve the website, the portal (`/admin/`) and the API (`/api/`) from one origin: the staff session cookie is `SameSite=Strict` and the portal calls `/api` on its own origin.
- Behind a proxy or load balancer, set `TRUST_PROXY` (usually `1`). Without it, rate limits see the proxy's IP and every visitor shares one limit.
- Set `TZ=Asia/Kolkata`.

## Data protection

- Public forms require explicit consent; the consent timestamp is stored. Staff confirm consent for phone and walk-in entries.
- Only the fields listed above are stored. IP addresses and user agents are **not** stored. IPs are held in memory only, for up to 15 minutes, for rate limiting.
- Access is limited to signed-in, active associates, and every permission (and the data scope) is enforced on the server. Changes are recorded in the audit log.
- Associates with the delete permissions can permanently delete an enquiry and its notes, a certificate registration and its activity log, an internship registration with its payments and offer letter, or a whole student with everything linked to them, on request. Remember that the database's backups (TiDB Cloud keeps them for its retention period), the former SQLite file, and rows already copied to the Google Sheet still contain the data.
- Registrations and referred friends are copied to Google Sheets, and certificates, offer letters and associate invites are sent through your email provider; both are third-party processors. Keep the sheet's sharing Restricted to staff who need it (the Apps Script does not need link sharing), and keep the script's secret private.
- Referred friends did not give their details themselves. The form asks the student to confirm each friend agreed; admissions should say who referred them when they call and delete the details of anyone who doesn't want to be contacted.
- The public verification endpoint reveals only the name, session, issue date and status of a certificate. It never reveals email, phone or college.
- Requirements under India's **Digital Personal Data Protection Act, 2023** (notice wording, retention periods, grievance contact, breach reporting and so on) should be confirmed with a legal adviser. This software does not by itself make you compliant.
