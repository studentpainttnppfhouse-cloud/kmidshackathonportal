# Hackathon Studio

Internal staff portal for **KMIDS Hackathon 2027** — MedTech & Digital Health,
20–21 March 2027, KMIDS Building 7th floor, Bangkok.

Built for 25–40 high-school student staff and 6 teachers across six
departments, with heavy phone usage on the event days themselves.

> **If you are the student maintaining this next year, start here.** The
> sections below cover local setup, the environment variables, how permissions
> work, and how to deploy. `SCHEMA.md` explains every database table in plain
> language.

---

## Quick start

```bash
git clone <this repo>
cd kmidshackathonportal
npm install
cp .env.example .env.local     # then fill it in — see below
npm run dev                    # http://localhost:3000
```

You need a Supabase project before the app will render anything. Setting one
up takes about ten minutes.

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a project.
2. Go to **Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` *(never put this in the browser)*
3. Go to **Settings → API → JWT Settings** and copy the **JWT Secret** →
   `SUPABASE_JWT_SECRET`.

### 2. Run the migrations

In the Supabase dashboard, open **SQL Editor** and run each file in
`supabase/migrations/` **in filename order**:

```
0010_foundation.sql      extensions, enums, RLS helpers, the audit log
0020_identity.sql        departments, users, invites, invite keys, sessions
0030_work.sql            assignments, comments, announcements, notifications
0040_content.sql         folders, documents, spreadsheets, files
0050_forms.sql           forms and responses
0060_social_event.sql    content calendar, run sheet, check-ins, incidents
0070_seed.sql            the six departments and the event-day reference data
0080_bootstrap_owner.sql the owner bootstrap helper
0090_grants.sql          table privileges — must be last
```

Order matters. `0090_grants.sql` applies to every table created before it, so
running it early silently leaves later tables unreachable.

Or, with the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

### 3. Create the storage bucket

**Storage → New bucket**, named `files`, **public**. This holds uploaded
images, PDFs and design exports. The 50 MB per-file cap is enforced in the
upload action, in the database constraint, and in the UI.

### 4. Set the Owner emails

`OWNER_EMAIL` and `OWNER_BACKUP_EMAIL` become Owner (T4) accounts the first
time they sign in. **Two Owners always exist** so that one graduating student
is never a single point of failure.

If Owner access is ever lost, changing `OWNER_EMAIL` and signing in with that
address restores it — the app repairs the account back to T4 on sign-in.

---

## Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public anon key; safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server only.** Bypasses all RLS |
| `SUPABASE_JWT_SECRET` | yes | Signs the PostgREST token (see *How sign-in works*) |
| `OWNER_EMAIL` | yes | First Owner, created at T4 on first sign-in |
| `OWNER_BACKUP_EMAIL` | recommended | Second Owner |
| `SCHOOL_EMAIL_DOMAIN` | no | Defaults to `kmids.ac.th` |

`.env.local` is gitignored. Never commit real keys.

---

## How sign-in works

**Email only. No password, no OAuth.** You type your school address and you
are in, and the device stays signed in for a year.

That is a deliberate trade for an internal, invite-only staff portal: the cost
of a forgotten password at 7 AM on event morning is higher than the cost of
someone typing a colleague's address. **Anyone who knows a staff email can
sign in as them**, so the tier system — not the login — is what actually
protects anything, and every action is attributed in the audit log.

### The four ways in

Nobody gets in unless the Owner has let them in.

1. **Owner bootstrap** — an address in `OWNER_EMAIL` or `OWNER_BACKUP_EMAIL`
   becomes T4 automatically.
2. **Direct invite** — the Owner adds addresses in the Owner Console with a
   pre-set tier and department. Signing in creates the account with those
   already applied. Bulk paste of comma, space or newline separated addresses
   is supported.
3. **Invite key** — a shareable code carrying a tier, department, expiry and
   max-uses counter. Good for onboarding a whole department at once. Revoking
   a key does not remove accounts already created with it.
4. **Access request** — a school address with no invite gets an account with
   status `requested` and **access to nothing**. They see a waiting screen; the
   Owner approves or rejects them from the queue.

Anything that is not a school address and has no invite is refused, and the
attempt is recorded.

### Staying signed in across deploys

The session lives in two places that both survive a redeploy: a one-year
`httpOnly` cookie on the device, and a row in `device_sessions`. Nothing is
held in server memory, so **shipping a new build does not sign anyone out**.
The expiry rolls forward whenever a device is used, so an active phone never
gets logged out.

The cookie holds a 32-byte random token; only its SHA-256 hash is stored, so a
leaked database dump does not hand over live sessions. Suspending or banning
someone revokes all their sessions immediately.

Manage your own devices under **Settings → Signed-in devices**.

---

## How permissions work

**Permissions are enforced in the database, not the UI.** Hiding a button is
not security — assume a student will open devtools and call the API directly.

Every table has Row-Level Security policies, written in the same migration as
the table itself. The app talks to PostgREST as the signed-in user, so the
rows that come back are already filtered. There is no "and also check the tier
in JavaScript" step, because that would be a second source of truth that could
drift.

### The tiers

| Tier | Name | Scope |
| --- | --- | --- |
| `T0` | Advisor | Reads everything except the Owner Console and interview/performance data. Can comment. Cannot create, edit or delete. |
| `T1` | Member | Reads own department + General. Creates and edits own documents, sheets and files. Updates assignments assigned to them. Comments. |
| `T2` | Department Head | Full read/write in own department. Creates and assigns assignments. Approves deliverables. Read-only elsewhere. |
| `T3` | Administration | Full read/write across all departments. Publishes all-staff announcements. All analytics. **Cannot** manage users or read the audit log. |
| `T4` | Owner | Everything in T3, plus the Owner Console: users, tiers, invites, suspensions, bans, audit log, exports, ownership transfer. |

Since sign-in is email-only, the app mints its own HS256 JWT signed with
`SUPABASE_JWT_SECRET`. PostgREST validates it exactly as it would a Supabase
Auth token. **The token carries an id and nothing else that matters** — tier,
status and department are read from the `users` table by the policy helpers on
every call, so a stale or tampered token cannot widen anyone's access.

### The escalation guard

The single most important trigger in the schema is
`app.guard_user_privileges()` in `0020_identity.sql`. Without it, the
"edit your own profile" policy would let any student `PATCH` their own row to
tier `T4` straight from devtools. It refuses tier, status and ban changes from
any non-Owner token, and refuses to demote the last remaining Owner.

The Owner Console works around it deliberately, using the service role after
establishing the Owner's authority in the application layer. Every one of
those actions writes to the audit log.

---

## Testing

```bash
npm test          # unit tests — permissions, forms, spreadsheet, export
npm run typecheck # TypeScript, strict mode
npm run build     # production build
```

### The database permission tests

These matter most. `tests/sql/rls_test.sql` connects as the same
`authenticated` Postgres role PostgREST uses and impersonates real users by
setting `request.jwt.claims` — which is exactly what the database sees when a
student calls the API from devtools.

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls_test.sql
```

Or against a throwaway local Postgres:

```bash
createdb hackathon_studio
psql -d hackathon_studio -c "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d hackathon_studio -f "$f"; done
psql -v ON_ERROR_STOP=1 -d hackathon_studio -f tests/sql/rls_test.sql
```

It proves, among other things, that a student cannot promote themselves to
Owner, that suspended accounts read nothing, that the audit log cannot be
edited *even by the Owner*, and that `DELETE` only ever soft-deletes. See
`tests/sql/README.md` for the full list.

**If you change a policy, run this before you deploy.**

---

## Deploying to Vercel

1. Push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new).
2. Add every variable from the table above under **Settings → Environment
   Variables**, for Production *and* Preview.
3. Deploy. The build command is the default `next build`.

Because sessions live in the database and on the device, a deploy does not
sign anyone out.

**Custom domain:** add it under **Settings → Domains**. Public form links use
the request's own host, so they pick up the new domain automatically.

---

## Project layout

```
src/
  app/
    (app)/            signed-in screens; layout.tsx checks account status
    signin/           email-only sign-in
    onboarding/       first-run profile setup
    blocked/[status]  pending / requested / suspended / banned screens
    f/[slug]/         public form submission, no session needed
    api/              document export, full data export
  components/         shared UI — shell, ECG motif, avatar, tier badge
  features/           one folder per feature, components + server actions
  lib/
    permissions.ts    tier logic, mirrored from the RLS policies
    audit.ts          the audit-log writer used by every mutation
    auth/             session and sign-in
    supabase/         admin (service role) and per-user clients
supabase/migrations/  schema and RLS, in filename order
tests/                unit tests; tests/sql holds the RLS suite
```

Components are colocated by feature, not by type. A server action lives next
to the screen that calls it.

### Conventions worth keeping

- Every mutation is a Server Action that validates with Zod, writes through
  the **user's** Supabase client, and records an audit entry.
- RLS filters an `UPDATE` to zero rows rather than raising, so actions check
  for a missing row and return a readable message instead of failing silently.
- Nothing is hard-deleted. Every table has `deleted_at` and a trigger that
  turns a `DELETE` into a soft delete even if something bypasses the app.
- Every content table has `year int default 2027` so next year's team can
  archive and start clean without a second database.

---

## Known trade-offs

Called out honestly so nobody rediscovers them the hard way.

- **PDF export** renders a print-ready HTML page and opens the browser's print
  dialogue, rather than generating a PDF server-side. A real PDF would mean
  shipping a headless browser to a serverless function — a lot of weight for a
  feature used a handful of times a term. DOCX export is a genuine `.docx`.
- **Realtime collaboration** is not wired up yet. The document and spreadsheet
  schemas carry a `yjs_state` column and the editors autosave with a visible
  save state, but live cursors and presence still need Yjs + Supabase Realtime
  connecting. Two people editing the same document right now will overwrite
  each other on save.
- **Email delivery** is not connected. Invites appear in the Owner Console and
  work the moment the person signs in, but no email is actually sent — tell
  people directly, or paste them an invite key. The daily digest in §5.10 of
  the brief needs an email provider first.
- **Login has no password by design.** See *How sign-in works*.

---

## Where things are in the brief

| Brief section | Where it lives |
| --- | --- |
| §4 Owner Key & access control | `src/features/owner/`, `src/lib/auth/signin.ts` |
| §5.2 Dashboard | `src/app/(app)/dashboard/`, `src/features/dashboard/` |
| §5.5 Assignments | `src/features/assignments/` |
| §5.6 Documents | `src/features/documents/`, `src/lib/export/` |
| §5.7 Spreadsheets | `src/features/spreadsheets/`, `src/lib/sheet.ts` |
| §5.8 Forms | `src/features/forms/`, `src/lib/forms.ts` |
| §5.12 Event-Day Mode | `src/features/event/` |
| §7 Design system | `tailwind.config.ts`, `src/app/globals.css`, `/kit` |
