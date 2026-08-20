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

You need Node 20+ and a PostgreSQL database. Anything that speaks Postgres
works — one on your laptop, an RDS or Aurora endpoint, or a Render PostgreSQL
instance.

```bash
git clone <this repo>
cd kmidshackathonportal
npm install

cp .env.example .env.local     # set DATABASE_URL and the owner addresses
npm run db:setup -- --seed     # roles, schema, demo content
npm run dev                    # http://localhost:3000
```

Sign in as **june@kmids.ac.th** — no password, and the demo data gives you a
portal with content in it rather than a set of empty screens.

`db:setup` is resumable and safe to re-run: it records which migrations have
already applied and skips them. `--seed` refuses to touch a database that
already has users in it.

If you only want to know whether the connection works:

```bash
npm run db:setup -- --check
```

### The database

One connection, one URI. The app connects as a single PostgreSQL user and
switches role per request, so the RLS policies in `db/migrations` decide what
each person can see — see *How permissions work*.

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

A password containing punctuation has to be URL-encoded (`@` becomes `%40`).
TLS is decided from the host: required for anything remote, off for
`localhost`. Certificates are verified against `certs/rds-global-bundle.pem`,
AWS's public RDS trust store; set `RDS_CA_CERT` for a provider that uses its
own root. Add `?sslmode=disable` only for a host that terminates TLS itself.

The database user needs to be able to create the `anon`, `authenticated` and
`service_role` roles and grant them to itself, which `db:setup` does on the
first run. On RDS the master user can do this; on a managed instance where it
cannot, ask an admin to run that step once. Extensions (`pgcrypto`, `pg_trgm`)
also need a superuser or `rds_superuser` on the first run.

---

## Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | The full PostgreSQL connection URI |
| `OWNER_EMAIL` | yes | First Owner; becomes T4 on first sign-in |
| `OWNER_BACKUP_EMAIL` | no | Second Owner, so one graduating student is not a single point of failure |
| `SCHOOL_EMAIL_DOMAIN` | no | Defaults to `kmids.ac.th`. Addresses here may sign in without an invite |
| `DATABASE_POOL_MAX` | no | Connections held per instance. Defaults to 8 |
| `RDS_CA_CERT` | no | Overrides the committed CA bundle |

`DATABASE_URL` is also read from `POSTGRES_URL`, `POSTGRESQL_URL`,
`RDS_DATABASE_URL` and `PG_CONNECTION_STRING`, so a value injected under one of
those names works without being copied into a second variable.

**`/api/health/db` is where you find out what is wrong with a deployment.** It
names any missing variable and where its value comes from, then says whether
the connection works and whether the schema has been applied. It is reachable
without signing in, because the deploy you most need to diagnose is the one
where nobody can sign in yet.

There is deliberately no "finish setting up" screen gating the app. One was
tried and removed: a gate that is wrong about a single alias hides an app that
works perfectly, which is worse than the digest it was replacing. A missing
variable now throws a named error server-side, and the health endpoint explains
it.

---

## Deploying to Render

The repository carries a `render.yaml`, so **New → Blueprint** pointed at this
repo sets the service up and asks for the three values it cannot guess. By
hand it is:

1. **New → Web Service**, connect the repository, runtime **Node**.
2. Build command `npm ci && npm run build`, start command `npm start`.
3. Under **Environment**, set `DATABASE_URL`, `OWNER_EMAIL` and
   `OWNER_BACKUP_EMAIL`.
4. Health check path `/api/health/db`.
5. Apply the schema once, from your machine, with `DATABASE_URL` pointed at the
   same database: `npm run db:setup`.

If the database is on RDS, it has to accept connections from the service:
publicly accessible, with a security group allowing inbound TCP 5432 from
Render's outbound addresses. Render lists those under the service's
**Connect** tab.

Sessions live in the database and on the device, so a deploy signs nobody out.

**Run one instance.** Live document editing is fanned out in process (see
`src/lib/collab/hub.ts`), so two instances would put two editors of the same
document in different rooms — they would each fall back to editing alone
rather than merging. Everything else scales out fine; if you ever need to,
that module is the one thing to move onto a shared channel.

**Custom domain:** add it under **Settings → Custom Domains**. Public form
links use the request's own host, so they follow the new domain automatically.

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
the table itself. Each request runs inside a transaction that writes the user
id into `request.jwt.claims` and switches to the `authenticated` role, so the
rows that come back are already filtered by those policies. There is no "and
also check the tier in JavaScript" step, because that would be a second source
of truth that could drift.

`src/lib/permissions.ts` mirrors the same rules, but only so the UI does not
offer buttons the database is going to refuse. It is not a security boundary.
If you change one, change both.

### The tiers

| Tier | Name | Scope |
| --- | --- | --- |
| `T0` | Advisor | Reads everything except the Owner Console and interview/performance data. Can comment. Cannot create, edit or delete. |
| `T1` | Member | Reads own department + General. Creates and edits own documents, sheets and files. Updates assignments assigned to them. Comments. |
| `T2` | Department Head | Full read/write in own department. Creates and assigns assignments. Approves deliverables. Read-only elsewhere. |
| `T3` | Administration | Full read/write across all departments. Publishes all-staff announcements. All analytics. **Cannot** manage users or read the audit log. |
| `T4` | Owner | Everything in T3, plus the Owner Console: users, tiers, invites, suspensions, bans, audit log, exports, ownership transfer. |

Once the server knows who is asking, it opens a transaction, writes
`{"sub": "<user id>"}` into `request.jwt.claims` and switches to the
`authenticated` role. Both settings are transaction-local, so a connection
handed back to the pool carries no trace of the user it just served.

**The claim carries an id and nothing else that matters** — tier, status and
department are read from the `users` table by the policy helpers on every
call, so nothing about a request can widen anyone's access on its own.

### The escalation guard

The single most important trigger in the schema is
`app.guard_user_privileges()` in `0020_identity.sql`. Without it, the
"edit your own profile" policy would let any student `PATCH` their own row to
tier `T4` straight from devtools. It refuses tier, status and ban changes from
any non-Owner token, and refuses to demote the last remaining Owner.

The Owner Console works around it deliberately, going through `admin()` after
establishing the Owner's authority in the application layer. Every one of
those actions writes to the audit log.

---

## Testing

```bash
npm test          # unit tests — SQL compiler, permissions, forms, sheets, collab
npm run typecheck # TypeScript, strict mode
npm run build     # production build
npm run smoke     # drives the real app in a browser (needs it running)
```

### The SQL compiler tests

`src/lib/db/query.ts` is what turns a query description into SQL, so the whole
data layer rides on it. `tests/query.test.ts` pins the exact statement for
every shape the app uses — a change that quietly drops a filter would
otherwise surface as an empty page rather than as a failure.

A string assertion cannot tell you the SQL is *valid*, though, so
`tests/query.integration.test.ts` sends every shape to a real server and checks
Postgres accepts it. It skips unless `TEST_DATABASE_URL` is set:

```bash
TEST_DATABASE_URL="$DATABASE_URL" npm test
```

Worth running against a database with the schema applied. It catches the class
of bug where the generated SQL reads perfectly and the server refuses it.

### The browser smoke tests

`npm run smoke` signs in and exercises the flows that matter: creating a task,
commenting, the approval gate, view-as being read-only while keeping console
access, the logged-out public form and its conditional branching, phone
check-in, and the document editor's autosave and version history. It exits
non-zero on failure.

Start the app first (`npm run dev` in another terminal). These have found
several bugs the type checker and unit tests both passed over — autosave
silently never firing, and a collaborative document opening empty — so they
are worth running before a release.

### The database permission tests

These matter most. `tests/sql/rls_test.sql` connects as the same
`authenticated` Postgres role the app switches into, and impersonates real
users by setting `request.jwt.claims` — which is exactly what the database sees
on every request the portal makes.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls_test.sql
```

Or against a throwaway local Postgres:

```bash
createdb hackathon_studio
DATABASE_URL=postgresql://localhost:5432/hackathon_studio npm run db:setup
psql -v ON_ERROR_STOP=1 -d hackathon_studio -f tests/sql/rls_test.sql
```

It proves, among other things, that a student cannot promote themselves to
Owner, that suspended accounts read nothing, that the audit log cannot be
edited *even by the Owner*, and that `DELETE` only ever soft-deletes. See
`tests/sql/README.md` for the full list.

**If you change a policy, run this before you deploy.**

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
    api/
      collab/         the live-editing channel (SSE in, POST out)
      files/          serves an uploaded file, with permissions applied
      health/db       is the database reachable, and is the schema applied
      export/         full data export; documents/[id]/export for one document
  components/         shared UI — shell, ECG motif, avatar, tier badge
  features/           one folder per feature, components + server actions
  lib/
    db/
      client.ts       admin() / asUser() / asAnon() — the handle everything uses
      query.ts        turns a query description into parameterised SQL
      relations.ts    which key points where, for inline related rows
      pool.ts         the connection pool
      reads.ts        reads shared across several screens
    permissions.ts    tier logic, mirrored from the RLS policies
    audit.ts          the audit-log writer used by every mutation
    auth/             session and sign-in
    collab/           Yjs provider, its transport, and the fan-out hub
    files/            uploaded file contents
db/migrations/        schema and RLS, in filename order
db/seed/              optional demo content
certs/                AWS's public RDS trust store, for verifying TLS
tests/                unit tests; tests/sql holds the RLS suite
```

Components are colocated by feature, not by type. A server action lives next
to the screen that calls it.

### Conventions worth keeping

- Every mutation is a Server Action that validates with Zod, writes through
  `asUser()` so RLS applies, and records an audit entry. `admin()` bypasses
  RLS and is for the handful of things that genuinely cannot go through a
  user: resolving a session cookie, provisioning an account, writing the audit
  log, and applying Owner Console decisions the escalation trigger refuses.
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
  shipping a headless browser — a lot of weight for a feature used a handful of
  times a term. DOCX export is a genuine `.docx`.
- **Live collaboration is scoped to one instance.** Documents merge through Yjs
  over a Server-Sent Events channel, fanned out in process by
  `src/lib/collab/hub.ts`. Run one web instance, or two people editing the same
  document may land in different rooms and each fall back to editing alone.
  Moving that module onto a shared channel is the only change needed to scale
  out; nothing above it would notice.
- **Collaboration works on documents, not spreadsheets.** When the channel is
  unreachable the editor falls back to single-user autosave and says so, rather
  than refusing to open. Spreadsheets are still last-write-wins — the schema
  carries `yjs_state` for them but the grid is not wired up.
- **Uploaded files are stored in the database**, in `file_blobs`, capped at
  50 MB each with anything larger added as an external link. That keeps a
  database backup a complete backup and leaves no second set of credentials to
  rotate, at the cost of putting large objects somewhere they are not
  especially cheap. `src/lib/files/storage.ts` is the whole surface if that
  trade ever stops making sense.
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
