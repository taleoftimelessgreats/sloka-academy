# Sloka Academy — API

The API behind the Sloka Academy website and its staff admin portal. It does four jobs:

1. **Career Guidance Certificate form**: students who attended a career guidance session fill in the form on the website (`/certificate/`) with the session code. The certificate of participation is issued immediately: they download it on the spot, it is **emailed to them as a PDF**, and the registration is **copied to a Google Sheet**. Anyone can verify a certificate by its ID.
2. **Master student database**: every career guidance registration and every Internship Course Program enquiry is linked to one student record with its own **Student ID** (e.g. `SLK-STU-2026-00042`). Students are matched by email or mobile number, so a returning student is never added twice and staff see each student's full history.
3. **Internship enquiries**: `POST /api/public/inquiries` receives the Pre-register (Internship Course Program), Contact and Brochure-download forms. This process is separate from the certificate form; the two only share the student records.
4. **Admin portal**: a small vanilla-JS app that is part of the website (`sloka-academy-frontend/public/admin`, served at `/admin/`, sign in at `/admin/#/login`); this server provides its API. Staff work with students, sessions, certificates and enquiries; managers and admins also run sessions, certificate designs (uploaded templates), settings and users. See [Roles](#roles).

This server serves **API routes only** (`/api/...`); anything else is a JSON 404. Staff reach the portal from the website's Sign in page (`/login/`). Every response carries `X-Robots-Tag: noindex, nofollow`, and the website's `robots.txt` disallows `/admin/` and `/api/`.

On Vercel the website, the portal and this API run as **one project on one domain**: see [Deploying on Vercel](#deploying-on-vercel).

Stack: Node ≥ 22.13 (developed on 24), Express 5, a MySQL-compatible database (TiDB Cloud) through `mysql2`, `bcryptjs`, `jsonwebtoken`, `nodemailer`, `pdf-lib`. There is no build step.

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

**Moving data over from the former SQLite database.** `npm run import-sqlite` copies `DB_PATH` (default `./data/sloka.db`) into `DATABASE_URL`. To read another file, pass it after `--`, e.g. `npm run import-sqlite -- path/to/file.db`.
- Ids, Student IDs, certificate IDs, download links, passwords and signed-in sessions stay the same, and rows already copied to the Google Sheet are not sent again.
- The SQLite file is only read.
- The script refuses a target database that already has data. `--replace` deletes that data first, which is useful to copy again just before switching over.

**Creating the first admin.** `npm run create-admin` prompts for the details. Git Bash/mintty has no interactive TTY, so there you either run it from PowerShell/cmd or pass the values as environment variables:

```bash
ADMIN_NAME="Anita" ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-long-password' npm run create-admin
```

Admins create everyone else under **Users** in the dashboard (managers can add counsellors and managers too).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `DATABASE_URL` | none, **required** | `mysql://USER:PASSWORD@HOST:PORT/DATABASE`. See [Database](#database). |
| `DB_PATH` | `./data/sloka.db` | The former SQLite file. Only `npm run import-sqlite` reads it. |
| `TEST_DATABASE_URL` | the server in `DATABASE_URL` | Database server for `npm test`. See [Tests](#tests). |
| `JWT_SECRET` | none, **required** | ≥ 32 chars. The server refuses to start without it. |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated **other** origins allowed to call the public endpoints (exact match). Pages on the API's own domain are always allowed. |
| `TRUST_PROXY` | off (`1` on Vercel) | Set behind a reverse proxy: `1` (number of hops), `loopback`, or proxy IPs. Needed for correct client IPs in rate limiting. |
| `DASHBOARD_URL` | `http://localhost:3000/admin/` | Public URL of the staff portal (part of the website). Used for links in team notifications. Production: `https://www.slokaacademy.com/admin/`. |
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

## Roles

| Role | Can |
|---|---|
| **Counsellor** | Work enquiries (add, update, assign, note), view students, sessions and certificates, download and re-send a certificate |
| **Manager** | Everything a counsellor can, plus everything an admin can **except**: export or download student data (CSV exports, and changing the Google Sheet link, since a new sheet receives every registration), edit or delete records (student profiles, certificate corrections, permanent erasure, deleting sessions and designs), and deleting users (deactivating staff accounts). Managers cannot create, change or reset the password of an admin account. |
| **Admin** | Everything |

The rules live in `PERMISSIONS` in `src/constants.js`. `GET /api/auth/me` and the login response include the user's `permissions`, which the portal uses to show or hide controls. In the tables below, **manager** means managers and admins.

## Staff API (same-origin, cookie session)

The session is an httpOnly, `SameSite=Strict` cookie holding an 8-hour JWT. The user is re-loaded from the database on every request, so deactivating a user, changing their role or resetting their password takes effect immediately. Failed logins are limited to 5 per email+IP and 30 per IP every 15 minutes. State-changing requests from another site are refused with 403, based on `Sec-Fetch-Site` and `Origin`.

| Method & path | Who | Notes |
|---|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/password` | staff | Login body: `{email, password}`. Password change: `{currentPassword, newPassword}`. |
| `GET /api/meta` · `GET /api/staff` | staff | Labels/enums, and staff for assignee pickers |
| `GET /api/stats` | staff | Overview: `students`, `pendingVerifications`, `certificates` (see below), `sessions` (latest 6), `recentRegistrations`, `system` (email on/off, Google Sheet state, default design), plus the enquiry pipeline: `newCount`, `dueToday`, `overdue`, `byStatus`, `byStream`, `byPlan` |
| `GET /api/students` | staff | Master student list. Filters: `q` (name/email/phone/college/Student ID), `program` (`career-guidance`\|`internship`), `stream`, `yearOfStudy` (`none` = not specified), `sessionId`, `sort` (`recent`\|`name`\|`created`), `page`, `pageSize` ≤ 100 |
| `GET /api/students/:id` | staff | `{student, certificates, enquiries, verifications}`. `student.programs` holds the programme tags; `verifications` are records waiting to be verified against this profile. The list also returns `programs` per student and `pendingVerifications` (records waiting anywhere). |
| `GET /api/verifications?status=open\|closed\|all` · `GET /api/verifications/:id` | staff | Records waiting for profile verification: the profile, the submitted details and the fields that differ. Enquiry and certificate details include their open `verification`. |
| `POST /api/verifications/:id/resolve` | manager | `{action}`: `link` (keep the profile as it is), `new_profile` (a different person), or `update` (accept the submitted details, **admin** only) |
| `PATCH /api/students/:id` | admin | Profile: `name`, `email`, `phone`, `college`, `stream`, `yearOfStudy`. The email and mobile number must not belong to another student. |
| `DELETE /api/students/:id` | admin | Permanent erasure of the student and **all** their registrations, certificates and enquiries |
| `GET /api/students/export` | admin | CSV with the list filters |
| `GET /api/inquiries` | staff | Filters: `status`, `source`, `stream`, `plan`, `yearOfStudy` (`none` = not specified), `assignedTo` (`id`\|`me`\|`none`), `followUp` (`today`\|`overdue`\|`due`), `q`, `sort` (`createdAt`\|`updatedAt`\|`nextFollowUp`\|`name`\|`status`), `dir`, `page`, `pageSize` ≤ 100 |
| `POST /api/inquiries` | staff | Manual `phone-call` / `walk-in` enquiry. `consent: true` confirms the enquirer agreed. |
| `GET /api/inquiries/:id` · `PATCH /api/inquiries/:id` | staff | PATCH accepts status, assignedTo, nextFollowUp (`YYYY-MM-DD`/null) and the contact/interest fields. Each change is appended to the timeline. |
| `POST /api/inquiries/:id/notes` | staff | `{body}`. Notes are append-only. |
| `GET /api/inquiries/export` | admin | CSV with the same filters as the list. See below. |
| `DELETE /api/inquiries/:id` | admin | Permanent erasure of the enquiry and its notes |
| `GET/POST /api/users` · `PATCH /api/users/:id` · `POST /api/users/:id/password` | manager | Users are deactivated, never deleted; only admins deactivate. Only admins can create admins or change/reset an admin account. Nobody can change their own role or deactivate themselves, or remove the last admin. |

All CSV exports (enquiries and certificates) are built for Excel: UTF-8 with a BOM, CRLF line endings and human-readable labels. Any cell starting with `= + - @`, a tab or a CR is prefixed with `'` to block formula injection. Phones are exported as the 10-digit national number (`9492631715`), so Excel shows them as-is.

"Due today" and "overdue" use the server's local date and exclude enquiries that are `enrolled` or `not-interested`. Conversion counts use each enquiry's current status.

## Master student database

The `students` table holds one profile per student. Each career guidance registration and each enquiry is its own record, with its own details and timestamps, and points to a profile (`student_id`). A profile can have any number of them. Its **programme tags** come from those records: certificate registrations are Career Guidance, enquiries are the Internship Course Program (`PROGRAMS` in `src/constants.js`).

Each email and each mobile number belongs to at most one profile, which unique indexes enforce. A new registration or enquiry is compared with the profiles that have its email or its mobile number (`src/studentMatch.js`). Names, colleges and emails are compared without regard to letter case or extra spaces, and fields left blank on the form are not compared.

- **No match:** a new profile with a new Student ID.
- **Same details:** the record is linked to that profile. Fields the profile was missing are filled in; nothing is overwritten.
- **Different details** (e.g. another name or college, or a new email with a known number): the profile is **not** changed and the record is not linked yet. It is saved as **pending verification**:
  - A 6-digit code is emailed to the address **already on the profile**, and the website form asks for it. With the right code the profile takes the submitted details and the record is linked.
  - Codes expire after 10 minutes. After 5 wrong codes, or when no code could be sent, the record stays pending for staff. A code can't be sent when the profile has no email, email is off, or the address reached its daily limit.
  - Staff see waiting records under **Students → Profile verification** and on the record itself, side by side with the profile. A manager or admin decides: link it and keep the profile as it is; link it and take the submitted details (admins only, since it edits a profile); or, for a different person, give it a profile and Student ID of its own. An email or number that belongs to the existing profile stays with it.
- **The email belongs to one profile and the number to another:** the record waits for verification against the email's profile.

A few other cases:
- A session gives one certificate per person: registering again with the same email, or the same mobile number under another email, gets the "already registered" answer.
- Staff cannot give a profile an email or mobile number that another student already has.
- Editing an enquiry's contact details changes the enquiry only, never the profile. If the edited details now point to a different student, the enquiry waits for verification.
- Correcting a certificate's email in the portal links it to the student with that email, without changing their profile. If the old address was only ever used by that registration (a typo), the profile's email is corrected instead.
- Deleting the last registration or enquiry of a student also deletes the empty profile. Deleting a student deletes everything linked to them. Records from other people that were waiting to be verified against that profile get profiles of their own.

**Student IDs** look like `SLK-STU-2026-00042`: the prefix, the year the student was first seen and a number that counts up within that year. A new student gets one in the same transaction that creates their record; students from before Student IDs existed get one when the server starts. Numbers are never reused, even after an erasure, and an ID never changes. It is shown in the portal, searchable on Students, included in the CSV exports and the Google Sheet, returned to the student after a certificate registration (`certificate.studentId`, null while the registration waits for verification) and printed in the certificate email.

## Career guidance certificates

Staff create a **session** (title, date, venue, in-person/online, optional closing time, optional certificate design). Each session gets a 6-character code from an alphabet without look-alikes (no 0/O/1/I/L), or managers and admins set their own (6–20 letters/digits). The code is announced at the end of the session. A student who enters the correct code on the website gets their certificate **immediately**; there is no approval step.

The website form works in two steps. First it sends the registration with `preview: true`: the server checks it exactly as it would a registration (fields, session, code, an earlier registration) and answers with the certificate as it would be printed, stamped **PREVIEW** and with `SLK-<year>-XXXXXXXX` in place of the ID. Nothing is stored. The student checks their name and confirms, and the form sends the same registration again without `preview`, which issues the certificate. The website then shows the issued certificate (`/certificates/:id/preview`) with the download button. The Verify page shows the same view of the certificate under a successful check (stamped REVOKED if it was withdrawn).

After a successful registration the server, in the background:

1. generates the PDF and **emails it as an attachment** (with a personal download link and the verify link) when SMTP is configured. Each registration records the email status: `sent`, `failed` (with the mail server's reason), `pending` or `off` (email not configured). Failed emails show on the Overview; staff can correct the address and send again, and managers and admins can resend all failed ones at once;
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

Managers and admins upload certificate artwork in **Settings → Certificate designs**: a PDF (its first page is used), PNG or JPEG of up to 4 MB, designed **without** the student's details. In the layout editor they choose where each detail is printed (student name, college, session title, session date, venue, issue date, certificate ID, verification link) by position (% across and down the page), size, standard PDF font, colour, alignment, maximum width (long text shrinks to fit) and optional text before it, with a live PDF preview.

- One design is the **default** for new certificates; until one is chosen, the built-in Sloka design is used. A session can pick a different design.
- Each certificate **keeps the design it was issued with**, even if the default changes later. Editing a design's layout changes how its issued certificates look when downloaded again (the portal warns about this).
- Designs used by certificates or sessions cannot be deleted, only archived.
- Uploaded files are checked: real PDF/PNG/JPEG content, not password-protected, a usable first page, images at least 600 × 400 px (1754 × 1240 recommended).

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

| Method & path | Who | Notes |
|---|---|---|
| `GET /api/sessions` · `GET /api/sessions/:id` | staff | Includes the code, the registration count, `templateId` and `studentLink` |
| `POST /api/sessions` · `PATCH /api/sessions/:id` | manager | `{title, sessionDate, venue, mode, description, code, registrationOpen, closesAt, templateId}`. Title and venue must be printable in the PDF fonts. `templateId: null` = the default design. |
| `POST /api/sessions/:id/regenerate-code` | manager | |
| `DELETE /api/sessions/:id` | admin | `409 has_registrations` if any student registered. Close registration instead. |
| `GET /api/sessions/:id/export` | admin | CSV of that session's registrations |
| `GET /api/certificates` | staff | `q` (name/email/phone/college/certificate ID), `sessionId`, `studentId`, `status` (`issued`\|`revoked`), `emailStatus` (`sent`\|`failed`\|`pending`\|`off`), `page`, `pageSize` |
| `GET /api/certificates/:id` · `GET /api/certificates/:id/pdf` | staff | Detail with the activity log. The staff PDF copy is not counted as a download, and is watermarked if revoked. |
| `POST /api/certificates/:id/resend` | staff | Emails the PDF again with a new download link (the old link stops working). Waits for the mail server and returns `result: "sent"\|"failed"`. Needs SMTP. |
| `POST /api/certificates/retry-emails` | manager | `202 {queued}`: resends every valid certificate whose email failed, in the background |
| `PATCH /api/certificates/:id` | admin | `{name?, email?}`. Corrections are logged old → new. |
| `POST /api/certificates/:id/revoke` · `POST /api/certificates/:id/reinstate` | manager | Revoking requires `{reason}`. |
| `DELETE /api/certificates/:id` | admin | Permanent erasure of the registration and its activity log |
| `GET /api/certificates/export` | admin | CSV of all certificates, with the list filters |
| `GET /api/templates` | staff | Designs (without files), field/font lists, `builtInIsDefault` |
| `POST /api/templates?name=…` | manager | Upload: the raw file as the body with `Content-Type: application/pdf`, `image/png` or `image/jpeg`. `400 fields.file` explains rejected files; `413` over 4 MB (Vercel refuses request bodies over 4.5 MB). |
| `GET /api/templates/:id` · `GET /api/templates/:id/file` | manager | Detail with layout; the original file |
| `PATCH /api/templates/:id` | manager | `{name?, layout?, archived?}`. Layout errors come back per field, e.g. `fields["name.x"]`. |
| `PUT /api/templates/default` | manager | `{id}`, or `{id: null}` for the built-in design |
| `POST /api/templates/preview` | manager | `{templateId?, layout?}` → sample certificate PDF (unsaved layouts allowed) |
| `DELETE /api/templates/:id` | admin | `409 in_use` if certificates or sessions use it (archive instead) |
| `GET /api/settings` | manager | Google Sheet status (web app URL, sheet name and link, rows waiting, last sync/error) and email status |
| `GET /api/settings/google-sheet/script` | admin | `{script}`: the Apps Script to paste into the sheet (contains the shared secret) |
| `PUT /api/settings/google-sheet` | admin | `{url}`: the web app URL ending in `/exec` (empty disconnects). Returns `check: {ok, title}` or `{ok: false, message}`. |
| `POST /api/settings/google-sheet/test` · `POST /api/settings/google-sheet/sync` | manager | Check access; copy waiting rows now |

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
- Students: matching across sessions and enquiries (by email and by phone), Student IDs, programme tags, filters, profile edits, CSV export, erasure, the database's own rules (roles, one profile per email and per number), and the SQLite import.
- Profile verification and email: same details link without changes, different details wait (wrong, expired and resent codes, locking after 5 wrong codes), staff decisions and who may make them, staff edits, erasure of a profile others were waiting on, and the daily email limit (5 per address of any kind, failed sends not counted, daily reset, team notifications included).
- Designs: layout validation, uploads (PDF, PNG, junk, empty pages, tiny images, oversized files), previews, the default and per-session designs, issued certificates keeping their design, archive/delete rules.
- Google Sheets: web app URL parsing, and syncing through the real Apps Script source run against a fake spreadsheet (tabs and headers, back-fill, new rows, referred friends, plain-text values, no duplicates on resend), the wrong-secret, private-deployment and missing-URL errors and retry, and who may see the script.
- Refer a friend: required friends and fields, referral enquiries linked to the registration without profiles or certificates, no duplicates on a repeat registration, the CSV column, and erasure.
- Certificate previews: the PREVIEW PDF before issuing stores nothing and is checked like a registration; the issued certificate's view (also when revoked) and not found.

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
3. Create the first admin from your computer against the same database (`npm run create-admin`), then sign in at `/admin/`.

How it behaves on Vercel:

- The app starts on the first request after a cold start (about 1–2 s: it opens the database and checks migrations).
- Emails, enquiry notifications and Sheets syncs that continue after a response are kept alive with `waitUntil`.
- The rate limits are kept in memory per running instance, so under load they are looser than on a single server.
- Google Sheets: there is no background timer between requests, so rows sync when a registration arrives or when staff press **Sync now** in Settings.
- Certificate-design uploads are limited to 4 MB.

## Deployment notes (any host)

- The data is in the database, so the host needs no persistent disk. Host it close to the database region (AWS Tokyo, `ap-northeast-1`), since every query is a network round trip. Check the backup settings in the TiDB Cloud console.
- Serve over **HTTPS** and set `NODE_ENV=production`. That enables `Secure`/`__Host-` cookies and HSTS.
- Serve the website, the portal (`/admin/`) and the API (`/api/`) from one origin: the staff session cookie is `SameSite=Strict` and the portal calls `/api` on its own origin.
- Behind a proxy or load balancer, set `TRUST_PROXY` (usually `1`). Without it, rate limits see the proxy's IP and every visitor shares one limit.
- Set `TZ=Asia/Kolkata`.

## Data protection

- Public forms require explicit consent; the consent timestamp is stored. Staff confirm consent for phone and walk-in entries.
- Only the fields listed above are stored. IP addresses and user agents are **not** stored. IPs are held in memory only, for up to 15 minutes, for rate limiting.
- Access is limited to logged-in staff, and admin-only actions are enforced on the server.
- Admins can permanently delete an enquiry and its notes, a certificate registration and its activity log, or a whole student with everything linked to them, on request. Remember that the database's backups (TiDB Cloud keeps them for its retention period), the former SQLite file, and rows already copied to the Google Sheet still contain the data.
- Registrations and referred friends are copied to Google Sheets and certificates are sent through your email provider; both are third-party processors. Keep the sheet's sharing Restricted to staff who need it (the Apps Script does not need link sharing), and keep the script's secret private.
- Referred friends did not give their details themselves. The form asks the student to confirm each friend agreed; admissions should say who referred them when they call and delete the details of anyone who doesn't want to be contacted.
- The public verification endpoint reveals only the name, session, issue date and status of a certificate. It never reveals email, phone or college.
- Requirements under India's **Digital Personal Data Protection Act, 2023** (notice wording, retention periods, grievance contact, breach reporting and so on) should be confirmed with a legal adviser. This software does not by itself make you compliant.
